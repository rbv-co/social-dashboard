-- FATIA 5.5 do esquema de produção para os testes. Carregada DEPOIS das fatias 5-01…5-04 (ordem de nome).
-- Fonte: pg_dump --schema-only do banco de ensaio (`api-db`, restaurado da produção em 14/10/2026), das 14
-- tabelas do Comercial. As 13 tabelas abaixo são declaradas SÓ aqui; as fatias seguintes (5.10, 5.11:
-- funções vessel_* leem bling_*) as usam como estão. Nenhuma tem gatilho em produção (só bling_lojas,
-- já no D0 desde o 5.1). bling_tokens fica fora: só o serviço a lê.
-- Diferenças do ensaio para o que o plano presumia (o plano estava errado, o dump manda):
--   bling_metas: loja_id é INTEGER, meta_valor numeric(14,2) NOT NULL default 0 e HÁ unique (loja_id, year, month);
--   bling_pedido_vendedor: vendor_id é NOT NULL; updated_at NOT NULL;
--   bling_vendedores: nome NOT NULL default ''; updated_at NOT NULL.

-- bling_lojas é do 5.5; o 5.1 a declarou mínima. nome NOT NULL e updated_at, como no ensaio; foco:
-- 2026-09-05-bling-lojas-ganha-foco.sql:16-17
alter table public.bling_lojas alter column nome set not null;
alter table public.bling_lojas add column if not exists updated_at timestamptz default now();
alter table public.bling_lojas add column if not exists foco boolean not null default true;

create table public.bling_depositos (
  deposito_id   bigint primary key,
  nome          text not null,
  ativo         boolean not null default true,
  padrao        boolean not null default false,
  atualizado_em timestamptz not null default now()
);

create table public.bling_metas (
  id          serial primary key,
  loja_id     integer not null,
  loja_nome   text,
  year        integer not null,
  month       integer not null,
  meta_valor  numeric(14,2) not null default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  daily_goals jsonb,
  unique (loja_id, year, month)
);

create table public.bling_vendedor_metas (
  id          serial primary key,
  vendor_id   bigint not null,
  year        integer not null,
  month       integer not null,
  meta_valor  numeric,
  daily_goals jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (vendor_id, year, month)
);

create table public.bling_vendedores (
  vendor_id  bigint primary key,
  nome       text not null default '',
  updated_at timestamptz not null default now()
);

create table public.bling_pedido_vendedor (
  pedido_id   bigint primary key,
  vendor_id   bigint not null,
  pedido_data date,
  updated_at  timestamptz not null default now(),
  qtd_itens   integer default 1,
  loja_id     bigint
);
create index bling_pedido_vendedor_loja_idx on public.bling_pedido_vendedor (loja_id, vendor_id) where loja_id is not null;

create table public.bling_pedido_nota (
  pedido_id      bigint primary key,
  loja_id        bigint,
  data_pedido    date not null,
  total          numeric(12,2),
  nota_id        bigint,
  modelo         text check (modelo in ('nfe', 'nfce')),
  nota_numero    text,
  nota_serie     integer,
  nota_situacao  smallint,
  data_da_nota   date,
  emitida_em     timestamptz,
  data_da_venda  date generated always as (coalesce(data_da_nota, data_pedido)) stored,
  origem_da_data text generated always as (case when data_da_nota is null then 'pedido' else 'nota' end) stored,
  conferido_em   timestamptz not null default now(),
  pedido_numero  text
);
create index idx_bpn_data_da_venda on public.bling_pedido_nota (data_da_venda desc);
create index idx_bpn_data_pedido on public.bling_pedido_nota (data_pedido desc);
create index idx_bpn_loja on public.bling_pedido_nota (loja_id);

create table public.bling_pedido_ajuste_valor (
  pedido_id       bigint primary key,
  loja_id         bigint,
  total_corrigido numeric(12,2) not null check (total_corrigido >= 0),
  total_do_bling  numeric(12,2),
  motivo          text not null check (length(btrim(motivo)) >= 10),
  criado_por      uuid references public.usuarios(id),
  criado_em       timestamptz not null default now()
);
create index idx_bpav_loja on public.bling_pedido_ajuste_valor (loja_id);

create table public.bling_pedido_ajuste_vendedor (
  pedido_id           bigint primary key,
  loja_id             bigint,
  vendor_id_corrigido bigint not null,
  vendor_id_do_bling  bigint,
  motivo              text not null check (length(btrim(motivo)) >= 10),
  criado_por          uuid references public.usuarios(id),
  criado_em           timestamptz not null default now()
);
create index idx_bpaven_loja on public.bling_pedido_ajuste_vendedor (loja_id);

create table public.bling_pedido_forma_pagamento (
  parcela_id         bigint primary key,
  pedido_id          bigint not null,
  loja_id            bigint,
  forma_pagamento_id bigint not null,
  valor              numeric(12,2) not null,
  data_vencimento    date,
  eh_devolucao       boolean not null,
  atualizado_em      timestamptz not null default now()
);
create index idx_bpfp_loja on public.bling_pedido_forma_pagamento (loja_id);
create index idx_bpfp_pedido on public.bling_pedido_forma_pagamento (pedido_id);
create index idx_bpfp_devolucao on public.bling_pedido_forma_pagamento (pedido_id) where eh_devolucao;

create table public.gc_vendas_item (
  mes           date not null,
  canal_loja_id bigint not null,
  sku           text not null,
  produto       text,
  categoria     text,
  unidades      integer not null default 0,
  faturamento   numeric not null default 0,
  atualizado_em timestamptz default now(),
  primary key (mes, canal_loja_id, sku)
);
create index idx_gc_vi_mes on public.gc_vendas_item (mes desc);

create table public.gc_estoque_item (
  deposito_id   bigint not null,
  sku           text not null,
  produto       text,
  categoria     text,
  saldo         integer not null default 0,
  atualizado_em timestamptz default now(),
  primary key (deposito_id, sku)
);

create table public.gestao_comercial_briefings (
  id         uuid primary key default gen_random_uuid(),
  rodada     date not null default current_date,
  periodo    text,
  resumo     text,
  conteudo   text not null,
  dados_json jsonb,
  created_at timestamptz not null default now()
);
create index idx_gcb_rodada on public.gestao_comercial_briefings (rodada desc);

create table public.shopify_pedidos (
  id                bigint primary key,
  numero            text,
  loja_id           bigint not null default 205512275,
  total             numeric(12,2) not null,
  moeda             text not null default 'BRL',
  status_financeiro text not null,
  cliente_nome      text,
  cliente_email     text,
  criado_em_shopify timestamptz not null,
  bruto             jsonb not null,
  atualizado_em     timestamptz not null default now()
);
create index idx_shopify_pedidos_data on public.shopify_pedidos (criado_em_shopify desc);
create index idx_shopify_pedidos_loja on public.shopify_pedidos (loja_id);
create index idx_shopify_pedidos_status on public.shopify_pedidos (status_financeiro);
