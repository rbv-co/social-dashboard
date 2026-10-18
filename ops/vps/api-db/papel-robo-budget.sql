-- Papel `robo_budget`: robô budget-ia: análise de orçamento e de anúncios com IA.
-- Menor privilégio: só as tabelas/colunas que o código do robô toca (levantamento do plano 02, ver o quadro robô→papel→env no
-- LEIA-ME.md). Nenhuma outra tabela, nenhuma função além das listadas no fim. No `api-db` não há RLS: o GRANT é a única tranca.
-- Quem precisar de coluna nova pede GRANT novo (o robô falha alto: `permission denied`), nunca `grant ... on all tables`.
--
-- Rodar como o dono do banco, DEPOIS do papel-copia.sql (que tira o EXECUTE de PUBLIC) e de `api migrar`. A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_ROBO_BUDGET="$(cat /root/secrets/robo-budget.senha)" docker exec -i -e SENHA_ROBO_BUDGET api-db psql -U api -d api < /root/api-db/papel-robo-budget.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-robos.teste.sh.
-- URL do robô (contêineres na rede `api_net`; o servidor não fala TLS):
--   ROBO_BUDGET_IA_DATABASE_URL=postgres://robo_budget:<SENHA_ROBO_BUDGET>@api-db:5432/api?sslmode=disable
\set ON_ERROR_STOP on
\getenv senha SENHA_ROBO_BUDGET
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_ROBO_BUDGET no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): sem o EXECUTE de PUBLIC revogado, "só estas funções" seria mentira.
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'robo_budget') as criar \gset
\if :criar
  create role robo_budget login;
\endif
alter role robo_budget with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 3 password :'senha';

grant connect on database :"DBNAME" to robo_budget;
grant usage on schema public to robo_budget;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from robo_budget;
revoke all on all sequences in schema public from robo_budget;
grant select (id, name, ad_account_id) on accounts to robo_budget;
grant select on gt_ponderada_config, gt_objetivo_interacao, followers_leituras, bling_pedido_nota, bling_pedido_ajuste_valor to robo_budget;
grant select, insert, update on gt_budget_analises, gt_ad_analises to robo_budget;
grant insert on ia_execucoes to robo_budget;
