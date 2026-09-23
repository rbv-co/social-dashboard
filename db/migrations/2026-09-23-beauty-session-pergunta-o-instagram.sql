-- A BEAUTY SESSION PASSA A PERGUNTAR O INSTAGRAM (OPCIONAL).
--
-- Pedido do dono em 23/09/2026: "a lp que tem o formulario do beauty sessions,
-- adiciona um campo de instagram".
--
-- ⚠️ OPCIONAL, E A ESCOLHA FOI DO DONO, com o aviso na mesa. O comentário de
-- `problemasDoInteresse` diz, desde o desenho: "SÓ NOME E WHATSAPP SÃO
-- OBRIGATÓRIOS — são trinta segundos, num salão, com a pessoa em pé. Cada campo
-- a mais aqui é uma cliente a menos." Campo opcional não cobra nada de quem
-- está com pressa e ainda assim pega o perfil de quem quer dar.
--
-- ── ONDE O DADO MORA, E POR QUE NÃO É NA LISTA DE ESPERA ────────────────────
--
-- Esta porta NÃO escreve em `vessel_lista_espera` — ela escreve em
-- `vessel_pessoas` (a pessoa) e `vessel_atendimentos` (o que ela pediu), pelo
-- miolo `vessel_anotar_interesse`. O Instagram é da PESSOA, não do pedido: ela
-- pode voltar por outra porta amanhã e o perfil continua sendo o mesmo.
--
-- E ele nasce com a mesma forma do Instagram que já existe na casa, o do
-- Stylist Circle (`vessel_stylists.instagram`): texto livre até 120, guardado
-- com `nullif(trim(...), '')`. Duas formas para o mesmo dado é como um vira
-- '@fulano' e o outro 'instagram.com/fulano' e ninguém consegue cruzar.
--
-- ── ⚠️ POR QUE NÃO MEXI EM `vessel_pessoa_por_telefone` ─────────────────────
--
-- Seria o lugar "natural" (é ela que completa e-mail e cidade), mas ela é
-- chamada de DEZ lugares, com 2 e com 4 argumentos posicionais. Acrescentar um
-- parâmetro obriga a derrubar a assinatura antiga, e enquanto as duas
-- existissem TODA chamada de 2 argumentos ficaria ambígua — dez portas caindo
-- de uma vez por causa de um campo opcional.
--
-- O miolo grava direto, com a MESMA postura dela: valor novo preenche, vazio
-- não apaga o que já estava lá.
--
-- ── AS DUAS ASSINATURAS QUE MUDAM ───────────────────────────────────────────
--
-- ⚠️ `create or replace` COM LISTA DE PARÂMETROS DIFERENTE NÃO SUBSTITUI: cria
-- uma SEGUNDA função com o mesmo nome. As duas conviveriam, e a chamada de 13
-- argumentos passaria a ser ambígua. Por isso cada uma é derrubada antes.
--
-- O parâmetro novo entra NO FIM e com `default null`, então as quatro portas
-- que chamam o miolo por posição (Personal Atelier, o atelier de três modelos,
-- a LP de atendimento e a própria Beauty Session) continuam funcionando sem
-- mexer em nenhuma delas.
--
-- ⚠️ ISTO QUEBRA `coletor/aplicar-vessel-beauty-sessions.mjs`, que nomeia a
-- assinatura de 13 argumentos para revogar o grant. Aquele aplicador JÁ está
-- marcado como envelhecido no próprio cabeçalho (B11), e já tem trava que o
-- impede de rodar. Fica registrado aqui mais um motivo.

-- ── 1. a coluna ─────────────────────────────────────────────────────────────
alter table public.vessel_pessoas
  add column if not exists instagram text;

comment on column public.vessel_pessoas.instagram is
  'Perfil que ela mesma informou, texto livre ate 120 (@fulano ou o endereco). '
  'Opcional. Mesma forma de vessel_stylists.instagram. Nunca e apagado por um '
  'envio posterior que venha vazio.';

-- ── 2. o miolo compartilhado ────────────────────────────────────────────────
drop function if exists public.vessel_anotar_interesse(
  text, text, text, text, text, text, text, text, text, boolean, text, jsonb, boolean);

/**
 * O MIOLO COMPARTILHADO: pessoa + origem + atendimento solicitado + permissões.
 *
 * ⚠️ SEM GRANT NENHUM. Ela não é porta: é o que as portas usam por dentro.
 * Aberta, aceitaria `origem_registro` arbitrário — e daí qualquer um poderia
 * inventar um canal e sujar a atribuição da receita.
 */
create or replace function public.vessel_anotar_interesse(
  p_nome             text,
  p_whatsapp         text,
  p_loja             text,
  p_origem_registro  text,
  p_ip               text,
  p_momento          text default null,
  p_periodo          text default null,
  p_interesse        text default null,
  p_recado           text default null,
  p_aceite_marketing boolean default false,
  p_aceite_versao    text default null,
  p_origem           jsonb default null,
  p_teste            boolean default false,
  p_instagram        text default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pessoa bigint;
  v_ja     bigint;
  v_id     bigint;
  v_recado text := nullif(trim(coalesce(p_recado, '')), '');
  v_insta  text := nullif(trim(coalesce(p_instagram, '')), '');
begin
  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp);
  update public.vessel_pessoas set teste = p_teste where id = v_pessoa;

  -- ⚠️ O PERFIL NÃO É APAGADO POR UM ENVIO VAZIO. Ela volta pela LP de visita,
  -- que não pergunta Instagram, e o `null` de lá passaria por cima do que ela
  -- escreveu no salão. É a mesma postura de e-mail e cidade em
  -- `vessel_pessoa_por_telefone`: preenche o que falta, não apaga o que há.
  if v_insta is not null then
    update public.vessel_pessoas set instagram = v_insta where id = v_pessoa;
  end if;

  -- ⚠️ QA03: A ORIGEM SÓ ACRESCENTA, NUNCA ATUALIZA. A primeira linha é o
  -- first touch e não pode ser sobrescrita quando a pessoa volta — o módulo 10
  -- repete: "não sobrescrever o first_touch".
  if p_origem is not null then
    insert into public.vessel_origens
      (pessoa_id, canal, campanha_id, evento_id, parceiro_id, stylist_id, criativo_id,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       clique_meta, navegador_meta)
    values (v_pessoa,
      coalesce(nullif(trim(p_origem ->> 'canal'), ''), p_origem_registro),
      nullif(trim(p_origem ->> 'campanha_id'), ''), nullif(trim(p_origem ->> 'evento_id'), ''),
      nullif(trim(p_origem ->> 'parceiro_id'), ''), nullif(trim(p_origem ->> 'stylist_id'), ''),
      nullif(trim(p_origem ->> 'criativo_id'), ''),
      nullif(trim(p_origem ->> 'utm_source'), ''), nullif(trim(p_origem ->> 'utm_medium'), ''),
      nullif(trim(p_origem ->> 'utm_campaign'), ''), nullif(trim(p_origem ->> 'utm_content'), ''),
      nullif(trim(p_origem ->> 'utm_term'), ''),
      nullif(trim(p_origem ->> 'clique_meta'), ''), nullif(trim(p_origem ->> 'navegador_meta'), ''));
  end if;

  -- ⚠️ QA02: DUPLO CLIQUE NÃO DUPLICA. Mesma pessoa, mesma loja, ainda
  -- `solicitado` e feito há menos de meia hora = é o mesmo pedido chegando de
  -- novo.
  select id into v_ja from public.vessel_atendimentos
   where pessoa_id = v_pessoa and loja = p_loja and status = 'solicitado'
     and criado_em > now() - interval '30 minutes'
   order by id desc limit 1;

  if v_ja is not null then
    v_id := v_ja;
    update public.vessel_atendimentos
       set momento_de_uso = coalesce(nullif(trim(coalesce(p_momento, '')), ''), momento_de_uso),
           periodo_preferido = coalesce(nullif(trim(coalesce(p_periodo, '')), ''), periodo_preferido),
           interesse = coalesce(nullif(trim(coalesce(p_interesse, '')), ''), interesse),
           recado = coalesce(v_recado, recado),
           atualizado_em = now()
     where id = v_id;
  else
    insert into public.vessel_atendimentos
      (pessoa_id, loja, quando, status, origem_registro, ip_hash, teste,
       momento_de_uso, periodo_preferido, interesse, recado)
    values (v_pessoa, p_loja, null, 'solicitado', p_origem_registro, p_ip, p_teste,
            nullif(trim(coalesce(p_momento, '')), ''),
            nullif(trim(coalesce(p_periodo, '')), ''),
            nullif(trim(coalesce(p_interesse, '')), ''), v_recado)
    returning id into v_id;
  end if;

  -- ⚠️ QA05: A PERMISSÃO DE ATENDIMENTO É SEMPRE GRAVADA; a de marketing só se
  -- ela marcou. Recusar propaganda não pode tirar dela o direito de ser
  -- atendida.
  insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
  values (v_pessoa, 'atendimento', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
          p_origem_registro, p_teste);

  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_pessoa, 'marketing', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            p_origem_registro, p_teste);
  end if;

  return v_id;
end;
$function$;

revoke all on function public.vessel_anotar_interesse(
  text, text, text, text, text, text, text, text, text, boolean, text, jsonb, boolean, text)
  from public, anon, authenticated;

-- ── 3. a porta da Beauty Session ────────────────────────────────────────────
drop function if exists public.vessel_interesse_da_beauty_session(
  text, text, text, text, boolean, text, jsonb, text, boolean);

create or replace function public.vessel_interesse_da_beauty_session(
  p_nome             text,
  p_whatsapp         text,
  p_evento           text,
  p_interesse        text default null,
  p_aceite_marketing boolean default false,
  p_aceite_versao    text default null,
  p_origem           jsonb default null,
  p_armadilha        text default null,
  p_teste            boolean default false,
  p_instagram        text default null
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

  -- ⚠️ O TETO É O MESMO DO STYLIST CIRCLE (120). Duas portas que guardam o
  -- mesmo dado com limites diferentes é como um perfil entra inteiro por uma e
  -- cortado pela outra.
  if length(trim(coalesce(p_instagram, ''))) > 120 then
    return json_build_object('ok', false, 'situacao', 'instagram_longo',
      'erro', 'Seu perfil ficou longo demais. Use so o @ ou o endereco.');
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
    v_origem, p_teste, p_instagram);

  return json_build_object('ok', true, 'situacao', 'recebido');
end;
$function$;

revoke all on function public.vessel_interesse_da_beauty_session(
  text, text, text, text, boolean, text, jsonb, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.vessel_interesse_da_beauty_session(
  text, text, text, text, boolean, text, jsonb, text, boolean, text) to anon;

comment on function public.vessel_interesse_da_beauty_session(
  text, text, text, text, boolean, text, jsonb, text, boolean, text) is
  'A porta da LP da Beauty Session. Desde 23/09/2026 aceita o Instagram, '
  'OPCIONAL e ate 120 caracteres, guardado em vessel_pessoas.instagram.';
