-- A VAGA DE CONSULTOR DE VENDAS DA LOJA DE BRASÍLIA (07/10/2026).
--
-- A página `vesselbrasil.com.br/vaga-brasilia` grava em `vessel_candidaturas`
-- com a vaga `consultor-brasilia`. Esta migração só ABRE a vaga nova: não mexe
-- na tabela, no bucket nem nos dados do Tivoli.
--
-- ⚠️ DUAS LISTAS FECHADAS, E AS DUAS PRECISAM TER A VAGA (a migração original
-- avisa: "Vaga nova entra aqui E na política da pasta"):
--   1. a política da pasta `vessel-curriculos` (onde o currículo é gravado);
--   2. a função `vessel_candidatar_vaga` (onde a candidatura é gravada).
-- Só uma das duas, e TODA candidatura de Brasília volta "vaga desconhecida" ou
-- "curriculo_nao_chegou". A chave da página (`vessel-brasil/regras-da-vaga.mjs`)
-- e a da triagem (`_shared/abas-da-triagem.js`) são a mesma: `consultor-brasilia`.
--
-- ⚠️ A FUNÇÃO ABAIXO É A DA MIGRAÇÃO 2026-09-25 COM A LISTA TROCADA. Se alguém
-- alterou a função direto no banco depois, confira antes de aplicar:
--   select pg_get_functiondef('public.vessel_candidatar_vaga(text,text,text,text,text,boolean,text,jsonb,text,boolean)'::regprocedure);

drop policy if exists "vessel_curriculos_anon_so_envia" on storage.objects;
create policy "vessel_curriculos_anon_so_envia" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'vessel-curriculos'
    and (storage.foldername(name))[1] in ('consultor-tivoli', 'consultor-brasilia')
  );

-- ── a porta da página ───────────────────────────────────────────────────────
create or replace function public.vessel_candidatar_vaga(
  p_vaga           text,
  p_nome           text,
  p_whatsapp       text,
  p_cidade         text,
  p_experiencia    text,
  p_fim_de_semana  boolean,
  p_curriculo      text default null,
  p_origem         jsonb default null,
  p_armadilha      text default null,
  p_teste          boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ip        text := public.vessel_hash_de_origem();
  v_fone      text := public.vessel_telefone_canonico(p_whatsapp);
  v_recentes  int;
  v_cv        text := nullif(trim(coalesce(p_curriculo, '')), '');
begin
  -- Robô que preencheu o campo escondido recebe "ok" e não grava nada.
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  -- ⚠️ LISTA FECHADA DE VAGAS. Vaga nova entra aqui E na política da pasta.
  if coalesce(p_vaga, '') not in ('consultor-tivoli', 'consultor-brasilia') then
    return json_build_object('ok', false, 'situacao', 'vaga_desconhecida',
      'erro', 'Esta vaga nao esta mais aberta.');
  end if;

  if length(trim(coalesce(p_nome, ''))) < 2 or v_fone is null then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Confira seu nome e o WhatsApp com DDD.');
  end if;
  if length(trim(coalesce(p_cidade, ''))) < 2 or length(p_cidade) > 80
     or length(p_nome) > 120 then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Confira seu nome e sua cidade.');
  end if;
  if coalesce(p_experiencia, '') not in ('luxo', 'varejo', 'nao')
     or p_fim_de_semana is null then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Responda as duas perguntas.');
  end if;

  -- ⚠️ O CURRÍCULO TEM DE SER UM ARQUIVO QUE ESTÁ NA PASTA DESTA VAGA. Sem esta
  -- conferência, qualquer texto viraria "currículo" e o robô tentaria baixá-lo.
  if v_cv is not null and not exists (
    select 1 from storage.objects
     where bucket_id = 'vessel-curriculos' and name = v_cv
       and (storage.foldername(name))[1] = p_vaga
  ) then
    return json_build_object('ok', false, 'situacao', 'curriculo_nao_chegou',
      'erro', 'O curriculo nao chegou. Anexe de novo ou envie sem ele.');
  end if;

  -- Teto por hora do mesmo endereço: acima dele finge que recebeu.
  select count(*) into v_recentes from public.vessel_candidaturas
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  if v_recentes >= 10 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  insert into public.vessel_candidaturas
    (vaga, nome, whatsapp, cidade, experiencia, fim_de_semana, curriculo,
     origem, ip_hash, teste)
  values
    (p_vaga, regexp_replace(trim(p_nome), '\s+', ' ', 'g'), v_fone,
     regexp_replace(trim(p_cidade), '\s+', ' ', 'g'), p_experiencia,
     p_fim_de_semana, v_cv, coalesce(p_origem, '{}'::jsonb), v_ip,
     coalesce(p_teste, false));

  return json_build_object('ok', true, 'situacao', 'recebido');
end;
$function$;

revoke all on function public.vessel_candidatar_vaga(
  text, text, text, text, text, boolean, text, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_candidatar_vaga(
  text, text, text, text, text, boolean, text, jsonb, text, boolean) to anon;

comment on function public.vessel_candidatar_vaga(
  text, text, text, text, text, boolean, text, jsonb, text, boolean) is
  'A porta das páginas /vaga-tivoli e /vaga-brasilia. Lista fechada de vagas, armadilha anti-robô, '
  'teto de 10 por hora por endereço, e o currículo só entra se o arquivo está na '
  'pasta da vaga.';
