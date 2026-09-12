-- OS DEPOSITOS DO BLING, com o NOME de cada um.
--
-- Ate 05/09/2026 os nomes viviam CRAVADOS em tres arquivos do repositorio
-- (`estoque-gv.js`, `lib/bling-comercial.mjs`, `gestor-comercial.mjs`), e loja
-- nova exigia mexer em codigo nos tres. Pior: o casamento canal->deposito era
-- feito adivinhando pelas palavras "tivoli" e "dom pedro" escritas no codigo.
--
-- ⚠️ AS IRMAS (`bling_lojas`, `fabrica_lojas`, `gc_estoque_item`) estao com
-- `anon` recebendo INSERT/UPDATE/DELETE pela concessao padrao do Supabase, e so
-- a RLS as segura. Uma trava so. Esta tabela nasce com as DUAS: a RLS abaixo e
-- a concessao retirada do `anon` explicitamente.
create table if not exists public.bling_depositos (
  deposito_id   bigint primary key,
  nome          text not null,
  ativo         boolean not null default true,
  padrao        boolean not null default false,
  atualizado_em timestamptz not null default now()
);

alter table public.bling_depositos enable row level security;

-- Quem esta logado LE. Quem escreve e o robo, com a chave de servico, que passa
-- por cima da RLS — deposito nao se cria pela tela.
create policy bling_depositos_read
  on public.bling_depositos for select
  to authenticated using (true);

revoke all on public.bling_depositos from anon;
revoke insert, update, delete, truncate on public.bling_depositos from authenticated;
grant select on public.bling_depositos to authenticated;
