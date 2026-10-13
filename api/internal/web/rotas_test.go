package web

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestSaudeEPronto(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	for _, caminho := range []string{"/saude", "/pronto"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", caminho, nil))
		if r.Code != http.StatusOK {
			t.Fatalf("%s = %d", caminho, r.Code)
		}
	}
}

func TestAuthEuPelasRotasReais(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	const painel, cliente = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	p.Exec(ctx, `insert into usuarios (id, email) values ($1, 'p@x.com'), ($2, 'c@x.com')`, painel, cliente)
	p.Exec(ctx, `insert into profiles (id, email, role) values ($1, 'p@x.com', 'viewer')`, painel)
	tokP, _ := s.Criar(ctx, painel, "painel", nil)
	tokC, _ := s.Criar(ctx, cliente, "cliente", nil)
	casos := []struct {
		nome, token string
		quer        int
	}{{"sem token", "", 401}, {"painel", tokP, 200}, {"cliente", tokC, 403}}
	for _, c := range casos {
		r := httptest.NewRequest("GET", "/auth/eu", nil)
		if c.token != "" {
			r.Header.Set("Authorization", "Bearer "+c.token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.quer {
			t.Errorf("%s: %d, esperava %d (%s)", c.nome, w.Code, c.quer, w.Body)
		}
	}
}

// Rotas públicas: EXATAMENTE estas. Qualquer outra rota registrada tem de exigir sessão;
// uma rota nova montada fora do grupo autenticado faz TestNenhumaRotaNovaFicaAberta falhar.
var publicas = map[string]bool{
	"GET /saude": true, "GET /pronto": true, "POST /auth/entrar": true,
	"POST /receber-webhook-pedido-shopify": true, "POST /receber-webhook-checkout": true,
	"POST /receber-webhook-abandono": true, "POST /receber-webhook-chatwoot": true,
	"POST /receber-opt-out-chatwoot": true,
	// Plano 5.0: links de senha (sem enumeração, limite por IP e por e-mail no handler)
	"POST /auth/esqueci-senha": true, "POST /auth/definir-senha": true,
	// Plano 5.1: o pedido de acesso da tela de login (JSON obrigatório, 10 por IP e 100 no total por hora, validação no handler)
	"POST /pedir-acesso": true,
}

func webhooksPublicos() []string {
	return []string{"/receber-webhook-pedido-shopify", "/receber-webhook-checkout", "/receber-webhook-abandono",
		"/receber-webhook-chatwoot", "/receber-opt-out-chatwoot"}
}

// Negado por padrão: percorre as rotas REAIS do roteador; toda rota fora da lista pública
// sem sessão = 401; todo webhook sem assinatura/segredo = 401 (a rota existe: não é 404).
func TestNenhumaRotaNovaFicaAberta(t *testing.T) {
	p := testebanco.Novo(t)
	st := auth.NovoStore(p)
	h := Rotas(p, st, auth.NovoLimitador(), config.Config{ShopifySegredos: []string{"s"}, ChatwootSegredo: "c"})
	semModulo := fixtureUsuarios(t, p, st)["nenhum"]
	const clienteID = "88888888-8888-4888-a888-888888888888"
	p.Exec(context.Background(), `insert into usuarios (id, email) values ($1, 'cliente-walk@x.com')`, clienteID)
	tokCliente, _ := st.Criar(context.Background(), clienteID, "cliente", nil)
	var vistas []string
	err := chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		chave := metodo + " " + rota
		vistas = append(vistas, chave)
		if publicas[chave] {
			return nil
		}
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(metodo, rota, strings.NewReader(`{"a":1}`)))
		if r.Code != http.StatusUnauthorized {
			t.Errorf("%s sem sessão = %d, esperava 401 (rota nova fora do grupo autenticado?)", chave, r.Code)
		}
		// sessão de CLIENTE (não é de painel) é recusada em TODA rota protegida, inclusive as só-sessão
		r = httptest.NewRecorder()
		req := httptest.NewRequest(metodo, rota, strings.NewReader(`{"a":1}`))
		req.Header.Set("Authorization", "Bearer "+tokCliente)
		h.ServeHTTP(r, req)
		if r.Code != http.StatusForbidden {
			t.Errorf("%s com sessão de cliente = %d, esperava 403", chave, r.Code)
		}
		// com sessão e SEM módulo nenhum: 403 em toda rota, salvo a lista curta de só-sessão
		if soSessao[chave] {
			return nil
		}
		r = httptest.NewRecorder()
		req = httptest.NewRequest(metodo, rota, strings.NewReader(`{"endpoint":"pedidos/vendas"}`))
		req.Header.Set("Authorization", "Bearer "+semModulo)
		h.ServeHTTP(r, req)
		if r.Code != http.StatusForbidden {
			t.Errorf("%s com sessão sem módulo = %d, esperava 403 (rota nova sem ExigirModulo?)", chave, r.Code)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for chave := range publicas { // a lista pública não pode apontar para rota que não existe
		achou := false
		for _, v := range vistas {
			achou = achou || v == chave
		}
		if !achou {
			t.Errorf("rota pública %s não está montada", chave)
		}
	}
	for chave := range soSessao { // nem a lista só-sessão pode apontar para rota que não existe
		if !slices.Contains(vistas, chave) {
			t.Errorf("rota só-sessão %s não está montada", chave)
		}
	}
	// Plano 5.1: estar na lista pública e montada não basta: sem sessão, o pedido de acesso responde 201 com JSON
	// (montá-la no grupo autenticado faria 401; o 415 sem o cabeçalho é do handler, não de sessão).
	if _, err := p.Exec(context.Background(), `create table access_requests (id uuid primary key default gen_random_uuid(), name text not null,
		email text not null, message text, status text not null, created_at timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/pedir-acesso", strings.NewReader(`{"name":"Sem Sessão","email":"sem-sessao@x.com","message":"oi"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(r, req)
	var pedido struct{ ID string }
	if r.Code != http.StatusCreated || json.Unmarshal(r.Body.Bytes(), &pedido) != nil || pedido.ID == "" {
		t.Errorf("POST /pedir-acesso sem sessão = %d %s, esperava 201 com {\"id\"}", r.Code, r.Body)
	}
	for _, c := range webhooksPublicos() {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("POST", c, strings.NewReader(`{"a":1}`)))
		if r.Code != http.StatusUnauthorized {
			t.Errorf("POST %s sem assinatura/segredo = %d, esperava 401", c, r.Code)
		}
	}
}

// Webhook só aceita POST: qualquer outro método é 405 do roteador, nunca chega ao handler.
func TestWebhooksSoAceitamPOST(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	for _, c := range webhooksPublicos() {
		for _, m := range []string{"GET", "PUT", "DELETE", "PATCH"} {
			r := httptest.NewRecorder()
			h.ServeHTTP(r, httptest.NewRequest(m, c, nil))
			if r.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s = %d, esperava 405", m, c, r.Code)
			}
		}
	}
}

const conta = "33333333-3333-3333-3333-333333333333"

// fixtureUsuarios cria a conta Meta e uma pessoa por módulo (SÓ aquele módulo), uma sem
// módulo nenhum e uma admin; devolve o token de sessão de cada uma pelo nome.
func fixtureUsuarios(t *testing.T, p *pgxpool.Pool, s *auth.Store) map[string]string {
	t.Helper()
	ctx := context.Background()
	testebanco.TabelasDoEscopo(t, p) // as rotas ao vivo passam por autz.ComEscopo (lê perfil e equipes)
	if _, err := p.Exec(ctx, `create table accounts (id uuid primary key, instagram_id text, ad_account_id text);
		insert into accounts values ('`+conta+`', '1784', 'act_1')`); err != nil {
		t.Fatal(err)
	}
	perfis := []struct{ nome, role, features string }{
		{"nenhum", "viewer", "{}"}, {"so-meta", "viewer", "{meta}"}, {"so-social", "viewer", "{social}"},
		{"so-sales", "viewer", "{sales}"}, {"admin", "admin", "{}"},
	}
	toks := map[string]string{}
	for i, pf := range perfis {
		id := fmt.Sprintf("11111111-1111-1111-1111-11111111111%d", i)
		email := pf.nome + "@x.com"
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1, $2)`, id, email); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features, escopo_por_equipe) values ($1, $2, $3, $4::text[], false)`, id, email, pf.role, pf.features); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, id, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		toks[pf.nome] = tok
	}
	return toks
}

func coreFalso(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[]}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// Rotas que só exigem sessão (qualquer módulo, ou nenhum). TODA outra rota do grupo
// autenticado tem de ter portão de módulo: uma rota nova sem portão falha no teste da varredura.
var soSessao = map[string]bool{"POST /auth/sair": true, "GET /auth/eu": true, "GET /eu/canais": true,
	// Plano 5.0: a conta de quem está logado; invite-user e entrar-como têm o portão das edges
	// DENTRO do handler (400 com a frase da edge: TestContaPelaMontagemReal) e /rpc/{nome} só
	// responde para nome registrado, cada um com o seu portão (sem registro: 404).
	"POST /auth/trocar-senha": true, "GET /eu/perfil": true, "POST /invite-user": true,
	"POST /entrar-como-usuario": true, "POST /conferir-senha": true, "POST /rpc/{nome}": true,
	// Plano 5.6: portão = catálogo, provado pela matriz de cada rota em `internal/redes`; vazamento entre
	// contas, impersonado e segredo por `TestNadaVazaEntreContas`, `TestEscritasRecusamImpersonado` e
	// `TestSegredoDaContaNuncaSai`.
	"GET /redes/contas": true, "PATCH /redes/contas/{id}": true, "GET /redes/seguidores": true,
	"GET /redes/leituras-de-seguidores": true, "GET /redes/engajamento": true, "GET /redes/conteudo": true,
	"GET /redes/campanhas": true, "GET /redes/conjuntos": true, "GET /redes/anuncios": true,
	"GET /redes/insights-de-campanha": true, "GET /redes/insights-da-conta": true,
	"GET /redes/campanhas-por-hora": true, "GET /redes/anuncios-por-hora": true, "GET /redes/visitas-por-hora": true,
	"GET /redes/metas": true, "PUT /redes/metas": true, "GET /redes/filtros-de-campanha": true,
	"PUT /redes/filtros-de-campanha/{account_id}": true,
	// Plano 5.12: leituras com a regra do catálogo (`true` para sessão); a matriz por papel é
	// TestPaineisPelaMontagemReal.
	"GET /noticias/rodadas": true, "GET /noticias/concorrentes": true, "GET /noticias/panorama": true,
	"GET /status-ia/execucoes": true,
	// quem não passa na regra das duas tabelas recebe 200 [] (TestSaudeDosRobosPelaMontagemReal).
	"GET /status-ia/saude-dos-robos": true,
}

// Plano 5.1: as rotas do admin, de equipes, de avisos e de saúde. Portão = catálogo, provado pela matriz de
// cada rota em internal/acesso; escrita de impersonado recusada por TestEscritasRecusamImpersonado. Todas
// ficam no grupo de DOMÍNIO (prazo e escopo do grupo: TestPrazosPorRotaPelaMontagemReal).
var rotas51 = []string{
	"GET /acesso/usuarios", "PATCH /acesso/usuarios/{id}", "GET /acesso/perfis", "POST /acesso/perfis", "PATCH /acesso/perfis/{id}",
	"GET /acesso/pedidos", "PATCH /acesso/pedidos/{id}",
	"GET /equipes/times", "POST /equipes/times", "PATCH /equipes/times/{id}",
	"GET /equipes/membros", "POST /equipes/membros", "PATCH /equipes/membros/{id}", "DELETE /equipes/membros/{id}",
	"GET /equipes/permissoes", "POST /equipes/permissoes", "DELETE /equipes/permissoes/{id}",
	"GET /equipes/grupos", "POST /equipes/grupos", "PATCH /equipes/grupos/{id}", "DELETE /equipes/grupos/{id}",
	"GET /equipes/grupos-membros", "POST /equipes/grupos-membros", "DELETE /equipes/grupos-membros/{id}",
	"GET /avisos/preferencias", "POST /avisos/preferencias", "POST /eu/push/inscrever", "POST /eu/push/desinscrever",
	"GET /saude/conferencias",
}

// Plano 5.7: as 16 rotas de tabela de trafego.Montar, no grupo de DOMÍNIO. Portão = catálogo, provado pela
// matriz de cada rota em `internal/trafego`; vazamento e impersonado por `TestNadaVazaEntreContas` e
// `TestEscritasRecusamImpersonado`. Os 3 proxies NÃO entram aqui: têm ExigirModulo (TestNenhumaRotaNovaFicaAberta).
var rotas57 = []string{
	"GET /gestao-trafego/analises-de-orcamento", "GET /gestao-trafego/analises-de-anuncio",
	"GET /gestao-trafego/decisoes", "POST /gestao-trafego/decisoes",
	"GET /gestao-trafego/rascunhos", "POST /gestao-trafego/rascunhos",
	"PATCH /gestao-trafego/rascunhos/{id}", "DELETE /gestao-trafego/rascunhos/{id}",
	"GET /gestao-trafego/config-metricas", "PUT /gestao-trafego/config-metricas/{balde}",
	"GET /gestao-trafego/objetivos", "PUT /gestao-trafego/objetivos/{alvo_id}", "DELETE /gestao-trafego/objetivos/{alvo_id}",
	"GET /gestao-trafego/regua", "PUT /gestao-trafego/regua", "GET /gestao-trafego/interesses-sugeridos",
}

func init() {
	for _, c := range append(slices.Clone(rotas51), rotas57...) {
		soSessao[c] = true
	}
}

// Matriz completa 401/403/200 por rota pela montagem de produção: cada módulo abre SÓ as
// suas rotas (pega portão trocado, portão extra ou ausente). O core é um servidor falso.
func TestRotasProtegidasPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{CoreURL: coreFalso(t), CoreToken: "t"})
	toks := fixtureUsuarios(t, p, s)
	casos := []struct {
		metodo, caminho, corpo string
		quem                   []string // quem passa (200); admin passa em todas
	}{
		{"GET", "/eu/canais", "", []string{"nenhum", "so-meta", "so-social", "so-sales"}},
		{"GET", "/auth/eu", "", []string{"nenhum", "so-meta", "so-social", "so-sales"}},
		{"POST", "/bling-proxy", `{"endpoint":"pedidos/vendas"}`, []string{"so-sales"}},
		{"POST", "/meta-proxy", fmt.Sprintf(`{"accountId":%q,"path":"x"}`, conta), []string{"so-meta"}},
		{"POST", "/insights-ao-vivo", fmt.Sprintf(`{"account_id":%q}`, conta), []string{"so-social"}},
		{"POST", "/serie-novos-dia", fmt.Sprintf(`{"account_id":%q,"dias":[]}`, conta), []string{"so-social"}},
		{"POST", "/contar-collabs", fmt.Sprintf(`{"account_id":%q}`, conta), []string{"so-social"}},
	}
	pedir := func(metodo, caminho, corpo, tok string) int {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	for _, c := range casos {
		if got := pedir(c.metodo, c.caminho, c.corpo, ""); got != 401 {
			t.Errorf("%s %s sem sessão = %d, esperava 401", c.metodo, c.caminho, got)
		}
		for _, quem := range []string{"nenhum", "so-meta", "so-social", "so-sales", "admin"} {
			quer := 403
			if quem == "admin" || slices.Contains(c.quem, quem) {
				quer = 200
			}
			if got := pedir(c.metodo, c.caminho, c.corpo, toks[quem]); got != quer {
				t.Errorf("%s %s como %s = %d, esperava %d", c.metodo, c.caminho, quem, got, quer)
			}
		}
	}
}

// Ruling 34 pela montagem de produção: o autz.ComEscopo das 4 rotas ao vivo está ligado. Sem ele, o
// so-meta (allowed_accounts nulo = todas) cairia em 400 por escopo ausente (falha fechada): o teste acusa.
func TestEscopoDeContasPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{CoreURL: coreFalso(t), CoreToken: "t"})
	toks := fixtureUsuarios(t, p, s)
	ctx := context.Background()
	const restrito = "44444444-4444-4444-4444-444444444444"
	if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'meta-restrito@x.com')`, restrito); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features, escopo_por_equipe, allowed_accounts)
		values ($1::uuid, 'meta-restrito@x.com', 'viewer', '{meta,social}', false, '{outra-conta}')`, restrito); err != nil {
		t.Fatal(err)
	}
	toks["meta-restrito"], _ = s.Criar(ctx, restrito, "painel", nil)
	pedir := func(caminho, corpo, tok string) (int, string) {
		r := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	proxy := fmt.Sprintf(`{"accountId":%q,"path":"/act_1/insights"}`, conta)
	if st, resp := pedir("/meta-proxy", proxy, toks["so-meta"]); st == 400 {
		t.Errorf("so-meta (sem lista) no /meta-proxy: %d %s (o ComEscopo da montagem?)", st, resp)
	}
	if st, resp := pedir("/meta-proxy", proxy, toks["meta-restrito"]); st != 400 || strings.TrimSpace(resp) != `{"error":"conta nao encontrada"}` {
		t.Errorf("meta-restrito no /meta-proxy: %d %s", st, resp)
	}
	ao := fmt.Sprintf(`{"account_id":%q}`, conta)
	if st, resp := pedir("/insights-ao-vivo", ao, toks["so-social"]); st == 404 {
		t.Errorf("so-social no /insights-ao-vivo: %d %s", st, resp)
	}
	if st, resp := pedir("/insights-ao-vivo", ao, toks["meta-restrito"]); st != 404 || !strings.Contains(resp, "conta não encontrada") {
		t.Errorf("meta-restrito no /insights-ao-vivo: %d %s", st, resp)
	}
}

// As rotas de /redes pela montagem de produção (esquema de produção): sem sessão 401; a pessoa com lista
// só vê A1; a admin vê as duas; a escrita da limitada em A2 é 403 (o redes.Montar está no grupo com ComEscopo).
func TestRedesPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{CoreURL: coreFalso(t), CoreToken: "t"})
	ctx := context.Background()
	const a1, a2 = "a5600000-0000-4000-a000-0000000000a1", "a5600000-0000-4000-a000-0000000000a2"
	const limitada, admin = "a5620000-0000-4000-a000-000000000001", "a5620000-0000-4000-a000-000000000002"
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := p.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`insert into usuarios (id, email) values ($1::uuid, 'limitada@x.com'), ($2::uuid, 'admin@x.com')`, limitada, admin)
	exec(`insert into profiles (id, email, role, features, escopo_por_equipe, allowed_accounts) values
		($1::uuid, 'limitada@x.com', 'viewer', '{social}', false, array[$3::uuid]),
		($2::uuid, 'admin@x.com', 'admin', '{social}', false, null)`, limitada, admin, a1)
	exec(`insert into accounts (id, name) values ($1::uuid, 'Vessel'), ($2::uuid, 'Mantova')`, a1, a2)
	exec(`insert into engagement_snapshots (account_id, captured_at, period_days, likes) values
		($1::uuid, '2026-10-11', 7, 10), ($2::uuid, '2026-10-11', 7, 30)`, a1, a2)
	tokL, _ := s.Criar(ctx, limitada, "painel", nil)
	tokA, _ := s.Criar(ctx, admin, "painel", nil)
	pedir := func(metodo, caminho, corpo, tok string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	if st, b := pedir("GET", "/redes/engajamento", "", ""); st != 401 {
		t.Errorf("sem sessão = %d %s", st, b)
	}
	if st, b := pedir("GET", "/redes/engajamento", "", tokL); st != 200 || !strings.Contains(b, a1) || strings.Contains(b, a2) {
		t.Errorf("limitada = %d %s (esperava só A1)", st, b)
	}
	if st, b := pedir("GET", "/redes/engajamento", "", tokA); st != 200 || !strings.Contains(b, a1) || !strings.Contains(b, a2) {
		t.Errorf("admin = %d %s (esperava as duas)", st, b)
	}
	meta := func(conta string) string {
		return `{"metas":[{"account_id":"` + conta + `","periodo":"1","indicador":"seguidores","valor":1}]}`
	}
	if st, b := pedir("PUT", "/redes/metas", meta(a2), tokL); st != 403 {
		t.Errorf("limitada gravando meta de A2 = %d %s, esperava 403", st, b)
	}
	if st, b := pedir("PUT", "/redes/metas", meta(a1), tokL); st/100 != 2 {
		t.Errorf("limitada gravando meta de A1 = %d %s, esperava 2xx", st, b)
	}
}

// Prazos pela montagem real: percorre as rotas e, nos middlewares embutidos de cada uma,
// confere que o de prazo dá o deadline esperado (contar-collabs 120 s, as outras ao vivo 90 s)
// e que nenhuma outra rota ganha prazo sem constar aqui.
func TestPrazosPorRotaPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	quer := map[string]time.Duration{"POST /bling-proxy": 90 * time.Second, "POST /insights-ao-vivo": 90 * time.Second, "POST /serie-novos-dia": 90 * time.Second, "POST /contar-collabs": 120 * time.Second,
		// Plano 5.0: o grupo de domínio inteiro (e o /rpc) tem prazo; rota de domínio nova herda
		"POST /rpc/{nome}": PrazoDominio,
		// Plano 5.12: leituras do grupo de domínio
		"GET /noticias/rodadas": PrazoDominio, "GET /noticias/concorrentes": PrazoDominio,
		"GET /noticias/panorama": PrazoDominio, "GET /status-ia/execucoes": PrazoDominio,
		"GET /status-ia/saude-dos-robos": PrazoDominio,
		// Plano 5.12: fatura real das contas de IA (grupo autenticado, FORA do de domínio)
		"POST /custo-anthropic": 90 * time.Second, "POST /custo-openai": 90 * time.Second,
		// Plano 5.7: proxies no grupo de SESSÃO, com prazo próprio (o de domínio cortaria a IA)
		"POST /sugerir-publico-ia": PrazoIA, "POST /ler-documento": PrazoIA, "POST /buscar-lugar": PrazoMapa}
	for _, c := range append(slices.Clone(rotas51), rotas57...) { // Planos 5.1 e 5.7: no grupo de domínio, com o prazo dele
		quer[c] = PrazoDominio
	}
	vistos := map[string]bool{}
	chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, mws ...func(http.Handler) http.Handler) error {
		chave := metodo + " " + rota
		var achado time.Duration
		for _, mw := range mws {
			mw(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				if dl, ok := r.Context().Deadline(); ok {
					achado = time.Until(dl).Round(time.Second)
				}
			})).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/", nil))
		}
		if strings.HasPrefix(rota, "/redes/") { // Plano 5.6: o grupo de domínio inteiro herda o prazo
			if achado != PrazoDominio {
				t.Errorf("%s: prazo %v, esperava %v (PrazoDominio)", chave, achado, PrazoDominio)
			}
			return nil
		}
		if q, ok := quer[chave]; ok {
			vistos[chave] = true
			if achado != q {
				t.Errorf("%s: prazo %v, esperava %v", chave, achado, q)
			}
		} else if achado != 0 {
			t.Errorf("%s ganhou prazo %v fora da lista", chave, achado)
		}
		return nil
	})
	if len(vistos) != len(quer) {
		t.Errorf("rotas com prazo não montadas: %v", vistos)
	}
	// o WriteTimeout do servidor (main.go usa EscritaDoServidor): cada prazo de rota termina com folga ANTES dele
	if EscritaDoServidor != 150*time.Second {
		t.Errorf("EscritaDoServidor = %v: as NOTAS dizem 150 s (PrazoCollabs + 30 s)", EscritaDoServidor)
	}
	for chave, d := range quer {
		if d+30*time.Second > EscritaDoServidor {
			t.Errorf("%s: prazo %v sem 30 s de folga antes do WriteTimeout do servidor (%v): a conexão cairia antes do 504", chave, d, EscritaDoServidor)
		}
	}
	if PrazoDominio >= 60*time.Second {
		t.Errorf("PrazoDominio %v: o proxy_read_timeout padrão do nginx (60 s) cortaria a resposta antes do 504 da API", PrazoDominio)
	}
}

// meta-proxy: o prazo é do handler (25 s; 45 s com imagem; 75 s com vídeo), visto no
// contexto da chamada ao core pela montagem real.
type gravaPrazo struct{ prazo *time.Duration }

func (g gravaPrazo) RoundTrip(r *http.Request) (*http.Response, error) {
	if dl, ok := r.Context().Deadline(); ok {
		*g.prazo = time.Until(dl).Round(time.Second)
	}
	return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"data":[]}`)), Request: r}, nil
}

func TestMetaProxyPrazosPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	var visto time.Duration
	antigo := http.DefaultTransport
	http.DefaultTransport = gravaPrazo{&visto}
	t.Cleanup(func() { http.DefaultTransport = antigo })
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{CoreURL: "http://core.invalido", CoreToken: "t", HostsDeMidia: []string{"m.exemplo"}})
	tok := fixtureUsuarios(t, p, s)["so-meta"]
	for _, c := range []struct {
		extra string
		quer  time.Duration
	}{{``, 25 * time.Second}, {`,"imageFromUrl":"https://m.exemplo/a.jpg"`, 45 * time.Second}, {`,"videoFromUrl":"https://m.exemplo/a.mp4"`, 75 * time.Second}} {
		visto = 0
		r := httptest.NewRequest("POST", "/meta-proxy", strings.NewReader(fmt.Sprintf(`{"accountId":%q,"path":"x"%s}`, conta, c.extra)))
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || visto != c.quer {
			t.Errorf("%q: status %d, prazo %v, esperava 200 e %v", c.extra, w.Code, visto, c.quer)
		}
	}
}

// Limite por IP nos webhooks (Ruling 31: 600/min). O IP vem do X-Real-IP SÓ quando o par é o
// nginx (privado/loopback); X-Forwarded-For e cabeçalhos de cliente nunca valem.
func TestLimiteDeIPNosWebhooks(t *testing.T) {
	p := testebanco.Novo(t)
	novo := func() http.Handler {
		return Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	}
	pedir := func(h http.Handler, peer string, cab map[string]string, i int) int {
		r := httptest.NewRequest("POST", webhooksPublicos()[i%5], strings.NewReader(`{}`))
		r.RemoteAddr = peer + ":4000"
		for k, v := range cab {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	// par público forjando cabeçalhos: o balde é o do par, compartilhado pelas 5 rotas
	h := novo()
	for i := 0; i < 600; i++ {
		if got := pedir(h, "203.0.113.9", map[string]string{"X-Real-IP": fmt.Sprintf("198.51.100.%d", i%250), "X-Forwarded-For": fmt.Sprintf("9.9.9.%d", i%250)}, i); got != 401 {
			t.Fatalf("requisição %d = %d, esperava 401", i, got)
		}
	}
	if got := pedir(h, "203.0.113.9", map[string]string{"X-Real-IP": "198.51.100.200"}, 0); got != 429 {
		t.Fatalf("601ª do mesmo par com X-Real-IP trocado = %d, esperava 429 (spoof)", got)
	}
	// via nginx (loopback): cada X-Real-IP tem o seu balde; XFF é ignorado
	h = novo()
	for i := 0; i < 600; i++ {
		pedir(h, "127.0.0.1", map[string]string{"X-Real-IP": "198.51.100.1", "X-Forwarded-For": fmt.Sprintf("9.9.9.%d", i%250)}, i)
	}
	if got := pedir(h, "127.0.0.1", map[string]string{"X-Real-IP": "198.51.100.1", "X-Forwarded-For": "7.7.7.7"}, 0); got != 429 {
		t.Fatalf("601ª do mesmo X-Real-IP via nginx = %d, esperava 429 (XFF não pode abrir balde novo)", got)
	}
	if got := pedir(h, "127.0.0.1", map[string]string{"X-Real-IP": "198.51.100.2"}, 0); got != 401 {
		t.Fatalf("outro IP real via nginx = %d, esperava 401 (balde próprio)", got)
	}
}

// Prazo por requisição das rotas lentas da Meta: o contexto que chega ao handler tem deadline.
func TestComPrazoPoeDeadlineNoContexto(t *testing.T) {
	var dl time.Time
	var tem bool
	h := comPrazo(PrazoCollabs)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { dl, tem = r.Context().Deadline() }))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/x", nil))
	if !tem || time.Until(dl) < PrazoCollabs-5*time.Second || time.Until(dl) > PrazoCollabs {
		t.Fatalf("deadline = %v (tem=%v)", time.Until(dl), tem)
	}
}

// Plano 4: avisar-decisao-de-reserva pela montagem real. O corpo vazio dá 400 DEPOIS do portão: quem
// recebe 400 passou; quem recebe 403 parou nele (mata um portão montado com a permissão errada). O
// portão é o da edge: superadmin ou permissions['frota.aprovar'] com 'ver'. Papel admin, módulo e
// outra permissão da Frota NÃO abrem.
func TestAvisarDecisaoDeReservaPeloPortaoReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	toks := map[string]string{}
	for i, u := range []struct {
		nome, perm, role string
		super            bool
	}{
		{"aprova", `{"frota.aprovar":["ver"]}`, "viewer", false}, {"frota-ver", `{"frota":["ver"]}`, "viewer", false},
		{"aprova-editar", `{"frota.aprovar":["editar"]}`, "viewer", false}, {"papel-admin", `{}`, "admin", false},
		{"super", `{}`, "viewer", true}, {"sem-nada", `{}`, "viewer", false},
	} {
		id := fmt.Sprintf("22222222-2222-2222-2222-22222222222%d", i)
		p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $1::text || '@x')`, id)
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin, permissions) values ($1::uuid, $1::text || '@x', $2::text, $3::boolean, $4::jsonb)`,
			id, u.role, u.super, u.perm); err != nil {
			t.Fatal(err)
		}
		toks[u.nome], _ = s.Criar(ctx, id, "painel", nil)
	}
	pedir := func(tok string) int {
		r := httptest.NewRequest("POST", "/avisar-decisao-de-reserva", strings.NewReader(`{}`))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	if got := pedir(""); got != 401 {
		t.Errorf("sem sessão = %d, esperava 401", got)
	}
	for nome, quer := range map[string]int{"aprova": 400, "super": 400, "frota-ver": 403, "aprova-editar": 403, "papel-admin": 403, "sem-nada": 403} {
		if got := pedir(toks[nome]); got != quer {
			t.Errorf("%s = %d, esperava %d", nome, got, quer)
		}
	}
	// Só POST: o resto é 405 do roteador, nunca chega ao handler.
	for _, m := range []string{"GET", "PUT", "DELETE"} {
		r := httptest.NewRequest(m, "/avisar-decisao-de-reserva", nil)
		r.Header.Set("Authorization", "Bearer "+toks["aprova"])
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 405 {
			t.Errorf("%s = %d, esperava 405", m, w.Code)
		}
	}
}

// Plano 5.0 pela montagem real: os links de senha respondem sem sessão; as rotas da conta exigem
// sessão de painel e, para quem não é admin/super-admin, devolvem a frase da edge.
func TestContaPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{EnderecosDoApp: []string{"https://central.exemplo"}, EnderecoPadrao: "https://central.exemplo"})
	viewer := fixtureUsuarios(t, p, s)["nenhum"]
	ctx := context.Background()
	const cliente = "77777777-7777-4777-a777-777777777777"
	p.Exec(ctx, `insert into usuarios (id, email) values ($1, 'cliente@x.com')`, cliente)
	tokCliente, _ := s.Criar(ctx, cliente, "cliente", nil)
	pedir := func(metodo, caminho, corpo, tok string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	casos := []struct {
		metodo, caminho, corpo, tok string
		status                      int
		trecho                      string
	}{
		{"POST", "/auth/esqueci-senha", `{"email":"ninguem@x.com"}`, "", 202, `{"ok":true}`},
		{"POST", "/auth/definir-senha", `{"token":"inventado","senha":"senha-boa"}`, "", 400, "token_invalido"},
		{"POST", "/invite-user", `{"email":"a@x.com"}`, viewer, 400, "Apenas administradores"},
		{"POST", "/entrar-como-usuario", `{"alvoId":"` + conta + `"}`, viewer, 400, "Apenas super-admin"},
		{"POST", "/conferir-senha", `{}`, viewer, 400, "sem_senha"},
		{"POST", "/auth/trocar-senha", `{"senha":"1"}`, viewer, 400, "senha_invalida"},
		{"GET", "/eu/perfil", ``, viewer, 200, `"role":"viewer"`},
		// nome que nenhum sub-plano registra: o /rpc só responde para o que está na lista branca
		{"POST", "/rpc/funcao_que_ninguem_registra", `{}`, viewer, 404, "nao_encontrado"},
		{"POST", "/invite-user", `{}`, tokCliente, 403, "sem_permissao"},
		{"POST", "/rpc/qualquer", `{}`, "", 401, "nao_autenticado"},
	}
	for _, c := range casos {
		if st, corpo := pedir(c.metodo, c.caminho, c.corpo, c.tok); st != c.status || !strings.Contains(corpo, c.trecho) {
			t.Errorf("%s %s = %d %s, esperava %d com %q", c.metodo, c.caminho, st, corpo, c.status, c.trecho)
		}
	}
}

// Os caminhos FELIZES da conta pela montagem real (200/204 de verdade, com efeito no banco): quem
// tem o portão passa; o mesmo corpo sem ele já foi recusado acima.
func TestContaCaminhosFelizesPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{EnderecosDoApp: []string{"https://central.exemplo"}, EnderecoPadrao: "https://central.exemplo"})
	toks := fixtureUsuarios(t, p, s)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table entradas_como_outro_usuario (
		id uuid primary key default gen_random_uuid(),
		admin_id uuid not null references profiles(id), admin_email text not null,
		alvo_id uuid not null references profiles(id), alvo_email text not null,
		criado_em timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	const super, alvo = "99999999-9999-4999-a999-999999999991", "99999999-9999-4999-a999-999999999992"
	hash, err := auth.HashDaSenha("senha-do-super")
	if err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `insert into usuarios (id, email, senha_hash) values ($1::uuid, 'super@x.com', $2::text), ($3::uuid, 'alvo@x.com', null)`, super, hash, alvo)
	p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin, escopo_por_equipe) values ($1::uuid, 'super@x.com', 'admin', true, false), ($2::uuid, 'alvo@x.com', 'viewer', false, false)`, super, alvo)
	toks["super"], _ = s.Criar(ctx, super, "painel", nil)
	pedir := func(metodo, caminho, corpo, tok string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for _, c := range []struct {
		metodo, caminho, corpo, quem string
		status                       int
		trecho                       string
	}{
		{"GET", "/auth/eu", ``, "nenhum", 200, `"id"`},
		{"GET", "/eu/perfil", ``, "nenhum", 200, `"role":"viewer"`},
		{"POST", "/conferir-senha", `{"senha":"senha-do-super"}`, "super", 200, `{"ok":true}`},
		{"POST", "/invite-user", `{"email":"nova@x.com","password":"senha-boa-123"}`, "admin", 200, `{"success":true}`},
		{"POST", "/entrar-como-usuario", `{"alvoId":"` + alvo + `"}`, "super", 200, `"expira_em"`},
		{"POST", "/auth/trocar-senha", `{"senha":"outra-senha-boa"}`, "nenhum", 204, ``},
	} {
		if st, corpo := pedir(c.metodo, c.caminho, c.corpo, toks[c.quem]); st != c.status || !strings.Contains(corpo, c.trecho) {
			t.Errorf("%s %s como %s = %d %s, esperava %d com %q", c.metodo, c.caminho, c.quem, st, corpo, c.status, c.trecho)
		}
	}
	var n int
	p.QueryRow(ctx, `select (select count(*) from usuarios where email = 'nova@x.com') + (select count(*) from entradas_como_outro_usuario where alvo_id = $1::uuid)`, alvo).Scan(&n)
	if n != 2 {
		t.Errorf("efeitos no banco = %d, esperava 2 (conta nova + auditoria de entrar como)", n)
	}
}

// POST /rpc/{nome} pela montagem real, com uma função registrada de verdade (movida de pendente para
// registrada, como cada sub-plano fará): 401 sem sessão, 403 sem o portão (e a função NÃO roda), 200 com
// ele, 404 para nome não registrado, e o portão vem antes da validação do corpo.
func TestRPCRegistradaPelaMontagemReal(t *testing.T) {
	const nome = "vessel_gerar_lote"
	original, pendentes := FuncoesRPC, RPCPendentes
	t.Cleanup(func() { FuncoesRPC, RPCPendentes = original, pendentes })
	// ACRESCENTA: com as funções dos sub-planos já registradas (e fora de RPCPendentes), trocar a lista inteira
	// derrubaria a soma de TotalRPCDoPainel.
	FuncoesRPC = append(slices.Clone(original), rpc.Funcao{Nome: nome, Params: []rpc.Param{{Nome: "p_n", Tipo: "integer"}}, Retorno: rpc.Valor, Portao: autz.SuperFicha})
	RPCPendentes = slices.DeleteFunc(slices.Clone(pendentes), func(x string) bool { return x == nome })
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	toks := fixtureUsuarios(t, p, s)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table marca (n int);
		create function `+nome+`(p_n integer) returns integer language plpgsql as $$ begin insert into marca values (p_n); return p_n + 1; end $$`); err != nil {
		t.Fatal(err)
	}
	const super = "99999999-9999-4999-a999-999999999993"
	p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'super-rpc@x.com')`, super)
	p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin, escopo_por_equipe) values ($1::uuid, 'super-rpc@x.com', 'viewer', true, false)`, super)
	toks["super"], _ = s.Criar(ctx, super, "painel", nil)
	pedir := func(caminho, corpo, quem string) (int, string) {
		r := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
		if quem != "" {
			r.Header.Set("Authorization", "Bearer "+toks[quem])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for _, c := range []struct {
		caminho, corpo, quem string
		status               int
		trecho               string
	}{
		{"/rpc/" + nome, `{"p_n":1}`, "", 401, "nao_autenticado"},
		{"/rpc/" + nome, `{"p_n":1}`, "nenhum", 403, "sem_permissao"},
		{"/rpc/" + nome, `lixo`, "nenhum", 403, "sem_permissao"}, // o portão vem antes do corpo
		{"/rpc/" + nome, `{"p_n":1}`, "admin", 403, "sem_permissao"},
		{"/rpc/" + nome, `{"p_n":1}`, "super", 200, "2"},
		{"/rpc/" + nome, `{}`, "super", 400, "pedido_invalido"},
		{"/rpc/outra_funcao", `{"p_n":1}`, "super", 404, "nao_encontrado"},
	} {
		if st, corpo := pedir(c.caminho, c.corpo, c.quem); st != c.status || !strings.Contains(corpo, c.trecho) {
			t.Errorf("%s %s como %q = %d %s, esperava %d com %q", c.caminho, c.corpo, c.quem, st, corpo, c.status, c.trecho)
		}
	}
	var n int
	p.QueryRow(ctx, `select count(*) from marca`).Scan(&n)
	if n != 1 {
		t.Errorf("a função rodou %d vez(es), esperava 1 (só a do super-admin)", n)
	}
}

// Plano 5.1 pela montagem real: sem sessão é 401, o portão é o do catálogo (viewer não muda a conta do
// admin; só o admin lê pedidos de acesso), o pedido de acesso é público e o health check não depende de
// sessão. A matriz de cada rota está em internal/acesso; aqui vale a MONTAGEM (grupo, cadeia, posição).
func TestAcessoPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	const admin, viewer = "5e000000-0000-4000-a000-0000000000a1", "5e000000-0000-4000-a000-0000000000a2"
	for _, u := range [][3]string{{admin, "admin-51@x.com", "admin"}, {viewer, "viewer-51@x.com", "viewer"}} {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, u[0], u[1]); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, escopo_por_equipe) values ($1::uuid, $2::text, $2::text, $3::text, false)`, u[0], u[1], u[2]); err != nil {
			t.Fatal(err)
		}
	}
	tok := map[string]string{}
	for nome, id := range map[string]string{"admin": admin, "viewer": viewer} {
		var err error
		if tok[nome], err = s.Criar(ctx, id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	pedir := func(quem, metodo, caminho, corpo string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		if quem != "" {
			r.Header.Set("Authorization", "Bearer "+tok[quem])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		trecho                             string
	}{
		{"usuários sem sessão", "", "GET", "/acesso/usuarios", "", 401, "nao_autenticado"},
		{"conferências exigem sessão", "", "GET", "/saude/conferencias", "", 401, "nao_autenticado"},
		{"o health check segue público", "", "GET", "/saude", "", 200, "ok"},
		{"viewer não muda a conta do admin", "viewer", "PATCH", "/acesso/usuarios/" + admin, `{"disabled":true}`, 403, "sem_permissao"},
		{"viewer lê pedidos: a regra devolve lista vazia", "viewer", "GET", "/acesso/pedidos", "", 200, "[]"},
		{"admin lê os times", "admin", "GET", "/equipes/times", "", 200, "["},
		{"pedir acesso é público", "", "POST", "/pedir-acesso", `{"name":"Fulana","email":"fulana@x.com","message":"oi"}`, 201, `"id"`},
	} {
		if st, corpo := pedir(c.quem, c.metodo, c.caminho, c.corpo); st != c.status || !strings.Contains(corpo, c.trecho) {
			t.Errorf("%s: %s %s = %d %s, esperava %d com %q", c.nome, c.metodo, c.caminho, st, corpo, c.status, c.trecho)
		}
	}
	var off bool
	if err := p.QueryRow(ctx, `select disabled from profiles where id = $1::uuid`, admin).Scan(&off); err != nil || off {
		t.Errorf("o PATCH negado mexeu em profiles.disabled (%v, %v)", off, err)
	}
	var n int
	if err := p.QueryRow(ctx, `select count(*) from access_requests where email = 'fulana@x.com' and status = 'pending'`).Scan(&n); err != nil || n != 1 {
		t.Errorf("pedidos gravados = %d (%v), esperava 1", n, err)
	}
}

// Plano 5.7 pela montagem real: a cadeia do grupo de domínio (sessão, escopo, prazo) nas leituras e na RPC,
// e o portão e o escopo dos três proxies no grupo de sessão. A matriz de cada rota está em internal/trafego,
// internal/ia e internal/mapa; aqui vale a MONTAGEM. Sem chave de IA e sem ligar a nada de fora: o 503 e o 400
// provam que o pedido passou do portão e do escopo e parou antes do externo.
func TestTrafegoPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	const a1, a2 = "a5700000-0000-4000-a000-0000000000a1", "a5700000-0000-4000-a000-0000000000a2"
	quem := map[string]string{}
	for i, u := range []struct{ nome, papel, features, contas string }{
		{"gestor-a1", "viewer", "{meta,meta.gestor}", "{" + a1 + "}"}, {"admin", "admin", "{}", ""},
		{"so-meta", "viewer", "{meta}", ""}, {"nenhum", "viewer", "{}", ""},
	} {
		id := fmt.Sprintf("a5710000-0000-4000-a000-00000000010%d", i)
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, id, u.nome+"@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, features, escopo_por_equipe, allowed_accounts)
			values ($1::uuid, $2::text, $2::text, $3::text, $4::text[], false, nullif($5::text, '')::uuid[])`,
			id, u.nome+"@x.com", u.papel, u.features, u.contas); err != nil {
			t.Fatal(err)
		}
		var err error
		if quem[u.nome], err = s.Criar(ctx, id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.Exec(ctx, `insert into gt_budget_analises (campaign_id, account_id, veredito) values ('9001', $1::text, 'escalar'), ('9002', $2::text, 'reduzir')`, a1, a2); err != nil {
		t.Fatal(err)
	}
	pedir := func(nome, metodo, caminho, corpo string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		if nome != "" {
			r.Header.Set("Authorization", "Bearer "+quem[nome])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		tem, naoTem                        string
	}{
		{"leitura sem sessão", "", "GET", "/gestao-trafego/analises-de-orcamento", "", 401, "nao_autenticado", ""},
		{"gestor com lista só vê a própria conta", "gestor-a1", "GET", "/gestao-trafego/analises-de-orcamento", "", 200, a1, a2},
		{"admin vê as duas", "admin", "GET", "/gestao-trafego/analises-de-orcamento", "", 200, a2, ""},
		{"RPC com conta que não se vê", "gestor-a1", "POST", "/rpc/gt_registrar_problemas", `{"p_conta":"` + a2 + `","p_itens":[]}`, 403, "sem_permissao", ""},
		{"RPC com a conta da lista", "gestor-a1", "POST", "/rpc/gt_registrar_problemas", `{"p_conta":"` + a1 + `","p_itens":[]}`, 200, "0", ""},
		{"IA sem o módulo do gestor", "so-meta", "POST", "/sugerir-publico-ia", `{"evidencia":{},"contaId":"` + a1 + `"}`, 403, "sem_permissao", ""},
		{"IA passa o portão e o escopo e para sem chave", "gestor-a1", "POST", "/sugerir-publico-ia", `{"evidencia":{},"contaId":"` + a1 + `"}`, 503, "chave_nao_configurada", ""},
		{"documento sem o módulo do gestor", "so-meta", "POST", "/ler-documento", `{}`, 403, "sem_permissao", ""},
		{"mapa sem o módulo meta", "nenhum", "POST", "/buscar-lugar", `{"acao":"buscar","termo":"praça"}`, 403, "sem_permissao", ""},
		{"mapa passa o portão e para na ação, sem ligar ao Nominatim", "so-meta", "POST", "/buscar-lugar", `{"acao":"apagar"}`, 400, "acao desconhecida", ""},
	} {
		st, corpo := pedir(c.quem, c.metodo, c.caminho, c.corpo)
		if st != c.status || !strings.Contains(corpo, c.tem) || (c.naoTem != "" && strings.Contains(corpo, c.naoTem)) {
			t.Errorf("%s: %s %s como %q = %d %s, esperava %d com %q e sem %q", c.nome, c.metodo, c.caminho, c.quem, st, corpo, c.status, c.tem, c.naoTem)
		}
	}
}
