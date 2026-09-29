-- PAGAMENTO PENDENTE (Pix/boleto) NÃO É COMPRA.
--
-- Achado no teste real de 28/09/2026: o cliente gerou o QR do Pix e a fila já dizia
-- "comprou", com o pedido em "Pagamento pendente" no Shopify. Pix e boleto criam o
-- pedido ANTES de pagar. Regra nova, decidida pelos webhooks de PEDIDO:
--
--   orders/create com pagamento pendente -> 'pagamento_pendente'  (sai da espera; NÃO vai
--                                            para a fila de envio: o cliente ainda pode pagar)
--   orders/paid                          -> 'comprou'
--   orders/cancelled (Pix expirou)       -> volta: 'aguardando' (relógio de 10 min recomeça) ou,
--                                            se já tinha entrado na fila de envio, 'fila_envio'
--
-- (o edge também deixou de tratar `completed_at` do checkout como compra: com Pix o checkout
--  é "concluído" ao gerar o QR.)

alter table public.checkout_abandono drop constraint if exists checkout_abandono_status_check;
alter table public.checkout_abandono add constraint checkout_abandono_status_check
  check (status in ('aguardando', 'fila_envio', 'pagamento_pendente', 'comprou'));

alter table public.checkout_abandono add column if not exists pedido_criado_em timestamptz;

comment on column public.checkout_abandono.pedido_criado_em is
  'Quando o pedido foi criado com pagamento pendente (Pix/boleto).';

-- orders/create com pagamento pendente. Só sai de aguardando/fila_envio: se o pago (orders/paid)
-- chegou primeiro, o status 'comprou' fica como está.
create or replace function public.marcar_checkout_pagamento_pendente(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.checkout_abandono
     set status           = 'pagamento_pendente',
         pedido_criado_em = now(),
         comprou_depois   = comprou_depois or (status = 'fila_envio')
   where token = p_token
     and status in ('aguardando', 'fila_envio');
$$;

-- orders/paid, ou orders/create já pago (cartão). Agora PRESERVA a marca "comprou depois":
-- ela pode ter sido gravada quando o pedido pendente foi criado.
create or replace function public.marcar_checkout_comprou(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.checkout_abandono
     set comprou_depois = comprou_depois or (status = 'fila_envio'),
         status         = 'comprou',
         comprou_em     = now()
   where token = p_token
     and status <> 'comprou';
$$;

-- orders/cancelled (Pix expirado). Só reabre quem estava com pagamento pendente.
-- Quem já tinha entrado na fila de envio volta para ela (sem zerar fila_envio_em, para o robô
-- não tratar como fila nova e mandar de novo); os demais recomeçam os 10 minutos.
create or replace function public.reabrir_checkout_abandono(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.checkout_abandono
     set status           = case when comprou_depois then 'fila_envio' else 'aguardando' end,
         ultimo_evento_em = now(),
         pedido_criado_em = null
   where token = p_token
     and status = 'pagamento_pendente';
$$;

-- Escrita: fechada para todos, aberta só para o service_role (`anon` citado de propósito).
revoke execute on function public.marcar_checkout_pagamento_pendente(text) from public, anon, authenticated;
revoke execute on function public.marcar_checkout_comprou(text) from public, anon, authenticated;
revoke execute on function public.reabrir_checkout_abandono(text) from public, anon, authenticated;
grant execute on function public.marcar_checkout_pagamento_pendente(text) to service_role;
grant execute on function public.marcar_checkout_comprou(text) to service_role;
grant execute on function public.reabrir_checkout_abandono(text) to service_role;
