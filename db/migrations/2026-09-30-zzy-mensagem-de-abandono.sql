-- 2026-09-30-zzy-mensagem-de-abandono.sql
-- ESTADO DA MENSAGEM DE RECUPERAÇÃO + LISTA DE BLOQUEADOS.
-- Design: docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md
--
-- `fila_envio` (o status) é a "Fila de mensagens" da tela. A mensagem em si tem estado PRÓPRIO
-- (mensagem_status), porque um checkout pode voltar para `fila_envio` depois de um Pix
-- expirado: se já recebeu, o `mensagem_status = 'enviada'` o impede de receber de novo.

alter table public.checkout_abandono
  add column if not exists mensagem_status text,
  add column if not exists mensagem_reservada_em timestamptz,
  add column if not exists mensagem_enviada_em timestamptz,
  add column if not exists mensagem_motivo text,
  add column if not exists mensagem_tentativas int not null default 0,
  add column if not exists chatwoot_conversation_id bigint;

alter table public.checkout_abandono drop constraint if exists checkout_abandono_mensagem_status_check;
alter table public.checkout_abandono add constraint checkout_abandono_mensagem_status_check
  check (mensagem_status is null or mensagem_status in ('enviando', 'enviada', 'falhou', 'ignorada'));

create index if not exists checkout_abandono_fila_mensagem_idx
  on public.checkout_abandono (fila_envio_em)
  where status = 'fila_envio' and mensagem_status is null;

-- Quem pediu para não receber. Telefone JÁ normalizado (55 + DDD + 9 + 8 dígitos).
create table if not exists public.contatos_sem_mensagem (
  telefone  text primary key,
  motivo    text,
  criado_em timestamptz not null default now()
);
alter table public.contatos_sem_mensagem enable row level security;
revoke all on public.contatos_sem_mensagem from anon, authenticated;
comment on table public.contatos_sem_mensagem is
  'Telefones que pediram para nao receber. RLS sem policies: so o service role le e grava.';

-- Reserva os próximos da fila. Com p_reservar = false só LÊ (modo seco). p_ultimos11 = filtro
-- opcional pelos últimos 11 dígitos do telefone (modo lista: só os números do dono).
create or replace function public.pegar_para_mensagem(
  p_limite int, p_atraso_min int, p_reservar boolean default true, p_ultimos11 text[] default null
) returns setof public.checkout_abandono
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reservar then
    return query
    with alvo as (
      select token from public.checkout_abandono
       where status = 'fila_envio' and mensagem_status is null
         and fila_envio_em <= now() - make_interval(mins => p_atraso_min)
         and fila_envio_em >= now() - interval '24 hours'
         and (p_ultimos11 is null
              or right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 11) = any (p_ultimos11))
       order by fila_envio_em
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
     where c.status = 'fila_envio' and c.mensagem_status is null
       and c.fila_envio_em <= now() - make_interval(mins => p_atraso_min)
       and c.fila_envio_em >= now() - interval '24 hours'
       and (p_ultimos11 is null
            or right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 11) = any (p_ultimos11))
     order by c.fila_envio_em
     limit p_limite;
  end if;
end;
$$;

-- Resultado final. Só finaliza quem está `enviando` (não sobrescreve outro estado).
create or replace function public.marcar_mensagem(
  p_token text, p_status text, p_motivo text default null, p_conversa bigint default null
) returns void
language sql
security definer
set search_path = public
as $$
  update public.checkout_abandono
     set mensagem_status          = p_status,
         mensagem_motivo          = p_motivo,
         chatwoot_conversation_id = coalesce(p_conversa, chatwoot_conversation_id),
         mensagem_enviada_em      = case when p_status = 'enviada' then now() else mensagem_enviada_em end
   where token = p_token
     and mensagem_status = 'enviando';
$$;

-- Devolve à fila. p_contar = true conta uma tentativa (erro de rede/5xx); na terceira, falha de vez.
create or replace function public.devolver_mensagem(p_token text, p_contar boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.checkout_abandono
     set mensagem_tentativas   = mensagem_tentativas + case when p_contar then 1 else 0 end,
         mensagem_status       = case when p_contar and mensagem_tentativas + 1 >= 3 then 'falhou' else null end,
         mensagem_motivo       = case when p_contar and mensagem_tentativas + 1 >= 3 then 'tentativas_esgotadas' else mensagem_motivo end,
         mensagem_reservada_em = null
   where token = p_token
     and mensagem_status = 'enviando';
$$;

-- Robô que morreu no meio da rodada: quem ficou `enviando` por mais de 10 min NÃO volta para a
-- fila. ⚠️ O template pode já ter saído (o robô pode ter morrido depois de enviar e antes de
-- gravar), e devolver a `null` mandaria a mesma mensagem DUAS vezes ao cliente. Vira `falhou`,
-- que aparece na tela para decisão humana.
create or replace function public.liberar_mensagens_travadas()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  liberados int;
begin
  update public.checkout_abandono
     set mensagem_status = 'falhou', mensagem_motivo = 'travada_sem_confirmacao', mensagem_reservada_em = null
   where mensagem_status = 'enviando'
     and mensagem_reservada_em < now() - interval '10 minutes';
  get diagnostics liberados = row_count;
  return liberados;
end;
$$;

revoke execute on function public.pegar_para_mensagem(int, int, boolean, text[]) from public, anon, authenticated;
revoke execute on function public.marcar_mensagem(text, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.devolver_mensagem(text, boolean) from public, anon, authenticated;
revoke execute on function public.liberar_mensagens_travadas() from public, anon, authenticated;
grant execute on function public.pegar_para_mensagem(int, int, boolean, text[]) to service_role;
grant execute on function public.marcar_mensagem(text, text, text, bigint) to service_role;
grant execute on function public.devolver_mensagem(text, boolean) to service_role;
grant execute on function public.liberar_mensagens_travadas() to service_role;
