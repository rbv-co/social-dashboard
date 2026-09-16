-- A BASE DE PESSOAS E ATENDIMENTOS DA VESSEL
--
-- Desenho: docs/superpowers/specs/2026-09-16-vessel-base-de-dados-e-backup-design.md
-- Origem:  Growth Plan v3.1, módulo 10 (tarefa T01, aprovada no gate H06).
--
-- Camadas 1 e 2 do desenho: quem é a pessoa, de onde ela veio, a visita que ela
-- marcou, o que ela autorizou, e quem abriu o convite. A camada 3 (o pedido,
-- pedido a pedido, vindo do Bling) fica para outra migration.
--
-- ⚠️ MESMO DESENHO DE SEGURANÇA DE vessel_lista_espera, E PELO MESMO MOTIVO:
-- a chave anônima da Supabase está DENTRO do HTML de páginas públicas. Quem
-- abre a landing page tem essa chave na mão. Por isso, em toda tabela com dado
-- de pessoa: RLS ligada e ZERO política. Não é política restritiva — é nenhuma.
-- Pela API pública estas tabelas não existem. Tudo entra pelas funções lá
-- embaixo, que validam, gravam e respondem {"ok": true} e nada mais.

-- ── ajudantes ────────────────────────────────────────────────────────────────

-- O telefone é a CHAVE DO SISTEMA INTEIRO: é por ele que o lead encontra o
-- contato no Bling, e é ele que o Meta usa (em código irreversível) para
-- reconhecer a pessoa. Um parêntese a mais faz o cruzamento dar zero SEM ERRO
-- NENHUM — por isso a normalização é do banco, e não de quem chama.
create or replace function public.vessel_telefone_canonico(p_bruto text)
returns text
language plpgsql
immutable
as $$
declare
  d text := regexp_replace(coalesce(p_bruto, ''), '\D', '', 'g');
begin
  -- Sem país: 10 dígitos (fixo com DDD) ou 11 (celular com DDD).
  if length(d) in (10, 11) then
    return '55' || d;
  end if;
  -- Com país já na frente.
  if length(d) in (12, 13) and left(d, 2) = '55' then
    return d;
  end if;
  return null;   -- qualquer outra coisa é telefone que não dá para usar
end;
$$;

create or replace function public.vessel_toca_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- ── 1. quem é ────────────────────────────────────────────────────────────────

create table if not exists public.vessel_pessoas (
  id             bigserial primary key,
  nome           text not null,
  telefone       text not null,              -- canônico: 55 + DDD + número
  email          text,
  cidade         text,
  consultora     text,                       -- CA-xx responsável, quando houver
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Uma pessoa por telefone. É isto que faz "a mesma cliente voltando" não virar
-- duas pessoas — e é o que o teste de aceite QA03 do plano exige.
create unique index if not exists vessel_pessoas_telefone_idx
  on public.vessel_pessoas (telefone);
create index if not exists vessel_pessoas_email_idx
  on public.vessel_pessoas (lower(email)) where email is not null;

drop trigger if exists vessel_pessoas_atualizado on public.vessel_pessoas;
create trigger vessel_pessoas_atualizado before update on public.vessel_pessoas
  for each row execute function public.vessel_toca_atualizado_em();

alter table public.vessel_pessoas enable row level security;

comment on table public.vessel_pessoas is
  'Pessoas da Vessel (leads e clientes). RLS ligada e SEM politica: so as '
  'funcoes vessel_* escrevem, e ninguem le pela API publica. SEM CPF, sem data '
  'de nascimento e sem endereco — o modulo 10 do Growth Plan proibe para '
  'simples captacao de interesse.';

-- ── 2. de onde ela veio ──────────────────────────────────────────────────────

create table if not exists public.vessel_origens (
  id              bigserial primary key,
  pessoa_id       bigint not null references public.vessel_pessoas(id) on delete cascade,
  momento         timestamptz not null default now(),
  canal           text not null,
  campanha_id     text,
  evento_id       text,
  parceiro_id     text,
  stylist_id      text,
  criativo_id     text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,
  clique_meta     text,      -- o _fbc: a etiqueta do clique no anuncio
  navegador_meta  text       -- o _fbp
);

create index if not exists vessel_origens_pessoa_idx
  on public.vessel_origens (pessoa_id, momento);

alter table public.vessel_origens enable row level security;

comment on table public.vessel_origens is
  'Cada toque: de onde a pessoa chegou, uma linha por vez. ⚠️ SO ACRESCENTA, '
  'NUNCA ATUALIZA — e assim que a primeira origem nunca e sobrescrita (modulo '
  '10: "nao sobrescrever o first_touch ao receber uma mensagem nova"). A '
  'primeira origem e a linha mais antiga; as demais sao assistentes e NAO '
  'somam receita.';
comment on column public.vessel_origens.clique_meta is
  '⚠️ O _fbc, a etiqueta que o Meta cola no endereco quando a pessoa clica no '
  'anuncio. So existe NO INSTANTE em que ela chega, e nao tem como recuperar '
  'depois. Sem ele a compra dela nunca podera ser creditada ao anuncio.';

-- ── 3. a visita ──────────────────────────────────────────────────────────────

create table if not exists public.vessel_atendimentos (
  id               bigserial primary key,
  pessoa_id        bigint not null references public.vessel_pessoas(id) on delete cascade,
  loja             text not null,
  client_advisor   text,
  quando           timestamptz,
  status           text not null default 'solicitado',
  convite_codigo   text,
  origem_registro  text not null,
  presenca_em      timestamptz,
  ip_hash          text,          -- so hash, nunca o endereco cru
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

-- ⚠️ PEDIDO DE HORARIO NAO E HORARIO RESERVADO (modulo 16). São estados
-- diferentes, e o formulario da landing page cria 'solicitado'. Remarcar e
-- faltar viram ESTADO, com data — nao destroem o atendimento nem a pessoa.
alter table public.vessel_atendimentos
  drop constraint if exists vessel_atendimentos_status_valido;
alter table public.vessel_atendimentos
  add constraint vessel_atendimentos_status_valido check (
    status in ('solicitado', 'confirmado', 'realizado', 'remarcado', 'cancelado', 'no_show'));

alter table public.vessel_atendimentos
  drop constraint if exists vessel_atendimentos_loja_valida;
alter table public.vessel_atendimentos
  add constraint vessel_atendimentos_loja_valida check (
    loja in ('iguatemi', 'tivoli', 'parkshopping'));

create unique index if not exists vessel_atendimentos_convite_idx
  on public.vessel_atendimentos (convite_codigo) where convite_codigo is not null;
create index if not exists vessel_atendimentos_pessoa_idx
  on public.vessel_atendimentos (pessoa_id, criado_em);
-- A consulta do painel: "quem tem horario nos proximos dias, por loja".
-- A consulta da trava de abuso, que roda em TODO envio.
create index if not exists vessel_atendimentos_origem_idx
  on public.vessel_atendimentos (ip_hash, criado_em) where ip_hash is not null;
create index if not exists vessel_atendimentos_agenda_idx
  on public.vessel_atendimentos (loja, quando) where status in ('solicitado', 'confirmado');

drop trigger if exists vessel_atendimentos_atualizado on public.vessel_atendimentos;
create trigger vessel_atendimentos_atualizado before update on public.vessel_atendimentos
  for each row execute function public.vessel_toca_atualizado_em();

alter table public.vessel_atendimentos enable row level security;

comment on column public.vessel_atendimentos.presenca_em is
  '⚠️ A coluna sem a qual o show rate (meta de 75% do protocolo) NAO TEM COMO '
  'ser calculado. Alguem da loja precisa marcar que a cliente veio; o sistema '
  'so pode oferecer o botao. Nenhum robo preenche isto.';

-- ── 4. o que ela autorizou ───────────────────────────────────────────────────

create table if not exists public.vessel_permissoes (
  id            bigserial primary key,
  pessoa_id     bigint not null references public.vessel_pessoas(id) on delete cascade,
  finalidade    text not null,
  canal         text not null,
  texto_versao  text not null,
  situacao      text not null default 'concedida',
  momento       timestamptz not null default now(),
  fonte         text not null
);

-- ⚠️ UMA LINHA POR FINALIDADE. Permissao de ATENDIMENTO, de MARKETING e de
-- IMAGEM sao separadas (modulo 10). Recusar marketing NAO pode bloquear o
-- atendimento que a pessoa pediu — e o teste de aceite QA05 do plano.
alter table public.vessel_permissoes
  drop constraint if exists vessel_permissoes_finalidade_valida;
alter table public.vessel_permissoes
  add constraint vessel_permissoes_finalidade_valida check (
    finalidade in ('atendimento', 'marketing', 'imagem'));

alter table public.vessel_permissoes
  drop constraint if exists vessel_permissoes_situacao_valida;
alter table public.vessel_permissoes
  add constraint vessel_permissoes_situacao_valida check (
    situacao in ('concedida', 'revogada'));

create index if not exists vessel_permissoes_pessoa_idx
  on public.vessel_permissoes (pessoa_id, finalidade, momento desc);

alter table public.vessel_permissoes enable row level security;

comment on column public.vessel_permissoes.texto_versao is
  'A versao do texto que a pessoa leu. Sem ela nao se consegue provar O QUE ela '
  'aceitou — so que aceitou alguma coisa.';

-- ── 5. quem abriu o convite ──────────────────────────────────────────────────

create table if not exists public.vessel_convite_aberturas (
  id              bigserial primary key,
  momento         timestamptz not null default now(),
  convite_codigo  text,
  praca           text,
  client_advisor  text,
  via             text,
  ip_hash         text
);

create index if not exists vessel_convite_aberturas_codigo_idx
  on public.vessel_convite_aberturas (convite_codigo, momento);
create index if not exists vessel_convite_aberturas_praca_idx
  on public.vessel_convite_aberturas (praca, momento);

alter table public.vessel_convite_aberturas enable row level security;

comment on table public.vessel_convite_aberturas is
  'Cada abertura do endereco /c/<praca>/<ca>/<codigo> do Appointment Card. '
  '⚠️ SEM pessoa_id, DE PROPOSITO: um QR escaneado nao e um contato '
  'identificado (modulo 10). A ligacao com a pessoa existe so por '
  'vessel_atendimentos.convite_codigo, e portanto so para convite que saiu de '
  'um atendimento registrado.';

-- ── as portas ────────────────────────────────────────────────────────────────
-- Todas security definer, todas com armadilha e teto por hora, todas devolvendo
-- {"ok": true} e nada mais. NENHUMA DELAS LE. Leitura e so de dentro da Central,
-- autenticada, atras de is_vessel_admin().

-- O hash do endereço de rede, igual ao de vessel_entrar_na_lista.
-- ⚠️ `extensions.digest` vai QUALIFICADO: pgcrypto mora no schema extensions e
-- sem o prefixo a funcao quebra com search_path = public. Foi o que derrubou
-- vessel_verificar na primeira vez.
create or replace function public.vessel_hash_de_origem()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cab json := nullif(current_setting('request.headers', true), '')::json;
begin
  return encode(
    extensions.digest(coalesce(v_cab ->> 'x-forwarded-for', 'sem-ip'), 'sha256'),
    'hex');
end;
$$;

-- Um código de convite novo, sem letra que se confunde ao ditar (sem I, L, O,
-- U, 0, 1). Gerado no BANCO para garantir que nao repete.
create or replace function public.vessel_novo_codigo_de_convite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_codigo   text;
  v_tenta    int := 0;
begin
  loop
    v_codigo := '';
    for i in 1..6 loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.vessel_atendimentos where convite_codigo = v_codigo);
    v_tenta := v_tenta + 1;
    if v_tenta > 50 then
      raise exception 'nao consegui um codigo de convite livre';
    end if;
  end loop;
  return v_codigo;
end;
$$;

-- Acha a pessoa pelo telefone ou cria. Nunca sobrescreve nome com vazio.
create or replace function public.vessel_pessoa_por_telefone(
  p_nome text, p_telefone text, p_email text default null, p_cidade text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text := public.vessel_telefone_canonico(p_telefone);
  v_id  bigint;
begin
  if v_tel is null then
    return null;
  end if;
  select id into v_id from public.vessel_pessoas where telefone = v_tel;
  if v_id is not null then
    -- Completa o que estiver faltando, sem apagar o que ja existe.
    update public.vessel_pessoas
       set email  = coalesce(nullif(trim(p_email), ''), email),
           cidade = coalesce(nullif(trim(p_cidade), ''), cidade)
     where id = v_id;
    return v_id;
  end if;
  insert into public.vessel_pessoas (nome, telefone, email, cidade)
  values (trim(p_nome), v_tel, nullif(lower(trim(p_email)), ''), nullif(trim(p_cidade), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- A porta das LANDING PAGES (T03 a T06, SB02, DF02).
create or replace function public.vessel_pedir_atendimento(
  p_nome           text,
  p_whatsapp       text,
  p_loja           text,
  p_aceite_versao  text,
  p_cidade         text default null,
  p_email          text default null,
  p_marketing      boolean default false,
  p_origem         json default null,
  p_armadilha      text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip        text := public.vessel_hash_de_origem();
  v_recentes  int;
  v_pessoa    bigint;
begin
  -- A ARMADILHA: campo invisivel que gente nao ve e robo preenche. Responde
  -- sucesso e NAO grava — o robo nao descobre que foi barrado.
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true);
  end if;

  if coalesce(trim(p_nome), '') = '' or public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'erro', 'Confira os campos e tente de novo.');
  end if;
  if p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'erro', 'Escolha a loja.');
  end if;

  -- Teto por origem, como na lista de espera. Estourado, responde sucesso e nao
  -- grava — o robo nao descobre que foi barrado.
  select count(*) into v_recentes
    from public.vessel_atendimentos
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  if v_recentes >= 10 then
    return json_build_object('ok', true);
  end if;

  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp, p_email, p_cidade);
  if v_pessoa is null then
    return json_build_object('ok', false, 'erro', 'Confira o WhatsApp e tente de novo.');
  end if;

  -- ⚠️ QA02 DO PLANO: "duplo clique nao duplica". Sem isto, o segundo toque no
  -- botao (ou a pessoa reenviando o mesmo formulario) vira um segundo pedido de
  -- visita para a mesma loja — e a loja liga duas vezes para a mesma cliente.
  -- Responde sucesso, porque do ponto de vista dela deu certo mesmo.
  if exists (
    select 1 from public.vessel_atendimentos
     where pessoa_id = v_pessoa and loja = p_loja and status = 'solicitado'
       and criado_em > now() - interval '30 minutes')
  then
    return json_build_object('ok', true);
  end if;

  insert into public.vessel_origens (
    pessoa_id, canal, campanha_id, evento_id, parceiro_id, stylist_id, criativo_id,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, clique_meta, navegador_meta)
  values (
    v_pessoa,
    coalesce(p_origem ->> 'canal', 'lp'),
    p_origem ->> 'campanha_id',  p_origem ->> 'evento_id',   p_origem ->> 'parceiro_id',
    p_origem ->> 'stylist_id',   p_origem ->> 'criativo_id',
    p_origem ->> 'utm_source',   p_origem ->> 'utm_medium',  p_origem ->> 'utm_campaign',
    p_origem ->> 'utm_content',  p_origem ->> 'utm_term',
    p_origem ->> 'clique_meta',  p_origem ->> 'navegador_meta');

  -- ⚠️ A pessoa pediu para ser atendida: essa permissao nasce do proprio envio.
  -- A de MARKETING e separada e so entra se ela marcar — e nunca vem marcada.
  insert into public.vessel_permissoes (pessoa_id, finalidade, canal, texto_versao, fonte)
  values (v_pessoa, 'atendimento', 'whatsapp', p_aceite_versao, coalesce(p_origem ->> 'canal', 'lp'));
  if p_marketing then
    insert into public.vessel_permissoes (pessoa_id, finalidade, canal, texto_versao, fonte)
    values (v_pessoa, 'marketing', 'whatsapp', p_aceite_versao, coalesce(p_origem ->> 'canal', 'lp'));
  end if;

  insert into public.vessel_atendimentos (pessoa_id, loja, status, origem_registro, ip_hash)
  values (v_pessoa, p_loja, 'solicitado', 'lp', v_ip);

  return json_build_object('ok', true);
end;
$$;

-- A porta do APPOINTMENT CARD. A Client Advisor ja combinou o horario com a
-- cliente; aqui o atendimento nasce 'confirmado'.
--
-- ⚠️ NAO grava permissao de marketing nem de imagem. A cliente nao marcou nada
-- aqui — inventar um aceite que ninguem deu e pior que nao ter aceite.
create or replace function public.vessel_registrar_cartao(
  p_nome            text,
  p_whatsapp        text,
  p_loja            text,
  p_quando          timestamptz,
  p_client_advisor  text,
  p_armadilha       text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_recentes int;
  v_pessoa   bigint;
  v_codigo   text;
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true);
  end if;
  if coalesce(trim(p_nome), '') = '' or public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'erro', 'Confira o nome e o WhatsApp da cliente.');
  end if;
  if p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'erro', 'Escolha a loja.');
  end if;
  if p_quando is null or p_quando < now() - interval '1 day' then
    return json_build_object('ok', false, 'erro', 'Confira a data e o horario.');
  end if;

  -- Teto alto: uma loja cheia gera muitos cartoes num dia. O que a trava barra
  -- e robo, nao expediente movimentado.
  select count(*) into v_recentes
    from public.vessel_atendimentos
   where ip_hash = v_ip and origem_registro = 'appointment_card'
     and criado_em > now() - interval '1 hour';
  if v_recentes >= 60 then
    return json_build_object('ok', true, 'codigo', public.vessel_novo_codigo_de_convite());
  end if;

  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp);
  v_codigo := public.vessel_novo_codigo_de_convite();

  insert into public.vessel_atendimentos (
    pessoa_id, loja, client_advisor, quando, status, convite_codigo, origem_registro, ip_hash)
  values (v_pessoa, p_loja, p_client_advisor, p_quando, 'confirmado', v_codigo, 'appointment_card', v_ip);

  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

-- A porta da PAGINA DO CONVITE (/sua-visita). So conta que abriu.
create or replace function public.vessel_abrir_convite(
  p_codigo          text,
  p_praca           text default null,
  p_client_advisor  text default null,
  p_via             text default 'qr'
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_recentes int;
begin
  select count(*) into v_recentes
    from public.vessel_convite_aberturas
   where ip_hash = v_ip and momento > now() - interval '1 hour';
  if v_recentes >= 30 then
    return json_build_object('ok', true);
  end if;

  insert into public.vessel_convite_aberturas (convite_codigo, praca, client_advisor, via, ip_hash)
  values (nullif(trim(p_codigo), ''), upper(nullif(trim(p_praca), '')),
          nullif(trim(p_client_advisor), ''),
          case when p_via in ('qr', 'texto') then p_via else 'qr' end, v_ip);

  return json_build_object('ok', true);
end;
$$;

-- ── quem pode chamar o quê ───────────────────────────────────────────────────
-- ⚠️ `grant` nao e o portao da funcao: security definer roda como dono. O que
-- estas linhas fazem e decidir QUEM pode CHAMAR. As funcoes internas (achar
-- pessoa, gerar codigo, hash) NAO sao expostas ao publico.

revoke all on function public.vessel_pedir_atendimento(text, text, text, text, text, text, boolean, json, text) from public;
revoke all on function public.vessel_registrar_cartao(text, text, text, timestamptz, text, text) from public;
revoke all on function public.vessel_abrir_convite(text, text, text, text) from public;
revoke all on function public.vessel_pessoa_por_telefone(text, text, text, text) from public;
revoke all on function public.vessel_novo_codigo_de_convite() from public;
revoke all on function public.vessel_hash_de_origem() from public;

grant execute on function public.vessel_pedir_atendimento(text, text, text, text, text, text, boolean, json, text) to anon, authenticated;
grant execute on function public.vessel_registrar_cartao(text, text, text, timestamptz, text, text) to anon, authenticated;
grant execute on function public.vessel_abrir_convite(text, text, text, text) to anon, authenticated;
