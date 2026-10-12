package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func montarEntrarComo(t *testing.T) (*pgxpool.Pool, *Store, *Conta, http.Handler, map[string]string) {
	t.Helper()
	p, s, c, _, _ := montarConta(t)
	ctx := context.Background()
	// o esquema de produção (db/migrations/2026-09-17-log-de-entrar-como.sql), sem a RLS
	if _, err := p.Exec(ctx, `create table entradas_como_outro_usuario (
		id uuid primary key default gen_random_uuid(),
		admin_id uuid not null references profiles(id), admin_email text not null,
		alvo_id uuid not null references profiles(id), alvo_email text not null,
		criado_em timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(Exigir(p, s))
		r.Post("/entrar-como-usuario", c.EntrarComo)
		r.Post("/conferir-senha", c.ConferirSenha)
		r.Get("/auth/eu", NovosHandlers(p, s, NovoLimitador()).Eu)
	})
	ids := map[string]string{}
	for i, u := range []struct {
		nome         string
		super, desat bool
	}{{"super", true, false}, {"admin", false, false}, {"alvo", false, false}, {"desativado", false, true}, {"outro-super", true, false}} {
		id := "55555555-5555-4555-a555-55555555555" + string(rune('0'+i))
		usuarioComSenha(t, p, id, u.nome+"@x.com", "senha-"+u.nome, `{}`)
		p.Exec(ctx, `update profiles set is_superadmin = $2::boolean, disabled = $3::boolean, role = 'admin' where id = $1::uuid`, id, u.super, u.desat)
		ids[u.nome] = id
		if !u.desat {
			ids["tok-"+u.nome], _ = s.Criar(ctx, id, "painel", nil)
		}
	}
	return p, s, c, r, ids
}

func TestEntrarComoRecusasNaOrdemDaEdge(t *testing.T) {
	p, _, _, h, ids := montarEntrarComo(t)
	casos := []struct{ quem, alvo, quer string }{
		{"admin", ids["alvo"], "Apenas super-admin pode entrar como outro usuário"},
		{"admin", ids["admin"], "Apenas super-admin pode entrar como outro usuário"}, // quem pede vem antes do alvo
		{"super", ids["super"], "Você já é você — não precisa entrar como si mesmo"},
		{"super", "66666666-6666-4666-a666-666666666666", "Não encontrei essa pessoa"},
		{"super", "nao-e-uuid", "Não encontrei essa pessoa"},
		{"super", ids["desativado"], "Conta desativada — reative antes de entrar como ela"},
		{"super", "", "Faltou alvoId"},
	}
	for _, c := range casos {
		w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+c.alvo+`"}`, ids["tok-"+c.quem])
		var o struct{ Error string }
		json.Unmarshal(w.Body.Bytes(), &o)
		if w.Code != 400 || o.Error != c.quer {
			t.Errorf("%s -> %s = %d %s", c.quem, c.alvo, w.Code, w.Body)
		}
	}
	var n int
	p.QueryRow(context.Background(), `select (select count(*) from entradas_como_outro_usuario) + (select count(*) from sessoes where impersonador_id is not null)`).Scan(&n)
	if n != 0 {
		t.Fatalf("recusa deixou %d auditoria/sessão", n)
	}
}

// Só super-admin pela ficha: nenhum outro papel (nem com todas as permissões) entra como ninguém.
func TestEntrarComoNegaTodoPapelQueNaoESuperAdmin(t *testing.T) {
	p, _, _, h, ids := montarEntrarComo(t)
	ctx := context.Background()
	for _, papel := range []string{"admin", "editor", "viewer", "vendedor", "cliente"} {
		p.Exec(ctx, `update profiles set role = $2::text, permissions = '{"usuarios":["ver","criar","editar","excluir"]}'::jsonb where id = $1::uuid`, ids["admin"], papel)
		w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["alvo"]+`"}`, ids["tok-admin"])
		if w.Code != 400 || !strings.Contains(w.Body.String(), "Apenas super-admin pode entrar como outro usuário") {
			t.Errorf("papel %s = %d %s", papel, w.Code, w.Body)
		}
	}
	var n int
	p.QueryRow(ctx, `select (select count(*) from entradas_como_outro_usuario) + (select count(*) from sessoes where impersonador_id is not null)`).Scan(&n)
	if n != 0 {
		t.Fatalf("recusa deixou %d auditoria/sessão", n)
	}
	// sem sessão: 401
	if w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["alvo"]+`"}`, ""); w.Code != 401 {
		t.Fatalf("sem sessão = %d", w.Code)
	}
	// super-admin que perde a ficha entre um pedido e outro: a decisão é da ficha de agora
	p.Exec(ctx, `update profiles set is_superadmin = false where id = $1::uuid`, ids["super"])
	if w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["alvo"]+`"}`, ids["tok-super"]); w.Code != 400 {
		t.Fatalf("ex-super-admin entrou: %d %s", w.Code, w.Body)
	}
}

func TestEntrarComoAuditaAntesEDaUmaHoraSemRenovar(t *testing.T) {
	p, s, _, h, ids := montarEntrarComo(t)
	ctx := context.Background()
	w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["alvo"]+`"}`, ids["tok-super"])
	var o struct {
		Token    string `json:"token"`
		ExpiraEm string `json:"expira_em"`
	}
	json.Unmarshal(w.Body.Bytes(), &o)
	if w.Code != 200 || o.Token == "" || o.ExpiraEm == "" {
		t.Fatalf("= %d %s", w.Code, w.Body)
	}
	var admin, alvo, adminEmail, alvoEmail string
	p.QueryRow(ctx, `select admin_id::text, alvo_id::text, admin_email, alvo_email from entradas_como_outro_usuario`).Scan(&admin, &alvo, &adminEmail, &alvoEmail)
	if admin != ids["super"] || alvo != ids["alvo"] || adminEmail != "super@x.com" || alvoEmail != "alvo@x.com" {
		t.Fatalf("auditoria = %s %s %s %s", admin, alvo, adminEmail, alvoEmail)
	}
	se, err := s.Buscar(ctx, o.Token)
	if err != nil || se.UsuarioID != ids["alvo"] || se.ImpersonadorID == nil || *se.ImpersonadorID != ids["super"] {
		t.Fatalf("sessão = %+v %v", se, err)
	}
	if d := time.Until(se.ExpiraEm); d < 59*time.Minute || d > time.Hour {
		t.Fatalf("a sessão impersonada vale %v", d)
	}
	if exp, err := time.Parse(time.RFC3339, o.ExpiraEm); err != nil || !exp.Equal(se.ExpiraEm.Truncate(time.Second)) && exp.Sub(se.ExpiraEm).Abs() > time.Second {
		t.Fatalf("expira_em da resposta %q não é o da sessão %v (%v)", o.ExpiraEm, se.ExpiraEm, err)
	}
	// não encadeia: a sessão impersonada (de um alvo super-admin) não entra como outra pessoa
	w = chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["outro-super"]+`"}`, ids["tok-super"])
	json.Unmarshal(w.Body.Bytes(), &o)
	var antesAud int
	p.QueryRow(ctx, `select count(*) from entradas_como_outro_usuario`).Scan(&antesAud)
	w = chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["admin"]+`"}`, o.Token)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "Sua sessão já é de outra pessoa") {
		t.Fatalf("encadeou: %d %s", w.Code, w.Body)
	}
	var depoisAud int
	p.QueryRow(ctx, `select count(*) from entradas_como_outro_usuario`).Scan(&depoisAud)
	if depoisAud != antesAud {
		t.Fatal("o encadeamento recusado deixou auditoria")
	}
	// sem a tabela de auditoria: nenhuma sessão nasce
	p.Exec(ctx, `drop table entradas_como_outro_usuario`)
	var antes, depois int
	p.QueryRow(ctx, `select count(*) from sessoes`).Scan(&antes)
	w = chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["admin"]+`"}`, ids["tok-super"])
	p.QueryRow(ctx, `select count(*) from sessoes`).Scan(&depois)
	if w.Code != 400 || depois != antes || strings.Contains(w.Body.String(), "relation") {
		t.Fatalf("auditoria falhou e: %d %s (sessões %d -> %d)", w.Code, w.Body, antes, depois)
	}
}

// A auditoria e a sessão nascem na MESMA transação: se criar a sessão falha, a auditoria some
// junto (não fica "entrou como" gravado sem sessão) e a pessoa recebe erro sem detalhe do banco.
func TestEntrarComoAuditoriaESessaoSaoUmaTransacaoSo(t *testing.T) {
	p, _, _, h, ids := montarEntrarComo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create function recusa_sessao_impersonada() returns trigger language plpgsql as $$
		begin if new.impersonador_id is not null then raise exception 'detalhe-secreto-do-banco'; end if; return new; end $$`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `create trigger recusa_sessao_impersonada before insert on sessoes
		for each row execute function recusa_sessao_impersonada()`); err != nil {
		t.Fatal(err)
	}
	w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["alvo"]+`"}`, ids["tok-super"])
	if w.Code != 500 || strings.Contains(w.Body.String(), "detalhe-secreto") || strings.Contains(w.Body.String(), "token") {
		t.Fatalf("falha da sessão = %d %s", w.Code, w.Body)
	}
	var aud, ses int
	p.QueryRow(ctx, `select (select count(*) from entradas_como_outro_usuario), (select count(*) from sessoes where impersonador_id is not null)`).Scan(&aud, &ses)
	if aud != 0 || ses != 0 {
		t.Fatalf("sobrou auditoria (%d) ou sessão (%d) de uma entrada que falhou", aud, ses)
	}
}

// A sessão de "entrar como" vale 1 h, com relógio injetado, e nunca renova (Ruling 19): nem
// quando a última renovação teria passado dos 5 min da sessão normal.
func TestSessaoDeEntrarComoExpiraEmUmaHoraSemRenovar(t *testing.T) {
	p, s, _, h, ids := montarEntrarComo(t)
	ctx := context.Background()
	t0 := time.Now().Truncate(time.Second)
	s.agora = func() time.Time { return t0 }
	w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["alvo"]+`"}`, ids["tok-super"])
	var o struct {
		Token    string `json:"token"`
		ExpiraEm string `json:"expira_em"`
	}
	json.Unmarshal(w.Body.Bytes(), &o)
	if w.Code != 200 {
		t.Fatalf("= %d %s", w.Code, w.Body)
	}
	if o.ExpiraEm != t0.Add(PrazoEntrarComo).UTC().Format(time.RFC3339) {
		t.Fatalf("expira_em = %s, quer %s", o.ExpiraEm, t0.Add(PrazoEntrarComo).UTC().Format(time.RFC3339))
	}
	var antes time.Time
	p.QueryRow(ctx, `select expira_em from sessoes where impersonador_id is not null`).Scan(&antes)
	for _, passou := range []time.Duration{10 * time.Minute, 30 * time.Minute, 59*time.Minute + 59*time.Second} {
		s.agora = func() time.Time { return t0.Add(passou) }
		se, err := s.Buscar(ctx, o.Token)
		if err != nil || !se.ExpiraEm.Equal(antes) {
			t.Fatalf("após %v: %+v %v (expira_em tinha de ficar %v)", passou, se, err, antes)
		}
	}
	var depois time.Time
	p.QueryRow(ctx, `select expira_em from sessoes where impersonador_id is not null`).Scan(&depois)
	if !depois.Equal(antes) {
		t.Fatalf("a sessão impersonada renovou: %v -> %v", antes, depois)
	}
	for _, passou := range []time.Duration{time.Hour, time.Hour + time.Second, 3 * time.Hour} {
		s.agora = func() time.Time { return t0.Add(passou) }
		if _, err := s.Buscar(ctx, o.Token); err != ErrSessaoInvalida {
			t.Fatalf("após %v a sessão ainda vale (%v)", passou, err)
		}
	}
	// a sessão normal continua renovando (o isolamento é só da impersonada)
	s.agora = func() time.Time { return t0.Add(10 * time.Minute) }
	var normalAntes, normalDepois time.Time
	p.QueryRow(ctx, `select expira_em from sessoes where impersonador_id is null and usuario_id = $1::uuid`, ids["super"]).Scan(&normalAntes)
	if _, err := s.Buscar(ctx, ids["tok-super"]); err != nil {
		t.Fatal(err)
	}
	p.QueryRow(ctx, `select expira_em from sessoes where impersonador_id is null and usuario_id = $1::uuid`, ids["super"]).Scan(&normalDepois)
	if !normalDepois.After(normalAntes) {
		t.Fatal("a sessão normal deixou de renovar")
	}
}

// Quem entrou como o alvo tem as permissões do alvo, mas o ator carrega o impersonador real; as
// rotas de conta o recusam (não encadeia, não confere senha: Ruling 18).
func TestSessaoDeEntrarComoGuardaOImpersonador(t *testing.T) {
	_, _, _, h, ids := montarEntrarComo(t)
	w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["alvo"]+`"}`, ids["tok-super"])
	var o struct{ Token string }
	json.Unmarshal(w.Body.Bytes(), &o)
	w = chamar(h, "GET", "/auth/eu", "", o.Token)
	if w.Code != 200 || !strings.Contains(w.Body.String(), ids["alvo"]) || strings.Contains(w.Body.String(), `"is_superadmin":true`) {
		t.Fatalf("/auth/eu na sessão impersonada = %d %s", w.Code, w.Body)
	}
}

func TestConferirSenha(t *testing.T) {
	_, s, c, h, ids := montarEntrarComo(t)
	agora := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	c.conferir.agora = func() time.Time { return agora }
	tok := ids["tok-admin"]
	pedir := func(corpo, token string) (int, string) {
		w := chamar(h, "POST", "/conferir-senha", corpo, token)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	if c, b := pedir(`{"senha":"senha-admin"}`, tok); c != 200 || b != `{"ok":true}` {
		t.Fatalf("certa = %d %s", c, b)
	}
	// a senha é de QUEM ESTÁ NA SESSÃO: a senha de outra pessoa (mesmo com e-mail no corpo) não vale
	if c, b := pedir(`{"senha":"senha-super","email":"super@x.com"}`, tok); c != 200 || b != `{"erro":"senha_incorreta","ok":false,"restam":4}` {
		t.Fatalf("senha de outro = %d %s", c, b)
	}
	for i := 3; i >= 0; i-- {
		if c, b := pedir(`{"senha":"errada"}`, tok); c != 200 || !strings.Contains(b, `"restam":`+string(rune('0'+i))) {
			t.Fatalf("erro %d = %d %s", 5-i, c, b)
		}
	}
	if c, b := pedir(`{"senha":"senha-admin"}`, tok); c != 429 || b != `{"bloqueado_ate":"2026-10-11T12:10:00.000Z","erro":"bloqueado","ok":false}` {
		t.Fatalf("bloqueado = %d %s", c, b)
	}
	if c, _ := pedir(`{"senha":"senha-alvo"}`, ids["tok-alvo"]); c != 200 {
		t.Fatal("o bloqueio de uma pessoa travou outra")
	}
	agora = agora.Add(Bloqueio)
	if c, b := pedir(`{"senha":"senha-admin"}`, tok); c != 200 || b != `{"ok":true}` {
		t.Fatalf("depois do bloqueio = %d %s", c, b)
	}
	for _, corpo := range []string{`{}`, `{"senha":""}`, `{"senha":123}`, `lixo`} {
		if c, b := pedir(corpo, tok); c != 400 || b != `{"erro":"sem_senha","ok":false}` {
			t.Errorf("%s = %d %s", corpo, c, b)
		}
	}
	imp := ids["super"]
	tokImp, _ := s.Criar(context.Background(), ids["admin"], "painel", &imp)
	if c, b := pedir(`{"senha":"senha-admin"}`, tokImp); c != 403 || b != `{"erro":"sessao_de_outra_pessoa","ok":false}` {
		t.Fatalf("impersonada = %d %s", c, b)
	}
	if c, _ := pedir(`{"senha":"senha-admin"}`, ""); c != 401 {
		t.Fatalf("sem sessão = %d", c)
	}
}

// Sessão impersonada pedindo conferir-senha com a senha CERTA do alvo e com a do super-admin:
// 403 nos dois casos e nenhuma contagem de erro é gasta (não é caminho para testar senha).
func TestConferirSenhaRecusaSessaoImpersonadaSemContar(t *testing.T) {
	_, _, c, h, ids := montarEntrarComo(t)
	w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["alvo"]+`"}`, ids["tok-super"])
	var o struct{ Token string }
	json.Unmarshal(w.Body.Bytes(), &o)
	for _, senha := range []string{"senha-alvo", "senha-super", "errada", "errada", "errada", "errada", "errada", "errada"} {
		w := chamar(h, "POST", "/conferir-senha", `{"senha":"`+senha+`"}`, o.Token)
		if w.Code != 403 || strings.TrimSpace(w.Body.String()) != `{"erro":"sessao_de_outra_pessoa","ok":false}` {
			t.Fatalf("%s = %d %s", senha, w.Code, w.Body)
		}
	}
	if len(c.conferir.marca) != 0 {
		t.Fatalf("a sessão impersonada gastou contagem: %v", c.conferir.marca)
	}
}

// Não é oráculo: conta sem senha (ou desconhecida do hash) responde igual a senha errada, e o
// corpo nunca escolhe de quem é a senha.
func TestConferirSenhaNaoVazaExistenciaNemEstado(t *testing.T) {
	p, _, _, h, ids := montarEntrarComo(t)
	ctx := context.Background()
	pedir := func(token, senha string) (int, string) {
		w := chamar(h, "POST", "/conferir-senha", `{"senha":"`+senha+`"}`, token)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	cErrada, bErrada := pedir(ids["tok-admin"], "errada")
	// a pessoa do alvo perde a senha (conta só de link): mesma resposta, mesmo restam
	p.Exec(ctx, `update usuarios set senha_hash = null where id = $1::uuid`, ids["alvo"])
	cSem, bSem := pedir(ids["tok-alvo"], "errada")
	if cErrada != cSem || bErrada != bSem {
		t.Fatalf("sem senha (%d %s) distingue de senha errada (%d %s)", cSem, bSem, cErrada, bErrada)
	}
	// e a "senha" do hash falso (o texto do hash em si) também não passa
	if c, b := pedir(ids["tok-alvo"], hashFalso); c != 200 || !strings.Contains(b, `"senha_incorreta"`) {
		t.Fatalf("hash falso = %d %s", c, b)
	}
	// e a resposta nunca carrega detalhe de erro
	if strings.Contains(bErrada, "mensagem") || strings.Contains(bErrada, "hash") {
		t.Fatalf("vazou: %s", bErrada)
	}
}

// 20 tentativas simultâneas erradas da mesma pessoa: só 5 chegam a ser conferidas (a contagem
// não pode ser furada por paralelismo).
func TestConferirSenhaParalelismoNaoFuraOLimite(t *testing.T) {
	_, _, c, h, ids := montarEntrarComo(t)
	agora := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	c.conferir.agora = func() time.Time { return agora }
	var wg sync.WaitGroup
	var mu sync.Mutex
	incorretas, bloqueadas := 0, 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := chamar(h, "POST", "/conferir-senha", `{"senha":"errada"}`, ids["tok-admin"])
			mu.Lock()
			defer mu.Unlock()
			switch w.Code {
			case 200:
				incorretas++
			case 429:
				bloqueadas++
			}
		}()
	}
	wg.Wait()
	if incorretas != ErrosAteBloquear || bloqueadas != 20-ErrosAteBloquear {
		t.Fatalf("conferidas = %d, bloqueadas = %d", incorretas, bloqueadas)
	}
}
