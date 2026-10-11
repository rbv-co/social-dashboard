package mensagens

import (
	"context"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// checkoutAbandono: a tabela de produção (migrations 2026-09-29/30) e a função do banco como está em
// pg_proc (levantamento 02-funções.csv): o teste prova a CHAMADA (nome e argumento), não reescreve a regra.
const checkoutAbandono = `
create table checkout_abandono (
  token text primary key, email text, telefone text, nome text, total numeric, moeda text,
  url_de_recuperacao text,
  status text not null default 'aguardando' check (status in ('aguardando', 'fila_envio', 'pagamento_pendente', 'comprou')),
  iniciado_em timestamptz not null default now(), ultimo_evento_em timestamptz not null default now(),
  fila_envio_em timestamptz, comprou_em timestamptz, comprou_depois boolean not null default false,
  pedido_criado_em timestamptz,
  mensagem_status text, mensagem_reservada_em timestamptz, mensagem_enviada_em timestamptz,
  mensagem_motivo text, mensagem_tentativas int not null default 0, chatwoot_conversation_id bigint);
create function mover_abandonados_para_fila(p_minutos integer default 10, p_pix_minutos integer default 35)
returns integer language plpgsql as $$
declare movidos int; reabertos int;
begin
  update checkout_abandono set status = 'fila_envio', fila_envio_em = now()
   where status = 'aguardando' and ultimo_evento_em < now() - make_interval(mins => p_minutos);
  get diagnostics movidos = row_count;
  update checkout_abandono
     set status = case when comprou_depois then 'fila_envio' else 'aguardando' end,
         ultimo_evento_em = now(), pedido_criado_em = null
   where status = 'pagamento_pendente' and pedido_criado_em < now() - make_interval(mins => p_pix_minutos);
  get diagnostics reabertos = row_count;
  return movidos + reabertos;
end $$;`

func TestMoverAbandonados(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, checkoutAbandono); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into checkout_abandono (token, status, ultimo_evento_em, pedido_criado_em) values
		('parado-11min', 'aguardando', now() - interval '11 minutes', null),
		('parado-9min', 'aguardando', now() - interval '9 minutes', null),
		('pix-vencido', 'pagamento_pendente', now(), now() - interval '36 minutes')`); err != nil {
		t.Fatal(err)
	}
	tf := MoverAbandonados(p)
	if tf.Nome != "abandono-de-checkout" || tf.Agenda != "* * * * *" {
		t.Fatalf("%+v", tf)
	}
	if err := tf.Executar(ctx); err != nil {
		t.Fatal(err)
	}
	for token, quer := range map[string]string{"parado-11min": "fila_envio", "parado-9min": "aguardando", "pix-vencido": "aguardando"} {
		var st string
		p.QueryRow(ctx, `select status from checkout_abandono where token = $1`, token).Scan(&st)
		if st != quer {
			t.Errorf("%s: status %q, esperava %q", token, st, quer)
		}
	}
}

func TestMoverAbandonadosSemAFuncaoEErro(t *testing.T) {
	p := testebanco.Novo(t)
	if err := MoverAbandonados(p).Executar(context.Background()); err == nil {
		t.Fatal("sem a função no banco a tarefa tem de falhar (visível em robos_execucoes)")
	}
}
