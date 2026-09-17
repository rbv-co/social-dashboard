-- A PORTA DAS BEAUTY SESSIONS (T05 do Growth Plan)
--
-- A cliente vê a coleção num salão parceiro, aponta o celular para um QR e cai
-- numa página de 30 segundos: nome, WhatsApp e o que ela quer como próximo
-- passo. Nada mais — o módulo 03 é explícito: "modelo/cor são preenchidos pela
-- consultora ou opcionais, não mais uma obrigação da cliente".
--
-- ⚠️ E NADA DE SALÃO. O plano proíbe, com todas as letras, coletar "serviço de
-- salão, procedimento clínico ou dados de saúde". Esta função não tem onde
-- guardar isso nem se alguém mandar.
--
-- ⚠️ POR QUE UMA PORTA PRÓPRIA, E NÃO UM PARÂMETRO A MAIS NA IRMÃ. Acrescentar
-- um parâmetro a `vessel_solicitar_atendimento` criaria uma SEGUNDA função com
-- o mesmo nome (o Postgres não troca a assinatura no lugar), e o PostgREST
-- passaria a ter duas candidatas para o mesmo pedido — erro de "não sei
-- escolher" na cara de quem está enviando. Trocar a assinatura à força deixaria
-- a LP que já está no ar chamando uma função que sumiu.
--
-- ⚠️ MAS A REGRA NÃO É COPIADA: as duas portas chamam o MESMO miolo
-- (`vessel_anotar_interesse`). Duas receitas para a mesma coisa é uma delas
-- envelhecendo em silêncio.

-- ── AS SESSÕES, COMO DADO ──────────────────────────────────────────────────
-- ⚠️ UMA LINHA POR QR IMPRESSO. Os códigos vêm do módulo 10 do plano
-- (BS-AAAAMMDD-PRACA-SEQ) e são a única lista que vale: `evento_id` que não
-- estiver aqui é RECUSADO. Sem essa lista, qualquer um escreveria um nome de
-- evento no endereço e ele apareceria no painel de atribuição como se fosse
-- uma sessão de verdade.
--
-- ⚠️ E É TABELA, NÃO CÓDIGO: sessão nova é um INSERT, não uma migration de
-- emergência na véspera do evento.
create table if not exists public.vessel_beauty_sessions (
  codigo     text primary key,          -- BS-20260925-CPS-01
  quando     date,
  praca      text,                      -- CPS | SBO | BSB | SAO
  loja       text not null,             -- para qual loja o interesse vai
  parceiro   text,                      -- o nome do salão/espaço
  ativa      boolean not null default true,
  criado_em  timestamptz not null default now()
);

alter table public.vessel_beauty_sessions enable row level security;

comment on table public.vessel_beauty_sessions is
  'Uma linha por QR impresso de Beauty Session. RLS ligada e SEM politica: so as '
  'funcoes security definer leem. O `parceiro` entra quando o nome for '
  'confirmado — a pagina mostra o nome quando ele existir, e so o rotulo quando nao.';

-- As três do plano (módulo 03). ⚠️ O NOME DO PARCEIRO FICA NULO ATÉ ALGUÉM
-- CONFIRMAR: escrever um palpite aqui colocaria um nome errado impresso num QR
-- que vai para a mão da cliente.
insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro)
values ('BS-20260925-CPS-01', '2026-09-25', 'CPS', 'iguatemi', null),
       ('BS-20260926-CPS-02', '2026-09-26', 'CPS', 'iguatemi', null),
       ('BS-20261016-CPS-AME', '2026-10-16', 'CPS', 'iguatemi', null)
on conflict (codigo) do nothing;

-- O que ela quer como próximo passo (LP03).
alter table public.vessel_atendimentos
  add column if not exists interesse text;

comment on column public.vessel_atendimentos.interesse is
  'Beauty Session: o proximo passo que ela pediu — conhecer-a-loja | rever-uma-peca | personal-atelier.';

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
  p_teste            boolean default false
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
begin
  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp);
  update public.vessel_pessoas set teste = p_teste where id = v_pessoa;

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
  text, text, text, text, text, text, text, text, text, boolean, text, jsonb, boolean)
  from public, anon, authenticated;

/** A LP Private Appointment, agora chamando o miolo em vez de repetir a regra. */
create or replace function public.vessel_solicitar_atendimento(
  p_nome             text,
  p_whatsapp         text,
  p_loja             text,
  p_momento          text default null,
  p_periodo          text default null,
  p_recado           text default null,
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
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;
  if coalesce(trim(p_nome), '') = ''
     or public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Confira seu nome e o WhatsApp com DDD.');
  end if;
  if p_loja is null or p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida', 'erro', 'Escolha a loja.');
  end if;
  if nullif(trim(coalesce(p_momento, '')), '') is not null
     and p_momento not in ('dia-a-dia', 'trabalho', 'ocasiao', 'personalizacao', 'conhecer') then
    return json_build_object('ok', false, 'situacao', 'momento_invalido');
  end if;
  if nullif(trim(coalesce(p_periodo, '')), '') is not null
     and p_periodo not in ('manha', 'tarde', 'noite', 'qualquer') then
    return json_build_object('ok', false, 'situacao', 'periodo_invalido');
  end if;
  if length(trim(coalesce(p_recado, ''))) > 300 then
    return json_build_object('ok', false, 'situacao', 'recado_longo',
      'erro', 'Seu recado ficou longo demais. Resuma em ate 300 letras.');
  end if;

  select count(*) into v_recentes from public.vessel_atendimentos
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  if v_recentes >= 20 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  perform public.vessel_anotar_interesse(
    p_nome, p_whatsapp, p_loja, 'lp-private-appointment', v_ip,
    p_momento, p_periodo, null, p_recado, p_aceite_marketing, p_aceite_versao,
    p_origem, p_teste);

  return json_build_object('ok', true, 'situacao', 'solicitado');
end;
$function$;

/**
 * A BEAUTY SESSION. Trinta segundos: nome, WhatsApp e o próximo passo.
 *
 * ⚠️ A LOJA VEM DA PRAÇA DO EVENTO, não de um menu. Quem está no salão acabou
 * de ver a coleção ali; perguntar "qual loja?" para alguém que nem sabe que há
 * mais de uma é transformar 30 segundos em desistência.
 *
 * ⚠️ E O EVENTO É CONFERIDO CONTRA A LISTA. Um `evento_id` inventado no
 * endereço não vira evento novo: ele é recusado. Sem isso, qualquer um
 * escreveria um nome de evento na URL e ele apareceria no painel de atribuição
 * como se fosse uma sessão de verdade.
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

  select loja into v_loja from public.vessel_beauty_sessions
   where codigo = upper(trim(coalesce(p_evento, '')));
  if v_loja is null then
    return json_build_object('ok', false, 'situacao', 'evento_desconhecido',
      'erro', 'Nao reconhecemos este QR. Fale com a nossa equipe.');
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
  -- É o "event_id fixado no servidor" do módulo 10: a URL diz QUAL QR foi lido,
  -- e o servidor decide o que isso significa. Sem isso, um endereço montado à
  -- mão escreveria o canal que quisesse na atribuição de receita.
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
