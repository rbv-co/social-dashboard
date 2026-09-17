-- A VENDA, PEDIDO A PEDIDO — a camada 3
--
-- Desenho: docs/superpowers/specs/2026-09-16-vessel-base-de-dados-e-backup-design.md
--
-- ⚠️ POR QUE ISTO EXISTE: a venda, no nosso banco, só existia como TOTAL DO MÊS
-- por loja por SKU (`gc_vendas_item`). Não havia pedido, não havia cliente, não
-- havia telefone — e não era coluna vazia, era coluna que não existia. Sem isto
-- a T07, a T08 e a T09 não têm do que se alimentar: mesmo que a loja preencha a
-- cliente perfeitamente no Bling, o dado não chegava aqui.
--
-- ⚠️ A CHAVE NÃO É O TELEFONE, E ISSO FOI MEDIDO NO BLING EM 17/09/2026:
-- o pedido do Bling NÃO TRAZ telefone. Nem na lista, nem no detalhe. Traz
-- `contato.id`, nome, tipo de pessoa e CPF.
--
-- Então o casamento tem duas escadas, nesta ordem:
--   1. `bling_contato_id` — exato. Quando o lead chega pela landing page, o robô
--      do espelho já cria a ficha dela no Bling; no dia da venda a loja escolhe
--      essa ficha e o pedido vem com o mesmo id. Sem fuzzy, sem dúvida.
--   2. o telefone da FICHA do contato (`contatos/<id>`), normalizado. É a
--      escada para quem comprou sem ter passado por nós antes.
--
-- Medido em 400 pedidos dos últimos 90 dias: TODOS têm contato (nenhum pedido
-- anônimo) e 88% das fichas têm telefone aproveitável. A corrente tem chão.

-- ── a pessoa ganha o elo com o Bling ─────────────────────────────────────────
alter table public.vessel_pessoas
  add column if not exists bling_contato_id bigint;

create unique index if not exists vessel_pessoas_bling_idx
  on public.vessel_pessoas (bling_contato_id) where bling_contato_id is not null;

comment on column public.vessel_pessoas.bling_contato_id is
  'A ficha dela no Bling. E a chave EXATA que liga a venda ao lead — o pedido do '
  'Bling traz contato.id e NAO traz telefone (medido em 17/09/2026).';

-- ── o pedido ─────────────────────────────────────────────────────────────────
create table if not exists public.vessel_pedidos (
  id                 bigserial primary key,
  bling_pedido_id    bigint not null,
  numero             text,
  bling_contato_id   bigint,
  contato_nome       text,
  pessoa_id          bigint references public.vessel_pessoas(id) on delete set null,
  casou_por          text,              -- bling_contato | telefone | (nulo: orfa)
  loja_id            bigint,
  vendedor_id        bigint,
  -- ⚠️ DUAS DATAS, DE PROPOSITO. A casa conta a venda pela DATA DO PEDIDO; a
  -- nota sai depois (no Atacado, no dia seguinte) e e ela que congela o valor.
  -- Guardar so uma obrigaria a escolher aqui uma decisao que e de quem le.
  data_do_pedido     date not null,
  data_da_nota       date,
  total_produtos     numeric(12,2),
  desconto           numeric(12,2),
  outras_despesas    numeric(12,2),
  total_do_bling     numeric(12,2),
  -- O valor que realmente entrou, quando o Bling congelou o pedido errado.
  -- Mesma regra das telas (`_shared/valor-corrigido.js`).
  total_corrigido    numeric(12,2),
  situacao_id        int,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create unique index if not exists vessel_pedidos_bling_idx
  on public.vessel_pedidos (bling_pedido_id);
create index if not exists vessel_pedidos_pessoa_idx
  on public.vessel_pedidos (pessoa_id, data_do_pedido);
create index if not exists vessel_pedidos_contato_idx
  on public.vessel_pedidos (bling_contato_id);
-- A consulta do painel e a do retorno ao Meta: "o que foi vendido na janela".
create index if not exists vessel_pedidos_janela_idx
  on public.vessel_pedidos (data_do_pedido, loja_id);
-- ⚠️ Venda ORFA e um fato a medir, nao um erro a esconder: este indice existe
-- para a pergunta "quantas vendas nao casaram com ninguem?" ser barata.
create index if not exists vessel_pedidos_orfas_idx
  on public.vessel_pedidos (data_do_pedido) where pessoa_id is null;

alter table public.vessel_pedidos
  drop constraint if exists vessel_pedidos_casou_por_valido;
alter table public.vessel_pedidos
  add constraint vessel_pedidos_casou_por_valido check (
    casou_por is null or casou_por in ('bling_contato', 'telefone'));

alter table public.vessel_pedidos enable row level security;

comment on table public.vessel_pedidos is
  'Um pedido do Bling por linha, trazido pelo robo coletor/trazer-pedidos-do-bling.mjs. '
  'RLS ligada e SEM politica: ninguem le pela API publica. ⚠️ NUNCA criar venda '
  'aqui a mao — so entra pedido que existe no Bling (modulo 10 do Growth Plan).';

-- ── o que foi vendido ────────────────────────────────────────────────────────
create table if not exists public.vessel_pedido_itens (
  id               bigserial primary key,
  pedido_id        bigint not null references public.vessel_pedidos(id) on delete cascade,
  sku              text,
  descricao        text,
  quantidade       numeric(12,3),
  valor_unitario   numeric(12,2),
  desconto         numeric(12,2)
);

create index if not exists vessel_pedido_itens_pedido_idx
  on public.vessel_pedido_itens (pedido_id);
create index if not exists vessel_pedido_itens_sku_idx
  on public.vessel_pedido_itens (sku);

alter table public.vessel_pedido_itens enable row level security;

comment on table public.vessel_pedido_itens is
  'As pecas de cada pedido. ⚠️ Um pedido com duas pecas e UMA compradora, UM '
  'pedido e DUAS pecas — nunca duas compras (teste de aceite QA13 do plano).';

-- ── o que ainda nao foi contado ao Meta ──────────────────────────────────────
-- ⚠️ A TRAVA CONTRA MANDAR DUAS VEZES. O modulo 10 pede: "um ID por acao real,
-- nao regenerar a cada tentativa", e ingestao idempotente por sistema+tipo+ID.
-- Aqui o ID e o proprio numero do pedido do Bling, que nunca muda.
create table if not exists public.vessel_envios_ao_meta (
  id              bigserial primary key,
  pedido_id       bigint not null references public.vessel_pedidos(id) on delete cascade,
  evento          text not null,                -- purchase | purchase_adjusted
  event_id        text not null,                -- o que vai para o Meta
  enviado_em      timestamptz not null default now(),
  resposta        text
);
create unique index if not exists vessel_envios_ao_meta_idx
  on public.vessel_envios_ao_meta (event_id, evento);

alter table public.vessel_envios_ao_meta enable row level security;

comment on table public.vessel_envios_ao_meta is
  'O que ja foi contado ao Meta, para nao contar duas vezes. A trava e o indice '
  'unico por (event_id, evento) — e o event_id e o numero do pedido do Bling, '
  'que nunca muda. Ainda nao ha robo escrevendo aqui; a T08 escreve.';
