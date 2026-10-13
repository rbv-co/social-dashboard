-- FATIA 5.8 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1, 5.7-1 e 5.8-1).
-- Carrega depois de 01-tabelas-5-07.sql (que declara fabrica_marcas: NÃO redeclarar aqui; coluna que
-- faltar entra com `alter table public.fabrica_marcas add column if not exists …`). Nenhum gatilho nem
-- função de produção nestas tabelas (levantamento/03-triggers.csv e 02-funções.csv). FKs de auth.users
-- viram public.usuarios (ops/migracao/limpar-dump.mjs:64). Todas com DDL no repositório: sem presumido.

-- db/migrations/014_fabrica_anuncios.sql:6-11 + 018_fabrica_marcas_lojas.sql:19-22
create table public.fabrica_lojas (
  deposito_id   text primary key,
  nome          text not null,
  ativo         boolean not null default true,
  ordem         int not null default 0,
  marca_id      uuid references public.fabrica_marcas(id),
  whatsapp      text,
  geo_cities    jsonb,
  canal_loja_id text
);

-- db/migrations/015_fabrica_criativos.sql:2-9 + 017_fabrica_jobs_lifecycle.sql:22-23
-- + 021_fabrica_campanhas_status.sql:2-4 (criado_por: auth.users → usuarios) + 022_fabrica_objetivos.sql:2
create table public.fabrica_campanhas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  desconto_tipo text not null default 'fixo',
  desconto_pct  numeric,
  parcelas      int not null default 10,
  created_at    timestamptz not null default now(),
  fechada_em    timestamptz,
  purgado_em    timestamptz,
  status        text not null default 'gerando',
  job_id        uuid,
  criado_por    uuid references public.usuarios(id),
  objetivo      text not null default 'engajamento'
);

-- db/migrations/015_fabrica_criativos.sql:11-25 sem candidato_id (019_fabrica_remove_f1.sql:2)
-- + 017:24 (purgado_em) + 020_fabrica_criativos_legenda.sql:2 + 029_fabrica_criativos_sku.sql:4
create table public.fabrica_criativos (
  id           uuid primary key default gen_random_uuid(),
  campanha_id  uuid references public.fabrica_campanhas(id) on delete cascade,
  arquetipo    text not null,
  template     text not null,
  formato      text not null,
  variante     text,
  preco_de     numeric,
  preco_por    numeric,
  storage_path text,
  url          text,
  escolhido    boolean not null default false,
  created_at   timestamptz not null default now(),
  purgado_em   timestamptz,
  legenda      text,
  sku          text
);
create index idx_fab_criativos_campanha on public.fabrica_criativos (campanha_id);

-- db/migrations/016_fabrica_meta_jobs.sql:2-15
create table public.fabrica_meta_jobs (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid,
  ad_account_id    text,
  loja             text,
  tipo             text,
  meta_campaign_id text,
  adset_ids        jsonb,
  ad_ids           jsonb,
  payload          jsonb,
  status           text not null default 'criado',
  erro             text,
  created_at       timestamptz not null default now()
);

-- db/migrations/017_fabrica_jobs_lifecycle.sql:3-14 (criado_por: auth.users → usuarios)
create table public.fabrica_jobs (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null,
  params        jsonb not null default '{}'::jsonb,
  status        text not null default 'enfileirado',
  github_run_id text,
  resultado     jsonb,
  erro          text,
  criado_por    uuid references public.usuarios(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- db/migrations/022_fabrica_objetivos.sql:4-18
create table public.fabrica_objetivos (
  chave                text primary key,
  rotulo               text not null,
  descricao            text not null default '',
  meta_objective       text not null,
  optimization_goal    text not null,
  billing_event        text not null default 'IMPRESSIONS',
  destination_type     text,
  promoted_object_tipo text not null default 'none',
  cta_type             text not null default 'LEARN_MORE',
  looks                text[] not null default '{}',
  pede_desconto        boolean not null default true,
  ativo                boolean not null default true,
  ordem                int not null default 0
);

-- db/migrations/023_fabrica_publicos.sql:2-15
create table public.fabrica_publicos (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  marca_id         uuid references public.fabrica_marcas(id) on delete set null,
  geo              jsonb not null default '{}'::jsonb,
  idade_min        int not null default 18,
  idade_max        int not null default 65,
  generos          int[] not null default '{}',
  interesses       jsonb not null default '[]'::jsonb,
  custom_audiences jsonb not null default '[]'::jsonb,
  ativo            boolean not null default true,
  criado_por       uuid,
  created_at       timestamptz not null default now()
);

-- db/migrations/024_fabrica_looks.sql:2-15 + 030_fabrica_looks_excluido.sql:4
create table public.fabrica_looks (
  chave             text primary key,
  nome              text not null,
  arquetipo         text not null,
  objetivos         text[] not null default '{}',
  ativo             boolean not null default true,
  ordem             int not null default 0,
  preview_url       text,
  tipo              text not null default 'codigo',
  canva_formato_map jsonb not null default '{}'::jsonb,
  campo_map         jsonb not null default '{}'::jsonb,
  criado_por        uuid,
  created_at        timestamptz not null default now(),
  excluido          boolean not null default false
);
