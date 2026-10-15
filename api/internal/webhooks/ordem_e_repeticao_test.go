package webhooks

import (
	"context"
	"strings"
	"sync"
	"testing"
)

const rotaPedido = "/receber-webhook-pedido-shopify"

func pedidoEm(status, atualizado string) string {
	c := strings.Replace(pedido, `"financial_status":"paid"`, `"financial_status":"`+status+`"`, 1)
	return strings.Replace(c, `"customer"`, `"updated_at":"`+atualizado+`","customer"`, 1)
}

// Plano 04 (C): ordem trocada. A Shopify e o fan-out do core reentregam com recuo, então um orders/create
// atrasado (pending, 10:00) pode chegar DEPOIS do orders/paid (paid, 10:05). O mais velho não pode
// desfazer o mais novo.
func TestShopifyPedidoAtrasadoNaoDesfazOMaisNovo(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	novo := pedidoEm("paid", "2026-10-09T10:05:00-03:00")
	velho := pedidoEm("pending", "2026-10-09T10:00:00-03:00")
	status := func() string {
		var s string
		p.QueryRow(context.Background(), `select status_financeiro from shopify_pedidos where id = 7001`).Scan(&s)
		return s
	}
	for i, c := range []struct{ corpo, topico, ev, quer string }{
		{novo, "orders/paid", "ev-novo", "paid"},
		{velho, "orders/create", "ev-velho", "paid"},                                                  // atrasado: ignorado, 200 (a Shopify não deve reentregar)
		{pedidoEm("refunded", "2026-10-09T10:05:00-03:00"), "orders/updated", "ev-igual", "refunded"}, // mesmo instante: vale o último
		{pedidoEm("paid", "2026-10-09T12:00:00Z"), "orders/updated", "ev-outro-fuso", "refunded"},     // 12:00Z = 09:00-03:00 é MAIS VELHO que 10:05-03:00, apesar de maior como texto: ignorado
		{pedidoEm("paid", "2026-10-09T13:06:00Z"), "orders/updated", "ev-outro-fuso-novo", "paid"},    // 13:06Z = 10:06-03:00: mais novo, vale
	} {
		if w := enviar(h, rotaPedido, c.corpo, assinar(segredoAdmin, c.corpo), c.topico, c.ev); w.Code != 200 {
			t.Fatalf("passo %d: %d %s", i, w.Code, w.Body)
		}
		if got := status(); got != c.quer {
			t.Fatalf("passo %d (%s): status = %q, esperava %q", i, c.ev, got, c.quer)
		}
	}
}

// updated_at ausente, lixo ou data impossível no payload novo não trava o pedido nem dá 500: sem data válida o
// último a chegar vale, como sempre valeu.
func TestShopifyPedidoSemUpdatedAtValidoContinuaAtualizando(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	status := func() string {
		var s string
		p.QueryRow(context.Background(), `select status_financeiro from shopify_pedidos where id = 7001`).Scan(&s)
		return s
	}
	enviarPedido := func(corpo string) {
		t.Helper()
		if w := enviar(h, rotaPedido, corpo, assinar(segredoAdmin, corpo), "orders/updated", ""); w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
	}
	enviarPedido(pedidoEm("pending", "2026-10-09T10:00:00-03:00"))
	for i, c := range []struct{ corpo, quer string }{
		{strings.Replace(pedido, `"paid"`, `"authorized"`, 1), "authorized"}, // sem updated_at
		{pedidoEm("paid", "lixo"), "paid"},
		{pedidoEm("refunded", "2026-13-45T10:05:00Z"), "refunded"}, // passa na regex de formato, não é data
		{pedidoEm("voided", ""), "voided"},
	} {
		enviarPedido(c.corpo)
		if got := status(); got != c.quer {
			t.Fatalf("passo %d: status = %q, esperava %q", i, got, c.quer)
		}
	}
	if contar(t, p, `select count(*) from shopify_pedidos`) != 1 {
		t.Fatal("mais de uma linha")
	}
}

// Plano 04 (C): o MESMO evento entregue ao mesmo tempo por várias conexões (retry em paralelo) grava uma vez.
func TestShopifyMesmoEventoEmParaleloGravaUmaVez(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	corpo := `{"cart_token":"abc"}`
	var wg sync.WaitGroup
	var mu sync.Mutex
	codigos, duplicados := map[int]int{}, 0
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := enviar(h, "/receber-webhook-checkout", corpo, assinar(segredoAdmin, corpo), "checkouts/create", "ev-paralelo")
			mu.Lock()
			codigos[w.Code]++
			if strings.Contains(w.Body.String(), "duplicado") {
				duplicados++
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	if codigos[200] != 12 || duplicados != 11 {
		t.Fatalf("códigos=%v duplicados=%d (esperava 12x200 e 11 duplicados)", codigos, duplicados)
	}
	if n := contar(t, p, `select count(*) from carrinho_eventos`); n != 1 {
		t.Fatalf("carrinho_eventos = %d, esperava 1", n)
	}
	if n := contar(t, p, `select count(*) from webhooks_recebidos where evento_id = 'ev-paralelo'`); n != 1 {
		t.Fatalf("marcas = %d", n)
	}
}
