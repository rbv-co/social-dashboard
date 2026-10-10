package meta

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

const tokenDoCore = "token-secreto-do-core"

// coreMeta é o core de mentira da Graph: guarda os pedidos e responde com `resp`.
type coreMeta struct {
	mu      sync.Mutex
	pedidos []core.PedidoMeta
	resp    func(p core.PedidoMeta) (status int, corpo string, cab map[string]string)
}

func (f *coreMeta) n() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.pedidos) }

func (f *coreMeta) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var p core.PedidoMeta
	json.NewDecoder(r.Body).Decode(&p)
	f.mu.Lock()
	f.pedidos = append(f.pedidos, p)
	f.mu.Unlock()
	st, corpo, cab := f.resp(p)
	for k, v := range cab {
		w.Header().Set(k, v)
	}
	w.WriteHeader(st)
	io.WriteString(w, corpo)
}

const (
	uMeta   = "aaaaaaaa-0000-0000-0000-000000000011"
	uSocial = "aaaaaaaa-0000-0000-0000-000000000012"
	uAdmin  = "aaaaaaaa-0000-0000-0000-000000000013"
	uNada   = "aaaaaaaa-0000-0000-0000-000000000014"
)

// ambienteMeta monta banco (accounts + perfis), core de mentira e roteador com as rotas do pacote.
type ambienteMeta struct {
	p      *pgxpool.Pool
	h      http.Handler
	core   *coreMeta
	cli    *core.Cliente
	tokens map[string]string
}

const accountsTexto = `create table accounts (id text primary key, instagram_id text, ad_account_id text, access_token text);
	insert into accounts values ('conta-1', '1784', '999', 'TOKEN-DA-CONTA'), ('42', '1785', null, null), ('conta-3', '1786', null, null), ('conta-sem-ig', null, null, null);`

func montarMeta(t *testing.T, resp func(core.PedidoMeta) (int, string, map[string]string)) *ambienteMeta {
	t.Helper()
	return montarMetaCom(t, resp, accountsTexto, []string{"midia.exemplo"})
}

// montarMetaCom deixa o teste escolher o DDL de accounts (id text ou uuid) e os hosts de mídia.
func montarMetaCom(t *testing.T, resp func(core.PedidoMeta) (int, string, map[string]string), ddlAccounts string, hosts []string) *ambienteMeta {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, ddlAccounts); err != nil {
		t.Fatal(err)
	}
	s := auth.NovoStore(p)
	tokens := map[string]string{}
	for _, u := range []struct{ id, role, features string }{
		{uMeta, "viewer", "{meta}"}, {uSocial, "viewer", "{social}"}, {uAdmin, "admin", "{}"}, {uNada, "viewer", "{banco}"},
	} {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $1::text || '@x')`, u.id); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features, escopo_por_equipe) values ($1::uuid, $1::text || '@x', $2, $3::text[], false)`, u.id, u.role, u.features); err != nil {
			t.Fatal(err)
		}
		tokens[u.id], _ = s.Criar(ctx, u.id, "painel", nil)
	}
	f := &coreMeta{resp: resp}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	cli := core.Novo(srv.URL, tokenDoCore)
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.With(auth.ExigirModulo("meta")).Post("/meta-proxy", (&Proxy{Pool: p, Core: cli, HostsDeMidia: hosts}).ServeHTTP)
		av := &AoVivo{Pool: p, Core: cli}
		r.With(auth.ExigirModulo("social")).Post("/insights-ao-vivo", av.Insights)
		r.With(auth.ExigirModulo("social")).Post("/serie-novos-dia", av.SerieNovosDia)
		r.With(auth.ExigirModulo("social")).Post("/contar-collabs", av.ContarCollabs)
	})
	return &ambienteMeta{p: p, h: r, core: f, cli: cli, tokens: tokens}
}

func (a *ambienteMeta) post(caminho, token, corpo string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	a.h.ServeHTTP(w, req)
	return w
}

func graphOK(corpo string) func(core.PedidoMeta) (int, string, map[string]string) {
	return func(core.PedidoMeta) (int, string, map[string]string) { return 200, corpo, nil }
}

func TestMetaProxyPortao(t *testing.T) {
	a := montarMeta(t, graphOK(`{"data":[]}`))
	corpo := `{"accountId":"conta-1","path":"/act_999/insights"}`
	for _, c := range []struct {
		nome, token string
		quer        int
	}{{"sem sessão", "", 401}, {"sem o módulo meta", a.tokens[uNada], 403}, {"com meta", a.tokens[uMeta], 200}, {"role admin", a.tokens[uAdmin], 200}} {
		if w := a.post("/meta-proxy", c.token, corpo); w.Code != c.quer {
			t.Errorf("%s: %d, esperava %d", c.nome, w.Code, c.quer)
		}
	}
	if a.core.n() != 2 {
		t.Fatalf("core chamado %d vezes, esperava 2", a.core.n())
	}
}

func TestMetaProxyValidaAntesDoCore(t *testing.T) {
	a := montarMeta(t, graphOK(`{}`))
	casos := []struct {
		corpo, erro string
		quer        int
	}{
		{`{"path":"/me"}`, "accountId e path obrigatorios", 400},
		{`{"accountId":"conta-1"}`, "accountId e path obrigatorios", 400},
		{`{"accountId":"nao-existe","path":"/me"}`, "conta nao encontrada", 400},
		{`{"accountId":"conta-1","path":"/act_1/adimages","imageFromUrl":"http://midia.exemplo/x.png"}`, "origem da imagem nao permitida", 400},
		{`{"accountId":"conta-1","path":"/act_1/adimages","imageFromUrl":"https://169.254.169.254/latest"}`, "origem da imagem nao permitida", 400},
		{`{"accountId":"conta-1","path":"/act_1/adimages","imageFromUrl":"https://midia.exemplo.mal.com/x.png"}`, "origem da imagem nao permitida", 400},
		{`{"accountId":"conta-1","path":"/act_1/advideos","videoFromUrl":"file:///etc/passwd"}`, "origem do video nao permitida", 400},
	}
	for _, c := range casos {
		w := a.post("/meta-proxy", a.tokens[uMeta], c.corpo)
		if w.Code != c.quer || !strings.Contains(w.Body.String(), c.erro) {
			t.Errorf("%s: %d %s", c.corpo, w.Code, w.Body)
		}
	}
	if a.core.n() != 0 {
		t.Fatalf("nada disso podia chegar ao core (%d chamadas)", a.core.n())
	}
	grande := `{"accountId":"conta-1","path":"/me","params":{"x":"` + strings.Repeat("a", 70<<10) + `"}}`
	if w := a.post("/meta-proxy", a.tokens[uMeta], grande); w.Code != 413 || a.core.n() != 0 {
		t.Fatalf("corpo grande: %d", w.Code)
	}
}

func TestMetaProxyMontaOPedidoDoCore(t *testing.T) {
	a := montarMeta(t, graphOK(`{"data":[{"spend":"10.5","id":123456789012345678}]}`))
	w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/act_999/insights","params":{"fields":"spend","nulo":null,"filtro":{"a":1}},"method":"get"}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `123456789012345678`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	b, _ := json.Marshal(a.core.pedidos[0])
	if string(b) != `{"caminho":"/act_999/insights","metodo":"GET","parametros":{"fields":"spend","filtro":{"a":1}}}` {
		t.Fatalf("pedido = %s", b)
	}
	for metodo, quer := range map[string]string{"delete": "DELETE", "POST": "POST", "PATCH": "GET", "": "GET"} {
		a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/123","method":"`+metodo+`"}`)
		if got := a.core.pedidos[a.core.n()-1].Metodo; got != quer {
			t.Errorf("method %q -> %q, esperava %q", metodo, got, quer)
		}
	}
	a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/act_1/adimages","imageFromUrl":"https://midia.exemplo/x.png","imageField":"img1","method":"GET"}`)
	if p := a.core.pedidos[a.core.n()-1]; p.Metodo != "POST" || p.ImagemURL != "https://midia.exemplo/x.png" || p.ImagemCampo != "img1" {
		t.Fatalf("imagem: %+v", p)
	}
	a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/act_1/advideos","videoFromUrl":"https://midia.exemplo/v.mp4"}`)
	if p := a.core.pedidos[a.core.n()-1]; p.Metodo != "POST" || p.VideoURL != "https://midia.exemplo/v.mp4" || p.ImagemURL != "" {
		t.Fatalf("vídeo: %+v", p)
	}
	// accountId numérico também acha a conta (o front manda número ou texto).
	if w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":42,"path":"/me"}`); w.Code != 200 {
		t.Fatalf("accountId numérico: %d %s", w.Code, w.Body)
	}
}

func TestMetaProxyErrosDoCore(t *testing.T) {
	casos := []struct {
		nome           string
		st             int
		corpo, retry   string
		quer           int
		querCorpo      string
		querRetryAfter string
	}{
		{"recuo do core repassa 429 + Retry-After", 429, `{"erro":"meta_em_recuo"}`, "7", 429, `{"error":"meta_em_recuo"}`, "7"},
		{"rede core->Meta vira 500", 502, `{"erro":"falha ao falar com a Meta"}`, "", 500, `{"error":"falha ao falar com a Meta"}`, ""},
		{"credencial da API vira 500, nunca 401", 401, `{"erro":"nao_autorizado"}`, "", 500, `{"error":"nao_autorizado"}`, ""},
		{"barrado no core mantém o 4xx", 400, `{"erro":"caminho ou metodo nao permitido"}`, "", 400, `{"error":"caminho ou metodo nao permitido"}`, ""},
		{"erro da Graph passa tal qual", 400, `{"error":{"message":"Invalid","code":100}}`, "", 400, `{"error":{"code":100,"message":"Invalid"}}`, ""},
		{"5xx sem erro nenhum", 500, `{}`, "", 500, `{"error":"core: 500"}`, ""},
	}
	for _, c := range casos {
		a := montarMeta(t, func(core.PedidoMeta) (int, string, map[string]string) {
			cab := map[string]string{}
			if c.retry != "" {
				cab["Retry-After"] = c.retry
			}
			return c.st, c.corpo, cab
		})
		w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/act_1/campaigns","method":"POST"}`)
		if w.Code != c.quer || strings.TrimSpace(w.Body.String()) != c.querCorpo || w.Header().Get("Retry-After") != c.querRetryAfter {
			t.Errorf("%s: %d %s RA=%q", c.nome, w.Code, w.Body, w.Header().Get("Retry-After"))
		}
		if a.core.n() != 1 {
			t.Errorf("%s: meta-proxy não repete (%d chamadas)", c.nome, a.core.n())
		}
	}
}

func TestMetaProxyCoreForaSemVazarToken(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	a := montarMeta(t, graphOK(`{}`))
	morto := httptest.NewServer(http.NotFoundHandler())
	morto.Close()
	a.cli.URL = morto.URL
	w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/me"}`)
	if w.Code != 500 || strings.Contains(w.Body.String(), tokenDoCore) || strings.Contains(log.String(), tokenDoCore) {
		t.Fatalf("%d %s / log: %s", w.Code, w.Body, log.String())
	}
	a.cli.Token = ""
	if w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/me"}`); w.Code != 503 {
		t.Fatalf("sem token: %d", w.Code)
	}
}
