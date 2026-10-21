package leituradupla

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

func pedC(id, total string, itens int, soma string) PedidoCentral {
	return PedidoCentral{ID: id, Numero: id, Data: "2026-10-10", Total: total, Situacao: "9", Itens: itens, SomaItens: soma}
}

func pedK(id, total string, itens int, soma float64) PedidoCore {
	return PedidoCore{ID: id, Numero: id, Data: "2026-10-10", Total: total, Situacao: "9", Itens: itens, SomaItens: soma, AtualizadoEm: "2026-10-10 10:00:00"}
}

func TestCompararPedidosIguaisEDiferencas(t *testing.T) {
	central := []PedidoCentral{pedC("1", "100.00", 2, "100.000"), pedC("2", "50.00", 1, "50.00"), pedC("3", "9.00", 1, "9.00"), pedC("4", "7.00", 1, "7.00")}
	doCore := map[string]PedidoCore{
		"1": pedK("1", "100.00", 2, 99.999),                                                                 // soma arredonda a 100,00: igual
		"2": pedK("2", "50.00", 2, 50),                                                                      // item a mais (o Core nunca apaga a linha retirada)
		"3": pedK("3", "9.50", 1, 9),                                                                        // total diferente
		"8": {ID: "8", Data: "2026-10-12", Total: "1", Situacao: "9", AtualizadoEm: "2026-10-12 10:00:00"},  // só no core
		"7": {ID: "7", Data: "2026-10-12", Total: "1", Situacao: "12", AtualizadoEm: "2026-10-12 10:00:00"}, // cancelado só no core: a Central não guarda
		"0": {ID: "0", Data: "2026-09-01", Total: "1", Situacao: "9", AtualizadoEm: "2026-09-01 10:00:00"},  // anterior à Central
	}
	r := CompararPedidos(central, doCore, false, time.Time{})
	if r.Iguais != 1 || len(r.Diferencas) != 2 || len(r.SoCentral) != 1 || r.SoCentral[0] != "4" ||
		len(r.SoCore) != 1 || r.SoCore[0] != "8" || len(r.SoCoreAnterior) != 1 || r.SoCoreNaoVenda != 1 || r.Limpo() {
		t.Fatalf("%+v", r)
	}
}

func TestCompararPedidosDefasadoERecenteNaoAcusam(t *testing.T) {
	c := []PedidoCentral{pedC("1", "1.00", 0, "0")}
	if r := CompararPedidos(c, nil, true, time.Time{}); !r.Limpo() {
		t.Fatalf("defasado não acusa: %+v", r)
	}
	k := pedK("1", "9.99", 0, 0)
	k.AtualizadoEm = "2026-10-20 15:59:00"
	if r := CompararPedidos(c, map[string]PedidoCore{"1": k}, false, time.Date(2026, 10, 20, 16, 0, 0, 0, time.UTC)); !r.Limpo() || r.Recentes != 1 {
		t.Fatalf("o que mudou no meio da leitura fica fora: %+v", r)
	}
}

type pedidosFixos []PedidoCentral

func (f pedidosFixos) Pedidos(context.Context, time.Time) ([]PedidoCentral, error) { return f, nil }

// coreDePedidos responde `pedidos`, `pedido_itens` e as contagens; falhaItens != 0 derruba só os itens.
func coreDePedidos(falhaItens int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		itens := strings.Contains(r.URL.Path, "/pedido_itens")
		if itens && falhaItens != 0 {
			w.WriteHeader(falhaItens)
			return
		}
		cont := strings.HasSuffix(r.URL.Path, "/contagem")
		switch {
		case itens && cont:
			w.Write([]byte(`{"linhas":1}`))
		case itens:
			w.Write([]byte(`{"data":[{"pedido_id_bling":26851358889,"quantidade":"2.000","valor":"50.00"}],"proximo_cursor":null}`))
		case cont:
			w.Write([]byte(`{"linhas":1}`))
		default:
			w.Write([]byte(`{"data":[{"pedido_id_bling":26851358889,"numero":"10","data":"2026-10-10","total":"100.00","status_id_bling":9,"contato_id":1,"updated_at":"2026-10-10 10:00:00"}],"proximo_cursor":null}`))
		}
	}))
}

func pedidoLocal(total string) PedidoCentral {
	return PedidoCentral{ID: "26851358889", Numero: "10", Data: "2026-10-10", Total: total, Situacao: "9", Itens: 1, SomaItens: "100.000"}
}

func TestPedidosRodarFimAFim(t *testing.T) {
	srv := coreDePedidos(0)
	defer srv.Close()
	limpa := logDaRodada(t, func() {
		s := &Pedidos{Fonte: pedidosFixos{pedidoLocal("100.00")}, Core: cliente(srv)}
		if err := s.Rodar(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(limpa, "resultado=limpa") || !strings.Contains(limpa, "iguais=1") {
		t.Fatalf("esperava limpa:\n%s", limpa)
	}
	diverge := logDaRodada(t, func() {
		s := &Pedidos{Fonte: pedidosFixos{pedidoLocal("90.00")}, Core: cliente(srv)}
		if err := s.Rodar(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(diverge, "resultado=divergente") || !strings.Contains(diverge, "26851358889.total central=90.00 core=100.00") {
		t.Fatalf("esperava divergente com a amostra:\n%s", diverge)
	}
}

// Core lento/fora/429/5xx/resposta inesperada (nos pedidos OU nos itens): erro, nenhuma divergência
// registrada e nenhum dado do Core tratado como atual.
func TestPedidosCoreDegradadoNaoRegistraDivergencia(t *testing.T) {
	falhas := map[string]*httptest.Server{
		"itens 503":     coreDePedidos(503),
		"itens 429":     coreDePedidos(429),
		"pedidos 5xx":   httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(502) })),
		"pedidos html":  httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>")) })),
		"pedidos lento": httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(300 * time.Millisecond) })),
	}
	for nome, srv := range falhas {
		c := cliente(srv)
		c.HTTP = &http.Client{Timeout: 50 * time.Millisecond}
		var err error
		saida := logDaRodada(t, func() {
			err = (&Pedidos{Fonte: pedidosFixos{pedidoLocal("100.00")}, Core: c}).Rodar(context.Background())
		})
		srv.Close()
		if err == nil || !errors.Is(err, core.ErrIndisponivel) {
			t.Errorf("%s: esperava ErrIndisponivel, veio %v", nome, err)
		}
		if strings.Contains(saida, "divergente") || strings.Contains(saida, "limpa") {
			t.Errorf("%s: core degradado não pode virar resultado de comparação:\n%s", nome, saida)
		}
	}
}

// Itens com a sincronia atrasada também tornam a rodada defasada (não só os pedidos): sem acusar divergência.
func TestPedidosItensDefasadosNaoAcusam(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		itens := strings.Contains(r.URL.Path, "/pedido_itens")
		switch {
		case strings.HasSuffix(r.URL.Path, "/contagem"):
			w.Write([]byte(`{"linhas":1}`))
		case itens:
			w.Write([]byte(`{"data":[{"pedido_id_bling":26851358889,"quantidade":"2.000","valor":"50.00"}],"proximo_cursor":null,"sincronia":{"atrasado":true}}`))
		default:
			w.Write([]byte(`{"data":[{"pedido_id_bling":26851358889,"numero":"10","data":"2026-10-10","total":"100.00","status_id_bling":9,"contato_id":1,"updated_at":"2026-10-10 10:00:00"}],"proximo_cursor":null}`))
		}
	}))
	defer srv.Close()
	saida := logDaRodada(t, func() {
		if err := (&Pedidos{Fonte: pedidosFixos{pedidoLocal("90.00")}, Core: cliente(srv)}).Rodar(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(saida, "defasado=true") || strings.Contains(saida, "divergente") {
		t.Fatalf("itens atrasados não podem acusar divergência:\n%s", saida)
	}
}

// Tudo "mexido agora" no core: nada foi comparado, então não se diz "limpa".
func TestPedidosRodadaSemNadaComparadoEhInconclusiva(t *testing.T) {
	srv := coreDePedidos(0)
	defer srv.Close()
	saida := logDaRodada(t, func() {
		s := &Pedidos{Fonte: pedidosFixos{pedidoLocal("100.00")}, Core: cliente(srv),
			Agora: func() time.Time { return time.Date(2026, 10, 10, 10, 2, 0, 0, time.UTC) }} // 2 min depois do updated_at do core
		if err := s.Rodar(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(saida, "resultado=inconclusiva") {
		t.Fatalf("esperava inconclusiva:\n%s", saida)
	}
}
