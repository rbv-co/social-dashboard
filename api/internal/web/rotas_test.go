package web

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
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
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{ShopifySegredos: []string{"s"}, ChatwootSegredo: "c"})
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

// 401 (sem sessão), 403 (sem o módulo) e 200 (autorizado) em cada rota protegida, pela
// montagem de produção. O core é um servidor falso que devolve {"data":[]}.
func TestRotasProtegidasPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	ctx := context.Background()
	coreFalso := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[]}`))
	}))
	defer coreFalso.Close()
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{CoreURL: coreFalso.URL, CoreToken: "t"})
	const comTudo, semNada = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	for _, q := range []string{
		`create table accounts (id uuid primary key, instagram_id text, ad_account_id text)`,
		`insert into accounts values ('33333333-3333-3333-3333-333333333333', '1784', 'act_1')`,
		`insert into usuarios (id, email) values ('` + comTudo + `', 'a@x.com'), ('` + semNada + `', 'b@x.com')`,
		`insert into profiles (id, email, role, features, escopo_por_equipe) values ('` + comTudo + `', 'a@x.com', 'viewer', '{sales,meta,social}', false)`,
		`insert into profiles (id, email, role, features, escopo_por_equipe) values ('` + semNada + `', 'b@x.com', 'viewer', '{}', false)`,
	} {
		if _, err := p.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	tokTudo, _ := s.Criar(ctx, comTudo, "painel", nil)
	tokNada, _ := s.Criar(ctx, semNada, "painel", nil)
	const conta = "33333333-3333-3333-3333-333333333333"
	casos := []struct {
		metodo, caminho, corpo string
		semPortao              bool // só exige sessão: sem módulo também dá 200
	}{
		{"GET", "/eu/canais", "", true},
		{"GET", "/auth/eu", "", true},
		{"POST", "/bling-proxy", `{"endpoint":"pedidos/vendas"}`, false},
		{"POST", "/meta-proxy", fmt.Sprintf(`{"accountId":%q,"path":"x"}`, conta), false},
		{"POST", "/insights-ao-vivo", fmt.Sprintf(`{"account_id":%q}`, conta), false},
		{"POST", "/serie-novos-dia", fmt.Sprintf(`{"account_id":%q,"dias":[]}`, conta), false},
		{"POST", "/contar-collabs", fmt.Sprintf(`{"account_id":%q}`, conta), false},
	}
	pedir := func(c struct {
		metodo, caminho, corpo string
		semPortao              bool
	}, tok string) int {
		r := httptest.NewRequest(c.metodo, c.caminho, strings.NewReader(c.corpo))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	for _, c := range casos {
		if got := pedir(c, ""); got != 401 {
			t.Errorf("%s %s sem sessão = %d, esperava 401", c.metodo, c.caminho, got)
		}
		quer := 403
		if c.semPortao {
			quer = 200
		}
		if got := pedir(c, tokNada); got != quer {
			t.Errorf("%s %s sem módulo = %d, esperava %d", c.metodo, c.caminho, got, quer)
		}
		if got := pedir(c, tokTudo); got != 200 {
			t.Errorf("%s %s autorizado = %d, esperava 200", c.metodo, c.caminho, got)
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
