-- FATIA 5.4 (Colaboradores e Acessos) do esquema de produção para os testes (D0 reconstruído: Rulings
-- 5.1-1 e 5.4-1). Carregada depois de 01-tabelas-5-01 e 5-02 (ordem do nome). As acessos_* são declaradas
-- AQUI, menos duas que nasceram MÍNIMAS em fatias anteriores porque outras fatias as referenciam por FK:
-- acessos_pessoas (5.1; o 5.2 acrescentou cargo, status, setor_id e marca_id) e acessos_setores (5.2).
-- Aqui as duas são COMPLETADAS por `alter table`. A FK equipes.setor_id → acessos_setores (on delete set
-- null) já veio com o 5.2 (01-tabelas-5-02.sql). Nenhuma acessos_* tem gatilho em produção
-- (03-triggers.csv): o 02-gatilhos.sql não ganha gatilho com esta fatia.
-- Sem as RLS/policies (is_acessos_admin) e sem os índices só de desempenho das migrations: o banco de
-- teste não as lê; a autorização é a da API. Sem as linhas semeadas (setores, organizações, modelo de termo).

-- db/migrations/acessos/005_organizacoes.sql:2-7
create table public.acessos_organizacoes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  ordem     int not null default 0,
  criado_em timestamptz not null default now()
);

-- acessos_setores (nasceu mínima no 5.2: 004_v2.sql:2-8): organizacao_id de 005_organizacoes.sql:19 e o
-- único POR organização de 014_setor_unique_por_org.sql:3-7 (a 014 largou o UNIQUE(nome) da 004_v2 —
-- PRESUMIDO aplicada em produção; sem organização o índice não impede nome repetido, o RPC deduplica).
alter table public.acessos_setores
  add column organizacao_id uuid references public.acessos_organizacoes(id) on delete set null;
create unique index acessos_setores_org_nome_uk on public.acessos_setores (organizacao_id, nome);

-- acessos_pessoas (nasceu mínima na 5.1, com cargo/status/setor_id/marca_id do 5.2): o resto de
-- 001_base.sql:2-11 (criado_em, atualizado_em; `nome` é NOT NULL na fonte), 004_v2.sql:19-30
-- (numero_pessoal, numero_corporativo, data_inicio_contrato, data_fim_contrato, motivo_saida),
-- 006_zoho.sql:20-21 (avatar_url, zoho_account_id), 010_colab_contas.sql:2-3 (email_outlook, conta_apple)
-- e 011_colab_org.sql:3 (organizacao_id). O check de status (ativo|desligado: 004_v2.sql:28-29) o 5.2 já pôs.
alter table public.acessos_pessoas
  alter column nome set not null,
  add column criado_em            timestamptz not null default now(),
  add column atualizado_em        timestamptz not null default now(),
  add column numero_pessoal       text,
  add column numero_corporativo   text,
  add column data_inicio_contrato date,
  add column data_fim_contrato    date,
  add column motivo_saida         text,
  add column avatar_url           text,
  add column zoho_account_id      text,
  add column email_outlook        text,
  add column conta_apple          text,
  add column organizacao_id       uuid references public.acessos_organizacoes(id) on delete set null;

-- 001_base.sql:13-22 + 004_v2.sql:33-38 (categoria; o check de tipo foi largado: tipo livre) +
-- 2026-07-17-patrimonio-completo.sql:7-8 (valor_centavos). 0 linhas em produção; sem rota (Ruling 5.4-10)
create table public.acessos_dispositivos (
  id             uuid primary key default gen_random_uuid(),
  pessoa_id      uuid not null references public.acessos_pessoas(id) on delete cascade,
  tipo           text not null,
  descricao      text not null,
  identificador  text,
  status         text not null default 'em_uso' check (status in ('em_uso','a_devolver','devolvido','perdido')),
  desde          date,
  observacao     text,
  atualizado_em  timestamptz not null default now(),
  categoria      text not null default 'dispositivo' check (categoria in ('dispositivo','veiculo')),
  detalhes       jsonb not null default '{}'::jsonb,
  valor_centavos bigint
);

-- 004_v2.sql:41-48 (recriada como documentos enviados)
create table public.acessos_termos (
  id           uuid primary key default gen_random_uuid(),
  pessoa_id    uuid not null references public.acessos_pessoas(id) on delete cascade,
  titulo       text,
  arquivo_path text not null,
  enviado_em   timestamptz not null default now(),
  observacao   text
);

-- 001_base.sql:39-44 (a linha única; sem rota)
create table public.acessos_config (
  id            int primary key default 1 check (id = 1),
  empresa       text,
  modelo_termo  text,
  atualizado_em timestamptz not null default now()
);

-- 001_base.sql:46-55 (só select e insert no catálogo)
create table public.acessos_log (
  id        uuid primary key default gen_random_uuid(),
  quando    timestamptz not null default now(),
  quem      uuid,
  acao      text not null,
  provedor  text,
  alvo      text,
  resultado text not null default 'ok' check (resultado in ('ok','erro')),
  detalhe   text
);

-- 009_recursos.sql:2-11 + 2026-07-16-acessos-arquivar-recurso.sql:12-14 (arquivado_em, arquivado_motivo)
-- + 2026-07-17-acessos-recursos-aceitar-workdrive.sql:19-39 (check com workdrive; único parcial do external_id)
create table public.acessos_recursos (
  id               uuid primary key default gen_random_uuid(),
  tipo             text not null default 'onedrive'
    constraint acessos_recursos_tipo_check check (tipo in ('onedrive','icloud','workdrive')),
  provedor         text default 'microsoft',
  nome             text not null,
  external_id      text,
  drive_id         text,
  caminho          text,
  criado_em        timestamptz not null default now(),
  arquivado_em     timestamptz,
  arquivado_motivo text
);
create unique index acessos_recursos_workdrive_external_id on public.acessos_recursos (external_id)
  where tipo = 'workdrive' and external_id is not null;

-- 012_icloud_vinculos.sql:3-12
create table public.acessos_vinculos (
  id         uuid primary key default gen_random_uuid(),
  recurso_id uuid not null references public.acessos_recursos(id) on delete cascade,
  pessoa_id  uuid not null references public.acessos_pessoas(id) on delete cascade,
  papel      text not null default 'leitura' check (papel in ('leitura','edicao')),
  estado     text not null default 'pendente' check (estado in ('pendente','feito')),
  observacao text,
  criado_em  timestamptz not null default now(),
  feito_em   timestamptz
);

-- 015_drive_marcas.sql:3-9 e 016_drive_setores_overrides.sql:2-14 (sem rota: Ruling 5.4-10; o proxy lê as marcas)
create table public.acessos_drive_marcas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  external_id text not null unique,
  ordem       int not null default 0,
  criado_em   timestamptz not null default now()
);
create table public.acessos_drive_setores (
  id        uuid primary key default gen_random_uuid(),
  chave     text not null unique,
  label     text not null,
  ordem     int not null default 100,
  criado_em timestamptz not null default now()
);
create table public.acessos_drive_overrides (
  external_id   text primary key,
  setor_chave   text not null,
  nome          text,
  atualizado_em timestamptz not null default now()
);

-- 2026-07-17-patrimonio-completo.sql:14-25 (sem rota)
create table public.acessos_patrimonio_historico (
  id             uuid primary key default gen_random_uuid(),
  dispositivo_id uuid not null references public.acessos_dispositivos(id) on delete cascade,
  pessoa_id      uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome    text,
  de             date not null,
  ate            date,
  motivo         text,
  criado_em      timestamptz not null default now()
);

-- 006_zoho.sql:2-13 + 007_zoho_state.sql:2-3. SEGREDOS (client_secret, refresh_token, oauth_state). Em
-- produção: RLS ligada SEM policy (só a chave de serviço). Fora do catálogo: o autz nega. Só o Plano 6
-- (proxy e OAuth) a lê ou grava; aqui ela existe para provar que nada deste domínio a alcança (Task 7).
-- Esta fatia NÃO traz valor algum: só as colunas.
create table public.acessos_conexoes (
  provedor       text primary key,
  client_id      text,
  client_secret  text,
  refresh_token  text,
  org_id         text,
  data_center    text default '.com',
  escopos        text,
  conectado_por  uuid,
  conectado_em   timestamptz,
  atualizado_em  timestamptz not null default now(),
  oauth_state    text,
  oauth_state_em timestamptz
);
