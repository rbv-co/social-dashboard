-- A PORTA DA LP PERSONAL ATELIER (T04 do Growth Plan)
--
-- A cliente diz o que gostou e como imagina a peça — modelo, tecido, ferragem —
-- e a equipe confirma o que é elegível e mostra os materiais. A página começa
-- uma conversa; ela NÃO fecha a encomenda.
--
-- ⚠️ POR ISSO O PEDIDO ENTRA COMO `solicitado`, igual aos outros: a configuração
-- só vale depois que a equipe confirma, e o plano é claro em que "depois de
-- aprovada a configuração, a composição fica bloqueada". Gravar aqui como se
-- estivesse fechado transformaria um interesse numa encomenda que ninguém
-- aprovou — e o plano manda cobrar 100% no momento da encomenda.

alter table public.vessel_atendimentos
  add column if not exists modelo_de_interesse text,
  add column if not exists atelier_tecido      text,
  add column if not exists atelier_ferragem    text;

comment on column public.vessel_atendimentos.atelier_tecido is
  'Personal Atelier: couro | canvas. Preferencia, nao encomenda fechada.';
comment on column public.vessel_atendimentos.atelier_ferragem is
  'Personal Atelier: ouro-9k | onix. Preferencia, nao encomenda fechada.';

/**
 * O PEDIDO DE PERSONAL ATELIER.
 *
 * ⚠️ ELA USA O MESMO MIOLO das outras duas portas (`vessel_anotar_interesse`) e
 * só ACRESCENTA o que é dela. Repetir aqui a criação de pessoa, origem e
 * permissões seria a terceira cópia da mesma regra — e a terceira a envelhecer
 * sozinha.
 */
create or replace function public.vessel_pedido_de_personal_atelier(
  p_nome             text,
  p_whatsapp         text,
  p_loja             text,
  p_modelo           text default null,
  p_tecido           text default null,
  p_ferragem         text default null,
  p_periodo          text default null,
  p_observacao       text default null,
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
  v_id       bigint;
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

  -- Vazio passa (ela ainda não viu os materiais); valor fora da lista é
  -- recusado. Responder é opcional; inventar não é.
  if nullif(trim(coalesce(p_modelo, '')), '') is not null
     and p_modelo not in ('alba', 'linear', 'cyrene', 'astrea', 'nao-sei') then
    return json_build_object('ok', false, 'situacao', 'modelo_invalido');
  end if;
  if nullif(trim(coalesce(p_tecido, '')), '') is not null
     and p_tecido not in ('couro', 'canvas') then
    return json_build_object('ok', false, 'situacao', 'tecido_invalido');
  end if;
  if nullif(trim(coalesce(p_ferragem, '')), '') is not null
     and p_ferragem not in ('ouro-9k', 'onix') then
    return json_build_object('ok', false, 'situacao', 'ferragem_invalida');
  end if;
  if nullif(trim(coalesce(p_periodo, '')), '') is not null
     and p_periodo not in ('manha', 'tarde', 'noite', 'qualquer') then
    return json_build_object('ok', false, 'situacao', 'periodo_invalido');
  end if;
  if length(trim(coalesce(p_observacao, ''))) > 300 then
    return json_build_object('ok', false, 'situacao', 'observacao_longa',
      'erro', 'Sua observacao ficou longa demais. Resuma em ate 300 letras.');
  end if;

  select count(*) into v_recentes from public.vessel_atendimentos
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  if v_recentes >= 20 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  v_id := public.vessel_anotar_interesse(
    p_nome, p_whatsapp, p_loja, 'lp-personal-atelier', v_ip,
    'personalizacao', p_periodo, 'personal-atelier', p_observacao,
    p_aceite_marketing, p_aceite_versao, p_origem, p_teste);

  -- O que é só desta porta.
  update public.vessel_atendimentos
     set modelo_de_interesse = coalesce(nullif(trim(coalesce(p_modelo, '')), ''), modelo_de_interesse),
         atelier_tecido      = coalesce(nullif(trim(coalesce(p_tecido, '')), ''), atelier_tecido),
         atelier_ferragem    = coalesce(nullif(trim(coalesce(p_ferragem, '')), ''), atelier_ferragem),
         atualizado_em = now()
   where id = v_id;

  return json_build_object('ok', true, 'situacao', 'solicitado');
end;
$function$;

-- ⚠️ `revoke ... from public` NAO fecha anon nem authenticated.
revoke all on function public.vessel_pedido_de_personal_atelier(
  text, text, text, text, text, text, text, text, boolean, text, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_pedido_de_personal_atelier(
  text, text, text, text, text, text, text, text, boolean, text, jsonb, text, boolean) to anon;
