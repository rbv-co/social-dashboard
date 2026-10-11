-- +goose Up
-- Livro de envios do worker e da API: uma linha por mensagem/push JÁ reservado para envio
-- (chave = tarefa:dia:...:destino). Reservar ANTES de enviar é o que impede uma execução repetida
-- (manual, duas instâncias no deploy) de mandar a mesma mensagem de novo. Expurgo: faxina-da-api (45 dias).
create table envios_feitos (
  chave    text primary key,
  feito_em timestamptz not null default now()
);

-- +goose Down
drop table envios_feitos;
