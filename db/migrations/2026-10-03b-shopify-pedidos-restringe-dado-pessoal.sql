-- Restringe o acesso às colunas de dado pessoal de shopify_pedidos.
--
-- POR QUE ESTA MIGRATION EXISTE
-- `shopify_pedidos` (criada em 2026-10-03-pedidos-da-shopify.sql) guarda
-- cliente_nome, cliente_email e o payload inteiro do pedido em `bruto`
-- (que inclui endereço, telefone e mais). A política de RLS daquela migration
-- só recorta por CANAL (pode_ver_canal) — e a Loja Shopify é um canal de
-- varejo normal, que a maioria dos perfis do sistema já enxerga pra ver total
-- de venda. Sem este ajuste, qualquer um desses perfis também lê dado pessoal
-- de cliente, só por enxergar o canal — não é a regra deste projeto para dado
-- pessoal (ver db/migrations/2026-09-29-abandono-de-checkout.sql, que trata
-- e-mail/telefone como acesso à parte).
--
-- A SAÍDA AQUI É PERMISSÃO POR COLUNA, NÃO POR LINHA: RLS continua recortando
-- por canal (ninguém de fora do canal vê nada, nem o total); por cima disso,
-- a permissão de coluna do Postgres tira cliente_nome/cliente_email/bruto de
-- quem só tem acesso ao canal. Só quem tiver GRANT explícito nessas colunas
-- (hoje: ninguém pela UI — dado de auditoria, lido só via service_role/SQL
-- direto quando precisar investigar um pedido específico) consegue ler.

revoke select on public.shopify_pedidos from authenticated;
grant select (id, numero, loja_id, total, moeda, status_financeiro, criado_em_shopify, atualizado_em)
  on public.shopify_pedidos to authenticated;

comment on column public.shopify_pedidos.cliente_nome is
  'Dado pessoal — sem GRANT para authenticated (ver 2026-10-03b-shopify-pedidos-restringe-dado-pessoal.sql). Só service_role/SQL direto.';
comment on column public.shopify_pedidos.cliente_email is
  'Dado pessoal — mesma restrição de cliente_nome.';
comment on column public.shopify_pedidos.bruto is
  'Payload cru, inclui dado pessoal (endereço, telefone) — mesma restrição de cliente_nome.';
