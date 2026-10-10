package meta

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/webpush/pushteste"
)

func conta(prepaga bool, tipo any, texto string) map[string]any {
	return map[string]any{"is_prepay_account": prepaga, "funding_source_details": map[string]any{"type": tipo, "display_string": texto}}
}

// Esperados gerados com o próprio _shared/saldo-de-conta.js (Node 22).
func TestSaldoComoAEdge(t *testing.T) {
	for txt, quer := range map[string]int64{"Saldo (R$ 12.345,67)": 1234567, "R$\U000000a00,05": 5} {
		if c := lerSaldoDoTexto(txt); c == nil || *c != quer {
			t.Errorf("%q = %v", txt, c)
		}
	}
	if lerSaldoDoTexto("R$ 1.673") != nil || lerSaldoDoTexto("Available balance ($200.00 USD)") != nil {
		t.Fatal("formato fora do pt-BR é 'não sei', nunca um número")
	}
	breno := conta(true, 20, "Saldo disponível (R$ 1.673,75 BRL)")
	vessel := conta(false, "20", "Saldo disponível (R$\U000000a00,00 BRL)")
	raissa := conta(false, 1, "Visa final 1234")
	pouco := conta(true, nil, "Saldo disponível (R$ 200,00 BRL)")
	estranho := conta(true, nil, "Available balance ($200.00 USD)")
	l := func(nome string, c map[string]any, gasto float64) Leitura {
		x := lerSaldo(c, gasto)
		x.Conta = nome
		return x
	}
	casos := []struct {
		ls            []Leitura
		titulo, corpo string
	}{
		{[]Leitura{l("breno", breno, 100), l("raissa", raissa, 50), l("estranho", estranho, 10)}, "", ""},
		{[]Leitura{l("pouco", pouco, 150)}, "pouco: saldo para 1 dia", "R$ 200,00 restantes. No ritmo atual, o saldo dura cerca de 1 dia."},
		{[]Leitura{l("pouco", pouco, 100), l("vessel", vessel, 10), l("breno", breno, 1000)}, "vessel está sem saldo",
			"vessel: sem saldo · breno: R$ 1.673,75 (~1 dia) · pouco: R$ 200,00 (~2 dias)"},
		{[]Leitura{l("pouco", pouco, 300)}, "pouco: saldo acaba hoje", "R$ 200,00 restantes. No ritmo atual, o saldo não passa de hoje."},
		{[]Leitura{l("vessel", vessel, 0)}, "vessel está sem saldo", "R$ 0,00 restantes. O saldo acabou — as campanhas desta conta já podem ter parado."},
	}
	for i, c := range casos {
		titulo, corpo, ok := montarAvisoDeSaldo(c.ls)
		if titulo != c.titulo || corpo != c.corpo || ok != (c.titulo != "") {
			t.Errorf("caso %d: %q / %q / %v", i, titulo, corpo, ok)
		}
	}
	if x := lerSaldo(breno, 0); x.Nivel != "ok" || x.DiasRestantes != nil || x.Porque != "Não sei o ritmo de gasto para estimar quanto tempo dura." {
		t.Fatalf("sem ritmo: %+v", x)
	}
}

const accountsSaldo = `create table accounts (id uuid primary key, name text, instagram_id text, ad_account_id text, access_token text);
insert into accounts values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pouco', null, 'act_111', null),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Cartão', null, '222', null),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Sem anúncio', '1784', null, null);`

func graphDoSaldo(falhaCartao bool) func(core.PedidoMeta) (int, string, map[string]string) {
	return func(p core.PedidoMeta) (int, string, map[string]string) {
		switch p.Caminho {
		case "/act_111":
			return 200, `{"is_prepay_account":true,"funding_source_details":{"type":20,"display_string":"Saldo disponível (R$ 200,00 BRL)"}}`, nil
		case "/act_111/insights":
			return 200, `{"data":[{"spend":"2100"}]}`, nil // 300/dia: acaba hoje
		case "/act_222":
			if falhaCartao {
				return 400, `{"error":{"message":"(#200) sem permissão"}}`, nil
			}
			return 200, `{"is_prepay_account":false,"funding_source_details":{"type":1}}`, nil
		case "/act_222/insights":
			return 500, `{"error":{"message":"fora"}}`, nil
		}
		return 404, `{"erro":"rota de teste desconhecida"}`, nil
	}
}

func ambienteSaldo(t *testing.T, falhaCartao bool) (*PushSaldo, *pushteste.Servico, *coreMeta) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), accountsSaldo+pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	cli, f := coreDeTeste(t, graphDoSaldo(falhaCartao))
	srv := pushteste.Novo(t)
	agora := func() time.Time { return time.Date(2026, 10, 10, 11, 0, 0, 0, time.UTC) }
	return &PushSaldo{Pool: p, Core: cli, VAPID: pushteste.VAPID(t), HTTP: srv.HTTP, Agora: agora}, srv, f
}

func TestPushSaldoAvisaQuemQuerUmaVezSo(t *testing.T) {
	ps, srv, f := ambienteSaldo(t, false)
	ctx := context.Background()
	ua := pushteste.Inscrever(t, ps.Pool, "quer", "cccccccc-0000-0000-0000-000000000001")
	pushteste.Inscrever(t, ps.Pool, "padrao", "cccccccc-0000-0000-0000-000000000002") // saldo nasce desligado
	ps.Pool.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values ('cccccccc-0000-0000-0000-000000000001', 'saldo', true)`)
	if err := ps.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var msg map[string]string
	json.Unmarshal(pushteste.Decifrar(t, srv.Ultimo(t, "quer"), ua), &msg)
	if msg["title"] != "Pouco: saldo acaba hoje" || msg["body"] != "R$ 200,00 restantes. No ritmo atual, o saldo não passa de hoje." ||
		msg["tag"] != "gt-saldo" || msg["url"] != "/gestao-trafego" {
		t.Fatalf("push = %v", msg)
	}
	if srv.Recebidos("padrao") != 0 {
		t.Fatal("quem não ligou o aviso de saldo não recebe")
	}
	for _, ped := range f.lista() {
		if ped.Caminho == "/act_act_111" || ped.Parametros["access_token"] != nil {
			t.Fatalf("pedido ao core: %+v", ped)
		}
	}
	// A mesma manhã de novo (rodar manual): nada é reenviado.
	if err := ps.Rodar(ctx); err != nil || srv.Total() != 1 {
		t.Fatalf("repetida reenviou: err=%v total=%d", err, srv.Total())
	}
}

func TestPushSaldoContaQueFalhaEErroMasAsOutrasAvisam(t *testing.T) {
	ps, srv, _ := ambienteSaldo(t, true)
	pushteste.Inscrever(t, ps.Pool, "quer", "cccccccc-0000-0000-0000-000000000001")
	ps.Pool.Exec(context.Background(), `insert into push_preferencias (user_id, tipo, ativo) values ('cccccccc-0000-0000-0000-000000000001', 'saldo', true)`)
	err := ps.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Cartão: Meta API /act_222: (#200) sem permissão") {
		t.Fatalf("falha de uma conta tem de aparecer: %v", err)
	}
	if srv.Recebidos("quer") != 1 {
		t.Fatal("as outras contas avisam mesmo assim")
	}
}

func TestPushSaldoSemVAPIDNemChamaOCore(t *testing.T) {
	ps, _, f := ambienteSaldo(t, false)
	ps.VAPID.Privada = ""
	if err := ps.Rodar(context.Background()); err == nil || f.n() != 0 {
		t.Fatalf("err=%v chamadas=%d", err, f.n())
	}
	if tf := ps.Tarefa(); tf.Nome != "enviar-push-saldo-08h" || tf.Agenda != "0 11 * * *" {
		t.Fatalf("%+v", tf)
	}
}
