-- Papel `robo_faxina`: robô faxina-storage: lê o que está em uso para saber o que apagar. Só leitura (apagar no Storage é fase 2).
-- Menor privilégio: só as tabelas/colunas que o código do robô toca (levantamento do plano 02, ver o quadro robô→papel→env no
-- LEIA-ME.md). Nenhuma outra tabela, nenhuma função além das listadas no fim. No `api-db` não há RLS: o GRANT é a única tranca.
-- Quem precisar de coluna nova pede GRANT novo (o robô falha alto: `permission denied`), nunca `grant ... on all tables`.
--
-- Rodar como o dono do banco, DEPOIS do papel-copia.sql (que tira o EXECUTE de PUBLIC) e de `api migrar`. A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_ROBO_FAXINA="$(cat /root/secrets/robo-faxina.senha)" docker exec -i -e SENHA_ROBO_FAXINA api-db psql -U api -d api < /root/api-db/papel-robo-faxina.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-robos.teste.sh.
-- URL do robô (contêineres na rede `api_net`; o servidor não fala TLS):
--   ROBO_FAXINA_STORAGE_DATABASE_URL=postgres://robo_faxina:<SENHA_ROBO_FAXINA>@api-db:5432/api?sslmode=disable
\set ON_ERROR_STOP on
\getenv senha SENHA_ROBO_FAXINA
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_ROBO_FAXINA no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): sem o EXECUTE de PUBLIC revogado, "só estas funções" seria mentira.
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'robo_faxina') as criar \gset
\if :criar
  create role robo_faxina login;
\endif
alter role robo_faxina with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 2 password :'senha';

grant connect on database :"DBNAME" to robo_faxina;
grant usage on schema public to robo_faxina;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from robo_faxina;
revoke all on all sequences in schema public from robo_faxina;
grant select (id, fechada_em, purgado_em) on fabrica_campanhas to robo_faxina;
grant select (storage_path, purgado_em) on fabrica_criativos to robo_faxina;
grant select (preview_url) on fabrica_looks to robo_faxina;
