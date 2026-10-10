-- +goose Up
-- Reentrega e replay de webhook (a Shopify e o fan-out do core mandam o MESMO
-- X-Shopify-Event-Id em toda reentrega). A marca é gravada na MESMA transação do efeito:
-- se o efeito falha, a marca some junto e a reentrega seguinte é processada.
create table webhooks_recebidos (
  origem      text not null,
  evento_id   text not null,
  recebido_em timestamptz not null default now(),
  primary key (origem, evento_id)
);

-- +goose Down
drop table webhooks_recebidos;
