-- Pedido da Loja Shopify, trazido direto da API dela — sem passar pelo Bling.
--
-- POR QUE ESTA TABELA EXISTE
-- A Loja Shopify (loja_id 205512275 no Bling) é lida hoje pelas telas de venda
-- através do Bling, igual qualquer outra loja. O dono quer parar de depender
-- do Bling pra ESTA loja e ler direto da API da própria Shopify — medido em
-- 03/10/2026: todo pedido dela cai num vendedor-placeholder "Fábrica"
-- (vendor_id 15596565431), ou seja, não tem vendedora de verdade atribuída, e
-- por isso não precisa da mesma lógica de vendedor/forma-de-pagamento das
-- outras lojas (ver bling_pedido_forma_pagamento).
--
-- `bruto jsonb` guarda o payload inteiro: é dado novo, formato ainda não
-- testado em produção — melhor poder reprocessar um campo que o desenho
-- inicial não previu do que ter que pedir pra Shopify mandar de novo.
--
-- O QUE ESTA MIGRATION NÃO FAZ
-- Não muda número nenhum nas telas. Só cria o lugar onde o pedido passa a ser
-- guardado; quem preenche é o robô coletor/trazer-pedidos-da-shopify.mjs e o
-- webhook receber-webhook-pedido-shopify; quem passa a ler são as telas, numa
-- etapa seguinte e separada.

create table if not exists public.shopify_pedidos (
  id                bigint        primary key,        -- order id da própria Shopify
  numero            text,                               -- order_number / name (ex: "#1042")
  loja_id           bigint        not null default 205512275,
  total             numeric(12,2) not null,
  moeda             text          not null default 'BRL',
  status_financeiro text          not null,             -- financial_status cru da Shopify
  cliente_nome      text,
  cliente_email     text,
  criado_em_shopify timestamptz   not null,             -- created_at do pedido na Shopify
  bruto             jsonb         not null,             -- payload cru, para auditoria/replay
  atualizado_em     timestamptz   not null default now()
);

comment on table public.shopify_pedidos is
  'Pedido da Loja Shopify (loja_id 205512275), trazido direto da API da Shopify — não passa pelo Bling. Preenchido pelo robô coletor/trazer-pedidos-da-shopify.mjs e pelo webhook receber-webhook-pedido-shopify.';
comment on column public.shopify_pedidos.status_financeiro is
  'financial_status cru da Shopify. O que conta como venda (paid, partially_refunded) é decidido por quem lê, não aqui — ver supabase/functions/_shared/pedido-shopify.js.';
comment on column public.shopify_pedidos.bruto is
  'Payload inteiro do pedido, cru. Dado novo, formato ainda não testado em produção — permite reprocessar um campo que o desenho inicial não previu.';

-- criado_em_shopify: leitura por faixa de dia, mesmo padrão de bling_pedido_nota.
-- status_financeiro: filtro de "o que conta como venda" roda em toda leitura.
-- loja_id: lido pela política de escopo por time, mesmo motivo das tabelas irmãs.
create index if not exists idx_shopify_pedidos_data   on public.shopify_pedidos (criado_em_shopify desc);
create index if not exists idx_shopify_pedidos_status on public.shopify_pedidos (status_financeiro);
create index if not exists idx_shopify_pedidos_loja   on public.shopify_pedidos (loja_id);

alter table public.shopify_pedidos enable row level security;

-- Leitura para quem está logado; escrita só pelo robô e pelo webhook
-- (service_role, que não passa por RLS). Mesmo padrão de bling_pedido_nota.
drop policy if exists shopify_pedidos_leitura on public.shopify_pedidos;
create policy shopify_pedidos_leitura on public.shopify_pedidos
  for select to authenticated using (true);

drop policy if exists shopify_pedidos_so_do_meu_canal on public.shopify_pedidos;
create policy shopify_pedidos_so_do_meu_canal on public.shopify_pedidos
  as restrictive for select to authenticated
  using (public.pode_ver_canal(loja_id));
