-- 2026-09-30-zzzzz-fila-de-mensagens.sql
-- FLUXO DE MENSAGENS (design: docs/superpowers/specs/2026-09-30-fluxo-de-mensagens-design.md).
--
-- 1) `mensagem_fila`: fila genérica (tipo, chave) das mensagens de PEDIDO RECEBIDO e de FOLLOW-UP do abandono.
--    O abandono continua em `checkout_abandono` (não foi mexido: está no ar).
-- 2) O abandono ganha o teto de horas em parâmetro (`p_max_horas`, padrão 24 = comportamento de hoje), para a
--    troca dos 10 min pelas 24 h ser só configuração (atraso 1440 min e teto 48 h).
--
-- Guarda dado pessoal (telefone, nome): RLS ligada e SEM policy, só o service role lê e grava.

create table if not exists public.mensagem_fila (
  tipo                     text not null check (tipo in ('pedido', 'followup')),
  chave                    text not null,            -- pedido: id do pedido na Shopify; followup: token do checkout
  numero                   text,                     -- pedido: número do pedido (#1001)
  nome                     text,
  telefone                 text,
  url_de_recuperacao       text,                     -- followup: link do checkout
  conversa_origem          bigint,                   -- followup: conversa da mensagem de abandono (para ver se respondeu)
  criado_em                timestamptz not null default now(),  -- pedido: quando foi criado; followup: quando foi agendado
  mensagem_status          text check (mensagem_status is null or mensagem_status in ('enviando', 'enviada', 'falhou', 'ignorada')),
  mensagem_reservada_em    timestamptz,
  mensagem_enviada_em      timestamptz,
  mensagem_motivo          text,
  mensagem_tentativas      int not null default 0,
  chatwoot_conversation_id bigint,
  primary key (tipo, chave)
);

create index if not exists mensagem_fila_pendentes_idx
  on public.mensagem_fila (tipo, criado_em) where mensagem_status is null;

alter table public.mensagem_fila enable row level security;
revoke all on public.mensagem_fila from anon, authenticated;
comment on table public.mensagem_fila is
  'Fila das mensagens de pedido recebido e follow-up. RLS sem policies: so o service role le e grava.';

-- ── pedido ────────────────────────────────────────────────────────────────────
-- Idempotente: a Shopify reenvia o webhook e o mesmo pedido nunca vira duas mensagens.
create or replace function public.registrar_pedido_para_mensagem(
  p_pedido_id bigint, p_numero text, p_nome text, p_telefone text, p_criado_em timestamptz
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.mensagem_fila (tipo, chave, numero, nome, telefone, criado_em)
  values ('pedido', p_pedido_id::text, p_numero, p_nome, p_telefone, coalesce(p_criado_em, now()))
  on conflict (tipo, chave) do nothing;
$$;

-- Pedido cancelado antes de a mensagem sair: não sai. Depois de reservada (enviando) não muda.
create or replace function public.cancelar_mensagem_pedido(p_pedido_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mensagem_fila
     set mensagem_status = 'ignorada', mensagem_motivo = 'pedido_cancelado'
   where tipo = 'pedido' and chave = p_pedido_id::text and mensagem_status is null;
$$;

-- ── follow-up ─────────────────────────────────────────────────────────────────
-- Agenda o follow-up de quem recebeu a mensagem de abandono entre `p_apos_horas` e `p_apos_horas + p_teto_horas`
-- atrás e ainda está na fila (não comprou, não está em pagamento pendente). Roda a cada rodada; nunca duplica.
create or replace function public.agendar_followups(p_apos_horas int default 48, p_teto_horas int default 24)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  agendados int;
begin
  insert into public.mensagem_fila (tipo, chave, nome, telefone, url_de_recuperacao, conversa_origem)
  select 'followup', c.token, c.nome, c.telefone, c.url_de_recuperacao, c.chatwoot_conversation_id
    from public.checkout_abandono c
   where c.status = 'fila_envio' and c.mensagem_status = 'enviada'
     and c.mensagem_enviada_em <= now() - make_interval(hours => p_apos_horas)
     and c.mensagem_enviada_em >  now() - make_interval(hours => p_apos_horas + p_teto_horas)
  on conflict (tipo, chave) do nothing;
  get diagnostics agendados = row_count;
  return agendados;
end;
$$;

-- ── reserva, resultado, devolução, travadas (pedido e follow-up) ─────────────
-- Chaves elegíveis. Follow-up: no máximo UM por telefone (o mais antigo) e nenhum cujo telefone já tem follow-up
-- em andamento. Pedido: um por pedido, sem agrupar por telefone (duas compras = duas confirmações).
create or replace function public.candidatos_da_fila(p_tipo text, p_max_horas int, p_ultimos11 text[] default null)
returns setof text
language sql
security definer
set search_path = public
as $$
  select distinct on (case when p_tipo = 'followup' and public.fone11(f.telefone) <> '' then public.fone11(f.telefone) else f.chave end) f.chave
    from public.mensagem_fila f
   where f.tipo = p_tipo and f.mensagem_status is null
     and f.criado_em >= now() - make_interval(hours => p_max_horas)
     and (p_ultimos11 is null or public.fone11(f.telefone) = any (p_ultimos11))
     and not (p_tipo = 'followup' and public.fone11(f.telefone) <> '' and exists (
       select 1 from public.mensagem_fila o
        where o.tipo = 'followup' and o.chave <> f.chave and o.mensagem_status = 'enviando'
          and public.fone11(o.telefone) = public.fone11(f.telefone)))
   order by (case when p_tipo = 'followup' and public.fone11(f.telefone) <> '' then public.fone11(f.telefone) else f.chave end), f.criado_em, f.chave;
$$;

-- Com p_reservar = false só LÊ (modo seco). Reserva serializada por lock e `for update skip locked`.
create or replace function public.pegar_da_fila(
  p_tipo text, p_limite int, p_max_horas int, p_reservar boolean default true, p_ultimos11 text[] default null
) returns setof public.mensagem_fila
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reservar then
    perform pg_advisory_xact_lock(hashtext('pegar_da_fila'));
    return query
    with alvo as (
      select f.tipo, f.chave from public.mensagem_fila f
       where f.tipo = p_tipo and f.chave in (select * from public.candidatos_da_fila(p_tipo, p_max_horas, p_ultimos11))
       order by f.criado_em, f.chave
       limit p_limite
       for update skip locked
    )
    update public.mensagem_fila f
       set mensagem_status = 'enviando', mensagem_reservada_em = now()
      from alvo
     where f.tipo = alvo.tipo and f.chave = alvo.chave
    returning f.*;
  else
    return query
    select f.* from public.mensagem_fila f
     where f.tipo = p_tipo and f.chave in (select * from public.candidatos_da_fila(p_tipo, p_max_horas, p_ultimos11))
     order by f.criado_em, f.chave
     limit p_limite;
  end if;
end;
$$;

-- Resultado final. Só finaliza quem está `enviando`.
create or replace function public.marcar_da_fila(
  p_tipo text, p_chave text, p_status text, p_motivo text default null, p_conversa bigint default null
) returns void
language sql
security definer
set search_path = public
as $$
  update public.mensagem_fila
     set mensagem_status          = p_status,
         mensagem_motivo          = p_motivo,
         chatwoot_conversation_id = coalesce(p_conversa, chatwoot_conversation_id),
         mensagem_enviada_em      = case when p_status = 'enviada' then now() else mensagem_enviada_em end
   where tipo = p_tipo and chave = p_chave and mensagem_status = 'enviando';
$$;

-- Devolve à fila. p_contar = true conta uma tentativa; na terceira, falha de vez.
create or replace function public.devolver_da_fila(p_tipo text, p_chave text, p_contar boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mensagem_fila
     set mensagem_tentativas   = mensagem_tentativas + case when p_contar then 1 else 0 end,
         mensagem_status       = case when p_contar and mensagem_tentativas + 1 >= 3 then 'falhou' else null end,
         mensagem_motivo       = case when p_contar and mensagem_tentativas + 1 >= 3 then 'tentativas_esgotadas' else mensagem_motivo end,
         mensagem_reservada_em = null
   where tipo = p_tipo and chave = p_chave and mensagem_status = 'enviando';
$$;

-- ⚠️ `enviando` há mais de 10 min NÃO volta à fila: o template pode já ter saído (mesma regra do abandono).
create or replace function public.liberar_travadas_da_fila()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  liberados int;
begin
  update public.mensagem_fila
     set mensagem_status = 'falhou', mensagem_motivo = 'travada_sem_confirmacao', mensagem_reservada_em = null
   where mensagem_status = 'enviando' and mensagem_reservada_em < now() - interval '10 minutes';
  get diagnostics liberados = row_count;
  return liberados;
end;
$$;

-- ── abandono: teto de horas em parâmetro ─────────────────────────────────────
-- As assinaturas antigas saem: com a nova (parâmetro final com padrão) as duas chamadas ficariam ambíguas.
drop function if exists public.pegar_para_mensagem(int, int, boolean, text[]);
drop function if exists public.candidatos_para_mensagem(int, text[]);

create or replace function public.candidatos_para_mensagem(p_atraso_min int, p_ultimos11 text[] default null, p_max_horas int default 24)
returns setof text
language sql
security definer
set search_path = public
as $$
  select distinct on (case when public.fone11(c.telefone) = '' then c.token else public.fone11(c.telefone) end) c.token
    from public.checkout_abandono c
   where c.status = 'fila_envio' and c.mensagem_status is null
     and c.fila_envio_em <= now() - make_interval(mins => p_atraso_min)
     and c.fila_envio_em >= now() - make_interval(hours => p_max_horas)
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
  p_limite int, p_atraso_min int, p_reservar boolean default true, p_ultimos11 text[] default null, p_max_horas int default 24
) returns setof public.checkout_abandono
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reservar then
    perform pg_advisory_xact_lock(hashtext('pegar_para_mensagem'));

    update public.checkout_abandono c
       set mensagem_status = 'ignorada', mensagem_motivo = 'telefone_ja_recebeu'
     where c.status = 'fila_envio' and c.mensagem_status is null
       and c.fila_envio_em >= now() - make_interval(hours => p_max_horas)
       and public.fone11(c.telefone) <> ''
       and (p_ultimos11 is null or public.fone11(c.telefone) = any (p_ultimos11))
       and exists (select 1 from public.checkout_abandono o
                    where o.token <> c.token and public.fone11(o.telefone) = public.fone11(c.telefone)
                      and o.mensagem_status = 'enviada' and o.mensagem_enviada_em > now() - interval '7 days');

    return query
    with alvo as (
      select t.token from public.checkout_abandono t
       where t.token in (select * from public.candidatos_para_mensagem(p_atraso_min, p_ultimos11, p_max_horas))
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
     where c.token in (select * from public.candidatos_para_mensagem(p_atraso_min, p_ultimos11, p_max_horas))
     order by c.fila_envio_em
     limit p_limite;
  end if;
end;
$$;

-- ── permissões: tudo fechado, só o service_role executa ──────────────────────
revoke execute on function public.registrar_pedido_para_mensagem(bigint, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.cancelar_mensagem_pedido(bigint) from public, anon, authenticated;
revoke execute on function public.agendar_followups(int, int) from public, anon, authenticated;
revoke execute on function public.candidatos_da_fila(text, int, text[]) from public, anon, authenticated;
revoke execute on function public.pegar_da_fila(text, int, int, boolean, text[]) from public, anon, authenticated;
revoke execute on function public.marcar_da_fila(text, text, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.devolver_da_fila(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.liberar_travadas_da_fila() from public, anon, authenticated;
revoke execute on function public.candidatos_para_mensagem(int, text[], int) from public, anon, authenticated;
revoke execute on function public.pegar_para_mensagem(int, int, boolean, text[], int) from public, anon, authenticated;
grant execute on function public.registrar_pedido_para_mensagem(bigint, text, text, text, timestamptz) to service_role;
grant execute on function public.cancelar_mensagem_pedido(bigint) to service_role;
grant execute on function public.agendar_followups(int, int) to service_role;
grant execute on function public.candidatos_da_fila(text, int, text[]) to service_role;
grant execute on function public.pegar_da_fila(text, int, int, boolean, text[]) to service_role;
grant execute on function public.marcar_da_fila(text, text, text, text, bigint) to service_role;
grant execute on function public.devolver_da_fila(text, text, boolean) to service_role;
grant execute on function public.liberar_travadas_da_fila() to service_role;
grant execute on function public.candidatos_para_mensagem(int, text[], int) to service_role;
grant execute on function public.pegar_para_mensagem(int, int, boolean, text[], int) to service_role;
