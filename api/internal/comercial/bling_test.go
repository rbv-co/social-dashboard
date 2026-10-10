package comercial

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// coreFalso é o core de mentira: guarda cada PedidoBling recebido e responde com `resp`.
type coreFalso struct {
	mu      sync.Mutex
	pedidos []core.PedidoBling
	resp    func(p core.PedidoBling, n int) (status int, corpo string, cab map[string]string)
}

func (f *coreFalso) n() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.pedidos) }

func (f *coreFalso) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var p core.PedidoBling
	json.NewDecoder(r.Body).Decode(&p)
	f.mu.Lock()
	f.pedidos = append(f.pedidos, p)
	n := len(f.pedidos)
	f.mu.Unlock()
	st, corpo, cab := f.resp(p, n)
	for k, v := range cab {
		w.Header().Set(k, v)
	}
	if st == 0 { // pendura até o cliente desistir
		<-r.Context().Done()
		return
	}
	w.WriteHeader(st)
	io.WriteString(w, corpo)
}

const tabelasDeCanais = `
create table bling_lojas (loja_id bigint primary key, nome text, grupo text, grupo_id uuid);
create table equipes (id uuid primary key, canal_loja_id bigint);
create table equipes_membros (equipe_id uuid not null, profile_id uuid not null, papel text not null default 'vendedora');
create table canais_grupos_membros (grupo_id uuid not null, profile_id uuid not null, papel text not null default 'supervisora');
insert into bling_lojas values (205657609, 'Dom Pedro', 'Varejo', null), (205834140, 'Tivoli', 'Varejo', null);
insert into equipes values ('bbbbbbbb-0000-0000-0000-000000000001', 205657609), ('bbbbbbbb-0000-0000-0000-000000000002', null);`

const (
	uVendas   = "aaaaaaaa-0000-0000-0000-000000000001" // features sales, sem escopo
	uLimitada = "aaaaaaaa-0000-0000-0000-000000000002" // sales, limitada ao Dom Pedro
	uSemTime  = "aaaaaaaa-0000-0000-0000-000000000003" // sales, limitada, só num time sem canal
	uAutent   = "aaaaaaaa-0000-0000-0000-000000000004" // só autenticidade
	uNada     = "aaaaaaaa-0000-0000-0000-000000000005" // só banco
)

type ambiente struct {
	p      *pgxpool.Pool
	h      http.Handler
	core   *coreFalso
	cli    *core.Cliente
	tokens map[string]string
}

func montar(t *testing.T, resp func(core.PedidoBling, int) (int, string, map[string]string)) *ambiente {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasDeCanais); err != nil {
		t.Fatal(err)
	}
	perfis := []struct {
		id, features string
		escopo       bool
	}{
		{uVendas, "{banco,sales}", false}, {uLimitada, "{sales}", true}, {uSemTime, "{sales}", true},
		{uAutent, "{autenticidade}", false}, {uNada, "{banco}", false},
	}
	s := auth.NovoStore(p)
	tokens := map[string]string{}
	for _, pf := range perfis {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $1::text || '@x')`, pf.id); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features, escopo_por_equipe)
			values ($1::uuid, $1::text || '@x', 'viewer', $2::text[], $3)`, pf.id, pf.features, pf.escopo); err != nil {
			t.Fatal(err)
		}
		tokens[pf.id], _ = s.Criar(ctx, pf.id, "painel", nil)
	}
	tokens["servico"], _ = s.Criar(ctx, uLimitada, "servico", nil) // mesma pessoa limitada, sessão de serviço
	if _, err := p.Exec(ctx, `insert into equipes_membros values ('bbbbbbbb-0000-0000-0000-000000000001', $1, 'vendedora'),
		('bbbbbbbb-0000-0000-0000-000000000002', $2, 'vendedora')`, uLimitada, uSemTime); err != nil {
		t.Fatal(err)
	}

	f := &coreFalso{resp: resp}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	cli := core.Novo(srv.URL, "token-do-core")
	cli.Prazo = 100 * time.Millisecond
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	r := chi.NewRouter()
	r.With(auth.Exigir(p, s)).Post("/bling-proxy", (&Bling{Pool: p, Core: cli}).ServeHTTP)
	return &ambiente{p: p, h: r, core: f, cli: cli, tokens: tokens}
}

func (a *ambiente) post(token, corpo string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/bling-proxy", strings.NewReader(corpo))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	a.h.ServeHTTP(w, req)
	return w
}

func ok200(corpo string) func(core.PedidoBling, int) (int, string, map[string]string) {
	return func(core.PedidoBling, int) (int, string, map[string]string) {
		return 200, corpo, map[string]string{"X-Core-Origem": "bling"}
	}
}

func TestCaminhosPermitidos(t *testing.T) {
	for _, bom := range []string{"pedidos/vendas", "pedidos/vendas/123", "vendedores/45", "produtos", "produtos/999",
		"estoques/saldos", "nfe", "nfe/7", "nfce", "nfce/7", "depositos", "formas-pagamentos"} {
		if !permitido(bom) {
			t.Errorf("caminho que uma tela usa foi fechado: %s", bom)
		}
	}
	for _, mau := range []string{"contatos", "contatos/1", "financeiro", "contas/pagar", "contas/receber", "oauth/token",
		"usuarios", "notas", "estoques", "estoques/saldos/1", "pedidos", "pedidos/compras", "depositos/1",
		"produtos/../oauth/token", "produtos/..%2Foauth", "../financeiro", "depositos ", " depositos", "depositos/", "/produtos"} {
		if permitido(mau) {
			t.Errorf("caminho perigoso ficou ABERTO: %q", mau)
		}
	}
	for _, re := range caminhosPermitidos {
		if s := re.String(); s[0] != '^' || s[len(s)-1] != '$' {
			t.Errorf("regra sem âncora nas duas pontas: %s", s)
		}
	}
}

func TestBlingProxyAutorizacao(t *testing.T) {
	a := montar(t, ok200(`{"data":[]}`))
	casos := []struct {
		nome, token, corpo string
		quer               int
	}{
		{"sem sessão", "", `{"endpoint":"produtos"}`, 401},
		{"fora da lista", a.tokens[uVendas], `{"endpoint":"contatos"}`, 403},
		{"fuga de caminho", a.tokens[uVendas], `{"endpoint":"produtos/../oauth/token"}`, 403},
		{"sem endpoint", a.tokens[uVendas], `{}`, 400},
		{"corpo não é JSON", a.tokens[uVendas], `xx`, 400},
		{"sem sales/gestor", a.tokens[uNada], `{"endpoint":"produtos"}`, 403},
		{"autenticidade só produto: produtos", a.tokens[uAutent], `{"endpoint":"produtos/1"}`, 200},
		{"autenticidade só produto: pedidos", a.tokens[uAutent], `{"endpoint":"pedidos/vendas"}`, 403},
		{"vendas pode pedidos", a.tokens[uVendas], `{"endpoint":"pedidos/vendas"}`, 200},
	}
	for _, c := range casos {
		if w := a.post(c.token, c.corpo); w.Code != c.quer {
			t.Errorf("%s: %d %s, esperava %d", c.nome, w.Code, w.Body, c.quer)
		}
	}
	if a.core.n() != 2 {
		t.Fatalf("o core só podia ser chamado pelos 2 casos permitidos; foi %d", a.core.n())
	}
}

func TestBlingProxyRepassaOContrato(t *testing.T) {
	a := montar(t, func(p core.PedidoBling, _ int) (int, string, map[string]string) {
		return 200, `{"data":[{"id":27078068236,"loja":{"id":205834140}}],"pagina":1}`, map[string]string{"X-Core-Origem": "bling"}
	})
	w := a.post(a.tokens[uVendas], `{"endpoint":"pedidos/vendas","params":{"pagina":1,"idsSituacoes[]":[9,12],"idLoja":null,"dataInicial":"2026-10-01","um":[5],"obj":{"a":1}}}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `27078068236`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	p := a.core.pedidos[0]
	b, _ := json.Marshal(p)
	if string(b) != `{"metodo":"GET","caminho":"/pedidos/vendas","query":{"dataInicial":"2026-10-01","idsSituacoes[]":["9","12"],"obj":"[object Object]","pagina":"1","um":"5"}}` {
		t.Fatalf("pedido ao core = %s", b)
	}
}

func TestBlingProxyLimitadaALoja(t *testing.T) {
	outraLoja := false
	a := montar(t, func(p core.PedidoBling, _ int) (int, string, map[string]string) {
		if outraLoja {
			return 200, `{"data":[{"id":1,"loja":{"id":205657609}},{"id":2,"loja":{"id":205834140}}]}`, nil
		}
		return 200, `{"data":[{"id":1,"loja":{"id":205657609}}]}`, nil
	})
	w := a.post(a.tokens[uLimitada], `{"endpoint":"pedidos/vendas","params":{"pagina":1}}`)
	if w.Code != 200 || a.core.n() != 1 {
		t.Fatalf("%d %s (core chamado %d vezes)", w.Code, w.Body, a.core.n())
	}
	if q := a.core.pedidos[0].Query; q["idLoja"] != "205657609" || q["pagina"] != "1" {
		t.Fatalf("query = %v", q)
	}
	outraLoja = true // o Bling deixou de honrar idLoja
	if w := a.post(a.tokens[uLimitada], `{"endpoint":"pedidos/vendas"}`); w.Code != 502 {
		t.Fatalf("lista torta deveria ser 502: %d %s", w.Code, w.Body)
	}
	antes := a.core.n()
	if w := a.post(a.tokens[uSemTime], `{"endpoint":"pedidos/vendas"}`); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"data":[]}` || a.core.n() != antes {
		t.Fatalf("limitada sem canal: %d %s (core chamado %d vezes)", w.Code, w.Body, a.core.n()-antes)
	}
	if w := a.post(a.tokens[uLimitada], `{"endpoint":"nfe"}`); w.Code != 403 || !strings.Contains(w.Body.String(), "sem permissao para este canal") {
		t.Fatalf("nfe para limitada: %d %s", w.Code, w.Body)
	}
	// Conta de serviço: a MESMA pessoa limitada, com sessão de serviço, não é recortada.
	if w := a.post(a.tokens["servico"], `{"endpoint":"pedidos/vendas"}`); w.Code != 200 || a.core.pedidos[a.core.n()-1].Query != nil {
		t.Fatalf("serviço: %d query=%v", w.Code, a.core.pedidos[a.core.n()-1].Query)
	}
}

func TestBlingProxyUmPedidoDeOutraLoja(t *testing.T) {
	a := montar(t, ok200(`{"data":{"id":2,"loja":{"id":205834140}}}`))
	if w := a.post(a.tokens[uLimitada], `{"endpoint":"pedidos/vendas/2"}`); w.Code != 403 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestBlingProxyFalhasDoCore(t *testing.T) {
	lento := montar(t, func(core.PedidoBling, int) (int, string, map[string]string) { return 0, "", nil })
	if w := lento.post(lento.tokens[uVendas], `{"endpoint":"produtos"}`); w.Code != 504 || !strings.Contains(w.Body.String(), "Tentei 3 vezes") || lento.core.n() != 3 {
		t.Fatalf("lento: %d %s (%d chamadas)", w.Code, w.Body, lento.core.n())
	}
	recuo := montar(t, func(_ core.PedidoBling, n int) (int, string, map[string]string) {
		if n == 1 {
			return 429, `{"error":"limite"}`, map[string]string{"Retry-After": "1", "X-Core-Origem": "bling"}
		}
		return 200, `{"data":[]}`, nil
	})
	if w := recuo.post(recuo.tokens[uVendas], `{"endpoint":"produtos"}`); w.Code != 200 || recuo.core.n() != 2 {
		t.Fatalf("429: %d (%d chamadas)", w.Code, recuo.core.n())
	}
	cred := montar(t, func(core.PedidoBling, int) (int, string, map[string]string) {
		return 401, `{"erro":"nao_autorizado"}`, nil
	})
	if w := cred.post(cred.tokens[uVendas], `{"endpoint":"produtos"}`); w.Code != 502 {
		t.Fatalf("401 do core sem X-Core-Origem deveria virar 502: %d", w.Code)
	}
	reaut := montar(t, func(core.PedidoBling, int) (int, string, map[string]string) {
		return 409, `{"erro":"reautorizacao_necessaria"}`, map[string]string{"X-Core-Origem": "proxy"}
	})
	if w := reaut.post(reaut.tokens[uVendas], `{"endpoint":"produtos"}`); w.Code != 409 || !strings.Contains(w.Body.String(), "reautorizacao_necessaria") {
		t.Fatalf("409 do core: %d %s", w.Code, w.Body)
	}
	cru := montar(t, ok200(`<html>oops</html>`))
	w := cru.post(cru.tokens[uVendas], `{"endpoint":"produtos"}`)
	var raw map[string]string
	if json.Unmarshal(w.Body.Bytes(), &raw); raw["raw"] != "<html>oops</html>" {
		t.Fatalf("corpo não-JSON vira {raw}: %s", w.Body)
	}
	semToken := montar(t, ok200(`{}`))
	semToken.cli.Token = ""
	if w := semToken.post(semToken.tokens[uVendas], `{"endpoint":"produtos"}`); w.Code != 503 {
		t.Fatalf("sem token do core: %d", w.Code)
	}
}

func TestBlingProxyCorpoGrande(t *testing.T) {
	a := montar(t, ok200(`{}`))
	grande := `{"endpoint":"produtos","params":{"x":"` + strings.Repeat("a", 70<<10) + `"}}`
	if w := a.post(a.tokens[uVendas], grande); w.Code != 413 || a.core.n() != 0 {
		t.Fatalf("%d (core chamado %d vezes)", w.Code, a.core.n())
	}
}

// Foco 1: o `query` que o core recebe é o mesmo que a edge mandava (String() do JS na URL).
func TestQueryComoAEdge(t *testing.T) {
	dec := func(j string) map[string]any {
		var m map[string]any
		d := json.NewDecoder(strings.NewReader(j))
		d.UseNumber()
		if err := d.Decode(&m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	got, _ := json.Marshal(query(dec(`{"obj":{"a":1},"nulo":null,"um":[7],"nulo1":[null],"aninh":[[1,2],{"x":1}],"dois":["a","b"],"vazia":[],
		"n":1.50,"i":27078068236,"zero":0,"grande":1e21,"mini":1e-7,"b":true,"s":"x y"}`)))
	quer := `{"aninh":["1,2","[object Object]"],"b":"true","dois":["a","b"],"grande":"1e+21","i":"27078068236","mini":"1e-7","n":"1.5","nulo1":"null","obj":"[object Object]","s":"x y","um":"7","zero":"0"}`
	if string(got) != quer {
		t.Fatalf("query =\n%s\nquer\n%s", got, quer)
	}
	if q := query(nil); len(q) != 0 {
		t.Fatalf("sem params: %v", q)
	}
}

// Foco 4: loja.id do pedido como texto, número ou ausente — só a loja do canal passa.
func TestBlingProxyLojaDoPedidoEmQualquerFormato(t *testing.T) {
	for _, c := range []struct {
		corpo, id string
		quer      int
	}{
		{`{"data":{"id":1,"loja":{"id":"205657609"}}}`, "texto", 200},
		{`{"data":{"id":1,"loja":{"id":205657609}}}`, "número", 200},
		{`{"data":{"id":1,"loja":{"id":205834140}}}`, "outra", 403},
		{`{"data":{"id":1,"loja":{}}}`, "sem id", 403},
		{`{"data":{"id":1}}`, "sem loja", 403},
	} {
		b := montar(t, ok200(c.corpo))
		if w := b.post(b.tokens[uLimitada], `{"endpoint":"pedidos/vendas/1"}`); w.Code != c.quer {
			t.Errorf("%s: %d %s, esperava %d", c.id, w.Code, w.Body, c.quer)
		}
	}
	// Lista: com idLoja honrado, mas pedidos de formatos mistos, todos da loja passam e nada some.
	l := montar(t, ok200(`{"data":[{"id":1,"loja":{"id":"205657609"}},{"id":2,"loja":{"id":205657609}}]}`))
	if w := l.post(l.tokens[uLimitada], `{"endpoint":"pedidos/vendas"}`); w.Code != 200 || strings.Count(w.Body.String(), `"id":`) != 4 {
		t.Fatalf("lista mista: %d %s", w.Code, w.Body)
	}
	// Se o Bling mandar um pedido sem loja ou de outra, é lista torta: 502.
	for _, corpo := range []string{`{"data":[{"id":4,"loja":{}}]}`, `{"data":[{"id":5}]}`} {
		m := montar(t, ok200(corpo))
		if w := m.post(m.tokens[uLimitada], `{"endpoint":"pedidos/vendas"}`); w.Code != 502 {
			t.Errorf("%s: %d %s, esperava 502", corpo, w.Code, w.Body)
		}
	}
}

func TestBlingProxyCabecalhosEFalha5xx(t *testing.T) {
	a := montar(t, func(core.PedidoBling, int) (int, string, map[string]string) {
		return 503, `{"error":"fora"}`, map[string]string{"Retry-After": "7", "X-Core-Origem": "bling"}
	})
	w := a.post(a.tokens[uVendas], `{"endpoint":"produtos"}`)
	if w.Code != 503 || w.Header().Get("Retry-After") != "7" || w.Header().Get("X-Core-Origem") != "bling" ||
		w.Header().Get("Content-Type") != "application/json" || !strings.Contains(w.Body.String(), "fora") {
		t.Fatalf("5xx final deve subir como veio: %d %v %s", w.Code, w.Header(), w.Body)
	}
	// 5xx de quem é limitada a uma loja também sobe como 5xx (não vira 403 nem lista vazia).
	if w := a.post(a.tokens[uLimitada], `{"endpoint":"pedidos/vendas"}`); w.Code != 503 || w.Header().Get("Retry-After") != "7" {
		t.Fatalf("limitada 5xx: %d %v", w.Code, w.Header())
	}
}

// Segredos nunca em log: nem o token do core, nem o do usuário.
func TestBlingProxyNaoVazaSegredoNoLog(t *testing.T) {
	var buf bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	for _, st := range []int{401, 0, 500} {
		a := montar(t, func(core.PedidoBling, int) (int, string, map[string]string) { return st, `{"erro":"x"}`, nil })
		a.post(a.tokens[uVendas], `{"endpoint":"produtos"}`)
		a.cli.Token = ""
		a.post(a.tokens[uVendas], `{"endpoint":"produtos"}`)
		for _, seg := range []string{"token-do-core", a.tokens[uVendas]} {
			if strings.Contains(buf.String(), seg) {
				t.Fatalf("segredo no log: %s", buf.String())
			}
		}
	}
	if buf.Len() == 0 {
		t.Fatal("o teste não exercitou nenhum log")
	}
}

func TestBlingProxyCaminhosComLixoNaoChegamAoCore(t *testing.T) {
	a := montar(t, ok200(`{}`))
	for _, e := range []string{"produtos\n", "produtos?x=1", "produtos#a", "Produtos", "PRODUTOS/1", "produtos/1/2", "pedidos/vendas/", "produtos/%2e%2e", "produtos/a b"} {
		b, _ := json.Marshal(map[string]string{"endpoint": e})
		if w := a.post(a.tokens[uVendas], string(b)); w.Code != 403 {
			t.Errorf("%q: %d", e, w.Code)
		}
	}
	if a.core.n() != 0 {
		t.Fatalf("core chamado %d vezes", a.core.n())
	}
}
