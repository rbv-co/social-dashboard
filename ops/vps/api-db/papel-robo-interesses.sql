-- Papel `robo_interesses`: robô sugerir-interesses: sugere interesses de anúncio por marca.
-- Menor privilégio: só as tabelas/colunas que o código do robô toca (levantamento do plano 02, ver o quadro robô→papel→env no
-- LEIA-ME.md). Nenhuma outra tabela, nenhuma função além das listadas no fim. No `api-db` não há RLS: o GRANT é a única tranca.
-- Quem precisar de coluna nova pede GRANT novo (o robô falha alto: `permission denied`), nunca `grant ... on all tables`.
--
-- Rodar como o dono do banco, DEPOIS do papel-copia.sql (que tira o EXECUTE de PUBLIC) e de `api migrar`. A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_ROBO_INTERESSES="$(cat /root/secrets/robo-interesses.senha)" docker exec -i -e SENHA_ROBO_INTERESSES api-db psql -U api -d api < /root/api-db/papel-robo-interesses.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-robos.teste.sh.
-- URL do robô (contêineres na rede `api_net`; o servidor não fala TLS):
--   ROBO_SUGERIR_INTERESSES_DATABASE_URL=postgres://robo_interesses:<SENHA_ROBO_INTERESSES>@api-db:5432/api?sslmode=disable
\set ON_ERROR_STOP on
\getenv senha SENHA_ROBO_INTERESSES
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_ROBO_INTERESSES no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): sem o EXECUTE de PUBLIC revogado, "só estas funções" seria mentira.
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'robo_interesses') as criar \gset
\if :criar
  create role robo_interesses login;
\endif
alter role robo_interesses with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 3 password :'senha';

grant connect on database :"DBNAME" to robo_interesses;
grant usage on schema public to robo_interesses;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from robo_interesses;
revoke all on all sequences in schema public from robo_interesses;
grant select on bling_pedido_nota, bling_pedido_ajuste_valor to robo_interesses;
grant select (id, nome, segmento, termos_produto, account_id, ativo) on fabrica_marcas to robo_interesses;
grant select (nome, marca_id, geo_cities) on fabrica_lojas to robo_interesses;
grant select, insert, update on interesses_sugeridos to robo_interesses;
grant insert on ia_execucoes to robo_interesses;
