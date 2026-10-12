package custo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

const chaveFalsa = "sk-ant-admin01-CHAVE-FALSA-0123456789abcdef"

var (
	admin = &auth.Ator{Tipo: "painel", Papel: "admin"}
	// janelaDeTeste: 30 dias até 2026-10-13 00:00 UTC (as Tasks 4 e 5 usam).
	janelaDeTeste = janelaDe(30, time.Date(2026, 10, 12, 15, 0, 0, 0, time.UTC))
)

func semEspera(context.Context, time.Duration) error { return nil }

func clienteDeTeste(pausas *[]time.Duration) cliente {
	return cliente{fornecedor: "OpenAI", chave: chaveFalsa, http: semRedirecionar, prazo: 8 * time.Second, orcamento: 20 * time.Second,
		cabecalho: func(h http.Header, k string) { h.Set("Authorization", "Bearer "+k) },
		pausa:     func(_ context.Context, d time.Duration) error { *pausas = append(*pausas, d); return nil }}
}

func pedir(rt Rota, a *auth.Ator, corpo string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/custo-x", strings.NewReader(corpo))
	if a != nil {
		r = r.WithContext(auth.NoContexto(r.Context(), a))
	}
	w := httptest.NewRecorder()
	rt.ServeHTTP(w, r)
	return w
}

func TestPortaoEhOPapelAdmin(t *testing.T) {
	chamadas := 0
	rt := Rota{Chave: chaveFalsa, Buscar: func(_ context.Context, _ string, j Janela) (Fatura, error) {
		chamadas++
		return novaFatura(j, nil, nil, []any{}), nil
	}}
	casos := []struct {
		nome   string
		a      *auth.Ator
		status int
	}{
		{"sem ator", nil, 403},
		{"viewer", &auth.Ator{Tipo: "painel", Papel: "viewer"}, 403},
		{"super-admin pela ficha com papel viewer (a edge só olha role)", &auth.Ator{Tipo: "painel", Papel: "viewer", SuperAdmin: true}, 403},
		{"claude.status abre a tela, não a fatura", &auth.Ator{Tipo: "painel", Papel: "viewer", Modulos: []string{"claude.status"},
			Permissoes: map[string][]string{"claude.status": {"ver"}}}, 403},
		{"serviço com papel admin", &auth.Ator{Tipo: "servico", Papel: "admin"}, 403},
		{"Admin maiúsculo", &auth.Ator{Tipo: "painel", Papel: "Admin"}, 403},
		{"admin", admin, 200},
	}
	for _, c := range casos {
		antes := chamadas
		w := pedir(rt, c.a, `{"dias":7}`)
		if w.Code != c.status {
			t.Errorf("%s = %d %s, esperava %d", c.nome, w.Code, w.Body, c.status)
		}
		if c.status == 403 && (chamadas != antes || strings.TrimSpace(w.Body.String()) != `{"error":"sem_permissao"}`) {
			t.Errorf("%s: negado chamou o fornecedor (%d) ou corpo errado: %s", c.nome, chamadas-antes, w.Body)
		}
	}
}

func TestChaveAusente(t *testing.T) {
	chamou := false
	rt := Rota{Buscar: func(context.Context, string, Janela) (Fatura, error) { chamou = true; return Fatura{}, nil }}
	if w := pedir(rt, admin, `{}`); w.Code != 500 || strings.TrimSpace(w.Body.String()) != `{"error":"falha","detalhe":"chave_admin_nao_configurada"}` || chamou {
		t.Errorf("admin sem chave = %d %s (chamou=%v)", w.Code, w.Body, chamou)
	}
	if w := pedir(rt, &auth.Ator{Tipo: "painel", Papel: "viewer"}, `{}`); w.Code != 403 {
		t.Errorf("o portão vem antes da chave: %d", w.Code)
	}
}

func TestCorpoEJanela(t *testing.T) {
	agora := time.Date(2026, 10, 12, 22, 30, 0, 0, time.FixedZone("BRT", -3*3600)) // 01:30 UTC do dia 13
	var recebida Janela
	rt := Rota{Chave: chaveFalsa, Agora: func() time.Time { return agora },
		Buscar: func(_ context.Context, _ string, j Janela) (Fatura, error) {
			recebida = j
			return novaFatura(j, nil, nil, []any{}), nil
		}}
	fim := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC) // amanhã EM UTC (em UTC já é dia 13)
	casos := []struct {
		corpo  string
		status int
		dias   float64
	}{
		{``, 200, 30}, {`{}`, 200, 30}, {`{"dias":null}`, 200, 30}, {`{"dias":7}`, 200, 7},
		{`{"dias":0}`, 200, 1}, {`{"dias":-5}`, 200, 1}, {`{"dias":1000}`, 200, 90}, {`{"dias":7.5}`, 200, 7.5},
		{`{"dias":7,"outro":1}`, 200, 7},
		{`{"dias":"30"}`, 400, 0}, {`{"dias":[1]}`, 400, 0}, {`{"dias":`, 400, 0},
	}
	for _, c := range casos {
		recebida = Janela{}
		w := pedir(rt, admin, c.corpo)
		if w.Code != c.status {
			t.Errorf("%q = %d %s, esperava %d", c.corpo, w.Code, w.Body, c.status)
			continue
		}
		if c.status != 200 {
			if strings.TrimSpace(w.Body.String()) != `{"error":"pedido_invalido"}` {
				t.Errorf("%q: corpo %s", c.corpo, w.Body)
			}
			continue
		}
		if quer := fim.Add(-time.Duration(c.dias * float64(24*time.Hour))); !recebida.Fim.Equal(fim) || !recebida.Inicio.Equal(quer) {
			t.Errorf("%q: janela %v–%v, esperava %v–%v", c.corpo, recebida.Inicio, recebida.Fim, quer, fim)
		}
	}
	w := pedir(rt, admin, `{"dias":30}`)
	if !strings.HasPrefix(w.Body.String(), `{"desde":"2026-09-14","ate":"2026-10-14","cambio":5.5,"totalUsd":0,"totalBrl":0,"dias":[],"porCategoria":[],"porChave":[]}`) {
		t.Errorf("fatura vazia = %s", w.Body)
	}
}

func TestFixoComoOToFixedDoJS(t *testing.T) {
	a, b, um, dois := 13.35, 5.5, 0.1, 0.2 // variáveis: a conta acontece em float, como no JS
	casos := []struct {
		x     float64
		casas int
		json  string // JSON.stringify(Number(x.toFixed(casas))) no Node 22
	}{
		{a * b, 2, "73.42"},                              // Math.round(x*100)/100 daria 73.43
		{1.03125, 4, "1.0313"}, {-1.03125, 4, "-1.0313"}, // empate exato: para longe do zero
		{1.005, 2, "1"}, {2.5, 0, "3"}, {um + dois, 2, "0.3"}, {123.456789, 4, "123.4568"},
		{-0.00001, 4, "0"}, {1e-7, 4, "0"}, {9.1234567, 6, "9.123457"},
	}
	for _, c := range casos {
		if j, _ := json.Marshal(fixo(c.x, c.casas)); string(j) != c.json {
			t.Errorf("fixo(%v, %d) = %s, esperava %s", c.x, c.casas, j, c.json)
		}
	}
}

// servidorEmSequencia responde um status por tentativa (o último se repete); 200 = {"ok":true}.
func servidorEmSequencia(t *testing.T, status []int, retryAfter string) (*httptest.Server, *int32) {
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		i := int(atomic.AddInt32(&n, 1)) - 1
		st := status[min(i, len(status)-1)]
		if st == 429 && retryAfter != "" {
			w.Header().Set("Retry-After", retryAfter)
		}
		if st == 302 {
			w.Header().Set("Location", "/outro") // seguido, contaria uma chamada a mais
		}
		w.WriteHeader(st)
		if st == 200 {
			io.WriteString(w, `{"ok":true}`)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &n
}

func TestNovaTentativa(t *testing.T) {
	ms := time.Millisecond
	casos := []struct {
		nome     string
		status   []int
		retry    string
		chamadas int
		pausas   []time.Duration
		erro     string // "" = deu certo
	}{
		{"503 503 200", []int{503, 503, 200}, "", 3, []time.Duration{600 * ms, 1200 * ms}, ""},
		{"429 com Retry-After 2", []int{429, 200}, "2", 2, []time.Duration{2 * time.Second}, ""},
		{"Retry-After menor que a espera própria", []int{429, 200}, "0.1", 2, []time.Duration{600 * ms}, ""},
		{"404 é resposta", []int{404}, "", 1, nil,
			"Não consegui falar com o OpenAI agora (o OpenAI respondeu, e a resposta é essa). Tentei 1 vez. Tente de novo em instantes; se continuar, o OpenAI está fora do ar."},
		{"401 é resposta", []int{401}, "", 1, nil, "(o OpenAI respondeu, e a resposta é essa)"},
		{"500 até desistir", []int{500}, "", 3, []time.Duration{600 * ms, 1200 * ms}, "(já tentei 3 vezes). Tentei 3 vezes."},
		{"429 pedindo 15 s não cabe no orçamento", []int{429}, "15", 1, nil, "(não caberia outra tentativa no tempo desta chamada)"},
		{"302 não é seguido nem repetido", []int{302}, "", 1, nil, "(o OpenAI respondeu, e a resposta é essa)"},
	}
	for _, c := range casos {
		srv, n := servidorEmSequencia(t, c.status, c.retry)
		var pausas []time.Duration
		var destino struct {
			Ok bool `json:"ok"`
		}
		err := clienteDeTeste(&pausas).getJSON(context.Background(), srv.URL, "teste", &destino)
		switch {
		case c.erro == "" && (err != nil || !destino.Ok):
			t.Errorf("%s: %v", c.nome, err)
		case c.erro != "" && (err == nil || !strings.Contains(err.Error(), c.erro)):
			t.Errorf("%s: erro = %v, esperava conter %q", c.nome, err, c.erro)
		}
		if got := int(atomic.LoadInt32(n)); got != c.chamadas || !slices.Equal(pausas, c.pausas) {
			t.Errorf("%s: %d chamadas e pausas %v, esperava %d e %v", c.nome, got, pausas, c.chamadas, c.pausas)
		}
	}
}

func TestNaoSegueRedirecionamento(t *testing.T) {
	var outro int32
	destino := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { atomic.AddInt32(&outro, 1) }))
	defer destino.Close()
	origem := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destino.URL+"/roubar", http.StatusFound)
	}))
	defer origem.Close()
	var pausas []time.Duration
	err := clienteDeTeste(&pausas).getJSON(context.Background(), origem.URL, "teste", &struct{}{})
	if n := atomic.LoadInt32(&outro); err == nil || n != 0 {
		t.Fatalf("redirecionamento seguido (outro host recebeu %d) ou aceito: %v", n, err)
	}
}

func TestPrazoPorTentativa(t *testing.T) {
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&n, 1)
		<-r.Context().Done() // nunca responde: só o prazo da tentativa solta
	}))
	defer srv.Close()
	var pausas []time.Duration
	c := clienteDeTeste(&pausas)
	c.prazo, c.orcamento = 50*time.Millisecond, 10*time.Second
	err := c.getJSON(context.Background(), srv.URL, "teste", &struct{}{})
	if got := atomic.LoadInt32(&n); err == nil || !strings.Contains(err.Error(), "(já tentei 3 vezes)") || got != 3 {
		t.Fatalf("%d tentativas, erro %v", got, err)
	}
}

func TestChaveNuncaSaiNoErroNemNoLog(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	defer slog.SetDefault(antes)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+chaveFalsa {
			t.Error("a chave não foi no cabeçalho")
		}
		w.WriteHeader(401)
		io.WriteString(w, strings.Repeat("x", 190)+chaveFalsa) // atravessa o corte de 200: mascarar ANTES de cortar
	}))
	defer srv.Close()
	var pausas []time.Duration
	err := clienteDeTeste(&pausas).getJSON(context.Background(), srv.URL, "teste", &struct{}{})
	if err == nil {
		t.Fatal("401 aceito")
	}
	for _, onde := range []string{err.Error(), log.String()} {
		if strings.Contains(onde, chaveFalsa[:10]) {
			t.Errorf("a chave (ou o começo dela) vazou: %s", onde)
		}
	}
	if !strings.Contains(log.String(), "status=401") {
		t.Errorf("o log precisa dizer o status: %s", log.String())
	}
	rt := Rota{Chave: chaveFalsa, Buscar: func(context.Context, string, Janela) (Fatura, error) {
		return Fatura{}, errors.New("eco " + chaveFalsa)
	}}
	if w := pedir(rt, admin, `{}`); w.Code != 500 || strings.Contains(w.Body.String(), chaveFalsa) {
		t.Errorf("rota = %d %s", w.Code, w.Body)
	}
}

func TestPaginasParaEm50(t *testing.T) {
	for _, c := range []struct {
		corpo    string
		chamadas int32
	}{
		{`{"data":[],"has_more":true,"next_page":"sempre"}`, 50},
		{`{"data":[],"has_more":true,"next_page":null}`, 1},
		{`{"data":[],"has_more":false,"next_page":"x"}`, 1},
	} {
		var mu sync.Mutex
		var paginas []string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			paginas = append(paginas, r.URL.Query().Get("page"))
			mu.Unlock()
			io.WriteString(w, c.corpo)
		}))
		var pausas []time.Duration
		err := clienteDeTeste(&pausas).paginas(context.Background(), srv.URL, url.Values{"limit": {"31"}}, "teste", func(pagina) error { return nil })
		srv.Close()
		mu.Lock()
		n := int32(len(paginas))
		if err != nil || n != c.chamadas || paginas[0] != "" || (n > 1 && paginas[1] != "sempre") {
			t.Errorf("%s: %d chamadas %v (%v), esperava %d", c.corpo, n, paginas, err, c.chamadas)
		}
		mu.Unlock()
	}
}
