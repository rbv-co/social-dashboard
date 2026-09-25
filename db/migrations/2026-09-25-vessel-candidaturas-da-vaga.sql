-- AS CANDIDATURAS DAS VAGAS DA VESSEL (25/09/2026).
--
-- A página `vesselbrasil.com.br/vaga-tivoli` grava aqui. Quem lê é o robô
-- `coletor/triagem-tivoli-no-zoho.mjs`, que espelha na planilha do RH.
--
-- ⚠️ POR QUE NÃO O FORMULÁRIO DO META: o cadastro feito dentro do Instagram
-- fica NO Meta, e ler de lá exige a permissão `leads_retrieval`, que o token do
-- usuário do sistema não tem — e ninguém da casa consegue entrar no Facebook
-- para gerar outro. O dado que cai no nosso banco a gente lê sem pedir licença.
--
-- ⚠️ TABELA PRÓPRIA, NÃO `vessel_pessoas`. Candidata não é cliente: misturar
-- faria o currículo de alguém aparecer na base de clientes, no espelho da lista
-- e nos disparos de marketing — e a pessoa só autorizou o processo seletivo.

create table if not exists public.vessel_candidaturas (
  id              uuid primary key default gen_random_uuid(),
  criado_em       timestamptz not null default now(),
  vaga            text not null,
  nome            text not null,
  whatsapp        text not null,
  cidade          text not null,
  experiencia     text not null check (experiencia in ('luxo', 'varejo', 'nao')),
  fim_de_semana   boolean not null,
  curriculo       text,
  origem          jsonb not null default '{}'::jsonb,
  ip_hash         text,
  teste           boolean not null default false
);

create index if not exists vessel_candidaturas_vaga_criado
  on public.vessel_candidaturas (vaga, criado_em desc);
create index if not exists vessel_candidaturas_ip_recente
  on public.vessel_candidaturas (ip_hash, criado_em);

-- ⚠️ RLS LIGADA E SEM POLÍTICA NENHUMA: ninguém de fora lê nem escreve na
-- tabela. A página escreve pela função abaixo; o robô lê com a chave de serviço.
alter table public.vessel_candidaturas enable row level security;
revoke all on public.vessel_candidaturas from public, anon, authenticated;

comment on table public.vessel_candidaturas is
  'Candidaturas das vagas da Vessel, gravadas pela página /vaga-<loja> do site. '
  'Separada de vessel_pessoas de propósito: candidata não é cliente.';

-- ── a pasta dos currículos ──────────────────────────────────────────────────
-- ⚠️ PRIVADA, E A PÁGINA SÓ ENVIA. A política abaixo deixa o visitante anônimo
-- INSERIR arquivo e nada mais: sem `select` ele não lista, não baixa e não
-- sobrescreve (o upsert do Storage precisa de select + update). Quem baixa é o
-- robô, com a chave de serviço, para levar ao Zoho.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vessel-curriculos', 'vessel-curriculos', false, 5242880, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "vessel_curriculos_anon_so_envia" on storage.objects;
create policy "vessel_curriculos_anon_so_envia" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'vessel-curriculos'
    and (storage.foldername(name))[1] in ('consultor-tivoli')
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
  if coalesce(p_vaga, '') not in ('consultor-tivoli') then
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
  'A porta da página /vaga-tivoli. Lista fechada de vagas, armadilha anti-robô, '
  'teto de 10 por hora por endereço, e o currículo só entra se o arquivo está na '
  'pasta da vaga.';
