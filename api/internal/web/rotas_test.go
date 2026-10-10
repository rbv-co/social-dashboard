package web

import (
	"context"
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
	"github.com/rbv-co/social-dashboard/api/internal/config"
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
		// com sessão e SEM módulo nenhum: 403 em toda rota, salvo a lista curta de só-sessão
		if soSessao[chave] {
			return nil
		}
		r = httptest.NewRecorder()
		req := httptest.NewRequest(metodo, rota, strings.NewReader(`{"endpoint":"pedidos/vendas"}`))
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
var soSessao = map[string]bool{"POST /auth/sair": true, "GET /auth/eu": true, "GET /eu/canais": true}

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

// Prazos pela montagem real: percorre as rotas e, nos middlewares embutidos de cada uma,
// confere que o de prazo dá o deadline esperado (contar-collabs 120 s, as outras ao vivo 90 s)
// e que nenhuma outra rota ganha prazo sem constar aqui.
func TestPrazosPorRotaPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	quer := map[string]time.Duration{"POST /insights-ao-vivo": 90 * time.Second, "POST /serie-novos-dia": 90 * time.Second, "POST /contar-collabs": 120 * time.Second}
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
