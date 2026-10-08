-- 2026-10-08-carrinho-eventos-evento-shopify-id.sql
-- O core repassa os webhooks da Shopify com retry (1, 5, 15, 60, 240 min): `receber-webhook-checkout` pode receber o
-- MESMO checkouts/create duas vezes. A chave é o X-Shopify-Event-Id (igual em toda reentrega do mesmo evento).
-- Coluna nula (eventos do pixel/tema, sem cabeçalho) fica fora do índice: o comportamento deles não muda.
-- Segura em tabela viva: add column nullable sem default é só catálogo; o índice único parcial bloqueia escrita por
-- instantes (tabela pequena, todas as linhas atuais têm a coluna nula).
alter table public.carrinho_eventos add column if not exists evento_shopify_id text;

create unique index if not exists carrinho_eventos_evento_shopify_id_uidx
  on public.carrinho_eventos (evento_shopify_id) where evento_shopify_id is not null;

comment on column public.carrinho_eventos.evento_shopify_id is
  'X-Shopify-Event-Id do webhook que gerou a linha (idempotência de reentrega). Nulo nos eventos que não vêm de webhook.';
