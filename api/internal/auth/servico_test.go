package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
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
	var dis, porEquipe bool
	var perm string
	var aa *string
	err := p.QueryRow(context.Background(), `select role, array_to_string(features, ','), disabled, permissions::text, allowed_accounts::text, escopo_por_equipe from profiles where email = 'robo-fabrica@x.com'`).Scan(&role, &feats, &dis, &perm, &aa, &porEquipe)
	if err != nil || role != "viewer" || feats != "meta,banco" || dis || perm != "{}" || aa != nil || porEquipe {
		t.Fatalf("perfil = %q %q %v %q %v %v (%v)", role, feats, dis, perm, aa, porEquipe, err)
	}
	var senha *string
	p.QueryRow(context.Background(), `select senha_hash from usuarios where email = 'robo-fabrica@x.com'`).Scan(&senha)
	if senha != nil {
		t.Fatal("usuário do robô tem senha")
	}
}

// Token de serviço não sai nem troca senha: a revogação é só pelo CLI. Antes, /auth/sair dava 204 sem
// revogar e /auth/trocar-senha dava 401 por acidente (o robô acharia que o token morreu).
func TestServicoNaoSaiNemTrocaSenha(t *testing.T) {
	p, s, c, _, h := montarConta(t)
	hs := NovosHandlers(p, s, NovoLimitador())
	h.(*chi.Mux).With(Exigir(p, s)).Post("/auth/sair", hs.Sair)
	_ = c
	tok, err := s.CriarContaDeServico(context.Background(), "fabrica", "fabrica@robos.invalid", []string{"meta"})
	if err != nil {
		t.Fatal(err)
	}
	w := chamar(h, "POST", "/auth/sair", "", tok)
	if w.Code != 403 || !strings.Contains(w.Body.String(), `"sem_permissao"`) || !strings.Contains(w.Body.String(), "api servico revogar") {
		t.Fatalf("sair com token de serviço = %d %s", w.Code, w.Body)
	}
	w = chamar(h, "POST", "/auth/trocar-senha", `{"senha":"uma-senha-longa"}`, tok)
	if w.Code != 403 || !strings.Contains(w.Body.String(), `"sem_permissao"`) {
		t.Fatalf("trocar senha com token de serviço = %d %s", w.Code, w.Body)
	}
	if _, err := s.Buscar(context.Background(), tok); err != nil {
		t.Fatalf("o token deixou de valer: %v", err)
	}
	var senha *string
	p.QueryRow(context.Background(), `select senha_hash from usuarios where email = 'fabrica@robos.invalid'`).Scan(&senha)
	if senha != nil {
		t.Fatal("o robô ganhou senha")
	}
}

// Robô não vira gente: sem link de recuperação (ativo ou revogado) e o link que já existia não define senha.
func TestServicoNaoRecuperaSenhaNemDefineSenha(t *testing.T) {
	p, s, c, cor, h := montarConta(t)
	ctx := context.Background()
	if _, err := s.CriarContaDeServico(ctx, "fabrica", "fabrica@robos.invalid", []string{"meta"}); err != nil {
		t.Fatal(err)
	}
	for _, rev := range []bool{false, true} {
		if rev {
			s.RevogarServico(ctx, "fabrica")
		}
		w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"fabrica@robos.invalid"}`, central)
		esperarEnvio(t, c)
		if w.Code != 202 || w.Body.String() != `{"ok":true}` {
			t.Fatalf("resposta (revogado=%v) = %d %s", rev, w.Code, w.Body)
		}
		if n := len(cor.lista()); n != 0 {
			t.Fatalf("mandou e-mail de recuperação ao robô (revogado=%v)", rev)
		}
	}
	var n int
	p.QueryRow(ctx, `select count(*) from tokens_de_senha`).Scan(&n)
	if n != 0 {
		t.Fatalf("gerou %d link(s) de senha para o robô", n)
	}
	// link que já existia (convite/reset do admin): o definir-senha recusa como link inválido
	var id, link string
	p.QueryRow(ctx, `select id::text from usuarios where email = 'fabrica@robos.invalid'`).Scan(&id)
	if err := pgx.BeginFunc(ctx, p, func(tx pgx.Tx) error {
		var e error
		link, e = novoLink(ctx, tx, id, "convite", padrao, time.Hour)
		return e
	}); err != nil {
		t.Fatal(err)
	}
	tok := link[strings.LastIndex(link, "token=")+len("token="):]
	w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"uma-senha-longa"}`, central)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "token_invalido") {
		t.Fatalf("definir-senha do robô = %d %s", w.Code, w.Body)
	}
	var senha *string
	p.QueryRow(ctx, `select senha_hash from usuarios where id = $1::uuid`, id).Scan(&senha)
	if senha != nil {
		t.Fatal("o robô ganhou senha")
	}
}

func TestContaDeServicoRecusaModuloDesconhecido(t *testing.T) {
	p := testebanco.Novo(t)
	s := NovoStore(p)
	if _, err := s.CriarContaDeServico(context.Background(), "r1", "r1@robos.invalid", []string{"meta", "metaa"}); err == nil || !strings.Contains(err.Error(), "metaa") {
		t.Fatalf("módulo desconhecido aceito: %v", err)
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from usuarios`).Scan(&n)
	if n != 0 {
		t.Fatal("deixou usuário para trás")
	}
	if _, err := s.CriarContaDeServico(context.Background(), "r1", "r1@robos.invalid", []string{"meta", "social", "sales"}); err != nil {
		t.Fatalf("módulos conhecidos recusados: %v", err)
	}
}

// Todo módulo que o código confere (rotas, PodeModulo, predicados do autz, policies do catálogo de produção)
// tem de estar em ModulosConhecidos: senão `--modulos` recusaria um módulo que existe.
func TestModulosConhecidosCobremOsModulosDoCodigo(t *testing.T) {
	reChamada := regexp.MustCompile(`(?:ExigirModulo|PodeModulo|\.Modulo|termoModulo)\(\s*("[^"]*"(?:\s*,\s*"[^"]*")*)\s*\)`)
	reLiteral := regexp.MustCompile(`"([a-z_.-]+)"`)
	reJSON := regexp.MustCompile(`'([a-z_.-]+)'::text = ANY \(p\.features\)`)
	achados := map[string]string{}
	err := filepath.WalkDir("..", func(caminho string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		ext := filepath.Ext(caminho)
		if (ext != ".go" || strings.HasSuffix(caminho, "_test.go")) && filepath.Base(caminho) != "catalogo-policies-producao.json" {
			return nil
		}
		b, err := os.ReadFile(caminho)
		if err != nil {
			return err
		}
		if ext == ".json" {
			for _, m := range reJSON.FindAllStringSubmatch(strings.ReplaceAll(string(b), `'`, "'"), -1) {
				achados[m[1]] = caminho
			}
			return nil
		}
		for _, c := range reChamada.FindAllStringSubmatch(string(b), -1) {
			for _, l := range reLiteral.FindAllStringSubmatch(c[1], -1) {
				achados[l[1]] = caminho
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(achados) < 8 {
		t.Fatalf("a varredura achou só %v: o regexp quebrou?", achados)
	}
	for m, onde := range achados {
		if !slices.Contains(ModulosConhecidos, m) {
			t.Errorf("módulo %q (usado em %s) não está em auth.ModulosConhecidos", m, onde)
		}
	}
}
