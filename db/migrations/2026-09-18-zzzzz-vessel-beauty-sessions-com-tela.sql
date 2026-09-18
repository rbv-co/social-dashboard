-- A BEAUTY SESSION GANHA TELA — criar, encerrar, e o encerrar passa a valer
--
-- Em 18/09/2026 o dono disse que sentia "perda de controle" nas gerações de
-- link, cartão e QR. O levantamento deu razão a ele: de cinco famílias de
-- endereço público, TRÊS nascem à mão, por migration, sem tela nenhuma — e a
-- Beauty Session é uma delas. Criar uma sessão nova dependia de alguém escrever
-- SQL, o que quer dizer que dependia de alguém estar disponível.
--
-- ⚠️ E `ativa` ERA DECORATIVA. A coluna existia desde a primeira migration, mas
-- `vessel_interesse_da_beauty_session` nunca a consultou: marcar uma sessão como
-- encerrada não encerrava coisa nenhuma, e o QR de uma sessão de meses atrás
-- continuaria colhendo contato para sempre. Aqui ela passa a valer.

-- ── 1. criar uma sessão ────────────────────────────────────────────────────
/**
 * ⚠️ A DATA DO CÓDIGO TEM DE BATER COM A DATA DA SESSÃO.
 *
 * O código carrega a data (`BS-20260925-...`) e é dele que sai a campanha
 * (`utm_campaign=bs_20260925_cps_01`). Se o código disser 25/09 e a sessão for
 * marcada para 26/09, os dois números vivem lado a lado no painel dizendo
 * coisas diferentes, e ninguém descobre até a conta não fechar — que é
 * exatamente o defeito que a lista escrita à mão produzia.
 *
 * ⚠️ E O CÓDIGO NÃO SE REAPROVEITA. Recriar um código que já existiu misturaria
 * a leitura de dois eventos diferentes na mesma linha do painel. O erro volta
 * dito em português, porque quem vai ler é a operação, não o programador.
 */
create or replace function public.vessel_beauty_session_criar(
  p_codigo   text,
  p_quando   date,
  p_praca    text,
  p_loja     text,
  p_parceiro text default null
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_praca  text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_data   text;
begin
  -- A permissão mora AQUI DENTRO, não no grant: `security definer` roda como
  -- dono, e `authenticated` é todo mundo que fez login na Central.
  if not public.is_vessel_atendimentos() then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para criar uma sessão.');
  end if;

  if v_codigo is null or v_codigo !~ '^BS-\d{8}-[A-Z]{3}-[A-Z0-9]{1,4}$' then
    return json_build_object('ok', false, 'erro',
      'O código precisa ter o formato BS-AAAAMMDD-PRACA-NUMERO, como BS-20260925-CPS-01.');
  end if;
  if p_quando is null then
    return json_build_object('ok', false, 'erro', 'Escolha a data da sessão.');
  end if;

  -- a data escrita DENTRO do código, contra a data da sessão
  v_data := substring(v_codigo from 4 for 8);
  if v_data <> to_char(p_quando, 'YYYYMMDD') then
    return json_build_object('ok', false, 'erro',
      'A data do código (' || v_data || ') não é a data da sessão ('
      || to_char(p_quando, 'YYYYMMDD') || '). Uma das duas está errada.');
  end if;

  if v_praca is null or v_praca !~ '^[A-Z]{3}$' then
    return json_build_object('ok', false, 'erro', 'A praça tem três letras, como CPS.');
  end if;
  if substring(v_codigo from 13 for 3) <> v_praca then
    return json_build_object('ok', false, 'erro',
      'A praça do código não é a praça escolhida.');
  end if;
  if p_loja is null or p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'erro', 'Escolha a loja.');
  end if;

  if exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'erro',
      'Já existe uma sessão com este código. Código não se reaproveita: a leitura '
      || 'de dois eventos diferentes cairia na mesma linha do painel.');
  end if;

  insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro, ativa)
  values (v_codigo, p_quando, v_praca,
          p_loja, nullif(trim(coalesce(p_parceiro, '')), ''), true);

  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$function$;

revoke all on function public.vessel_beauty_session_criar(text, date, text, text, text)
  from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_criar(text, date, text, text, text)
  to authenticated;

-- ── 2. encerrar (e reabrir) ────────────────────────────────────────────────
/**
 * ⚠️ ENCERRAR NÃO APAGA. A sessão continua no painel com os números que ela
 * trouxe — apagar a linha esconderia o resultado junto com o evento. O que
 * muda é que o QR dela para de aceitar contato novo.
 */
create or replace function public.vessel_beauty_session_encerrar(
  p_codigo text,
  p_ativa  boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.is_vessel_atendimentos() then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para mexer nas sessões.');
  end if;
  update public.vessel_beauty_sessions
     set ativa = coalesce(p_ativa, false)
   where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'erro', 'Não achei esta sessão.');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo, 'ativa', coalesce(p_ativa, false));
end;
$function$;

revoke all on function public.vessel_beauty_session_encerrar(text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_encerrar(text, boolean) to authenticated;

-- ── 3. `ativa` PASSA A VALER ───────────────────────────────────────────────
/**
 * ⚠️ ATÉ AQUI A COLUNA NÃO FAZIA NADA. Marcar a sessão como encerrada não
 * impedia envio nenhum: o QR de um evento de três meses atrás seguiria colhendo
 * nome e WhatsApp, e a pessoa entraria no painel com a etiqueta de uma sessão
 * que não estava mais acontecendo.
 *
 * ⚠️ A RECUSA É GENTIL E NÃO ACUSA A CLIENTE. Ela não tem como saber que o QR
 * venceu — muitas vezes está com um cartão antigo na mão. A frase manda falar
 * com a equipe, que é o caminho que resolve, em vez de dizer que o código é
 * inválido.
 *
 * O resto da função é o que já estava no ar (a migration das Beauty Sessions),
 * e foi mantido linha por linha.
 */
create or replace function public.vessel_interesse_da_beauty_session(
  p_nome             text,
  p_whatsapp         text,
  p_evento           text,
  p_interesse        text default null,
  p_aceite_marketing boolean default false,
  p_aceite_versao    text default null,
  p_origem           jsonb default null,
  p_armadilha        text default null,
  p_teste            boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_recentes int;
  v_loja     text;
  v_ativa    boolean;
  v_origem   jsonb;
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;
  if coalesce(trim(p_nome), '') = ''
     or public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Confira seu nome e o WhatsApp com DDD.');
  end if;

  select loja, ativa into v_loja, v_ativa from public.vessel_beauty_sessions
   where codigo = upper(trim(coalesce(p_evento, '')));
  if v_loja is null then
    return json_build_object('ok', false, 'situacao', 'evento_desconhecido',
      'erro', 'Nao reconhecemos este QR. Fale com a nossa equipe.');
  end if;
  if not coalesce(v_ativa, false) then
    return json_build_object('ok', false, 'situacao', 'evento_encerrado',
      'erro', 'Esta sessao ja foi encerrada. Fale com a nossa equipe que a gente '
           || 'te atende do mesmo jeito.');
  end if;

  if nullif(trim(coalesce(p_interesse, '')), '') is not null
     and p_interesse not in ('conhecer-a-loja', 'rever-uma-peca', 'personal-atelier') then
    return json_build_object('ok', false, 'situacao', 'interesse_invalido');
  end if;

  select count(*) into v_recentes from public.vessel_atendimentos
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  if v_recentes >= 20 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  -- ⚠️ O EVENTO E O CANAL SÃO CRAVADOS AQUI, por cima do que veio do endereço.
  v_origem := coalesce(p_origem, '{}'::jsonb)
    || jsonb_build_object('canal', 'beauty_session',
                          'evento_id', upper(trim(p_evento)));

  perform public.vessel_anotar_interesse(
    p_nome, p_whatsapp, v_loja, 'beauty-session', v_ip,
    null, null, p_interesse, null, p_aceite_marketing, p_aceite_versao,
    v_origem, p_teste);

  return json_build_object('ok', true, 'situacao', 'recebido');
end;
$function$;

revoke all on function public.vessel_interesse_da_beauty_session(
  text, text, text, text, boolean, text, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_interesse_da_beauty_session(
  text, text, text, text, boolean, text, jsonb, text, boolean) to anon;

-- ── 4. e o cartão também respeita o encerramento ───────────────────────────
/**
 * A outra porta da mesma sessão: o QR do cartão leva para a LP de visita, e lá
 * quem confere o evento é `vessel_sessao_do_codigo`. Encerrar a sessão passa a
 * tirar a ETIQUETA (o pedido da cliente continua valendo, ela não perde nada —
 * só deixa de contar para um evento que acabou).
 */
create or replace function public.vessel_sessao_do_codigo(p_codigo text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.codigo from public.vessel_beauty_sessions s
   where s.codigo = upper(nullif(trim(coalesce(p_codigo, '')), ''))
     and coalesce(s.ativa, false)
   limit 1;
$function$;

revoke all on function public.vessel_sessao_do_codigo(text) from public, anon, authenticated;

comment on function public.vessel_beauty_session_criar(text, date, text, text, text) is
  'Cria uma Beauty Session pela tela da Central. Confere que a DATA e a PRACA '
  'escritas dentro do codigo batem com as escolhidas — o codigo vira utm_campaign, '
  'e divergencia ali e defeito que so aparece quando a conta nao fecha.';
