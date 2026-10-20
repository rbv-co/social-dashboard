package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// espelhoFalso serve /contagem e /{tabela} paginando de 2 em 2 (cursor = índice).
func espelhoFalso(t *testing.T, linhas []map[string]any, contagem int, extra map[string]any) (*Cliente, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok-espelho" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/contagem") {
			json.NewEncoder(w).Encode(map[string]any{"linhas": contagem, "espelhado_em": nil})
			return
		}
		ini := 0
		if c := r.URL.Query().Get("cursor"); c != "" {
			for i := range linhas {
				if c == string(rune('a'+i)) {
					ini = i + 1
				}
			}
		}
		fim := min(ini+2, len(linhas))
		corpo := map[string]any{"data": linhas[ini:fim], "proximo_cursor": nil, "espelhado_em": "2026-10-20T15:00:00Z"}
		if fim < len(linhas) {
			corpo["proximo_cursor"] = string(rune('a' + fim - 1))
		}
		for k, v := range extra {
			corpo[k] = v
		}
		json.NewEncoder(w).Encode(corpo)
	}))
	t.Cleanup(srv.Close)
	c := Novo(srv.URL, "token-do-bling")
	c.TokenEspelho = "tok-espelho"
	c.Dormir = func(context.Context, time.Duration) error { return nil }
	return c, srv
}

func linhasDe(n int) []map[string]any {
	out := make([]map[string]any, n)
	for i := range out {
		out[i] = map[string]any{"shopify_id": 820982911946154508 + i}
	}
	return out
}

func TestEspelhoTodasPaginaEConferePelaContagem(t *testing.T) {
	c, _ := espelhoFalso(t, linhasDe(5), 5, nil)
	l, err := c.EspelhoTodas(context.Background(), "shopify_pedidos", url.Values{})
	if err != nil || l == nil || len(l.Linhas) != 5 {
		t.Fatalf("err=%v leitura=%+v", err, l)
	}
	if got := l.Linhas[0]["shopify_id"].(json.Number).String(); got != "820982911946154508" {
		t.Fatalf("id perdeu precisão: %s", got)
	}
	if l.EspelhadoEm == nil || l.Sincronia != nil {
		t.Fatalf("espelhado_em deveria vir e sincronia ficar nil: %+v", l)
	}
}

func TestEspelhoTodasLeituraIncompletaNaoViraListaParcial(t *testing.T) {
	c, _ := espelhoFalso(t, linhasDe(5), 6, nil) // a contagem diz 6, as páginas dão 5
	l, err := c.EspelhoTodas(context.Background(), "shopify_pedidos", nil)
	if !errors.Is(err, ErrIndisponivel) || l != nil {
		t.Fatalf("esperava ErrIndisponivel sem lista, veio err=%v l=%v", err, l)
	}
}

func TestEspelhoUsaOTokenDoConsumidorEEsperaOCorePedir(t *testing.T) {
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer so-este" {
			w.WriteHeader(401)
			return
		}
		if n.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/contagem") {
			w.Write([]byte(`{"linhas":0}`))
			return
		}
		w.Write([]byte(`{"data":[],"proximo_cursor":null}`))
	}))
	defer srv.Close()
	c := Novo(srv.URL, "outro")
	c.TokenEspelho = "so-este"
	var esperou time.Duration
	c.Dormir = func(_ context.Context, d time.Duration) error { esperou = d; return nil }
	if _, err := c.EspelhoTodas(context.Background(), "shopify_pedidos", nil); err != nil {
		t.Fatal(err)
	}
	if esperou < time.Second {
		t.Fatalf("não respeitou o Retry-After: %v", esperou)
	}
}

func TestEspelhoCoreForaViraIndisponivelNuncaAusente(t *testing.T) {
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { n.Add(1); w.WriteHeader(503) }))
	defer srv.Close()
	c := Novo(srv.URL, "t")
	c.Dormir = func(context.Context, time.Duration) error { return nil }
	_, err := c.EspelhoTodas(context.Background(), "shopify_pedidos", nil)
	if !errors.Is(err, ErrIndisponivel) || n.Load() != 3 {
		t.Fatalf("err=%v tentativas=%d (esperava ErrIndisponivel após 3)", err, n.Load())
	}
}

func TestEspelhoRespostaInesperadaEPrazoViramIndisponivel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`<html>nginx</html>`)) }))
	defer srv.Close()
	c := Novo(srv.URL, "t")
	if _, err := c.EspelhoTodas(context.Background(), "x", nil); !errors.Is(err, ErrIndisponivel) {
		t.Fatalf("resposta inesperada: %v", err)
	}
	fora := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	fora.Close()
	c2 := Novo(fora.URL, "t")
	c2.Dormir = func(context.Context, time.Duration) error { return nil }
	if _, err := c2.EspelhoTodas(context.Background(), "x", nil); !errors.Is(err, ErrIndisponivel) {
		t.Fatalf("core fora: %v", err)
	}
}

func TestEspelho4xxEErroDeContratoENaoDeDisponibilidade(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(422) }))
	defer srv.Close()
	_, err := Novo(srv.URL, "t").EspelhoTodas(context.Background(), "x", nil)
	if err == nil || errors.Is(err, ErrIndisponivel) {
		t.Fatalf("422 não é indisponibilidade: %v", err)
	}
}

func TestSemTokenNaoEnviaNada(t *testing.T) {
	if _, err := Novo("http://127.0.0.1:1", "").EspelhoTodas(context.Background(), "x", nil); !errors.Is(err, ErrSemToken) {
		t.Fatal(err)
	}
}

func TestDefasadoSoAcusaComBlocoSincronia(t *testing.T) {
	agora := time.Date(2026, 10, 20, 16, 0, 0, 0, time.UTC)
	velho := agora.Add(-3 * time.Hour)
	novo := agora.Add(-5 * time.Minute)
	casos := []struct {
		nome string
		l    *Leitura
		max  time.Duration
		want bool
	}{
		{"sem bloco não acusa", &Leitura{}, time.Hour, false},
		{"core diz atrasado", &Leitura{Sincronia: &Sincronia{Atrasado: true}}, 0, true},
		{"idade acima do limite", &Leitura{Sincronia: &Sincronia{UltimoOK: &velho}}, time.Hour, true},
		{"idade dentro do limite", &Leitura{Sincronia: &Sincronia{UltimoOK: &novo}}, time.Hour, false},
		{"sem limite não acusa por idade", &Leitura{Sincronia: &Sincronia{UltimoOK: &velho}}, 0, false},
		{"bloco sem ultimo_ok não inventa", &Leitura{Sincronia: &Sincronia{}}, time.Hour, false},
	}
	for _, c := range casos {
		if got := c.l.Defasado(agora, c.max); got != c.want {
			t.Errorf("%s: %v", c.nome, got)
		}
	}
	var nil_ *Leitura
	if nil_.Defasado(agora, time.Hour) {
		t.Error("leitura nil não acusa")
	}
}

func TestEspelhoLeBlocoSincroniaQuandoOCoreManda(t *testing.T) {
	c, _ := espelhoFalso(t, linhasDe(1), 1, map[string]any{"sincronia": map[string]any{"ultimo_ok": "2026-10-20T15:15:01Z", "periodo_s": 900, "atrasado": true}})
	l, err := c.EspelhoTodas(context.Background(), "shopify_pedidos", nil)
	if err != nil || l.Sincronia == nil || !l.Sincronia.Atrasado || l.Sincronia.PeriodoS != 900 {
		t.Fatalf("%v %+v", err, l)
	}
	if !l.Defasado(time.Now(), 0) {
		t.Fatal("atrasado devia ser defasado")
	}
}

func TestEspelhoSemTokenDoConsumidorUsaOTokenDeSempre(t *testing.T) {
	var visto string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		visto = r.Header.Get("Authorization")
		if strings.HasSuffix(r.URL.Path, "/contagem") {
			w.Write([]byte(`{"linhas":0}`))
			return
		}
		w.Write([]byte(`{"data":[],"proximo_cursor":null}`))
	}))
	defer srv.Close()
	if _, err := Novo(srv.URL, "o-de-sempre").EspelhoTodas(context.Background(), "x", nil); err != nil || visto != "Bearer o-de-sempre" {
		t.Fatalf("err=%v auth=%q", err, visto)
	}
}

func TestDefasadoAcusaWebhookMudo(t *testing.T) {
	f := false
	if !(&Leitura{Sincronia: &Sincronia{TempoReal: &f}}).Defasado(time.Now(), 0) {
		t.Fatal("tempo_real=false é defasado (igual ao JS)")
	}
}

func TestLimiteDeIdade(t *testing.T) {
	cases := []struct {
		env, tabela string
		want        time.Duration
	}{
		{"", "x", 0},
		{"30", "x", 30 * time.Minute},
		{"estoque_depositos=2160, shopify_pedidos=30, 60", "shopify_pedidos", 30 * time.Minute},
		{"estoque_depositos=2160, shopify_pedidos=30, 60", "contatos", 60 * time.Minute},
		{"abc,x=-5", "x", 0},
	}
	for _, c := range cases {
		if got := LimiteDeIdade(c.env, c.tabela); got != c.want {
			t.Errorf("%q/%s = %v, quero %v", c.env, c.tabela, got, c.want)
		}
	}
}
