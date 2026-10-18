-- Papel `robo_notas`: robô notas-dos-pedidos: grava a nota fiscal de cada pedido do Bling.
-- Menor privilégio: só as tabelas/colunas que o código do robô toca (levantamento do plano 02, ver o quadro robô→papel→env no
-- LEIA-ME.md). Nenhuma outra tabela, nenhuma função além das listadas no fim. No `api-db` não há RLS: o GRANT é a única tranca.
-- Quem precisar de coluna nova pede GRANT novo (o robô falha alto: `permission denied`), nunca `grant ... on all tables`.
--
-- Rodar como o dono do banco, DEPOIS do papel-copia.sql (que tira o EXECUTE de PUBLIC) e de `api migrar`. A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_ROBO_NOTAS="$(cat /root/secrets/robo-notas.senha)" docker exec -i -e SENHA_ROBO_NOTAS api-db psql -U api -d api < /root/api-db/papel-robo-notas.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-robos.teste.sh.
-- URL do robô (contêineres na rede `api_net`; o servidor não fala TLS):
--   ROBO_NOTAS_DOS_PEDIDOS_DATABASE_URL=postgres://robo_notas:<SENHA_ROBO_NOTAS>@api-db:5432/api?sslmode=disable
\set ON_ERROR_STOP on
\getenv senha SENHA_ROBO_NOTAS
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_ROBO_NOTAS no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): sem o EXECUTE de PUBLIC revogado, "só estas funções" seria mentira.
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'robo_notas') as criar \gset
\if :criar
  create role robo_notas login;
\endif
alter role robo_notas with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 3 password :'senha';

grant connect on database :"DBNAME" to robo_notas;
grant usage on schema public to robo_notas;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from robo_notas;
revoke all on all sequences in schema public from robo_notas;
grant select, insert, update on bling_pedido_nota to robo_notas;
grant select on bling_pedido_ajuste_valor to robo_notas;
