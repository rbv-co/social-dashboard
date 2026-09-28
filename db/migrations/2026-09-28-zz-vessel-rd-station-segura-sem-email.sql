-- RD Station: cadastro SEM E-MAIL espera (28/09/2026).
--
-- ⚠️ Conferido no RD ao vivo: esta conta RECUSA contato só com telefone.
-- Sem `phone` ele responde AT_LEAST_ONE_REQUIRED (email, phone); com `phone` e
-- sem e-mail, `$.payload.email` MISSING. Com e-mail: 200. Então quem não tem
-- e-mail fica em 'sem_email' (não gasta tentativa) e volta sozinho para a fila
-- quando a pessoa ganhar um e-mail na base.
-- Idempotente.

alter table public.vessel_rd_envios drop constraint if exists vessel_rd_envios_status_check;
alter table public.vessel_rd_envios add constraint vessel_rd_envios_status_check
  check (status in ('pendente', 'enviado', 'ok', 'falhou', 'sem_email'));

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

  -- 2) Sem e-mail espera; ganhou e-mail, volta para a fila.
  update public.vessel_rd_envios e
     set status = case when nullif(trim(p.email), '') is null then 'sem_email' else 'pendente' end,
         atualizado_em = now()
    from public.vessel_pessoas p
   where p.id = e.pessoa_id
     and ((e.status = 'pendente' and nullif(trim(p.email), '') is null)
       or (e.status = 'sem_email' and nullif(trim(p.email), '') is not null));

  if v_token is null then
    return json_build_object('ok', false, 'situacao', 'sem_token');
  end if;

  -- 3) Manda os pendentes e os que falharam (até 5 tentativas).
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
