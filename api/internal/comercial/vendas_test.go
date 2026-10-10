package comercial

import (
	"slices"
	"testing"
)

func i64(v int64) *int64 { return &v }
func ip(v int) *int      { return &v }

func TestAjustarPelaDataDaNota(t *testing.T) {
	pedidos := []pedido{
		{ID: 1, Data: "2026-10-09", Total: 100}, // sem linha: fica
		{ID: 2, Data: "2026-10-09", Total: 200}, // nota negada: sai
		{ID: 3, Data: "2026-10-09", Total: 300}, // nota pendente: fica
		{ID: 4, Data: "2026-10-09", Total: 400}, // nota saiu no dia seguinte: sai deste dia
	}
	linhas := []linhaDaNota{
		{PedidoID: 2, DataPedido: "2026-10-09", DataDaVenda: "2026-10-09", NotaSituacao: ip(4)},
		{PedidoID: 3, DataPedido: "2026-10-09", DataDaVenda: "2026-10-09", NotaSituacao: ip(1)},
		{PedidoID: 4, DataPedido: "2026-10-09", DataDaVenda: "2026-10-10", NotaSituacao: ip(6)},
		{PedidoID: 5, DataPedido: "2026-10-08", DataDaVenda: "2026-10-09", Total: 50, LojaID: i64(7), NotaSituacao: ip(5)}, // trazido
		{PedidoID: 6, DataPedido: "2026-10-08", DataDaVenda: "2026-10-09", Total: 60, NotaSituacao: ip(2)},                 // cancelado não é trazido
		{PedidoID: 7, DataPedido: "2026-10-08", DataDaVenda: "2026-10-09", Total: 70},                                      // sem situação não é trazido
	}
	var ids []int64
	for _, p := range ajustarPelaDataDaNota(pedidos, linhas, "2026-10-09", "2026-10-09") {
		ids = append(ids, p.ID)
	}
	if !slices.Equal(ids, []int64{1, 3, 5}) {
		t.Fatalf("ids = %v", ids)
	}
}

func TestAplicarValorCorrigido(t *testing.T) {
	ps := aplicarValorCorrigido([]pedido{{ID: 1, Total: 1900}, {ID: 2, Total: 10}}, map[int64]float64{1: 1615, 2: -5, 9: 99})
	if ps[0].Total != 1615 || ps[1].Total != 10 || len(ps) != 2 {
		t.Fatalf("%+v", ps)
	}
}

func TestBRLESeta(t *testing.T) {
	for v, quer := range map[float64]string{0: "R$ 0", 1234.5: "R$ 1.235", 1615: "R$ 1.615", 1e6: "R$ 1.000.000", 999.49: "R$ 999", 2.5: "R$ 3"} {
		if got := brl(v); got != quer {
			t.Errorf("brl(%v) = %q, esperava %q", v, got, quer)
		}
	}
	casos := []struct {
		ref, cmp float64
		quer     string
	}{{150, 100, "\U0001F4C8 50%"}, {50, 100, "\U0001F4C9 50%"}, {100, 100, "➡️ 0%"}, {10, 0, "\U0001F195"}, {87.5, 100, "\U0001F4C9 12%"}}
	for _, c := range casos {
		if got := seta(c.ref, c.cmp); got != c.quer {
			t.Errorf("seta(%v,%v) = %q, esperava %q", c.ref, c.cmp, got, c.quer)
		}
	}
}

func TestAgregarEMontarCorpo(t *testing.T) {
	lojas := []canalAgregado{{LojaID: 1, Nome: "Tivoli"}, {LojaID: 2, Nome: "Dom Pedro"}, {LojaID: 3, Nome: "Parada"}}
	ref := []pedido{{LojaID: i64(1), Total: 100, Itens: 2}, {LojaID: i64(2), Total: 300, Itens: 1}, {LojaID: i64(99), Total: 50, Itens: 1}}
	cmpDia := []pedido{{LojaID: i64(1), Total: 200, Itens: 1}}
	a := agregarVendasPorCanal(ref, cmpDia, lojas)
	if a.Ref.Valor != 450 || a.Ref.Vendas != 3 || a.Ref.Itens != 4 || a.Canais[0].Nome != "Dom Pedro" {
		t.Fatalf("%+v", a)
	}
	c := montarCorpo(a, "hoje", "ontem")
	if c["title"] != "\U0001F6CD️ Vendas de hoje · R$ 450" {
		t.Fatalf("title = %q", c["title"])
	}
	quer := "\U0001F4C8 125% vs ontem · 3 vendas · 4 itens\nDom Pedro · R$ 300 · \U0001F195\nTivoli · R$ 100 · \U0001F4C9 50%"
	if c["body"] != quer || c["url"] != "/gestao-vista" || c["tag"] != "vendas-do-dia" {
		t.Fatalf("body = %q", c["body"])
	}
	vazio := montarCorpo(agregarVendasPorCanal(nil, nil, lojas), "hoje", "ontem")
	if vazio["body"] != "\U0001F195 vs ontem · 0 vendas · 0 itens\nNenhuma venda registrada hoje ainda." {
		t.Fatalf("vazio = %q", vazio["body"])
	}
	if b := montarCorpo(agregarVendasPorCanal([]pedido{{LojaID: i64(1), Total: 1, Itens: 1}}, nil, lojas), "ontem", "anteontem")["body"]; b != "\U0001F195 vs anteontem · 1 venda · 1 item\nTivoli · R$ 1 · \U0001F195" {
		t.Fatalf("singular = %q", b)
	}
}
