-- O HORÁRIO DO PRIVATE APPOINTMENT MUDA: SEGUNDA A SEXTA, E A SEXTA FECHA CEDO
--
-- Dono, 17/09/2026: segunda a quinta das 11h às 20h; sexta das 11h às 17h.
-- Antes era segunda a quinta das 11h às 17h.
--
-- ⚠️ POR QUE A CONFERÊNCIA DEIXA DE SER UMA FAIXA SÓ. O mesmo horário passa a
-- ser certo num dia e errado no outro: 19h30 vale numa terça e não vale numa
-- sexta. Uma regra que perguntasse só "está entre 11h e 20h?" aceitaria a sexta
-- às 19h30 — e o "não" só apareceria na loja, com a cliente na porta.
--
-- Esta é a MESMA regra que `vessel-brasil/regras-da-visita.mjs` tem do lado da
-- página. A de lá é gentileza (avisa no idioma dela, sem viagem de rede); esta é
-- a trava — quem manda um POST na mão não passa pela tela. Mudar a política pede
-- as duas, sempre.

create or replace function public.vessel_detalhar_visita(
  p_senha         text,
  p_data          date,
  p_hora          text,
  p_bolsa         text    default null,
  p_ocasiao       text    default null,
  p_atelier       boolean default false,
  p_acompanhantes int     default null,
  p_pedido        text    default null,
  p_loja          text    default null
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash  text := encode(extensions.digest(coalesce(p_senha, ''), 'sha256'), 'hex');
  -- ⚠️ A DATA DA CASA, não a do servidor. O banco roda em UTC: depois das 21h
  -- de Brasília `current_date` já virou o dia seguinte, e uma visita marcada
  -- para amanhã seria recusada como "passada" — à noite, e só à noite.
  v_hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dia   int;
  v_loja  text;
  v_id    bigint;
begin
  if p_data is null then
    return json_build_object('ok', false, 'situacao', 'sem_data');
  end if;

  -- `isodow`: segunda = 1 … domingo = 7.
  v_dia := extract(isodow from p_data);
  if v_dia not between 1 and 5 then
    return json_build_object('ok', false, 'situacao', 'dia_fechado');
  end if;

  -- Nunca hoje nem ontem: a visita é PREPARADA antes (seleção de peças e
  -- Client Advisor dedicada), e preparar leva pelo menos um dia.
  if p_data <= v_hoje then
    return json_build_object('ok', false, 'situacao', 'data_passada');
  end if;
  if p_data > v_hoje + 120 then
    return json_build_object('ok', false, 'situacao', 'data_longe');
  end if;

  -- ⚠️ A JANELA DEPENDE DO DIA. Segunda a quinta: 11:00 … 20:00. Sexta: 11:00
  -- … 17:00. Sempre de meia em meia hora, pontas incluídas.
  if v_dia <= 4 then
    if coalesce(p_hora, '') !~ '^(1[1-9]:(00|30)|20:00)$' then
      return json_build_object('ok', false, 'situacao', 'hora_fora');
    end if;
  else
    if coalesce(p_hora, '') !~ '^(1[1-6]:(00|30)|17:00)$' then
      return json_build_object('ok', false, 'situacao', 'hora_fora');
    end if;
  end if;

  -- Vazio é "não respondeu" e passa; valor fora da lista é recusado. Responder
  -- é opcional; INVENTAR resposta não é.
  if nullif(trim(coalesce(p_bolsa, '')), '') is not null
     and p_bolsa not in ('hand-bag', 'shoulder-bag', 'east-west', 'toda-colecao') then
    return json_build_object('ok', false, 'situacao', 'bolsa_invalida');
  end if;
  if nullif(trim(coalesce(p_ocasiao, '')), '') is not null
     and p_ocasiao not in ('dia-a-dia', 'trabalho', 'viagem', 'noite', 'presente') then
    return json_build_object('ok', false, 'situacao', 'ocasiao_invalida');
  end if;
  if p_acompanhantes is not null and (p_acompanhantes < 0 or p_acompanhantes > 6) then
    return json_build_object('ok', false, 'situacao', 'acompanhantes_invalido');
  end if;
  if length(trim(coalesce(p_pedido, ''))) > 400 then
    return json_build_object('ok', false, 'situacao', 'pedido_longo');
  end if;

  v_loja := coalesce(nullif(trim(p_loja), ''), 'iguatemi');
  if v_loja not in ('tivoli', 'iguatemi') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;

  update public.vessel_lista_espera
     set objetivo             = 'visita',
         loja                 = v_loja,
         visita_data          = p_data,
         visita_hora          = p_hora,
         visita_bolsa         = nullif(trim(coalesce(p_bolsa, '')), ''),
         visita_ocasiao       = nullif(trim(coalesce(p_ocasiao, '')), ''),
         visita_atelier       = coalesce(p_atelier, false),
         visita_acompanhantes = p_acompanhantes,
         visita_pedido        = nullif(trim(coalesce(p_pedido, '')), ''),
         visita_detalhes_em   = now(),
         senha_hash           = null,
         planilha_em          = null
   where senha_hash = v_hash
     and senha_em > now() - interval '2 hours'
  returning id into v_id;

  if v_id is null then
    return json_build_object('ok', false, 'situacao', 'senha_invalida');
  end if;

  return json_build_object('ok', true, 'situacao', 'registrado');
end;
$function$;

-- `create or replace` preserva o revoke/grant da migration original
-- (2026-09-17-vessel-preferencias-da-visita.sql): mesma assinatura, nada a
-- refazer aqui.
