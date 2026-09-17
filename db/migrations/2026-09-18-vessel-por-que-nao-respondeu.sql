-- POR QUE ELA NÃO RESPONDEU AS PREFERÊNCIAS
--
-- ⚠️ O QUE ACONTECEU, E POR QUE ISTO EXISTE. Em 17/09/2026, às 16:10, a
-- primeira cliente real passou pelo formulário de preferências da visita e saiu
-- sem responder. A linha dela registra a escolha ("quer visitar") e nada mais —
-- e o dado não distingue as quatro saídas possíveis:
--
--   · ela apertou "Prefiro combinar pelo WhatsApp";
--   · fechou no X;
--   · apertou Esc ou clicou no escuro em volta;
--   · saiu da página.
--
-- São quatro histórias diferentes. "Preferiu o WhatsApp" é uma escolha dela e
-- não é problema nenhum; "saiu da página" com o formulário aberto pode ser
-- cansaço, pode ser um campo que não abriu no celular dela. Sem saber qual,
-- qualquer conserto é chute — e chute em cima de UMA pessoa é o pior tipo.
--
-- Instrumentar custa uma coluna. Deduzir custa a próxima cliente.

alter table public.vessel_lista_espera
  add column if not exists objetivo_motivo text;

comment on column public.vessel_lista_espera.objetivo_motivo is
  'Quando a pessoa escolheu "visita" e NAO respondeu as preferencias, por qual '
  'saida ela foi: pulou | fechou | esc | fora | saiu-da-pagina. Nulo quando ela '
  'respondeu, ou quando o objetivo e ecommerce.';

/**
 * A MESMA SEGUNDA ESCRITA, agora anotando por onde ela saiu.
 *
 * ⚠️ NOME NOVO, E A ANTIGA VIRA UM ATALHO PARA ESTA. Acrescentar um parâmetro à
 * função existente criaria uma SEGUNDA função com o mesmo nome — e o PostgREST
 * passaria a ter duas candidatas para o mesmo pedido, respondendo "não sei
 * escolher" na cara de quem está enviando. Trocar a assinatura à força deixaria
 * a página que já está no ar chamando uma função que sumiu. Com um nome novo e
 * a antiga delegando, nada quebra em nenhum dos dois sentidos, e a regra
 * continua existindo em um lugar só.
 */
create or replace function public.vessel_marcar_objetivo_e_motivo(
  p_senha    text,
  p_objetivo text,
  p_motivo   text default null,
  p_loja     text default null
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text := encode(extensions.digest(coalesce(p_senha, ''), 'sha256'), 'hex');
  v_loja text;
  v_id   bigint;
begin
  if p_objetivo is null or p_objetivo not in ('visita', 'ecommerce') then
    return json_build_object('ok', false, 'situacao', 'objetivo_invalido');
  end if;

  v_loja := coalesce(nullif(trim(p_loja), ''), 'iguatemi');
  if p_objetivo = 'visita' and v_loja not in ('tivoli', 'iguatemi') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;

  -- Lista fechada na FUNÇÃO, não em CHECK: motivo novo é uma linha aqui, não
  -- uma transação derrubada.
  if nullif(trim(coalesce(p_motivo, '')), '') is not null
     and p_motivo not in ('pulou', 'fechou', 'esc', 'fora', 'saiu-da-pagina') then
    return json_build_object('ok', false, 'situacao', 'motivo_invalido');
  end if;

  update public.vessel_lista_espera
     set objetivo        = p_objetivo,
         loja            = case when p_objetivo = 'visita' then v_loja else null end,
         objetivo_motivo = nullif(trim(coalesce(p_motivo, '')), ''),
         senha_hash      = null,
         planilha_em     = null
   where senha_hash = v_hash
     and senha_em > now() - interval '2 hours'
  returning id into v_id;

  if v_id is null then
    return json_build_object('ok', false, 'situacao', 'senha_invalida');
  end if;
  return json_build_object('ok', true, 'situacao', 'registrado');
end;
$function$;

/**
 * A ANTIGA, agora um atalho para a nova.
 *
 * ⚠️ ELA CONTINUA EXISTINDO porque há navegador com a página velha aberta neste
 * momento — e uma aba aberta desde ontem chamando uma função que sumiu perde a
 * escolha de uma cliente sem ninguém ver.
 */
create or replace function public.vessel_marcar_objetivo(
  p_senha    text,
  p_objetivo text,
  p_loja     text default null
) returns json
language sql
security definer
set search_path to 'public'
as $function$
  select public.vessel_marcar_objetivo_e_motivo(p_senha, p_objetivo, null, p_loja);
$function$;

-- ⚠️ `revoke ... from public` NAO fecha anon nem authenticated.
revoke all on function public.vessel_marcar_objetivo_e_motivo(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.vessel_marcar_objetivo_e_motivo(text, text, text, text) to anon;
