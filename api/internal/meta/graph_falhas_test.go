package meta

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// Plano 04 (A): a Graph (pelo core) falha de cada jeito. Cada falha tem de virar ERRO (nunca lista vazia
// que a coleta gravaria como "sem campanha"), com o número certo de chamadas ao core (repetição só onde
// é seguro: 429) e sem token nem endereço na mensagem.
func TestPaginasFalhasDaGraphViramErroSemDuplicar(t *testing.T) {
	type caso struct {
		nome     string
		serve    func(w http.ResponseWriter, r *http.Request, n int)
		chamadas int32
		ctx      time.Duration // 0 = sem prazo curto
	}
	json200 := func(c string) func(http.ResponseWriter, *http.Request, int) {
		return func(w http.ResponseWriter, r *http.Request, n int) { io.WriteString(w, c) }
	}
	status := func(st int, c string, cab ...string) func(http.ResponseWriter, *http.Request, int) {
		return func(w http.ResponseWriter, r *http.Request, n int) {
			for i := 0; i+1 < len(cab); i += 2 {
				w.Header().Set(cab[i], cab[i+1])
			}
			w.WriteHeader(st)
			io.WriteString(w, c)
		}
	}
	casos := []caso{
		{"429 sempre repete 3x e desiste", status(429, `{"erro":"uso alto"}`, "Retry-After", "1"), 3, 0},
		{"500 não repete", status(500, `{"erro":"falha"}`), 1, 0},
		{"503 não repete", status(503, `upstream`), 1, 0},
		{"400 da Graph não repete", status(400, `{"error":{"message":"(#100) Invalid parameter","code":100}}`), 1, 0},
		{"401 do core não repete", status(401, `{}`), 1, 0},
		{"200 com error da Graph", json200(`{"error":{"message":"Unsupported get request"}}`), 1, 0},
		{"200 JSON truncado", json200(`{"data":[{"id":"1","name":"Camp`), 1, 0},
		{"200 HTML de gateway", json200(`<html>502</html>`), 1, 0},
		{"200 corpo vazio", json200(``), 1, 0},
		{"200 sem data", json200(`{"paging":{}}`), 1, 0},
		{"200 data é texto", json200(`{"data":"nenhuma"}`), 1, 0},
		{"200 data nulo", json200(`{"data":null}`), 1, 0},
		{"200 raiz é lista", json200(`[]`), 1, 0},
		{"conexão cortada depois do pedido", func(w http.ResponseWriter, r *http.Request, n int) {
			c, _, _ := w.(http.Hijacker).Hijack()
			c.Close()
		}, 1, 0},
		{"resposta cortada no meio do corpo", func(w http.ResponseWriter, r *http.Request, n int) {
			w.Header().Set("Content-Length", "500")
			io.WriteString(w, `{"data":[`)
		}, 1, 0},
		{"nunca responde (prazo)", func(w http.ResponseWriter, r *http.Request, n int) { <-r.Context().Done() }, 1, 150 * time.Millisecond},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			var n atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				io.Copy(io.Discard, r.Body) // sem ler o corpo o servidor não vê o cliente desistir
				c.serve(w, r, int(n.Add(1)))
			}))
			defer srv.Close()
			cli := core.Novo(srv.URL, tokenDoCore)
			cli.Dormir = func(context.Context, time.Duration) error { return nil }
			ctx := context.Background()
			if c.ctx > 0 {
				var cancela context.CancelFunc
				ctx, cancela = context.WithTimeout(ctx, c.ctx)
				defer cancela()
			}
			itens, err := Paginas(ctx, cli, "/act_1/campaigns", obj{"fields": "id"}, 5, false)
			if err == nil {
				t.Fatalf("a falha virou sucesso com %d itens: a coleta gravaria como se não houvesse dado", len(itens))
			}
			if got := n.Load(); got != c.chamadas {
				t.Errorf("chamadas ao core = %d, esperava %d", got, c.chamadas)
			}
			if m := err.Error(); strings.Contains(m, tokenDoCore) || strings.Contains(m, srv.Listener.Addr().String()) || strings.Contains(m, "127.0.0.1") {
				t.Errorf("o erro vaza token ou endereço: %s", m)
			}
		})
	}
}

// 429 que passa na repetição: sucesso, 2 chamadas. Lista vazia de verdade é sucesso vazio.
func TestPaginas429PassaNaRepeticaoEVazioDeVerdadeEhVazio(t *testing.T) {
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if n.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
			io.WriteString(w, `{"erro":"uso alto"}`)
			return
		}
		io.WriteString(w, `{"data":[]}`)
	}))
	defer srv.Close()
	cli := core.Novo(srv.URL, tokenDoCore)
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	itens, err := Paginas(context.Background(), cli, "/act_1/campaigns", obj{}, 5, false)
	if err != nil || len(itens) != 0 || n.Load() != 2 {
		t.Fatalf("itens=%d err=%v chamadas=%d", len(itens), err, n.Load())
	}
}

// Página seguinte quebrada (200 sem data): tolerante guarda o que já leu; estrito falha. Nunca soma "nada".
func TestPaginasSegundaPaginaSemDataTolerarOuFalhar(t *testing.T) {
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		if n.Add(1)%2 == 1 {
			io.WriteString(w, `{"data":[{"id":"1"}],"paging":{"next":"https://graph.facebook.com/v22.0/act_1/campaigns?after=X"}}`)
			return
		}
		io.WriteString(w, `{"mensagem":"sem lista"}`)
	}))
	defer srv.Close()
	cli := core.Novo(srv.URL, tokenDoCore)
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	if itens, err := Paginas(context.Background(), cli, "/act_1/campaigns", obj{}, 5, true); err != nil || len(itens) != 1 {
		t.Errorf("tolerante: itens=%d err=%v", len(itens), err)
	}
	if _, err := Paginas(context.Background(), cli, "/act_1/campaigns", obj{}, 5, false); err == nil {
		t.Error("estrito: devia falhar")
	}
}
