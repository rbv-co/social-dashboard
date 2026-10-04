-- 2026-10-04-mensagem-de-pagamento-confirmado.sql
-- MENSAGEM "PAGAMENTO CONFIRMADO", disparada em orders/paid, reaproveitando a fila genérica `mensagem_fila`
-- (mesmo padrão do tipo `pedido`, 2026-09-30-zzzzz-fila-de-mensagens.sql). Design:
-- docs/superpowers/specs/2026-10-04-mensagens-pos-pedido-design.md

alter table public.mensagem_fila drop constraint if exists mensagem_fila_tipo_check;
alter table public.mensagem_fila add constraint mensagem_fila_tipo_check check (tipo in ('pedido', 'followup', 'inicio', 'pagamento'));

-- Idêntica a `registrar_pedido_para_mensagem`, só troca o tipo. Idempotente: a Shopify reenvia o webhook
-- de orders/paid e o mesmo pedido nunca vira duas mensagens de pagamento.
create or replace function public.registrar_pagamento_para_mensagem(
  p_pedido_id bigint, p_numero text, p_nome text, p_telefone text, p_criado_em timestamptz
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.mensagem_fila (tipo, chave, numero, nome, telefone, criado_em)
  values ('pagamento', p_pedido_id::text, p_numero, p_nome, p_telefone, coalesce(p_criado_em, now()))
  on conflict (tipo, chave) do nothing;
$$;

-- Pedido cancelado antes de QUALQUER mensagem sair: cancela a de pedido E a de pagamento (se já registrada).
-- Antes só cancelava a de pedido; agora qualquer tipo pendente para este pedido_id. Depois de reservada
-- (enviando) não muda, como sempre.
create or replace function public.cancelar_mensagem_pedido(p_pedido_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mensagem_fila
     set mensagem_status = 'ignorada', mensagem_motivo = 'pedido_cancelado'
   where chave = p_pedido_id::text and tipo in ('pedido', 'pagamento') and mensagem_status is null;
$$;

revoke execute on function public.registrar_pagamento_para_mensagem(bigint, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_pagamento_para_mensagem(bigint, text, text, text, timestamptz) to service_role;
