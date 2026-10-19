-- +goose Up
-- Achado 04-M1 da revisão de 10/2026 (mesmo texto de db/migrations/2026-10-19-abandono-compra-sem-linha.sql):
-- `orders/paid` com o token de um checkout que ainda não tem linha só fazia UPDATE; o `checkouts/update` atrasado
-- criava `aguardando` + mensagem `inicio` e a cliente que já comprou recebia a recuperação. Agora a compra grava a
-- linha já como `comprou` (o registrar_checkout_abandono só mexe em `aguardando`, não muda).
--
-- A função vem do dump do Supabase: num banco sem ela (testes, instalação nova) a migration não faz nada. Na
-- VIRADA ela também seria no-op (o schema.sql chega depois do `migrar`): ops/migracao/restaurar.sh reaplica o Up
-- depois dos dados. `create or replace` mantém dono e permissões (só service_role executa).
-- +goose StatementBegin
do $mig$
begin
  if to_regclass('checkout_abandono') is null or to_regprocedure('marcar_checkout_comprou(text,text,text)') is null
     or to_regprocedure('fone11(text)') is null then
    return;
  end if;
  execute $f$
create or replace function public.marcar_checkout_comprou(
  p_token text, p_email text default null, p_telefone text default null
) returns void
language plpgsql
security definer
set search_path = public
as $g$
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
$g$;
  $f$;
end
$mig$;
-- +goose StatementEnd

-- +goose Down
-- Volta ao texto de 2026-09-30 (só UPDATE). Mesma guarda do Up.
-- +goose StatementBegin
do $mig$
begin
  if to_regclass('checkout_abandono') is null or to_regprocedure('marcar_checkout_comprou(text,text,text)') is null
     or to_regprocedure('fone11(text)') is null then
    return;
  end if;
  execute $f$
create or replace function public.marcar_checkout_comprou(
  p_token text, p_email text default null, p_telefone text default null
) returns void
language plpgsql
security definer
set search_path = public
as $g$
declare
  v_email_origem text;
  v_fone_origem  text;
  v_emails text[];
  v_fones  text[];
begin
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
$g$;
  $f$;
end
$mig$;
-- +goose StatementEnd
