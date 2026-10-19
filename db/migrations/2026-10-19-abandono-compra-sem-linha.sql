-- 2026-10-19-abandono-compra-sem-linha.sql
-- Achado 04-M1 da revisão de 10/2026: `orders/paid` com o token de um checkout que ainda não tem linha (o
-- `checkouts/update` atrasou) só fazia UPDATE e não gravava nada; o `checkouts/update` que chegava depois criava a
-- linha `aguardando` e a mensagem `inicio`, e a cliente que JÁ COMPROU recebia a recuperação. Agora a compra
-- grava a linha já como `comprou`. O resto (compra por e-mail/telefone, comprou_depois) fica como estava.
-- registrar_checkout_abandono não muda: o upsert e o insert da fila já exigem status = 'aguardando'.
-- Mesmo texto da migration 00011 da API em Go (api/internal/banco/migracoes).

create or replace function public.marcar_checkout_comprou(
  p_token text, p_email text default null, p_telefone text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_origem text;
  v_fone_origem  text;
  v_emails text[];
  v_fones  text[];
begin
  -- Pedido pago que chega ANTES do checkouts/update (webhook atrasado): sem linha, o UPDATE abaixo não marcava nada
  -- e o evento atrasado criava `aguardando` + mensagem de recuperação para quem já comprou. Grava a linha já como
  -- `comprou`; o registrar_checkout_abandono só mexe em `aguardando`, então o evento tardio passa a ser inofensivo.
  -- Corrida com o registrar: o insert espera o commit dele e o UPDATE abaixo (READ COMMITTED) já enxerga a linha.
  if p_token is not null then
    insert into public.checkout_abandono (token, email, telefone, status, comprou_em)
    values (p_token, nullif(btrim(p_email), ''), nullif(btrim(p_telefone), ''), 'comprou', now())
    on conflict (token) do nothing;
  end if;

  select nullif(lower(btrim(email)), ''), nullif(public.fone11(telefone), '')
    into v_email_origem, v_fone_origem
    from public.checkout_abandono where token = p_token;

  v_emails := array_remove(array[nullif(lower(btrim(p_email)), ''), v_email_origem], null);
  v_fones  := array_remove(array[nullif(public.fone11(p_telefone), ''), v_fone_origem], null);

  update public.checkout_abandono
     set comprou_depois = comprou_depois or (status = 'fila_envio'),
         status         = 'comprou',
         comprou_em     = now()
   where status <> 'comprou'
     and (token = p_token
          or (status in ('aguardando', 'fila_envio')
              and (lower(btrim(email)) = any (v_emails) or public.fone11(telefone) = any (v_fones))));
end;
$$;

revoke execute on function public.marcar_checkout_comprou(text, text, text) from public, anon, authenticated;
grant execute on function public.marcar_checkout_comprou(text, text, text) to service_role;
