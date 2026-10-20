package leituradupla

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
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
		[]map[string]any{doCore("820982911946154508", "#1", "200.00", "PAID", "2026-09-12 17:00:00")}, false, time.Time{})
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
		}, false, time.Time{})
	if r.Limpo() || len(r.Diferencas) != 2 || len(r.SoCentral) != 1 || r.SoCentral[0] != "9" ||
		len(r.SoCore) != 1 || r.SoCore[0] != "7" || len(r.SoCoreAnterior) != 1 {
		t.Fatalf("%+v", r)
	}
}

func TestCompararDefasadoNaoContaComoDivergencia(t *testing.T) {
	r := Comparar([]LinhaCentral{central("1", "#1", "1.00", "paid")}, nil, true, time.Time{})
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

// logDaRodada captura o slog padrão durante f e devolve o texto.
func logDaRodada(t *testing.T, f func()) string {
	t.Helper()
	var b bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&b, nil)))
	defer slog.SetDefault(antes)
	f()
	return b.String()
}

func coreComLinhas(linhas string, sincronia string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/contagem") {
			w.Write([]byte(`{"linhas":` + strconv.Itoa(strings.Count(linhas, "shopify_id")) + `}`))
			return
		}
		w.Write([]byte(`{"data":[` + linhas + `],"proximo_cursor":null` + sincronia + `}`))
	}))
}

func TestRodarFimAFimCoreAtrasadoNaoAcusa(t *testing.T) {
	srv := coreComLinhas("", `,"sincronia":{"atrasado":true}`)
	defer srv.Close()
	s := &ShopifyPedidos{Fonte: fonteFixa{central("1", "#1", "1.00", "paid")}, Core: cliente(srv)}
	saida := logDaRodada(t, func() {
		if err := s.Rodar(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(saida, "resultado=limpa") || !strings.Contains(saida, "defasado=true") || strings.Contains(saida, "divergente") {
		t.Fatalf("core atrasado não pode acusar divergência:\n%s", saida)
	}
}

func TestRodarRegistraLimpaEDivergenteSemDadoPessoal(t *testing.T) {
	linha := `{"shopify_id":1,"nome":"#1","total":"1.00","moeda":"BRL","status_financeiro":"paid","criado_em":"2026-09-12 17:00:00"}`
	srv := coreComLinhas(linha, "")
	defer srv.Close()
	limpa := logDaRodada(t, func() {
		s := &ShopifyPedidos{Fonte: fonteFixa{central("1", "#1", "1.00", "paid")}, Core: cliente(srv)}
		if err := s.Rodar(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(limpa, "resultado=limpa") || !strings.Contains(limpa, "iguais=1") {
		t.Fatalf("esperava limpa:\n%s", limpa)
	}
	diverge := logDaRodada(t, func() {
		l := central("1", "#1", "2.00", "paid")
		l.Moeda = "BRL"
		s := &ShopifyPedidos{Fonte: fonteFixa{l}, Core: cliente(srv)}
		if err := s.Rodar(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(diverge, "resultado=divergente") || !strings.Contains(diverge, "1.total central=2.00 core=1.00") {
		t.Fatalf("esperava divergente com a amostra:\n%s", diverge)
	}
}

func TestPedidoMexidoNoCoreDepoisDaLeituraLocalNaoEDivergencia(t *testing.T) {
	corte := time.Date(2026, 10, 20, 16, 0, 0, 0, time.UTC)
	novo := map[string]any{"shopify_id": json.Number("5"), "nome": "#5", "total": "1.00", "moeda": "BRL",
		"status_financeiro": "paid", "criado_em": "2026-10-20 15:58:00", "atualizado_em": "2026-10-20 15:58:00"}
	mexido := doCore("1", "#1", "9.99", "paid", "2026-09-12 17:00:00")
	mexido["atualizado_em"] = "2026-10-20 15:59:30"
	r := Comparar([]LinhaCentral{central("1", "#1", "1.00", "paid")}, []map[string]any{novo, mexido}, false, corte)
	if !r.Limpo() || r.Recentes != 2 {
		t.Fatalf("o que mudou no meio da leitura fica fora: %+v", r)
	}
}
