package auth

import (
	"bytes"
	"context"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Mesmo link em 12 pedidos simultâneos: um 200 só, uma sessão só (sem o `for update`/o
// `usado_em is null` dois pedidos passariam pela mesma checagem).
func TestDefinirSenhaConcorrenteSoUmVence(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	c.PorIP.Max = 1000
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	for rodada := 0; rodada < 3; rodada++ {
		tok := linkDe(t, c, cor, h, "pessoa@x.com")
		var wg sync.WaitGroup
		var mu sync.Mutex
		codigos := map[int]int{}
		inicio := make(chan struct{})
		for i := 0; i < 12; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-inicio
				w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"nova-senha-`+string(rune('a'+i))+`"}`, "")
				mu.Lock()
				codigos[w.Code]++
				mu.Unlock()
			}(i)
		}
		close(inicio)
		wg.Wait()
		var sess int
		p.QueryRow(context.Background(), `select count(*) from sessoes where usuario_id = $1::uuid`, uid).Scan(&sess)
		if codigos[200] != 1 || codigos[400] != 11 || sess != 1 {
			t.Fatalf("uso único furado: %v, sessões %d", codigos, sess)
		}
	}
}

// Quem roubou a senha de um super-admin entra "como" outra pessoa: a sessão tem usuario_id = alvo e
// impersonador_id = super-admin. Trocar ou redefinir a senha do super-admin tem de derrubá-la também.
func TestSessaoImpersonadaPeloDonoCaiNaDefinicaoENaTroca(t *testing.T) {
	p, s, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "super@x.com", "antiga", `{}`)
	usuarioComSenha(t, p, uid2, "alvo@x.com", "antiga", `{}`)
	imp := uid
	ladrao1, _ := s.Criar(context.Background(), uid2, "painel", &imp)
	alheia, _ := s.Criar(context.Background(), uid2, "painel", nil) // sessão do alvo, sem o super: não é da conta
	tok := linkDe(t, c, cor, h, "super@x.com")
	if w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"nova-senha"}`, ""); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	if _, err := s.Buscar(context.Background(), ladrao1); err != ErrSessaoInvalida {
		t.Errorf("definir-senha: a sessão em que o dono é impersonador continuou viva (%v)", err)
	}
	if _, err := s.Buscar(context.Background(), alheia); err != nil {
		t.Errorf("definir-senha: derrubou a sessão própria do alvo: %v", err)
	}
	ladrao2, _ := s.Criar(context.Background(), uid2, "painel", &imp)
	esta := entrar(t, h, "super@x.com", "nova-senha")
	if w := chamar(h, "POST", "/auth/trocar-senha", `{"senha":"outra-senha"}`, esta); w.Code != 204 {
		t.Fatal(w.Code, w.Body)
	}
	if _, err := s.Buscar(context.Background(), ladrao2); err != ErrSessaoInvalida {
		t.Errorf("trocar-senha: a sessão em que o dono é impersonador continuou viva (%v)", err)
	}
	if _, err := s.Buscar(context.Background(), esta); err != nil {
		t.Errorf("trocar-senha: a sessão de quem trocou caiu: %v", err)
	}
	if _, err := s.Buscar(context.Background(), alheia); err != nil {
		t.Errorf("trocar-senha: derrubou a sessão própria do alvo: %v", err)
	}
}

// Link pedido antes da troca (pode ter vazado) não vale depois dela.
func TestTrocarSenhaInvalidaLinksVivos(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	tok := linkDe(t, c, cor, h, "pessoa@x.com")
	esta := entrar(t, h, "pessoa@x.com", "antiga")
	if w := chamar(h, "POST", "/auth/trocar-senha", `{"senha":"nova-da-dona"}`, esta); w.Code != 204 {
		t.Fatal(w.Code, w.Body)
	}
	w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"do-ladrao"}`, "")
	if w.Code != 400 || !strings.Contains(w.Body.String(), "token_invalido") {
		t.Fatalf("link pedido antes da troca = %d %s", w.Code, w.Body)
	}
	entrar(t, h, "pessoa@x.com", "nova-da-dona")
}

// Nenhum Origin/Host/Referer forjado leva o link para fora da lista, e o token vai no FRAGMENTO.
func TestEsqueciSenhaVariantesDeOrigem(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	c.PorIP.Max, c.PorEmail.Max = 1000, 1000
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	for _, o := range []string{central + "/", "https://x@central.exemplo", "https://central.exemplo@ladrao.net", "//ladrao.net",
		"https://central.exemplo:443", "HTTPS://CENTRAL.EXEMPLO", `https://central.exemplo\@ladrao.net`, "https://central.exemplo.ladrao.net",
		"https://ladrao.net/https://central.exemplo", " https://central.exemplo", "https://central.exemplo%2f", "null", ""} {
		envelhecer(t, p)
		r := httptest.NewRequest("POST", "/auth/esqueci-senha", strings.NewReader(`{"email":"pessoa@x.com"}`))
		r.Header.Set("Origin", o)
		r.Host = "ladrao.net"
		r.Header.Set("X-Forwarded-Host", "ladrao.net")
		r.Header.Set("Referer", "https://ladrao.net/")
		h.ServeHTTP(httptest.NewRecorder(), r)
		esperarEnvio(t, c)
		env := cor.lista()
		if txt := env[len(env)-1].texto; !strings.Contains(txt, padrao+"/#type=recovery&token=") {
			t.Errorf("Origin %q levou a %q", o, txt)
		}
	}
}

// A resposta não espera nem o e-mail nem o banco: com o servidor de e-mail travado e a tabela de
// usuários trancada por outra transação, o "esqueci" ainda responde 202 na hora (sem canal de tempo).
func TestEsqueciSenhaNaoDependeDoEnvioNemDoBanco(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	cor.trava = make(chan struct{})
	tx, err := p.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(context.Background(), `lock table usuarios in access exclusive mode`); err != nil {
		t.Fatal(err)
	}
	for _, email := range []string{"pessoa@x.com", "ninguem@x.com"} {
		t0 := time.Now()
		w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"`+email+`"}`, "")
		if w.Code != 202 || w.Body.String() != `{"ok":true}` || time.Since(t0) > time.Second {
			t.Fatalf("%s = %d %s em %v", email, w.Code, w.Body, time.Since(t0))
		}
	}
	tx.Rollback(context.Background())
	close(cor.trava)
	esperarEnvio(t, c)
	esperarEnvio(t, c)
}

// A chave do limite por e-mail é o e-mail normalizado: caixa e espaços não dão tentativas novas.
func TestEsqueciSenhaLimiteDeEmailIgnoraCaixaEEspacos(t *testing.T) {
	_, _, c, _, h := montarConta(t)
	for i, email := range []string{"alvo@x.com", "ALVO@x.com", " alvo@x.com", "Alvo@X.com ", "alvo@x.COM"} {
		if w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"`+email+`"}`, ""); w.Code != 202 {
			t.Fatalf("pedido %d = %d", i, w.Code)
		}
		esperarEnvio(t, c)
	}
	if w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"  ALVO@x.com"}`, ""); w.Code != 429 {
		t.Fatalf("6º pedido (outra grafia) = %d, esperava 429", w.Code)
	}
}

// Limite por IP em "esqueci" e em "definir": e-mails/links diferentes do mesmo IP esgotam o limite.
func TestLimitePorIPNasRotasDeSenha(t *testing.T) {
	_, _, c, _, h := montarConta(t)
	c.PorIP.Max = 3
	for i := 0; i < 3; i++ {
		if w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"a`+string(rune('a'+i))+`@x.com"}`, ""); w.Code != 202 {
			t.Fatalf("esqueci %d = %d", i, w.Code)
		}
		esperarEnvio(t, c)
	}
	if w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"outro@x.com"}`, ""); w.Code != 429 {
		t.Fatalf("esqueci acima do limite por IP = %d", w.Code)
	}
	_, _, c2, _, h2 := montarConta(t)
	c2.PorIP.Max = 3
	for i := 0; i < 3; i++ {
		if w := pedirComOrigem(h2, "/auth/definir-senha", `{"token":"inventado`+string(rune('a'+i))+`","senha":"nova-senha"}`, ""); w.Code != 400 {
			t.Fatalf("definir %d = %d", i, w.Code)
		}
	}
	if w := pedirComOrigem(h2, "/auth/definir-senha", `{"token":"inventadod","senha":"nova-senha"}`, ""); w.Code != 429 {
		t.Fatalf("definir acima do limite por IP = %d", w.Code)
	}
}

// Usar um link apaga os outros links vivos da pessoa (de qualquer tipo).
func TestDefinirSenhaApagaOsOutrosLinks(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	var convite string
	err := pgx.BeginFunc(context.Background(), p, func(tx pgx.Tx) error {
		l, e := novoLink(context.Background(), tx, uid, "convite", padrao, PrazoConvite)
		convite = l[strings.LastIndex(l, "token=")+len("token="):]
		return e
	})
	if err != nil {
		t.Fatal(err)
	}
	recuperacao := linkDe(t, c, cor, h, "pessoa@x.com")
	if w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+recuperacao+`","senha":"nova-senha"}`, ""); w.Code != 200 {
		t.Fatalf("definir = %d %s", w.Code, w.Body)
	}
	if w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+convite+`","senha":"outra-senha"}`, ""); w.Code != 400 {
		t.Fatalf("o convite continuou valendo depois de a senha ser definida pela recuperação: %d", w.Code)
	}
}

// Anti bombardeio de e-mail: dentro de 60 s do último link da pessoa não sai outro (a resposta é a mesma).
func TestEsqueciSenhaNaoReenviaEmMenosDeUmMinuto(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	var respostas []string
	for i := 0; i < 3; i++ {
		w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"pessoa@x.com"}`, "")
		esperarEnvio(t, c)
		respostas = append(respostas, w.Body.String())
		if w.Code != 202 {
			t.Fatal(w.Code)
		}
	}
	if n := len(cor.lista()); n != 1 || respostas[1] != respostas[0] || respostas[2] != respostas[0] {
		t.Fatalf("e-mails = %d, respostas = %v", n, respostas)
	}
	envelhecer(t, p)
	pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"pessoa@x.com"}`, "")
	esperarEnvio(t, c)
	if n := len(cor.lista()); n != 2 {
		t.Fatalf("depois de 1 min o pedido deveria enviar de novo: %d e-mails", n)
	}
}

// Pânico no envio (biblioteca, mandador) não derruba o processo nem vaza o texto do e-mail no log.
func TestEsqueciSenhaPanicoNoEnvioNaoDerrubaNada(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	cor.panico = true
	var log syncBuf
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	defer slog.SetDefault(antes)
	if w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"pessoa@x.com"}`, ""); w.Code != 202 {
		t.Fatal(w.Code)
	}
	esperarEnvio(t, c)
	if s := log.String(); strings.Contains(s, "segredo-no-panico") || strings.Contains(s, "token=") || !strings.Contains(s, "esqueci-senha") {
		t.Fatalf("log = %q", s)
	}
}

type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.b.Write(p) }
func (s *syncBuf) String() string              { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

// Conta desativada: com a senha certa o 403 não zera o limite (senão quem sabe a senha testaria
// à vontade); a senha errada continua contando.
func TestLoginDeDesativadoNaoLimpaOLimite(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{}`)
	p.Exec(context.Background(), `update profiles set disabled = true where id = $1`, uid)
	var codigos []int
	for i := 0; i < 7; i++ {
		senha := "certa"
		if i%2 == 1 {
			senha = "errada"
		}
		codigos = append(codigos, chamar(h, "POST", "/auth/entrar", `{"email":"a@x.com","senha":"`+senha+`"}`, "").Code)
	}
	quer := []int{403, 401, 403, 401, 403, 429, 429}
	for i := range quer {
		if codigos[i] != quer[i] {
			t.Fatalf("códigos = %v, esperava %v", codigos, quer)
		}
	}
}
