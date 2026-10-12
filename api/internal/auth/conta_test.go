package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

type enviado struct{ para, assunto, html, texto string }

type correio struct {
	mu       sync.Mutex
	enviados []enviado
	falhar   bool
	trava    chan struct{} // se não nil, Mandar espera até ser fechado (e-mail lento)
	panico   bool          // Mandar entra em pânico com o link no texto
}

func (c *correio) Mandar(_ context.Context, para, assunto, html, texto string) error {
	if c.trava != nil {
		<-c.trava
	}
	if c.panico {
		panic("segredo-no-panico " + texto)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.falhar {
		return errFalhaDeEnvio
	}
	c.enviados = append(c.enviados, enviado{para, assunto, html, texto})
	return nil
}

var errFalhaDeEnvio = errors.New("falha de envio")

func (c *correio) lista() []enviado {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]enviado(nil), c.enviados...)
}

const padrao, central = "https://socialdashboard.exemplo", "https://central.exemplo"

func montarConta(t *testing.T) (*pgxpool.Pool, *Store, *Conta, *correio, http.Handler) {
	t.Helper()
	p := testebanco.Novo(t)
	s := NovoStore(p)
	cor := &correio{}
	c := NovaConta(p, s, cor, []string{padrao, central}, padrao)
	c.enviando = make(chan struct{}, 10)
	r := chi.NewRouter()
	r.Post("/auth/entrar", NovosHandlers(p, s, NovoLimitador()).Entrar)
	r.Post("/auth/esqueci-senha", c.EsqueciSenha)
	r.Post("/auth/definir-senha", c.DefinirSenha)
	r.Group(func(r chi.Router) {
		r.Use(Exigir(p, s))
		r.Post("/auth/trocar-senha", c.TrocarSenha)
		r.Get("/eu/perfil", c.Perfil)
	})
	return p, s, c, cor, r
}

func pedirComOrigem(h http.Handler, caminho, corpo, origem string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
	r.Header.Set("Origin", origem)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

var reLink = regexp.MustCompile(`(https://[a-z.]+)/#type=(recovery|invite)&token=([A-Za-z0-9_-]{43})`)

func esperarEnvio(t *testing.T, c *Conta) {
	t.Helper()
	select {
	case <-c.enviando:
	case <-time.After(5 * time.Second):
		t.Fatal("o envio não terminou")
	}
}

// Sem enumeração: quem tem conta, quem não tem e quem está desativado recebem a MESMA resposta;
// só a conta ativa recebe o e-mail, e o link só leva a um endereço do app.
func TestEsqueciSenha(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	usuarioComSenha(t, p, uid2, "desligada@x.com", "antiga", `{}`)
	p.Exec(context.Background(), `update profiles set disabled = true where id = $1`, uid2)
	respostas := map[string]string{}
	for _, email := range []string{"PESSOA@x.com ", "ninguem@x.com", "desligada@x.com"} {
		w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"`+email+`"}`, central)
		esperarEnvio(t, c)
		respostas[email] = w.Body.String()
		if w.Code != 202 || w.Body.String() != `{"ok":true}` {
			t.Fatalf("%s = %d %s", email, w.Code, w.Body)
		}
	}
	env := cor.lista()
	if len(env) != 1 || env[0].para != "pessoa@x.com" {
		t.Fatalf("enviados = %+v", env)
	}
	m := reLink.FindStringSubmatch(env[0].texto)
	if strings.Contains(env[0].texto, "?") || strings.Contains(env[0].html, "?") {
		t.Fatalf("o token foi para a query string (vai parar no log do nginx e no Referer): %q", env[0].texto)
	}
	if m == nil || m[1] != central || m[2] != "recovery" || !strings.Contains(env[0].html, m[0]) {
		t.Fatalf("link = %v (%q)", m, env[0].texto)
	}
	var claro, hash int
	p.QueryRow(context.Background(), `select count(*) filter (where token_hash = $1), count(*) filter (where token_hash = $2) from tokens_de_senha`, m[3], hashDoToken(m[3])).Scan(&claro, &hash)
	if claro != 0 || hash != 1 {
		t.Fatalf("token no banco: em claro %d, hash %d", claro, hash)
	}
	// origem forjada: o link cai no endereço padrão
	envelhecer(t, p)
	pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"pessoa@x.com"}`, "https://central.exemplo.ladrao.net")
	esperarEnvio(t, c)
	if m := reLink.FindStringSubmatch(cor.lista()[1].texto); m == nil || m[1] != padrao {
		t.Fatalf("origem forjada levou o link para %v", m)
	}
	// pedir de novo invalida o link anterior
	var vivos int
	p.QueryRow(context.Background(), `select count(*) from tokens_de_senha where usado_em is null`).Scan(&vivos)
	if vivos != 1 {
		t.Fatalf("links vivos = %d, esperava 1", vivos)
	}
	for _, corpo := range []string{`{}`, `{"email":""}`, `lixo`} {
		if w := pedirComOrigem(h, "/auth/esqueci-senha", corpo, ""); w.Code != 400 {
			t.Errorf("%s = %d", corpo, w.Code)
		}
	}
}

func TestEsqueciSenhaTemLimitePorEmail(t *testing.T) {
	_, _, c, _, h := montarConta(t)
	for i := 0; i < 5; i++ {
		if w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"alvo@x.com"}`, ""); w.Code != 202 {
			t.Fatalf("pedido %d = %d", i, w.Code)
		}
		esperarEnvio(t, c)
	}
	if w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"alvo@x.com"}`, ""); w.Code != 429 {
		t.Fatalf("6º pedido = %d, esperava 429", w.Code)
	}
}

// envelhecer faz os links já criados parecerem de 2 minutos atrás (passam da trava de 60 s do "esqueci").
func envelhecer(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	if _, err := p.Exec(context.Background(), `update tokens_de_senha set criado_em = criado_em - interval '2 minutes'`); err != nil {
		t.Fatal(err)
	}
}

func linkDe(t *testing.T, c *Conta, cor *correio, h http.Handler, email string) string {
	t.Helper()
	envelhecer(t, c.Pool)
	pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"`+email+`"}`, padrao)
	esperarEnvio(t, c)
	env := cor.lista()
	if len(env) == 0 {
		t.Fatal("nenhum e-mail enviado")
	}
	m := reLink.FindStringSubmatch(env[len(env)-1].texto)
	if m == nil {
		t.Fatalf("sem link no e-mail: %q", env[len(env)-1].texto)
	}
	return m[3]
}

func TestDefinirSenhaConsomeOLinkUmaVez(t *testing.T) {
	p, s, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	velha, _ := s.Criar(context.Background(), uid, "painel", nil)
	tok := linkDe(t, c, cor, h, "pessoa@x.com")
	w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"nova-senha"}`, "")
	var o struct{ Token string }
	json.Unmarshal(w.Body.Bytes(), &o)
	if w.Code != 200 || o.Token == "" {
		t.Fatalf("definir = %d %s", w.Code, w.Body)
	}
	if _, err := s.Buscar(context.Background(), o.Token); err != nil {
		t.Fatalf("sessão nova: %v", err)
	}
	if _, err := s.Buscar(context.Background(), velha); err != ErrSessaoInvalida {
		t.Fatalf("sessão antiga continuou viva: %v", err)
	}
	if w := chamar(h, "POST", "/auth/entrar", `{"email":"pessoa@x.com","senha":"antiga"}`, ""); w.Code != 401 {
		t.Fatalf("senha antiga = %d", w.Code)
	}
	entrar(t, h, "pessoa@x.com", "nova-senha")
	if w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"outra-senha"}`, ""); w.Code != 400 || !strings.Contains(w.Body.String(), "token_invalido") {
		t.Fatalf("link usado de novo = %d %s", w.Code, w.Body)
	}
}

func TestDefinirSenhaRecusa(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	tok := linkDe(t, c, cor, h, "pessoa@x.com")
	casos := []struct{ corpo, erro string }{
		{`{"token":"` + tok + `","senha":"12345"}`, "senha_invalida"},
		{`{"token":"` + tok + `","senha":"` + strings.Repeat("x", 73) + `"}`, "senha_invalida"},
		{`{"token":"` + tok + `","senha":"` + strings.Repeat("é", 37) + `"}`, "senha_invalida"}, // 74 bytes: o limite do bcrypt é em bytes
		{`{"token":"inventado","senha":"nova-senha"}`, "token_invalido"},
		{`{"senha":"nova-senha"}`, "pedido_invalido"},
	}
	for _, c := range casos {
		if w := pedirComOrigem(h, "/auth/definir-senha", c.corpo, ""); w.Code != 400 || !strings.Contains(w.Body.String(), c.erro) {
			t.Errorf("%.60s = %d %s", c.corpo, w.Code, w.Body)
		}
	}
	p.Exec(context.Background(), `update tokens_de_senha set expira_em = now() - interval '1 second'`)
	if w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"nova-senha"}`, ""); w.Code != 400 {
		t.Errorf("link vencido = %d", w.Code)
	}
	tok = linkDe(t, c, cor, h, "pessoa@x.com")
	p.Exec(context.Background(), `update profiles set disabled = true where id = $1`, uid)
	if w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"nova-senha"}`, ""); w.Code != 400 {
		t.Errorf("conta desativada com link vivo = %d", w.Code)
	}
}

func TestTrocarSenha(t *testing.T) {
	p, s, _, _, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	p.Exec(context.Background(), `update profiles set precisa_trocar_senha = true where id = $1`, uid)
	esta := entrar(t, h, "pessoa@x.com", "antiga")
	outra := entrar(t, h, "pessoa@x.com", "antiga")
	if w := chamar(h, "POST", "/auth/trocar-senha", `{"senha":"123"}`, esta); w.Code != 400 {
		t.Fatalf("senha curta = %d", w.Code)
	}
	if w := chamar(h, "POST", "/auth/trocar-senha", `{"senha":"nova-senha"}`, esta); w.Code != 204 {
		t.Fatalf("trocar = %d %s", w.Code, w.Body)
	}
	var precisa bool
	p.QueryRow(context.Background(), `select precisa_trocar_senha from profiles where id = $1`, uid).Scan(&precisa)
	if precisa {
		t.Fatal("a cobrança de troca continuou")
	}
	if _, err := s.Buscar(context.Background(), esta); err != nil {
		t.Fatalf("a sessão de quem trocou caiu: %v", err)
	}
	if _, err := s.Buscar(context.Background(), outra); err != ErrSessaoInvalida {
		t.Fatalf("a outra sessão continuou: %v", err)
	}
	entrar(t, h, "pessoa@x.com", "nova-senha")
	// sessão de "entrar como": nunca troca a senha do alvo
	usuarioComSenha(t, p, uid2, "super@x.com", "s", `{}`)
	imp := uid2
	tokImp, _ := s.Criar(context.Background(), uid, "painel", &imp)
	if w := chamar(h, "POST", "/auth/trocar-senha", `{"senha":"do-impostor"}`, tokImp); w.Code != 403 {
		t.Fatalf("impersonada = %d", w.Code)
	}
	if w := chamar(h, "POST", "/auth/entrar", `{"email":"pessoa@x.com","senha":"do-impostor"}`, ""); w.Code != 401 {
		t.Fatal("a senha mudou pela sessão impersonada")
	}
}

func TestPerfil(t *testing.T) {
	p, s, _, _, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "s", `{"frota":["ver"]}`)
	tok, _ := s.Criar(context.Background(), uid, "painel", nil)
	w := chamar(h, "GET", "/eu/perfil", "", tok)
	quer := `[{"role":"viewer","features":["banco"],"avatar_url":null,"permissions":{"frota": ["ver"]},"allowed_accounts":null,"is_superadmin":false,"precisa_trocar_senha":false,"escopo_por_equipe":false}]`
	if w.Code != 200 || w.Body.String() != quer {
		t.Fatalf("= %d %s", w.Code, w.Body)
	}
	p.Exec(context.Background(), `insert into usuarios (id, email) values ($1, 'semperfil@x.com')`, uid2)
	tok2, _ := s.Criar(context.Background(), uid2, "painel", nil)
	if w := chamar(h, "GET", "/eu/perfil", "", tok2); w.Body.String() != `[]` {
		t.Fatalf("sem perfil = %s", w.Body)
	}
}
