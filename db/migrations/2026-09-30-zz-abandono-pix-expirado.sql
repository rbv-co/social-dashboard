-- PIX EXPIRADO: o pagamento pendente REABRE SOZINHO depois de 35 minutos.
--
-- Achado no teste real de 29/09/2026: o Pix (30 min de validade, provedor appmax) expirou e o
-- Shopify passou o pedido para "Expirado", mas o registro continuou em 'pagamento_pendente'
-- para sempre (44 min e contando). O webhook orders/cancelled, que reabria o checkout, NÃO
-- disparou na expiração: o Shopify só troca o status do pagamento para "expirado".
--
-- Em vez de depender de mais um webhook, o mesmo cron de todo minuto reabre quem está
-- 'pagamento_pendente' há mais de p_pix_minutos (35 = os 30 do Pix + 5 de folga).
-- Reabrir = a mesma regra do orders/cancelled: quem NUNCA foi para a fila recomeça os 10
-- minutos em 'aguardando'; quem já tinha ido volta para a 'fila_envio' (sem zerar
-- fila_envio_em, para o robô não tratar como fila nova e mandar de novo).
--
-- ⚠️ 35 min vale para PIX. Boleto dura dias: se a loja passar a vender boleto, um boleto
-- ainda válido também reabriria aqui. Se isso acontecer, trocar por um teto por forma de
-- pagamento (o payload do pedido traz payment_gateway_names).
--
-- A assinatura ganha um parâmetro com default; o cron continua chamando (10) e resolve para
-- esta função. A antiga (só p_minutos) é removida para não haver duas sobrecargas ambíguas.

drop function if exists public.mover_abandonados_para_fila(int);

create or replace function public.mover_abandonados_para_fila(
  p_minutos int default 10,
  p_pix_minutos int default 35
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  movidos int;
  reabertos int;
begin
  -- 1) 10 minutos sem evento e sem pedido -> fila de envio
  update public.checkout_abandono
     set status        = 'fila_envio',
         fila_envio_em = now()
   where status = 'aguardando'
     and ultimo_evento_em < now() - make_interval(mins => p_minutos);
  get diagnostics movidos = row_count;

  -- 2) pagamento pendente que passou da validade do Pix -> reabre
  update public.checkout_abandono
     set status           = case when comprou_depois then 'fila_envio' else 'aguardando' end,
         ultimo_evento_em = now(),
         pedido_criado_em = null
   where status = 'pagamento_pendente'
     and pedido_criado_em < now() - make_interval(mins => p_pix_minutos);
  get diagnostics reabertos = row_count;

  return movidos + reabertos;
end;
$$;

revoke execute on function public.mover_abandonados_para_fila(int, int) from public, anon, authenticated;
grant execute on function public.mover_abandonados_para_fila(int, int) to service_role;
