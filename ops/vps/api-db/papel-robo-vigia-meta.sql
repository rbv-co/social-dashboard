-- Papel `robo_vigia_meta`: robô vigia-problemas-meta: lê as contas e registra problemas via gt_registrar_problemas().
-- Menor privilégio: só as tabelas/colunas que o código do robô toca (levantamento do plano 02, ver o quadro robô→papel→env no
-- LEIA-ME.md). Nenhuma outra tabela, nenhuma função além das listadas no fim. No `api-db` não há RLS: o GRANT é a única tranca.
-- Quem precisar de coluna nova pede GRANT novo (o robô falha alto: `permission denied`), nunca `grant ... on all tables`.
--
-- Rodar como o dono do banco, DEPOIS do papel-copia.sql (que tira o EXECUTE de PUBLIC) e de `api migrar`. A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_ROBO_VIGIA_META="$(cat /root/secrets/robo-vigia-meta.senha)" docker exec -i -e SENHA_ROBO_VIGIA_META api-db psql -U api -d api < /root/api-db/papel-robo-vigia-meta.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-robos.teste.sh.
-- URL do robô (contêineres na rede `api_net`; o servidor não fala TLS):
--   VIGIA_DATABASE_URL=postgres://robo_vigia_meta:<SENHA_ROBO_VIGIA_META>@api-db:5432/api?sslmode=disable
\set ON_ERROR_STOP on
\getenv senha SENHA_ROBO_VIGIA_META
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_ROBO_VIGIA_META no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): sem o EXECUTE de PUBLIC revogado, "só estas funções" seria mentira.
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'robo_vigia_meta') as criar \gset
\if :criar
  create role robo_vigia_meta login;
\endif
alter role robo_vigia_meta with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 2 password :'senha';

grant connect on database :"DBNAME" to robo_vigia_meta;
grant usage on schema public to robo_vigia_meta;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from robo_vigia_meta;
revoke all on all sequences in schema public from robo_vigia_meta;
-- sem access_token (CORE_META=true: a Graph passa pelo proxy do core)
grant select (id, name, ad_account_id) on accounts to robo_vigia_meta;
grant execute on function gt_registrar_problemas(text, jsonb) to robo_vigia_meta;
-- fonte-pg.mjs: credencial do Zoho (só as colunas dele) e o registro da rodada
grant select (provedor, client_id, client_secret, refresh_token, data_center) on acessos_conexoes to robo_vigia_meta;
grant insert on robos_execucoes to robo_vigia_meta;
grant usage on sequence robos_execucoes_id_seq to robo_vigia_meta;
