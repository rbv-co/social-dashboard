-- FATIA 5.2 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1 e 5.2-1). Carregada
-- DEPOIS de 01-tabelas-5-01.sql (ordem de nome). Fonte ao lado de cada tabela. Tabelas de outros
-- sub-planos entram MÍNIMAS (só o que os gatilhos, as RPCs e as rotas do 5.2 leem e gravam); o dono
-- delas completa com `alter table ... add column` no 01-tabelas-5-N.sql dele. FKs de auth.users viram
-- public.usuarios (ops/migracao/limpar-dump.mjs:64).
-- A linha abaixo é lida por gerar-gatilhos.mjs: estas funções entram verbatim em 02-gatilhos.sql.
-- funções: criar_pessoa_rapida, criar_setor_rapido, pessoas_para_escolher, setores_para_escolher, sincronizar_carro_e_bem

-- db/migrations/acessos/018_patrimonio_cadastros.sql:24-30
create table public.patrimonio_empresas (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  ordem     int not null default 0,
  criado_em timestamptz not null default now()
);

-- acessos/018:32-38 + acessos/020_patrimonio_hierarquia.sql:19, 25, 121, 124-126, 135 (único por marca)
create table public.patrimonio_locais (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ordem      int not null default 0,
  criado_em  timestamptz not null default now(),
  empresa_id uuid not null references public.patrimonio_empresas(id) on delete cascade
);
create unique index uq_patrimonio_locais_marca_nome on public.patrimonio_locais (empresa_id, nome);

-- acessos/018:40-46 + acessos/020:20, 26, 122, 128-130, 136 (único por local)
create table public.patrimonio_comodos (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ordem     int not null default 0,
  criado_em timestamptz not null default now(),
  local_id  uuid not null references public.patrimonio_locais(id) on delete cascade
);
create unique index uq_patrimonio_comodos_local_nome on public.patrimonio_comodos (local_id, nome);

-- acessos/018:49-56
create table public.patrimonio_categorias (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null unique,
  vida_util_anos int,
  ordem          int not null default 0,
  criado_em      timestamptz not null default now()
);

-- acessos/018:59-66
create table public.patrimonio_tipos (
  id           uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references public.patrimonio_categorias(id) on delete cascade,
  nome         text not null,
  ordem        int not null default 0,
  criado_em    timestamptz not null default now(),
  unique (categoria_id, nome)
);

-- do 5.4, MÍNIMA: acessos/004_v2.sql:2-8 (o que criar_setor_rapido e setores_para_escolher leem e gravam).
-- Sem UNIQUE em nome (PRESUMIDO): acessos/014_setor_unique_por_org.sql:3-6 trocou por unique(organizacao_id, nome),
-- e com organizacao_id nulo produção não garante nome único; o RPC deduplica sozinho. O conferir do 5.4 confere.
create table public.acessos_setores (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  cor       text,
  ordem     int not null default 0,
  criado_em timestamptz not null default now()
);

-- acessos_pessoas é MÍNIMA no 5.1; aqui, as colunas que o cadastro rápido lê e grava:
-- acessos/001_base.sql:5-6 (cargo, status; o check é o de acessos/004_v2.sql:27-29: ativo|desligado), acessos/004_v2.sql:20 (setor_id), 2026-08-06-pessoa-marca.sql:14-15 (marca_id)
alter table public.acessos_pessoas
  add column cargo    text,
  add column status   text not null default 'ativo' check (status in ('ativo', 'desligado')),
  add column setor_id uuid references public.acessos_setores(id) on delete set null,
  add column marca_id uuid references public.patrimonio_empresas(id);

-- as FKs de equipes que o 5.1 deixou para cá (2026-08-04-equipes-e-escopo.sql:58-62)
alter table public.equipes
  add foreign key (local_id)   references public.patrimonio_locais(id)   on delete set null,
  add foreign key (setor_id)   references public.acessos_setores(id)     on delete set null,
  add foreign key (empresa_id) references public.patrimonio_empresas(id) on delete set null;

-- acessos/019_patrimonio_bens.sql:3-28 + 2026-08-13-patrimonio-numero-de-serie.sql:11-12
create table public.patrimonio_bens (
  id             uuid primary key default gen_random_uuid(),
  numero         int unique,
  nome           text not null,
  valor_centavos bigint,
  data_compra    date,
  empresa_id     uuid references public.patrimonio_empresas(id)   on delete set null,
  local_id       uuid references public.patrimonio_locais(id)     on delete set null,
  comodo_id      uuid references public.patrimonio_comodos(id)    on delete set null,
  categoria_id   uuid references public.patrimonio_categorias(id) on delete set null,
  tipo_id        uuid references public.patrimonio_tipos(id)      on delete set null,
  marca          text,
  pessoa_id      uuid references public.acessos_pessoas(id) on delete set null,
  dono_texto     text,
  etiquetado     boolean not null default false,
  situacao       text not null default 'em_estoque'
                 check (situacao in ('em_uso', 'em_estoque', 'em_manutencao', 'baixado')),
  observacao     text,
  detalhes       jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  numero_serie   text
);

-- acessos/019:38-47
create table public.patrimonio_posse (
  id          uuid primary key default gen_random_uuid(),
  bem_id      uuid not null references public.patrimonio_bens(id) on delete cascade,
  pessoa_id   uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome text,
  de          date not null,
  ate         date,
  motivo      text,
  criado_em   timestamptz not null default now()
);

-- acessos/019:50-58
create table public.patrimonio_log (
  id        uuid primary key default gen_random_uuid(),
  quem      uuid,
  acao      text not null,
  alvo      text,
  resultado text,
  detalhe   text,
  quando    timestamptz not null default now()
);

-- acessos/021_patrimonio_config.sql:8-12
create table public.patrimonio_config (
  chave         text primary key,
  valor         text not null,
  atualizado_em timestamptz not null default now()
);

-- do 5.3, MÍNIMA: o que os gatilhos do bem e do carro e sincronizar_carro_e_bem leem e gravam.
-- acessos/022_frota.sql:18-49 (placa única, situação, pessoa_id, atualizado_em), acessos/025_frota_veiculo_completo.sql:20
-- (bem_id), acessos/048_frota_bem_id_unico.sql:44-46 (um carro por bem)
create table public.frota_veiculos (
  id            uuid primary key default gen_random_uuid(),
  placa         text not null unique,
  nome          text not null,
  marca         text,
  fipe_centavos bigint,
  situacao      text not null default 'ativo' check (situacao in ('ativo', 'em_manutencao', 'alienado', 'inativo')),
  pessoa_id     uuid references public.acessos_pessoas(id) on delete set null,
  bem_id        uuid references public.patrimonio_bens(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index uq_frota_veiculos_bem_id on public.frota_veiculos (bem_id) where bem_id is not null;

-- do 5.3, MÍNIMA: o que frota_fechar_posse_orfa grava e os gatilhos de frota_uso leem.
-- acessos/022_frota.sql:58-81, acessos/028_frota_checklist.sql:14 (tipo), acessos/046_frota_aceite_de_retirada.sql:33-46
-- (aceite_*; aceite_checklist_id sem a FK: frota_checklist é do 5.3)
create table public.frota_uso (
  id                    uuid primary key default gen_random_uuid(),
  veiculo_id            uuid not null references public.frota_veiculos(id) on delete cascade,
  pessoa_id             uuid references public.acessos_pessoas(id) on delete set null,
  tipo                  text not null default 'viagem',
  saida_em              timestamptz not null default now(),
  volta_em              timestamptz,
  aceite_em             timestamptz,
  aceite_por            uuid references public.usuarios(id) on delete set null,
  aceite_nome           text,
  aceite_rabisco        jsonb,
  aceite_checklist_id   uuid,
  aceite_checklist_hash text
);
