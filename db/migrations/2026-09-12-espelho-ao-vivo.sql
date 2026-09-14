-- O ESPELHO DA LISTA DE ESPERA PASSA A SER AO VIVO
--
-- PEDIDO DO DONO (12/09/2026): "preciso que seja feito ao vivo para ir ao bling
-- e no espelho. e n pode travar, precisa sempre ser certeza absoluta que irá aos
-- dois caminhos."
--
-- O QUE MEDI ANTES DE MEXER, nas 12 últimas pessoas que se cadastraram:
--
--     10 de 12 → planilha em 3-5s, Bling em 5-9s
--      2 de 12 → ~175s nos dois
--
-- Os dois lentos não são acaso: `vessel_espelhar_agora` tinha um FREIO DE 20
-- SEGUNDOS. Se uma rodada tivesse acontecido nos últimos 20s, o gatilho era
-- ignorado e quem cobria era o cron de 3 em 3 minutos. Com rodadas a cada 3min
-- durando ~9s, cair nessa janela é questão de sorte — e deu ~17% na amostra.
--
-- O FREIO EXISTIA POR UM MOTIVO REAL, e ele continua valendo: duas rodadas ao
-- mesmo tempo veem a MESMA linha pendente e criam DOIS contatos no Bling para a
-- mesma pessoa. O que muda é o remédio. Freio de tempo é palpite: 20s é chute
-- para cima (atrasa quem não precisava) e chute para baixo ao mesmo tempo (uma
-- rodada que demore 35s — e elas existem, medi — ainda colide com a seguinte).
-- Uma TRAVA é exata: uma rodada por vez, garantido, sem atrasar ninguém.

-- ── 1. A trava ──────────────────────────────────────────────────────────────
-- ⚠️ COM PRAZO DE VALIDADE, e isto não é detalhe. Uma trava sem prazo que fique
-- presa por um robô que morreu no meio trava o robô PARA SEMPRE, e o sintoma é
-- exatamente o que o dono não quer: parou de ir. Com prazo, o pior caso é o robô
-- ficar parado até o prazo vencer — e o cron de 3 minutos cobre em seguida.
create table if not exists public.robos_travas (
  robo       text primary key,
  expira_em  timestamptz not null default now(),
  tomada_em  timestamptz
);

comment on table  public.robos_travas is
  'Uma rodada por vez, por robô. Prazo de validade para não prender quem morreu no meio.';
comment on column public.robos_travas.expira_em is
  'Enquanto for futuro, a trava está tomada. Ao soltar, vira now().';

-- RLS ligada com ZERO policies: ninguém de fora lê nem escreve. Quem usa isto é
-- a Edge Function, com a chave de serviço.
alter table public.robos_travas enable row level security;

-- ── 2. Tomar e soltar ───────────────────────────────────────────────────────
-- ⚠️ É UM COMANDO SÓ, e tem de ser. `select` seguido de `update` é a forma
-- clássica de duas rodadas passarem pelo `select` juntas e as duas acharem que
-- ganharam. Aqui quem arbitra é a chave primária: o `insert` é atômico, e o
-- `where` do `do update` só deixa passar quem chega com a trava JÁ VENCIDA.
-- Sem linha devolvida = outro está com ela.
create or replace function public.tomar_trava(p_robo text, p_segundos integer default 120)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ok boolean;
begin
  insert into public.robos_travas as t (robo, expira_em, tomada_em)
  values (p_robo, now() + make_interval(secs => p_segundos), now())
  on conflict (robo) do update
     set expira_em = excluded.expira_em,
         tomada_em = excluded.tomada_em
   where t.expira_em <= now()
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$function$;

create or replace function public.soltar_trava(p_robo text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.robos_travas set expira_em = now() where robo = p_robo;
$function$;

-- Nenhuma das duas é para o navegador. Só a chave de serviço, que é quem a Edge
-- Function usa.
revoke execute on function public.tomar_trava(text, integer)  from public, anon, authenticated;
revoke execute on function public.soltar_trava(text)          from public, anon, authenticated;
grant  execute on function public.tomar_trava(text, integer)  to service_role;
grant  execute on function public.soltar_trava(text)          to service_role;

-- ── 3. O gatilho perde o freio ──────────────────────────────────────────────
-- Agora TODO cadastro dispara o robô na hora. Quem impede a colisão é a trava,
-- lá dentro da função — e a rodada que não pegar a trava sai na hora, sem fazer
-- nada, porque quem está com ela vai ler a lista inteira e cobrir a linha nova.
create or replace function public.vessel_espelhar_agora()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.disparar_robo(
    'vessel-espelhar-lista', 'vessel-espelhar-lista', 'vessel-espelhar-lista',
    '{"origem":"gatilho"}'::jsonb, 120000);
  return null;
end;
$function$;

-- ── 4. O vigia ──────────────────────────────────────────────────────────────
-- ⚠️ "CERTEZA ABSOLUTA" NÃO É PROMESSA, É MEDIDA. O robô é auto-curativo (ele
-- COMPARA o que existe com o que deveria existir, em vez de trabalhar por fila),
-- então uma rodada perdida é refeita na seguinte. Mas "deveria se curar" não é
-- prova. Esta função responde, a qualquer momento, quem está parado — e é ela
-- que a Saúde dos Robôs pode ler.
create or replace function public.vessel_lista_atrasados(p_minutos integer default 10)
returns json
language sql
security definer
set search_path to 'public'
as $function$
  select json_build_object(
    'minutos', p_minutos,
    'sem_bling',    (select count(*) from public.vessel_lista_espera
                      where bling_em is null and criado_em < now() - make_interval(mins => p_minutos)),
    'sem_planilha', (select count(*) from public.vessel_lista_espera
                      where planilha_em is null and criado_em < now() - make_interval(mins => p_minutos)),
    'quem',         coalesce((select json_agg(json_build_object(
                        'id', id,
                        'cadastrou', criado_em,
                        'falta', case when bling_em is null and planilha_em is null then 'bling e planilha'
                                      when bling_em is null then 'bling'
                                      else 'planilha' end))
                      from public.vessel_lista_espera
                      where (bling_em is null or planilha_em is null)
                        and criado_em < now() - make_interval(mins => p_minutos)), '[]'::json));
$function$;

revoke execute on function public.vessel_lista_atrasados(integer) from public, anon;
grant  execute on function public.vessel_lista_atrasados(integer) to authenticated, service_role;
