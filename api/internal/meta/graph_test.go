package meta

import (
	"context"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// coreDeTeste: o core de mentira da Graph (coreMeta, de proxy_test.go) e um cliente que não dorme.
// As tasks do Plano 4 no pacote meta usam este ajudante.
func coreDeTeste(t *testing.T, resp func(core.PedidoMeta) (int, string, map[string]string)) (*core.Cliente, *coreMeta) {
	t.Helper()
	f := &coreMeta{resp: resp}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	cli := core.Novo(srv.URL, tokenDoCore)
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	return cli, f
}

// lista: cópia dos pedidos que o core de mentira recebeu (sob a trava: o servidor anota em outra goroutine).
func (f *coreMeta) lista() []core.PedidoMeta {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.pedidos)
}

func TestGETErroDaGraphEDoCoreViramErro(t *testing.T) {
	cli, _ := coreDeTeste(t, func(p core.PedidoMeta) (int, string, map[string]string) {
		switch p.Caminho {
		case "/ok":
			return 200, `{"data":[{"id":"1"}]}`, nil
		case "/graph":
			return 400, `{"error":{"message":"(#100) Invalid parameter","code":100}}`, nil
		case "/erro-200":
			return 200, `{"error":{"message":"Unsupported get request"}}`, nil
		}
		return 400, `{"erro":"caminho ou metodo nao permitido"}`, nil
	})
	if j, err := GET(context.Background(), cli, "/ok", nil); err != nil || len(j["data"].([]any)) != 1 {
		t.Fatalf("j=%v err=%v", j, err)
	}
	for cam, quer := range map[string]string{
		"/graph":    "Meta API /graph: (#100) Invalid parameter",
		"/erro-200": "Meta API /erro-200: Unsupported get request",
		"/core":     "Meta API /core: core: caminho ou metodo nao permitido",
	} {
		_, err := GET(context.Background(), cli, cam, nil)
		if err == nil || err.Error() != quer || strings.Contains(err.Error(), tokenDoCore) {
			t.Errorf("%s: %v", cam, err)
		}
	}
}

func TestPaginasSegueONextEToleraOuNao(t *testing.T) {
	cli, f := coreDeTeste(t, func(p core.PedidoMeta) (int, string, map[string]string) {
		switch p.Parametros["after"] {
		case nil:
			return 200, `{"data":[1,2],"paging":{"next":"https://graph.facebook.com/v21.0/act_9/ads?after=P2&access_token=***"}}`, nil
		case "P2":
			return 200, `{"data":[3],"paging":{"next":"https://graph.facebook.com/v21.0/act_9/ads?after=P3&access_token=***"}}`, nil
		}
		return 500, `{"error":{"message":"página 3 caiu"}}`, nil
	})
	todos, err := Paginas(context.Background(), cli, "/act_9/ads", map[string]any{"limit": "500"}, 50, true)
	if err != nil || len(todos) != 3 {
		t.Fatalf("tolerante devolve o que leu: %v %v", todos, err)
	}
	if ps := f.lista(); ps[1].Caminho != "/act_9/ads" || ps[1].Parametros["access_token"] != nil {
		t.Fatalf("o next vira caminho sem versão e sem token: %+v", ps[1])
	}
	if _, err := Paginas(context.Background(), cli, "/act_9/ads", nil, 50, false); err == nil {
		t.Fatal("não tolerante: página seguinte que falha é erro")
	}
	antes := f.n()
	if todos, _ := Paginas(context.Background(), cli, "/act_9/ads", nil, 2, true); len(todos) != 3 || f.n()-antes != 2 {
		t.Fatalf("teto de páginas: %v chamadas=%d", todos, f.n()-antes)
	}
}
