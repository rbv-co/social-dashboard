package leituradupla

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

var t0 = time.Date(2026, 9, 12, 17, 0, 0, 0, time.UTC)

func central(id, numero, total, status string) LinhaCentral {
	return LinhaCentral{ID: id, Numero: numero, Total: total, Moeda: "BRL", Status: status, CriadoEm: t0}
}

func doCore(id, nome, total, status, criado string) map[string]any {
	return map[string]any{"shopify_id": json.Number(id), "nome": nome, "total": total, "moeda": "BRL", "status_financeiro": status, "criado_em": criado}
}

func TestCompararIguaisSemPassarPorFloat(t *testing.T) {
	// 820982911946154508 passa de 2^53: por float viraria ...500 e nunca casaria com o do core.
	r := Comparar(
		[]LinhaCentral{central("820982911946154508", "#1", "200.00", "paid")},
		[]map[string]any{doCore("820982911946154508", "#1", "200.00", "PAID", "2026-09-12 17:00:00")}, false)
	if r.Iguais != 1 || !r.Limpo() {
		t.Fatalf("%+v", r)
	}
}

func TestCompararAcusaDivergenciaEDiferenciaAnteriorDaCentral(t *testing.T) {
	r := Comparar(
		[]LinhaCentral{central("1", "#1", "200.00", "paid"), central("2", "#2", "10.00", "paid"), central("9", "#9", "1.00", "paid")},
		[]map[string]any{
			doCore("1", "#1", "199.99", "paid", "2026-09-12 17:00:00"),    // total diferente
			doCore("2", "#2", "10.00", "refunded", "2026-09-12 17:00:00"), // situação diferente
			doCore("7", "#7", "5.00", "paid", "2026-09-13 10:00:00"),      // só no core, depois da Central começar: divergência
			doCore("5", "#5", "5.00", "paid", "2026-08-15 20:28:26"),      // só no core, ANTES da Central existir: esperado
		}, false)
	if r.Limpo() || len(r.Diferencas) != 2 || len(r.SoCentral) != 1 || r.SoCentral[0] != "9" ||
		len(r.SoCore) != 1 || r.SoCore[0] != "7" || len(r.SoCoreAnterior) != 1 {
		t.Fatalf("%+v", r)
	}
}

func TestCompararDefasadoNaoContaComoDivergencia(t *testing.T) {
	r := Comparar([]LinhaCentral{central("1", "#1", "1.00", "paid")}, nil, true)
	if !r.Limpo() || len(r.SoCentral) != 1 {
		t.Fatalf("defasado deve manter o dado mas não acusar: %+v", r)
	}
}

type fonteFixa []LinhaCentral

func (f fonteFixa) Linhas(context.Context) ([]LinhaCentral, error) { return f, nil }

func cliente(srv *httptest.Server) *core.Cliente {
	c := core.Novo(srv.URL, "t")
	c.Dormir = func(context.Context, time.Duration) error { return nil }
	return c
}

func TestRodarComCoreForaDaErroENaoRegistraDivergencia(t *testing.T) {
	for nome, status := range map[string]int{"5xx": 503, "429": 429, "404": 404} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(status) }))
		s := &ShopifyPedidos{Fonte: fonteFixa{central("1", "#1", "1.00", "paid")}, Core: cliente(srv)}
		err := s.Rodar(context.Background())
		srv.Close()
		if err == nil {
			t.Errorf("%s: core fora tem de dar erro (a tela de saúde vê), não sucesso", nome)
		}
	}
	// resposta que não é JSON do core (nginx de manutenção, por exemplo)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>")) }))
	defer srv.Close()
	err := (&ShopifyPedidos{Fonte: fonteFixa{}, Core: cliente(srv)}).Rodar(context.Background())
	if !errors.Is(err, core.ErrIndisponivel) {
		t.Fatalf("resposta inesperada deveria ser ErrIndisponivel: %v", err)
	}
}

func TestRodarFimAFimCoreAtrasadoNaoAcusa(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/contagem") {
			w.Write([]byte(`{"linhas":0}`))
			return
		}
		w.Write([]byte(`{"data":[],"proximo_cursor":null,"sincronia":{"atrasado":true}}`))
	}))
	defer srv.Close()
	s := &ShopifyPedidos{Fonte: fonteFixa{central("1", "#1", "1.00", "paid")}, Core: cliente(srv)}
	if err := s.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
}
