-- O PERSONAL ATELIER PERSONALIZA TRÊS MODELOS: NEREA, CYRÈNE E ASTREA
--
-- Dono, 17/09/2026. A primeira versão aceitava a coleção inteira e deixava "a
-- equipe confirma o modelo elegível" resolver na conversa — o que é o mesmo que
-- deixar a cliente escolher uma peça que não existe no Personal Atelier e
-- descobrir isso depois.
--
-- ⚠️ A LISTA VIVE EM DOIS LUGARES, e isso é de propósito: aqui e em
-- `vessel-brasil/regras-do-personal-atelier.mjs`. A da página é gentileza (ela
-- nem oferece o que não serve); esta é a TRAVA — quem manda um POST na mão não
-- passa pela tela. Acrescentar um modelo pede as duas.
--
-- Só a lista muda; o resto do corpo é o de produção, intocado.
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

  -- ⚠️ OS TRÊS ELEGÍVEIS, e só eles.
  if nullif(trim(coalesce(p_modelo, '')), '') is not null
     and p_modelo not in ('nerea', 'cyrene', 'astrea', 'nao-sei') then
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

  update public.vessel_atendimentos
     set modelo_de_interesse = coalesce(nullif(trim(coalesce(p_modelo, '')), ''), modelo_de_interesse),
         atelier_tecido      = coalesce(nullif(trim(coalesce(p_tecido, '')), ''), atelier_tecido),
         atelier_ferragem    = coalesce(nullif(trim(coalesce(p_ferragem, '')), ''), atelier_ferragem),
         atualizado_em = now()
   where id = v_id;

  return json_build_object('ok', true, 'situacao', 'solicitado');
end;
$function$;

-- `create or replace` preserva o revoke/grant da migration original
-- (2026-09-18-vessel-personal-atelier.sql): mesma assinatura, nada a refazer.
