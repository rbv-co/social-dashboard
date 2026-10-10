package webpush_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/webpush/pushteste"
)

const (
	uQuer    = "cccccccc-0000-0000-0000-000000000001"
	uNaoQuer = "cccccccc-0000-0000-0000-000000000002"
	uPadrao  = "cccccccc-0000-0000-0000-000000000003"
)

func TestDestinatariosSeguemAPreferenciaEOPadraoDoTipo(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	pushteste.Inscrever(t, p, "quer", uQuer)
	pushteste.Inscrever(t, p, "nao-quer", uNaoQuer)
	pushteste.Inscrever(t, p, "padrao", uPadrao)
	pushteste.Inscrever(t, p, "sem-dono", "")
	p.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values
		($1::uuid, 'saldo', true), ($2::uuid, 'saldo', false), ($2::uuid, 'vendas', false)`, uQuer, uNaoQuer)
	nomes := func(tipo, usuario string) (out []string) {
		ds, err := webpush.Destinatarios(ctx, p, tipo, usuario)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range ds {
			out = append(out, d.Endpoint[len("https://example.com/push/"):]+"="+d.UserID[len(d.UserID)-1:])
		}
		return
	}
	if got := nomes("saldo", ""); len(got) != 1 || got[0] != "quer=1" {
		t.Fatalf("saldo nasce desligado; só quem ligou: %v", got)
	}
	if got := nomes("vendas", ""); len(got) != 2 || got[0] != "padrao=3" || got[1] != "quer=1" {
		t.Fatalf("vendas nasce ligado; quem desligou sai e sem dono nunca entra: %v", got)
	}
	if got := nomes("saldo", uNaoQuer); len(got) != 0 {
		t.Fatalf("restrito a um dono que não quer: %v", got)
	}
	if got := nomes("tipo-inventado", ""); len(got) != 0 {
		t.Fatalf("tipo desconhecido não chega a ninguém: %v", got)
	}
}

func TestEntregarNaoRepeteEPodaMortas(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	srv := pushteste.Novo(t)
	v := pushteste.VAPID(t)
	ua := pushteste.Inscrever(t, p, "boa", uQuer)
	pushteste.Inscrever(t, p, "morta", uQuer)
	pushteste.Inscrever(t, p, "e500", uQuer)
	pushteste.Inscrever(t, p, "rede", uQuer)
	pushteste.Inscrever(t, p, "e429", uQuer)
	alvos, _ := webpush.Destinatarios(ctx, p, "vendas", "")
	r, err := webpush.Entregar(ctx, p, srv.HTTP, alvos, []byte(`{"title":"oi"}`), v, "teste:2026-10-10")
	if err != nil {
		t.Fatal(err)
	}
	if r != (webpush.Resultado{Enviados: 1, Podados: 1, Falhas: 3}) {
		t.Fatalf("primeira entrega: %+v", r)
	}
	if string(pushteste.Decifrar(t, srv.Ultimo(t, "boa"), ua)) != `{"title":"oi"}` {
		t.Fatal("o conteúdo não abre do lado do navegador")
	}
	var n int
	p.QueryRow(ctx, `select count(*) from push_subs where endpoint like '%/morta'`).Scan(&n)
	if n != 0 {
		t.Fatal("410 apaga a inscrição")
	}
	// Execução repetida com o MESMO prefixo: quem recebeu não recebe de novo; quem falhou tenta outra vez.
	alvos, _ = webpush.Destinatarios(ctx, p, "vendas", "")
	r, _ = webpush.Entregar(ctx, p, srv.HTTP, alvos, []byte(`{"title":"oi"}`), v, "teste:2026-10-10")
	if r != (webpush.Resultado{Repetidos: 1, Falhas: 3}) || srv.Recebidos("boa") != 1 || srv.Recebidos("e500") != 2 || srv.Recebidos("e429") != 2 {
		t.Fatalf("repetida: %+v boa=%d e500=%d e429=%d", r, srv.Recebidos("boa"), srv.Recebidos("e500"), srv.Recebidos("e429"))
	}
	// Outro prefixo (outro dia) envia de novo.
	r, _ = webpush.Entregar(ctx, p, srv.HTTP, alvos[:1], []byte(`{}`), v, "teste:2026-10-11")
	if r.Enviados != 1 {
		t.Fatalf("outro dia: %+v", r)
	}
}

// Serviço de push lento além do prazo do cliente: conta como falha e libera a reserva (push é
// idempotente no aparelho pela tag), então a execução seguinte entrega.
func TestEntregarLentoFalhaEDepoisEntrega(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	srv := pushteste.Novo(t)
	v := pushteste.VAPID(t)
	pushteste.Inscrever(t, p, "lento", uQuer)
	alvos, _ := webpush.Destinatarios(ctx, p, "vendas", "")
	apressado := &http.Client{Transport: srv.HTTP.Transport, Timeout: 100 * time.Millisecond}
	if r, _ := webpush.Entregar(ctx, p, apressado, alvos, []byte(`{}`), v, "lento:2026-10-10"); r != (webpush.Resultado{Falhas: 1}) {
		t.Fatalf("lento: %+v", r)
	}
	if r, _ := webpush.Entregar(ctx, p, srv.HTTP, alvos, []byte(`{}`), v, "lento:2026-10-10"); r != (webpush.Resultado{Enviados: 1}) {
		t.Fatalf("depois do prazo vencido a reserva foi liberada: %+v", r)
	}
}
