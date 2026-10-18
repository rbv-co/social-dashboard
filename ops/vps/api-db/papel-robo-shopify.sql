-- Papel `robo_shopify`: robô pedidos-da-shopify: upsert dos pedidos da Shopify.
-- Menor privilégio: só as tabelas/colunas que o código do robô toca (levantamento do plano 02, ver o quadro robô→papel→env no
-- LEIA-ME.md). Nenhuma outra tabela, nenhuma função além das listadas no fim. No `api-db` não há RLS: o GRANT é a única tranca.
-- Quem precisar de coluna nova pede GRANT novo (o robô falha alto: `permission denied`), nunca `grant ... on all tables`.
--
-- Rodar como o dono do banco, DEPOIS do papel-copia.sql (que tira o EXECUTE de PUBLIC) e de `api migrar`. A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_ROBO_SHOPIFY="$(cat /root/secrets/robo-shopify.senha)" docker exec -i -e SENHA_ROBO_SHOPIFY api-db psql -U api -d api < /root/api-db/papel-robo-shopify.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-robos.teste.sh.
-- URL do robô (contêineres na rede `api_net`; o servidor não fala TLS):
--   ROBO_PEDIDOS_DA_SHOPIFY_DATABASE_URL=postgres://robo_shopify:<SENHA_ROBO_SHOPIFY>@api-db:5432/api?sslmode=disable
\set ON_ERROR_STOP on
\getenv senha SENHA_ROBO_SHOPIFY
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_ROBO_SHOPIFY no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): sem o EXECUTE de PUBLIC revogado, "só estas funções" seria mentira.
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'robo_shopify') as criar \gset
\if :criar
  create role robo_shopify login;
\endif
alter role robo_shopify with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 3 password :'senha';

grant connect on database :"DBNAME" to robo_shopify;
grant usage on schema public to robo_shopify;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from robo_shopify;
revoke all on all sequences in schema public from robo_shopify;
grant select, insert, update on shopify_pedidos to robo_shopify;
