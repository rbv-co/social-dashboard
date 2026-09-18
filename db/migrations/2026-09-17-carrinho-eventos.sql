-- db/migrations/2026-09-17-carrinho-eventos.sql
--
-- Rastreamento de carrinho da loja Shopify (Funil de Carrinho): cada evento
-- (produto adicionado/removido, checkout iniciado) chega cru pela Edge
-- Function `capturar-evento-carrinho`, mandado pelo Web Pixel Extension da
-- loja. "Abandonado" é calculado na consulta (view carrinho_abandonados),
-- sem robô de agregação — ver spec
-- docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.
create table if not exists public.carrinho_eventos (
  id             bigint generated always as identity primary key,
  cart_token     text not null,
  tipo           text not null check (tipo in (
                   'produto_adicionado', 'produto_removido', 'checkout_iniciado'
                 )),
  produto_id     text,
  produto_titulo text,
  variante_id    text,
  quantidade     int,
  preco          numeric,
  ip             text,
  criado_em      timestamptz not null default now()
);

create index if not exists carrinho_eventos_cart_token_criado_em_idx
  on public.carrinho_eventos (cart_token, criado_em);
create index if not exists carrinho_eventos_tipo_criado_em_idx
  on public.carrinho_eventos (tipo, criado_em);
create index if not exists carrinho_eventos_ip_criado_em_idx
  on public.carrinho_eventos (ip, criado_em);

comment on table public.carrinho_eventos is
  'Eventos crus de carrinho da loja Shopify, gravados só pela Edge Function capturar-evento-carrinho (chave de serviço). Leitura liberada a quem tem a permissão "carrinho".';

alter table public.carrinho_eventos enable row level security;

-- Sem policy de insert de propósito: só a chave de serviço grava (ela ignora
-- RLS). Nem o próprio pixel tem policy de escrita — ele nunca fala direto com
-- o banco, só com a Edge Function.
drop policy if exists carrinho_eventos_leitura on public.carrinho_eventos;
create policy carrinho_eventos_leitura
  on public.carrinho_eventos for select
  to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.is_superadmin or 'carrinho' = any (p.features))
  ));

create or replace view public.carrinho_abandonados as
select cart_token,
       min(criado_em) as iniciado_em,
       max(criado_em) as ultimo_evento
from public.carrinho_eventos
where tipo = 'produto_adicionado'
group by cart_token
having not exists (
  select 1 from public.carrinho_eventos e2
  where e2.cart_token = carrinho_eventos.cart_token
    and e2.tipo = 'checkout_iniciado'
)
and max(criado_em) < now() - interval '30 minutes';

comment on view public.carrinho_abandonados is
  'Carrinhos com produto adicionado, sem checkout iniciado, parados há mais de 30 minutos (fixo, não é medido — ajustável se o dono achar cedo/tarde demais).';

-- OBRIGATÓRIO: sem isto a view roda com a permissão do DONO (postgres) e passa
-- por cima do RLS de carrinho_eventos — toda view nova sobre tabela com RLS
-- neste projeto precisa desta linha (ver db/migrations/2026-07-31-saude-dos-robos.sql).
alter view public.carrinho_abandonados set (security_invoker = true);
