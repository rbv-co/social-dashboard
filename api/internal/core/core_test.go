package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const tokenDeTeste = "segredo-do-core-123"

// coreFalso responde com `resp(n, corpo)` para a n-ésima chamada (1, 2, ...) e guarda o que recebeu.
type coreFalso struct {
	mu      sync.Mutex
	corpos  []map[string]any
	cabecas []http.Header
	caminho []string
}

func (f *coreFalso) n() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.corpos) }

func novoCore(t *testing.T, resp func(n int, w http.ResponseWriter, r *http.Request)) (*Cliente, *coreFalso, *[]time.Duration) {
	t.Helper()
	f := &coreFalso{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var m map[string]any
		json.NewDecoder(r.Body).Decode(&m)
		f.mu.Lock()
		f.corpos = append(f.corpos, m)
		f.cabecas = append(f.cabecas, r.Header.Clone())
		f.caminho = append(f.caminho, r.Method+" "+r.URL.Path)
		n := len(f.corpos)
		f.mu.Unlock()
		resp(n, w, r)
	}))
	t.Cleanup(srv.Close)
	esperas := &[]time.Duration{}
	c := Novo(srv.URL, tokenDeTeste)
	c.Prazo = 200 * time.Millisecond
	c.Dormir = func(_ context.Context, d time.Duration) error { *esperas = append(*esperas, d); return nil }
	return c, f, esperas
}

func status(cod int, corpo string, cab ...string) func(int, http.ResponseWriter, *http.Request) {
	return func(_ int, w http.ResponseWriter, _ *http.Request) {
		for i := 0; i+1 < len(cab); i += 2 {
			w.Header().Set(cab[i], cab[i+1])
		}
		w.WriteHeader(cod)
		io.WriteString(w, corpo)
	}
}

// sequencia responde a n-ésima chamada com resps[n-1] (a última se repete).
func sequencia(resps ...func(int, http.ResponseWriter, *http.Request)) func(int, http.ResponseWriter, *http.Request) {
	return func(n int, w http.ResponseWriter, r *http.Request) {
		resps[min(n, len(resps))-1](n, w, r)
	}
}

// pendurar segura a resposta até o cliente desistir (simula core lento).
func pendurar(_ int, _ http.ResponseWriter, r *http.Request) {
	select {
	case <-r.Context().Done():
	case <-time.After(5 * time.Second):
	}
}

var leitura = PedidoBling{Metodo: "GET", Caminho: "/pedidos/vendas", Query: map[string]any{"pagina": "1", "idsSituacoes[]": []string{"9", "12"}}}

func TestBlingMandaOContratoDoCore(t *testing.T) {
	c, f, _ := novoCore(t, status(200, `{"data":[]}`, "X-Core-Origem", "bling"))
	r, err := c.Bling(context.Background(), leitura)
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != 200 || string(r.Corpo) != `{"data":[]}` || r.Origem != "bling" {
		t.Fatalf("resposta = %+v", r)
	}
	if f.caminho[0] != "POST "+CaminhoBling {
		t.Fatalf("chamou %s", f.caminho[0])
	}
	if got := f.cabecas[0].Get("Authorization"); got != "Bearer "+tokenDeTeste {
		t.Fatalf("Authorization = %q", got)
	}
	b, _ := json.Marshal(f.corpos[0])
	if string(b) != `{"caminho":"/pedidos/vendas","metodo":"GET","query":{"idsSituacoes[]":["9","12"],"pagina":"1"}}` {
		t.Fatalf("corpo = %s", b)
	}
}

func TestBlingRepete429RespeitandoRetryAfter(t *testing.T) {
	c, f, esperas := novoCore(t, sequencia(status(429, `{}`, "Retry-After", "2"), status(200, `{"data":[1]}`)))
	r, err := c.Bling(context.Background(), leitura)
	if err != nil || r.Status != 200 {
		t.Fatalf("r=%+v err=%v", r, err)
	}
	if f.n() != 2 || len(*esperas) != 1 || (*esperas)[0] != 2*time.Second {
		t.Fatalf("chamadas=%d esperas=%v", f.n(), *esperas)
	}
}

func TestBlingRepete5xxComRecuoEDevolveOUltimo(t *testing.T) {
	c, f, esperas := novoCore(t, status(503, `{"erro":"bling_indisponivel"}`))
	r, err := c.Bling(context.Background(), leitura)
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != 503 || f.n() != 3 {
		t.Fatalf("status=%d chamadas=%d", r.Status, f.n())
	}
	if len(*esperas) != 2 || (*esperas)[0] != 600*time.Millisecond || (*esperas)[1] != 1200*time.Millisecond {
		t.Fatalf("esperas = %v", *esperas)
	}
}

func TestBlingNaoRepeteResposta(t *testing.T) {
	for _, cod := range []int{400, 403, 404, 409, 422} {
		c, f, _ := novoCore(t, status(cod, `{}`))
		r, err := c.Bling(context.Background(), leitura)
		if err != nil || r.Status != cod || f.n() != 1 {
			t.Errorf("%d: r=%+v err=%v chamadas=%d", cod, r, err, f.n())
		}
	}
}

func TestBlingLentoDesisteComFraseDeGente(t *testing.T) {
	c, f, _ := novoCore(t, pendurar)
	c.Prazo = 50 * time.Millisecond
	_, err := c.Bling(context.Background(), leitura)
	var sr *SemResposta
	if !errors.As(err, &sr) {
		t.Fatalf("err = %v", err)
	}
	if f.n() != 3 || !strings.Contains(err.Error(), "não respondeu no prazo") || !strings.Contains(err.Error(), "Tentei 3 vezes") {
		t.Fatalf("chamadas=%d err=%q", f.n(), err)
	}
}

func TestBlingNaoComecaTentativaQueNaoCabeNoOrcamento(t *testing.T) {
	c, f, _ := novoCore(t, status(503, `{}`))
	c.Prazo, c.Orcamento = 100*time.Millisecond, 650*time.Millisecond // 600 ms + 100 ms > 650 ms
	r, err := c.Bling(context.Background(), leitura)
	if err != nil || r.Status != 503 || f.n() != 1 {
		t.Fatalf("r=%+v err=%v chamadas=%d", r, err, f.n())
	}
}

func TestBlingEscritaNuncaRepete(t *testing.T) {
	escrita := PedidoBling{Metodo: "POST", Caminho: "/pedidos/vendas"}
	c, f, _ := novoCore(t, status(503, `{}`))
	if r, err := c.Bling(context.Background(), escrita); err != nil || r.Status != 503 || f.n() != 1 {
		t.Fatalf("5xx: r=%+v err=%v chamadas=%d", r, err, f.n())
	}
	c2, f2, _ := novoCore(t, pendurar)
	c2.Prazo = 50 * time.Millisecond
	if _, err := c2.Bling(context.Background(), escrita); err == nil || f2.n() != 1 {
		t.Fatalf("prazo: err=%v chamadas=%d", err, f2.n())
	}
}

func TestSemTokenNaoChamaNada(t *testing.T) {
	c, f, _ := novoCore(t, status(200, `{}`))
	c.Token = ""
	if _, err := c.Bling(context.Background(), leitura); !errors.Is(err, ErrSemToken) {
		t.Fatalf("bling err = %v", err)
	}
	if _, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 3); !errors.Is(err, ErrSemToken) {
		t.Fatalf("meta err = %v", err)
	}
	if f.n() != 0 {
		t.Fatalf("chamou o core %d vezes", f.n())
	}
}

func TestSegredoNuncaApareceEmErroNemEmLog(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })

	c, _, _ := novoCore(t, pendurar)
	c.Prazo = 30 * time.Millisecond
	_, err1 := c.Bling(context.Background(), leitura) // repete (loga) e desiste
	srv := httptest.NewServer(http.NotFoundHandler())
	srv.Close() // porta fechada: erro de rede
	c2 := Novo(srv.URL, tokenDeTeste)
	_, err2 := c2.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if err1 == nil || err2 == nil {
		t.Fatalf("esperava erros: %v / %v", err1, err2)
	}
	for _, s := range []string{err1.Error(), err2.Error(), log.String()} {
		if strings.Contains(s, tokenDeTeste) {
			t.Fatalf("o token vazou: %q", s)
		}
	}
	if !strings.Contains(log.String(), "repetindo") {
		t.Fatal("o teste não exercitou o log de repetição")
	}
}

func TestRespostaGrandeDemaisEhRecusada(t *testing.T) {
	antes := limiteResposta
	limiteResposta = 10
	t.Cleanup(func() { limiteResposta = antes })
	c, _, _ := novoCore(t, status(200, `{"data":"12345678901234567890"}`))
	if _, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1); err == nil || !strings.Contains(err.Error(), "grande demais") {
		t.Fatalf("err = %v", err)
	}
}

func TestMetaSoRepete429(t *testing.T) {
	c, f, esperas := novoCore(t, sequencia(status(429, `{"erro":"meta_em_recuo"}`, "Retry-After", "7"), status(200, `{"id":"1"}`)))
	r, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/act_1/campaigns", Metodo: "POST"}, 3)
	if err != nil || r.Status != 200 || f.n() != 2 || (*esperas)[0] != 7*time.Second {
		t.Fatalf("r=%+v err=%v chamadas=%d esperas=%v", r, err, f.n(), *esperas)
	}
	c2, f2, _ := novoCore(t, status(500, `{"erro":"x"}`))
	if r, _ := c2.Meta(context.Background(), PedidoMeta{Caminho: "/act_1/campaigns", Metodo: "POST"}, 3); r.Status != 500 || f2.n() != 1 {
		t.Fatalf("5xx repetiu: chamadas=%d", f2.n())
	}
	c3, f3, esperas3 := novoCore(t, status(429, `{}`)) // sem Retry-After: 5 s; tentativas=1: não repete
	if r, _ := c3.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1); r.Status != 429 || f3.n() != 1 || len(*esperas3) != 0 {
		t.Fatalf("tentativas=1: chamadas=%d", f3.n())
	}
	c4, _, esperas4 := novoCore(t, sequencia(status(429, `{}`, "Retry-After", "99"), status(200, `{}`)))
	c4.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 2)
	if (*esperas4)[0] != 30*time.Second {
		t.Fatalf("teto de espera = %v", *esperas4)
	}
}

func TestMetaParametrosVazioViraObjeto(t *testing.T) {
	c, f, _ := novoCore(t, status(200, `{}`))
	c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if p, ok := f.corpos[0]["parametros"].(map[string]any); !ok || len(p) != 0 {
		t.Fatalf("parametros = %#v", f.corpos[0]["parametros"])
	}
}

func TestNaoSegueRedirecionamento(t *testing.T) {
	c, f, _ := novoCore(t, status(302, ``, "Location", "https://outro.exemplo/roubar"))
	r, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if err != nil || r.Status != 302 || f.n() != 1 {
		t.Fatalf("r=%+v err=%v", r, err)
	}
}
