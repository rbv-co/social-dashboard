-- Beauty Sessions → RD Station Marketing (28/09/2026, pedido do dono).
--
-- Cada cadastro de Beauty Session (pelo QR da mesa OU pela equipe) nasce como
-- uma linha em `vessel_origens` com canal 'beauty_session'. Um gatilho põe essa
-- linha numa FILA (`vessel_rd_envios`) e o robô `vessel-rd-station` (pg_cron,
-- 1/min) manda a fila ao RD como conversão `beauty-session-<codigo>`.
--
-- ⚠️ O GATILHO NUNCA DERRUBA O CADASTRO: só grava na fila, e qualquer erro vira
-- aviso. O HTTP mora no robô, fora da transação da cliente — RD fora do ar não
-- pode custar a lead no salão.
-- ⚠️ O token NÃO mora neste arquivo: fica em `segredos_de_cron`, nome
-- 'rd-station-token-publico' (token público do RD Station Marketing).
-- ⚠️ O RD aceita contato só com telefone (conferido: sem e-mail E sem telefone
-- ele responde AT_LEAST_ONE_REQUIRED), então o e-mail vai quando existir.
-- Idempotente.

create table if not exists public.vessel_rd_envios (
  id            bigint generated always as identity primary key,
  origem_id     bigint not null unique references public.vessel_origens(id) on delete cascade,
  pessoa_id     bigint not null,
  codigo        text,
  status        text not null default 'pendente'
                check (status in ('pendente', 'enviado', 'ok', 'falhou')),
  tentativas    int not null default 0,
  request_id    bigint,
  http_status   int,
  resposta      text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists vessel_rd_envios_status on public.vessel_rd_envios (status);
alter table public.vessel_rd_envios enable row level security;
-- Sem política: só as funções abaixo (security definer) mexem aqui.
revoke all on public.vessel_rd_envios from anon, authenticated;

create or replace function public.vessel_rd_na_fila()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.canal = 'beauty_session'
     and not coalesce((select p.teste from public.vessel_pessoas p where p.id = new.pessoa_id), false) then
    begin
      insert into public.vessel_rd_envios (origem_id, pessoa_id, codigo)
      values (new.id, new.pessoa_id, new.evento_id)
      on conflict (origem_id) do nothing;
    exception when others then
      raise warning 'vessel_rd_na_fila: % (origem %)', sqlerrm, new.id;
    end;
  end if;
  return new;
end $$;

drop trigger if exists vessel_rd_na_fila on public.vessel_origens;
create trigger vessel_rd_na_fila
  after insert on public.vessel_origens
  for each row execute function public.vessel_rd_na_fila();

-- O que vai ao RD por um cadastro. Separado para dar para conferir sem enviar.
create or replace function public.vessel_rd_payload(p_origem_id bigint)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'event_type', 'CONVERSION',
    'event_family', 'CDP',
    'payload', jsonb_strip_nulls(jsonb_build_object(
      'conversion_identifier', 'beauty-session-' || lower(coalesce(o.evento_id, 'sem-codigo')),
      'name', p.nome,
      'email', nullif(trim(p.email), ''),
      'mobile_phone', '+' || p.telefone,
      'personal_phone', '+' || p.telefone,
      'city', nullif(trim(p.cidade), ''),
      'traffic_source', o.utm_source,
      'traffic_medium', o.utm_medium,
      'traffic_campaign', o.utm_campaign,
      'tags', (select jsonb_agg(t) from unnest(array[
                 'beauty-session',
                 lower(o.evento_id),
                 case o.utm_medium when 'offline_equipe' then 'cadastro-pela-equipe'
                                   when 'offline_qr' then 'cadastro-pelo-qr' end,
                 (select 'interesse-' || a.interesse from public.vessel_atendimentos a
                   where a.pessoa_id = o.pessoa_id and a.interesse is not null
                   order by a.criado_em desc limit 1)
               ]) t where t is not null),
      -- Marketing SEMPRE no Beauty Session (decisão do dono, a mesma do cadastro).
      'legal_bases', jsonb_build_array(jsonb_build_object(
        'category', 'communications', 'type', 'consent', 'status', 'granted'))
    ))
  )
  from public.vessel_origens o
  join public.vessel_pessoas p on p.id = o.pessoa_id
  where o.id = p_origem_id
$$;
revoke all on function public.vessel_rd_payload(bigint) from public, anon, authenticated;

create or replace function public.vessel_rd_enviar()
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text := (select segredo from public.segredos_de_cron where nome = 'rd-station-token-publico');
  v_r     record;
  v_req   bigint;
  v_env   int := 0;
begin
  -- 1) Colhe a resposta dos que já foram.
  update public.vessel_rd_envios e
     set status = case when h.status_code between 200 and 299 then 'ok' else 'falhou' end,
         http_status = h.status_code,
         resposta = left(coalesce(h.error_msg, h.content::text), 500),
         atualizado_em = now()
    from net._http_response h
   where e.status = 'enviado' and h.id = e.request_id;

  -- Enviado há mais de 10 min sem resposta: a resposta se perdeu, tenta de novo.
  update public.vessel_rd_envios
     set status = 'falhou', resposta = 'sem resposta em 10 min', atualizado_em = now()
   where status = 'enviado' and atualizado_em < now() - interval '10 minutes';

  if v_token is null then
    return json_build_object('ok', false, 'situacao', 'sem_token');
  end if;

  -- 2) Manda os pendentes e os que falharam (até 5 tentativas).
  for v_r in
    select id, origem_id from public.vessel_rd_envios
     where status = 'pendente' or (status = 'falhou' and tentativas < 5)
     order by id limit 50
     for update skip locked
  loop
    select net.http_post(
      url := 'https://api.rd.services/platform/conversions?api_key=' || v_token,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := public.vessel_rd_payload(v_r.origem_id),
      timeout_milliseconds := 30000
    ) into v_req;
    update public.vessel_rd_envios
       set status = 'enviado', request_id = v_req, tentativas = tentativas + 1, atualizado_em = now()
     where id = v_r.id;
    v_env := v_env + 1;
  end loop;

  return json_build_object('ok', true, 'enviados', v_env);
end $$;
revoke all on function public.vessel_rd_enviar() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('vessel-rd-station')
    where exists (select 1 from cron.job where jobname = 'vessel-rd-station');
  perform cron.schedule('vessel-rd-station', '* * * * *', 'select public.vessel_rd_enviar()');
end $$;
