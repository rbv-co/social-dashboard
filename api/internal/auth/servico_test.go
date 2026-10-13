package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func umServico(t *testing.T, modulos ...string) (*pgxpool.Pool, *Store, string) {
	t.Helper()
	p := testebanco.Novo(t)
	s := NovoStore(p)
	tok, err := s.CriarContaDeServico(context.Background(), "fabrica", "robo-fabrica@x.com", modulos)
	if err != nil {
		t.Fatal(err)
	}
	return p, s, tok
}

func chamarComToken(h http.Handler, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", "/x", nil)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestServicoTokenValidoEntraComOPerfilDoRobo(t *testing.T) {
	p, s, tok := umServico(t, "meta")
	eu := Exigir(p, s)(http.HandlerFunc(NovosHandlers(p, s, NovoLimitador()).Eu))
	w := chamarComToken(eu, tok)
	if w.Code != 200 {
		t.Fatalf("status = %d, corpo = %s", w.Code, w.Body)
	}
	var o map[string]any
	json.Unmarshal(w.Body.Bytes(), &o)
	if o["tipo"] != "servico" || o["papel"] != "viewer" || o["superadmin"] != false || o["email"] != "robo-fabrica@x.com" {
		t.Fatalf("eu = %v", o)
	}
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {})
	if w := chamarComToken(Exigir(p, s)(ExigirModulo("meta")(ok)), tok); w.Code != 200 {
		t.Fatalf("módulo do perfil = %d", w.Code)
	}
	if w := chamarComToken(Exigir(p, s)(ExigirModulo("bling")(ok)), tok); w.Code != 403 {
		t.Fatalf("módulo fora do perfil = %d", w.Code)
	}
}

func TestServicoTokenInvalidoDa401(t *testing.T) {
	ctx := context.Background()
	casos := map[string]func(p *pgxpool.Pool, s *Store){
		"revogado": func(p *pgxpool.Pool, s *Store) {
			p.Exec(ctx, `update tokens_de_servico set revogado_em = now()`)
		},
		"usuário desativado": func(p *pgxpool.Pool, s *Store) {
			p.Exec(ctx, `update usuarios set desativado_em = now()`)
		},
		"perfil disabled": func(p *pgxpool.Pool, s *Store) {
			p.Exec(ctx, `update profiles set disabled = true`)
		},
	}
	for nome, estraga := range casos {
		t.Run(nome, func(t *testing.T) {
			p, s, tok := umServico(t, "meta")
			h := Exigir(p, s)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
			if w := chamarComToken(h, tok); w.Code != 200 {
				t.Fatalf("antes: %d", w.Code)
			}
			estraga(p, s)
			if w := chamarComToken(h, tok); w.Code != 401 {
				t.Fatalf("depois: %d", w.Code)
			}
		})
	}
	p, s, _ := umServico(t)
	h := Exigir(p, s)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	if w := chamarComToken(h, "srv_naoexiste"); w.Code != 401 {
		t.Fatalf("inexistente: %d", w.Code)
	}
}

func TestServicoNaoMudaASessaoNormal(t *testing.T) {
	p, s, _ := umServico(t)
	novoUsuario(t, s, uid, "a@x.com")
	tok, _ := s.Criar(context.Background(), uid, "painel", nil)
	h := Exigir(p, s)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	if w := chamarComToken(h, tok); w.Code != 200 {
		t.Fatalf("sessão normal = %d", w.Code)
	}
	if _, err := s.Buscar(context.Background(), "srv_"+tok); !errors.Is(err, ErrSessaoInvalida) {
		t.Fatalf("err = %v", err)
	}
}

func TestSoServico(t *testing.T) {
	p, s, tok := umServico(t)
	novoUsuario(t, s, uid, "a@x.com")
	painel, _ := s.Criar(context.Background(), uid, "painel", nil)
	h := Exigir(p, s)(SoServico(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {})))
	if w := chamarComToken(h, painel); w.Code != 403 || !strings.Contains(w.Body.String(), "sem_permissao") {
		t.Fatalf("painel = %d %s", w.Code, w.Body)
	}
	if w := chamarComToken(h, tok); w.Code != 200 {
		t.Fatalf("serviço = %d", w.Code)
	}
	if w := chamarComToken(h, ""); w.Code != 401 {
		t.Fatalf("sem sessão = %d", w.Code)
	}
}

func TestServicoBancoNaoGuardaOTokenEmClaro(t *testing.T) {
	p, _, tok := umServico(t)
	var n int
	p.QueryRow(context.Background(), `select count(*) from tokens_de_servico t where to_jsonb(t)::text like '%' || $1 || '%'`, tok).Scan(&n)
	if n != 0 || !strings.HasPrefix(tok, "srv_") {
		t.Fatalf("token em claro no banco (%d) ou sem prefixo: %q", n, tok)
	}
}

func TestServicoNaoExpiraNemRenova(t *testing.T) {
	p, s, tok := umServico(t)
	ctx := context.Background()
	s.agora = func() time.Time { return time.Now().Add(400 * 24 * time.Hour) }
	se, err := s.Buscar(ctx, tok)
	if err != nil || se.Tipo != "servico" || !se.ExpiraEm.IsZero() || se.ImpersonadorID != nil {
		t.Fatalf("sessão = %+v, err = %v", se, err)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from sessoes`).Scan(&n)
	if n != 0 {
		t.Fatalf("o caminho de serviço gravou %d sessão(ões)", n)
	}
}

func TestServicoUltimoUsoGravaNoMaximoACada5Min(t *testing.T) {
	p, s, tok := umServico(t)
	ctx := context.Background()
	t0 := time.Now().Add(time.Hour).Truncate(time.Microsecond)
	uso := func(d time.Duration) time.Time {
		s.agora = func() time.Time { return t0.Add(d) }
		if _, err := s.Buscar(ctx, tok); err != nil {
			t.Fatal(err)
		}
		var u time.Time
		p.QueryRow(ctx, `select ultimo_uso_em from tokens_de_servico`).Scan(&u)
		return u
	}
	if u := uso(0); !u.Equal(t0) {
		t.Fatalf("primeiro uso = %v, quer %v", u, t0)
	}
	if u := uso(time.Minute); !u.Equal(t0) {
		t.Fatalf("segunda chamada regravou: %v", u)
	}
	if u := uso(6 * time.Minute); !u.Equal(t0.Add(6 * time.Minute)) {
		t.Fatalf("depois de 5 min não regravou: %v", u)
	}
}

func TestContaDeServicoRecusas(t *testing.T) {
	p, s, _ := umServico(t, "meta")
	ctx := context.Background()
	if _, err := s.CriarContaDeServico(ctx, "fabrica", "outro@x.com", nil); !errors.Is(err, ErrServicoNomeEmUso) {
		t.Fatalf("nome repetido: %v", err)
	}
	// a recusa não deixa o usuário novo para trás (tudo na mesma transação)
	var n int
	p.QueryRow(ctx, `select count(*) from usuarios where email = 'outro@x.com'`).Scan(&n)
	if n != 0 {
		t.Fatal("usuário órfão depois da recusa")
	}
	novoUsuario(t, s, uid, "gente@x.com")
	p.Exec(ctx, `update usuarios set senha_hash = 'x' where id = $1`, uid)
	if _, err := s.CriarContaDeServico(ctx, "robo2", "Gente@x.com", nil); !errors.Is(err, ErrServicoUsuarioComSenha) {
		t.Fatalf("usuário com senha: %v", err)
	}
	for _, nome := range []string{"A", "a", "com espaço", "-x", strings.Repeat("a", 64)} {
		if _, err := s.CriarContaDeServico(ctx, nome, "n@x.com", nil); err == nil {
			t.Fatalf("nome %q aceito", nome)
		}
	}
	// rotação: segundo token para o MESMO robô (usuário existente, sem senha, com perfil)
	novo, err := s.CriarContaDeServico(ctx, "fabrica-2", "robo-fabrica@x.com", nil)
	if err != nil {
		t.Fatalf("rotação: %v", err)
	}
	if _, err := s.Buscar(ctx, novo); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CriarContaDeServico(ctx, "fabrica-3", "robo-fabrica@x.com", []string{"x"}); err == nil {
		t.Fatal("--modulos num usuário que já existe deveria recusar")
	}
}

func TestContaDeServicoRecusaSuperAdminEUsuarioSemPerfil(t *testing.T) {
	p := testebanco.Novo(t)
	s := NovoStore(p)
	ctx := context.Background()
	novoUsuario(t, s, uid, "adm@x.com")
	p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin) values ($1, 'adm@x.com', 'admin', true)`, uid)
	if _, err := s.CriarContaDeServico(ctx, "r1", "adm@x.com", nil); err == nil {
		t.Fatal("super-admin virou robô")
	}
	novoUsuario(t, s, uid2, "cliente@x.com")
	if _, err := s.CriarContaDeServico(ctx, "r2", "cliente@x.com", nil); err == nil {
		t.Fatal("usuário sem perfil virou robô")
	}
}

func TestContaDeServicoPerfilCriado(t *testing.T) {
	p, _, _ := umServico(t, "meta", "banco")
	var role, feats string
	var dis bool
	var perm string
	var aa *string
	err := p.QueryRow(context.Background(), `select role, array_to_string(features, ','), disabled, permissions::text, allowed_accounts::text from profiles where email = 'robo-fabrica@x.com'`).Scan(&role, &feats, &dis, &perm, &aa)
	if err != nil || role != "viewer" || feats != "meta,banco" || dis || perm != "{}" || aa != nil {
		t.Fatalf("perfil = %q %q %v %q %v (%v)", role, feats, dis, perm, aa, err)
	}
	var senha *string
	p.QueryRow(context.Background(), `select senha_hash from usuarios where email = 'robo-fabrica@x.com'`).Scan(&senha)
	if senha != nil {
		t.Fatal("usuário do robô tem senha")
	}
}
