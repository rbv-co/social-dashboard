-- FATIA 5.1 do esquema de produção para os testes (D0 reconstruído: Ruling 5.1-1). Os próximos
-- sub-planos acrescentam 01-tabelas-5-02.sql, 5-03... SEMPRE com dois dígitos (a ordem é a do nome do
-- arquivo: 5-10 viria antes de 5-2). Carregada por testebanco.ComEsquemaDeProducao DEPOIS da camada de compatibilidade e das migrações da API.
-- Fonte ao lado de cada tabela. "Presumido" = sem DDL no repositório (tabela anterior às migrations):
-- o `api worker conferir` confere essas colunas no banco restaurado (Task 11). Tabelas de outros
-- sub-planos entram MÍNIMAS (só o que o Escopo, os gatilhos e as rotas do 5.1 leem); FKs de
-- auth.users viram public.usuarios, como no dump limpo (ops/migracao/limpar-dump.mjs:64).

-- db/migrations/acessos/039_perfis_de_acesso.sql:20-29
create table public.acessos_perfis (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,
  permissions jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references public.usuarios(id)
);

-- colunas, tipos e nulidade: levantamento/12-colunas.csv:2-16. Defaults: escopo_por_equipe
-- (2026-08-04-equipes-e-escopo.sql:131-132), perfil_id e permissions_excecao (acessos/039:31-39);
-- permissions, is_superadmin e allowed_accounts (uuid[]; nulo = todas):
-- docs/superpowers/plans/2026-07-09-permissoes-granulares-fase1.md:31-33; os demais presumidos.
create table public.profiles (
  id                   uuid primary key references public.usuarios(id) on delete cascade,
  email                text not null,
  name                 text,
  role                 text not null default 'viewer',
  created_at           timestamptz default now(),
  disabled             boolean default false,
  features             text[] default '{}',
  avatar_url           text,
  permissions          jsonb not null default '{}'::jsonb,
  allowed_accounts     uuid[],
  is_superadmin        boolean not null default false,
  escopo_por_equipe    boolean not null default true,
  precisa_trocar_senha boolean not null default false,
  perfil_id            uuid references public.acessos_perfis(id) on delete set null,
  permissions_excecao  jsonb not null default '{}'::jsonb
);

-- presumido: as colunas que guard_profiles grava (02-funções.csv, guard_profiles)
create table public.audit_log (
  id          bigserial primary key,
  actor_id    uuid,
  actor_email text,
  action      text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- 2026-08-21-canal-pai-e-supervisora-de-grupo.sql:16-28
create table public.canais_grupos (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ordem     int not null default 0,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index canais_grupos_nome_unico on public.canais_grupos (lower(btrim(nome)));

-- do 5.5, MÍNIMA (o que meus_vinculos e os gatilhos leem); grupo_id: canal-pai…sql:33-34;
-- grupo: 2026-08-20-grupo-do-canal.sql:24-25; fechado_em: 2026-09-09-canal-fechado.sql:21-22
create table public.bling_lojas (
  loja_id    bigint primary key,
  nome       text,
  grupo      text,
  grupo_id   uuid references public.canais_grupos(id) on delete set null,
  fechado_em date
);

-- 2026-08-04-equipes-e-escopo.sql:32-77 + deposito_id (2026-08-04-escopo-em-vendas-e-estoque.sql:21-27).
-- FKs de local_id/setor_id/empresa_id: entram com as fatias do 5.2 e do 5.4.
create table public.equipes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  tipo          text not null default 'loja' check (tipo in ('loja', 'canal', 'setor')),
  ativo         boolean not null default true,
  canal_loja_id bigint references public.bling_lojas(loja_id) on delete set null,
  local_id      uuid,
  setor_id      uuid,
  empresa_id    uuid,
  deposito_id   bigint,
  ordem         int not null default 100,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index equipes_canal_unico on public.equipes (canal_loja_id) where canal_loja_id is not null;
create unique index equipes_deposito_unico on public.equipes (deposito_id) where deposito_id is not null;

-- 2026-08-04-equipes-e-escopo.sql:85-109
create table public.equipes_membros (
  id         uuid primary key default gen_random_uuid(),
  equipe_id  uuid not null references public.equipes(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  papel      text not null default 'vendedora' check (papel in ('vendedora', 'supervisora', 'gestor')),
  criado_em  timestamptz not null default now(),
  criado_por uuid references public.profiles(id) default auth.uid()
);
create unique index equipes_membros_unico on public.equipes_membros (equipe_id, profile_id);

-- 2026-08-04-escopo-em-vendas-e-estoque.sql:43-56
create table public.equipes_permissoes (
  id            uuid primary key default gen_random_uuid(),
  equipe_id     uuid not null references public.equipes(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  chave         text not null check (chave in ('estoque')),
  concedido_por uuid references public.profiles(id) default auth.uid(),
  criado_em     timestamptz not null default now()
);
create unique index equipes_permissoes_unica on public.equipes_permissoes (equipe_id, profile_id, chave);

-- 2026-08-21-canal-pai-e-supervisora-de-grupo.sql:103-111
create table public.canais_grupos_membros (
  id            uuid primary key default gen_random_uuid(),
  grupo_id      uuid not null references public.canais_grupos(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  papel         text not null default 'supervisora' check (papel in ('supervisora')),
  concedido_por uuid references public.profiles(id),
  concedido_em  timestamptz not null default now(),
  unique (grupo_id, profile_id)
);

-- do 5.4, MÍNIMA: o que autz.CarregarEscopo lê. Fonte: acessos/001_base.sql:2-11 e 004_v2.sql:21. Na fonte
-- `nome` é NOT NULL; aqui fica anulável de propósito: os testes do autz inserem só (id, profile_id).
create table public.acessos_pessoas (
  id                uuid primary key default gen_random_uuid(),
  nome              text,
  profile_id        uuid,
  email_corporativo text
);

-- presumido: as colunas que login (tela-de-login.vue:267) e admin (tela-de-admin.vue:4300) usam
create table public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  email      text,
  message    text,
  status     text not null default 'pending',
  created_at timestamptz not null default now()
);

-- 2026-07-24-push-subs.sql:3-10
create table public.push_subs (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_id    uuid references public.usuarios(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 2026-07-29-push-preferencias.sql:12-19 + o check de acessos/052_push_tipo_reserva.sql:17-19
create table public.push_preferencias (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  tipo         text not null check (tipo in ('vendas', 'saldo', 'conteudo', 'frota', 'frota_reserva')),
  ativo        boolean not null,
  alterado_em  timestamptz not null default now(),
  alterado_por uuid,
  primary key (user_id, tipo)
);

-- presumido; os tipos de checked_date (date) e account_id (uuid) são os que cmd/api/conferir.go já exige
create table public.data_integrity_checks (
  id           bigserial primary key,
  checked_date date not null,
  account_id   uuid,
  check_name   text not null,
  status       text not null,
  detail       text,
  created_at   timestamptz not null default now()
);

-- db/migrations/025_ia_execucoes.sql:6-23
create table public.ia_execucoes (
  id            uuid primary key default gen_random_uuid(),
  run_at        timestamptz not null default now(),
  robo          text not null,
  acao          text not null,
  modelo        text,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  chamadas      int not null default 0,
  usd           numeric(10,4) not null default 0,
  duracao_ms    bigint,
  itens         int,
  unidade       text,
  status        text not null default 'ok',
  detalhe       text,
  github_run_id text,
  created_at    timestamptz not null default now()
);
