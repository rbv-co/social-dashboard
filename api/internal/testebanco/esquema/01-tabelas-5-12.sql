-- FATIA do Plano 12 (lacunas da API) do esquema de produção para os testes: as duas tabelas lidas pelas telas
-- Base de Leads e Abandono de carrinho que as outras fatias não trazem (create/alter table das migrations em
-- db/migrations, na ordem do nome, à mão). Sem RLS, policy nem função: a regra de leitura vem do catálogo de policies.

-- 2026-09-17-carrinho-eventos.sql, -09-18-carrinho-eventos-sessao.sql, -09-18-carrinho-eventos-fbp-fbc.sql,
-- -09-19-carrinho-eventos-origem.sql, -10-08-carrinho-eventos-evento-shopify-id.sql
create table if not exists public.carrinho_eventos (
  id               bigint generated always as identity primary key,
  cart_token       text,
  tipo             text not null check (tipo in ('produto_adicionado', 'produto_removido', 'checkout_iniciado', 'sessao_iniciada')),
  produto_id       text,
  produto_titulo   text,
  variante_id      text,
  quantidade       int,
  preco            numeric,
  ip               text,
  criado_em        timestamptz not null default now(),
  session_id       text,
  fbp              text,
  fbc              text,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  gclid            text,
  referrer         text,
  evento_shopify_id text
);

-- 2026-09-29-abandono-de-checkout.sql, 2026-09-30-abandono-de-checkout-pagamento-pendente.sql,
-- 2026-09-30-zz-abandono-pix-expirado.sql, 2026-09-30-zzy-mensagem-de-abandono.sql
create table if not exists public.checkout_abandono (
  token                     text primary key,
  email                     text,
  telefone                  text,
  nome                      text,
  total                     numeric,
  moeda                     text,
  url_de_recuperacao        text,
  status                    text not null default 'aguardando'
                            check (status in ('aguardando', 'fila_envio', 'pagamento_pendente', 'comprou')),
  iniciado_em               timestamptz not null default now(),
  ultimo_evento_em          timestamptz not null default now(),
  fila_envio_em             timestamptz,
  comprou_em                timestamptz,
  comprou_depois            boolean not null default false,
  pedido_criado_em          timestamptz,
  mensagem_status           text,
  mensagem_reservada_em     timestamptz,
  mensagem_enviada_em       timestamptz,
  mensagem_motivo           text,
  mensagem_tentativas       int not null default 0,
  chatwoot_conversation_id  bigint
);
