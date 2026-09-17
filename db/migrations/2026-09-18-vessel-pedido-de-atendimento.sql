-- A PORTA DA LP PRIVATE APPOINTMENT (T03 do Growth Plan)
--
-- A página pergunta o mínimo — nome, WhatsApp, loja, para que momento procura
-- uma bolsa, que período prefere e um recado livre — e ESTA função transforma
-- isso em três coisas que já existem no banco: a pessoa, a origem dela e um
-- atendimento SOLICITADO.
--
-- ⚠️ SOLICITADO, NUNCA CONFIRMADO. É o teste de aceite QA09 do plano, e a frase
-- do módulo 16: "pedido de horário não é horário reservado". A própria página
-- diz isso à cliente ("o envio deste formulário ainda não confirma a reserva").
-- Entrar como confirmado encheria a taxa de comparecimento de gente que nunca
-- teve horário — e travaria a agenda com pedidos que ninguém aceitou.
--
-- ⚠️ E POR ISSO ELE NÃO PASSA PELA TRAVA DE HORÁRIO. Um pedido não reserva
-- nada; quem reserva é a Client Advisor, no gerador de cartão, e lá a trava
-- existe (2026-09-17-vessel-um-horario-uma-visita.sql). Note que `solicitado`
-- ENTRA na conta de conflito daquela trava: assim que a loja aceitar o pedido,
-- o horário passa a valer.

-- ── O que a cliente contou ─────────────────────────────────────────────────
alter table public.vessel_atendimentos
  add column if not exists momento_de_uso    text,
  add column if not exists periodo_preferido text,
  add column if not exists recado            text;

comment on column public.vessel_atendimentos.momento_de_uso is
  'Para que momento ela procura uma bolsa (LP01): dia-a-dia | trabalho | '
  'ocasiao | personalizacao | conhecer.';
comment on column public.vessel_atendimentos.periodo_preferido is
  'Periodo que ela prefere: manha | tarde | noite | qualquer. NAO e horario '
  'reservado — a LP nao marca hora, so recolhe preferencia.';

-- ── As permissões, separadas por finalidade ────────────────────────────────
-- ⚠️ SEPARADAS, E ISSO É EXIGÊNCIA DO PLANO, não organização: "permissão de
-- atendimento, marketing e imagem são separadas" (módulo 10). Quem pede uma
-- visita autorizou a VISITA; não autorizou propaganda. Guardar as duas na
-- mesma marca é o que transforma um pedido de atendimento em lista de
-- disparo — e é o teste QA05: recusar marketing NÃO pode bloquear o
-- atendimento.
create table if not exists public.vessel_consentimentos (
  id          bigserial primary key,
  pessoa_id   bigint not null references public.vessel_pessoas(id) on delete cascade,
  finalidade  text not null,              -- atendimento | marketing | imagem
  canal       text,                       -- whatsapp | email
  versao      text,                       -- a versão do texto que ela leu
  fonte       text,                       -- de qual página veio
  situacao    text not null default 'ativo',   -- ativo | revogado
  momento     timestamptz not null default now(),
  revogado_em timestamptz,
  teste       boolean not null default false
);

create index if not exists vessel_consentimentos_pessoa_idx
  on public.vessel_consentimentos (pessoa_id, finalidade, momento desc);

alter table public.vessel_consentimentos enable row level security;

comment on table public.vessel_consentimentos is
  'Quem autorizou o que, quando, por qual canal e lendo qual versao do texto. '
  'SO ACRESCENTA: revogar e uma linha nova (ou situacao revogado), nunca apagar '
  'a anterior — sem o historico nao da para provar o que foi autorizado no dia. '
  'RLS ligada e SEM politica.';

/**
 * O PEDIDO DE ATENDIMENTO DA LP.
 *
 * Testes de aceite do módulo 10 cobertos aqui: QA01 (cria uma pessoa e uma
 * oportunidade), QA02 (duplo clique não duplica), QA03 (pessoa que volta
 * preserva a origem inicial), QA05 (recusar marketing não bloqueia o
 * atendimento), QA08 (falha vira erro tratado, nunca sucesso falso) e QA09
 * (solicitado não entra como confirmado).
 */
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
  v_pessoa   bigint;
  v_ja       bigint;
  v_id       bigint;
  v_recado   text := nullif(trim(coalesce(p_recado, '')), '');
begin
  -- A ARMADILHA CONTINUA MUDA: robô que soubesse que caiu nela tentaria de
  -- outro jeito. Ele sai achando que deu certo.
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  if coalesce(trim(p_nome), '') = ''
     or public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Confira seu nome e o WhatsApp com DDD.');
  end if;
  if p_loja is null or p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida',
      'erro', 'Escolha a loja.');
  end if;
  -- Vazio passa (não respondeu); valor fora da lista é recusado. Responder é
  -- opcional; inventar não é.
  if nullif(trim(coalesce(p_momento, '')), '') is not null
     and p_momento not in ('dia-a-dia', 'trabalho', 'ocasiao', 'personalizacao', 'conhecer') then
    return json_build_object('ok', false, 'situacao', 'momento_invalido');
  end if;
  if nullif(trim(coalesce(p_periodo, '')), '') is not null
     and p_periodo not in ('manha', 'tarde', 'noite', 'qualquer') then
    return json_build_object('ok', false, 'situacao', 'periodo_invalido');
  end if;
  if length(v_recado) > 300 then
    return json_build_object('ok', false, 'situacao', 'recado_longo',
      'erro', 'Seu recado ficou longo demais. Resuma em ate 300 letras.');
  end if;

  -- Teto por IP, mudo como na lista de espera: quem apanha não pode saber.
  select count(*) into v_recentes from public.vessel_atendimentos
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  if v_recentes >= 20 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp);
  update public.vessel_pessoas set teste = p_teste where id = v_pessoa;

  -- ⚠️ QA03: A ORIGEM SÓ ACRESCENTA, NUNCA ATUALIZA. A primeira linha é o
  -- first touch e não pode ser sobrescrita quando a pessoa volta — está escrito
  -- na própria tabela, e o módulo 10 repete: "não sobrescrever o first_touch".
  if p_origem is not null then
    insert into public.vessel_origens
      (pessoa_id, canal, campanha_id, evento_id, parceiro_id, stylist_id, criativo_id,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       clique_meta, navegador_meta)
    values (v_pessoa,
      coalesce(nullif(trim(p_origem ->> 'canal'), ''), 'lp-private-appointment'),
      nullif(trim(p_origem ->> 'campanha_id'), ''), nullif(trim(p_origem ->> 'evento_id'), ''),
      nullif(trim(p_origem ->> 'parceiro_id'), ''), nullif(trim(p_origem ->> 'stylist_id'), ''),
      nullif(trim(p_origem ->> 'criativo_id'), ''),
      nullif(trim(p_origem ->> 'utm_source'), ''), nullif(trim(p_origem ->> 'utm_medium'), ''),
      nullif(trim(p_origem ->> 'utm_campaign'), ''), nullif(trim(p_origem ->> 'utm_content'), ''),
      nullif(trim(p_origem ->> 'utm_term'), ''),
      nullif(trim(p_origem ->> 'clique_meta'), ''), nullif(trim(p_origem ->> 'navegador_meta'), ''));
  end if;

  -- ⚠️ QA02: DUPLO CLIQUE NÃO DUPLICA. Mesmo pessoa, mesma loja, ainda
  -- `solicitado` e feito há menos de meia hora = é o mesmo pedido chegando de
  -- novo. Devolve o que já existe em vez de criar um segundo.
  select id into v_ja from public.vessel_atendimentos
   where pessoa_id = v_pessoa and loja = p_loja and status = 'solicitado'
     and criado_em > now() - interval '30 minutes'
   order by id desc limit 1;

  if v_ja is not null then
    v_id := v_ja;
    -- O que ela contou AGORA vale: talvez tenha corrigido no segundo envio.
    update public.vessel_atendimentos
       set momento_de_uso = coalesce(nullif(trim(coalesce(p_momento, '')), ''), momento_de_uso),
           periodo_preferido = coalesce(nullif(trim(coalesce(p_periodo, '')), ''), periodo_preferido),
           recado = coalesce(v_recado, recado),
           atualizado_em = now()
     where id = v_id;
  else
    insert into public.vessel_atendimentos
      (pessoa_id, loja, quando, status, origem_registro, ip_hash, teste,
       momento_de_uso, periodo_preferido, recado)
    values (v_pessoa, p_loja, null, 'solicitado', 'lp-private-appointment', v_ip, p_teste,
            nullif(trim(coalesce(p_momento, '')), ''),
            nullif(trim(coalesce(p_periodo, '')), ''), v_recado)
    returning id into v_id;
  end if;

  -- ── As permissões ────────────────────────────────────────────────────────
  -- ⚠️ QA05: A DE ATENDIMENTO É SEMPRE GRAVADA, a de marketing só se ela
  -- marcou. Recusar propaganda não pode tirar dela o direito de ser atendida.
  insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
  values (v_pessoa, 'atendimento', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
          'lp-private-appointment', p_teste);

  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_pessoa, 'marketing', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            'lp-private-appointment', p_teste);
  end if;

  return json_build_object('ok', true, 'situacao', 'solicitado');
end;
$function$;

-- ⚠️ `revoke ... from public` NAO fecha anon nem authenticated: os dois recebem
-- execute por privilegio PADRAO do schema, que e outra concessao.
revoke all on function public.vessel_solicitar_atendimento(
  text, text, text, text, text, text, boolean, text, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_solicitar_atendimento(
  text, text, text, text, text, text, boolean, text, jsonb, text, boolean) to anon;
