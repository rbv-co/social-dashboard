-- 2026-09-30-zzzz-abandono-sem-duplicidade.sql
-- Review do fluxo (30/09/2026): o robô podia mandar a MESMA cliente mais de uma vez, ou mandar a quem já
-- tinha comprado por outro checkout. Duas regras novas, ambas no banco:
--
-- 1) UMA MENSAGEM POR TELEFONE. `pegar_para_mensagem` não escolhe dois checkouts do mesmo telefone no mesmo
--    lote, nem quem já recebeu (enviada) nos últimos 7 dias, nem quem tem mensagem em andamento (enviando).
--    Quem é barrado por já ter recebido vira `ignorada / telefone_ja_recebeu` (aparece na tela).
--    Duas rodadas ao mesmo tempo não se atropelam: a reserva é serializada por um lock.
-- 2) COMPROU POR OUTRO CHECKOUT. `marcar_checkout_comprou` (só com token, como antes, ou com o e-mail e o
--    telefone do pedido) também tira da fila os checkouts abertos (aguardando/fila_envio) do mesmo
--    e-mail ou telefone. Quem estiver em pagamento pendente não é mexido.

-- Telefone canônico: os últimos 11 dígitos (DDD + celular). Menos de 10 dígitos não identifica ninguém: ''.
create or replace function public.fone11(p_telefone text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when length(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g')) >= 10
              then right(regexp_replace(p_telefone, '\D', '', 'g'), 11)
              else '' end;
$$;

-- Tokens elegíveis: fila de envio, ainda sem mensagem, dentro das 24 h, no máximo UM por telefone (o mais
-- antigo) e nenhum cujo telefone já recebeu ou está recebendo por outro checkout. Sem telefone não agrupa.
create or replace function public.candidatos_para_mensagem(p_atraso_min int, p_ultimos11 text[] default null)
returns setof text
language sql
security definer
set search_path = public
as $$
  select distinct on (case when public.fone11(c.telefone) = '' then c.token else public.fone11(c.telefone) end) c.token
    from public.checkout_abandono c
   where c.status = 'fila_envio' and c.mensagem_status is null
     and c.fila_envio_em <= now() - make_interval(mins => p_atraso_min)
     and c.fila_envio_em >= now() - interval '24 hours'
     and (p_ultimos11 is null or public.fone11(c.telefone) = any (p_ultimos11))
     and not exists (
       select 1 from public.checkout_abandono o
        where public.fone11(c.telefone) <> '' and o.token <> c.token
          and public.fone11(o.telefone) = public.fone11(c.telefone)
          and (o.mensagem_status = 'enviando'
               or (o.mensagem_status = 'enviada' and o.mensagem_enviada_em > now() - interval '7 days')))
   order by (case when public.fone11(c.telefone) = '' then c.token else public.fone11(c.telefone) end), c.fila_envio_em, c.token;
$$;

create or replace function public.pegar_para_mensagem(
  p_limite int, p_atraso_min int, p_reservar boolean default true, p_ultimos11 text[] default null
) returns setof public.checkout_abandono
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reservar then
    -- Uma reserva por vez: duas rodadas simultâneas não escolhem dois checkouts do mesmo telefone.
    perform pg_advisory_xact_lock(hashtext('pegar_para_mensagem'));

    -- Já recebeu nos últimos 7 dias por outro checkout: sai da fila com o motivo à mostra.
    update public.checkout_abandono c
       set mensagem_status = 'ignorada', mensagem_motivo = 'telefone_ja_recebeu'
     where c.status = 'fila_envio' and c.mensagem_status is null
       and c.fila_envio_em >= now() - interval '24 hours'
       and public.fone11(c.telefone) <> ''
       and (p_ultimos11 is null or public.fone11(c.telefone) = any (p_ultimos11))
       and exists (select 1 from public.checkout_abandono o
                    where o.token <> c.token and public.fone11(o.telefone) = public.fone11(c.telefone)
                      and o.mensagem_status = 'enviada' and o.mensagem_enviada_em > now() - interval '7 days');

    return query
    with alvo as (
      select t.token from public.checkout_abandono t
       where t.token in (select * from public.candidatos_para_mensagem(p_atraso_min, p_ultimos11))
       order by t.fila_envio_em
       limit p_limite
       for update skip locked
    )
    update public.checkout_abandono c
       set mensagem_status = 'enviando', mensagem_reservada_em = now()
      from alvo
     where c.token = alvo.token
    returning c.*;
  else
    return query
    select c.* from public.checkout_abandono c
     where c.token in (select * from public.candidatos_para_mensagem(p_atraso_min, p_ultimos11))
     order by c.fila_envio_em
     limit p_limite;
  end if;
end;
$$;

-- A assinatura muda (ganha e-mail e telefone do pedido, opcionais). A antiga sai, senão fica uma
-- sobrecarga aberta ao lado.
drop function if exists public.marcar_checkout_comprou(text);

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

revoke execute on function public.candidatos_para_mensagem(int, text[]) from public, anon, authenticated;
revoke execute on function public.marcar_checkout_comprou(text, text, text) from public, anon, authenticated;
grant execute on function public.candidatos_para_mensagem(int, text[]) to service_role;
grant execute on function public.marcar_checkout_comprou(text, text, text) to service_role;
