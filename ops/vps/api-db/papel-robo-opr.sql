-- Papel `robo_opr`: robô opr-diario: lê campanhas, seguidores e eventos para o relatório diário. Lê tudo isso e grava só o cache visitas_perfil_dia (o upload da imagem em Storage é fase 2: em pg o robô a omite).
-- Menor privilégio: só as tabelas/colunas que o código do robô toca (levantamento do plano 02, ver o quadro robô→papel→env no
-- LEIA-ME.md). Nenhuma outra tabela, nenhuma função além das listadas no fim. No `api-db` não há RLS: o GRANT é a única tranca.
-- Quem precisar de coluna nova pede GRANT novo (o robô falha alto: `permission denied`), nunca `grant ... on all tables`.
--
-- Rodar como o dono do banco, DEPOIS do papel-copia.sql (que tira o EXECUTE de PUBLIC) e de `api migrar`. A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_ROBO_OPR="$(cat /root/secrets/robo-opr.senha)" docker exec -i -e SENHA_ROBO_OPR api-db psql -U api -d api < /root/api-db/papel-robo-opr.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-robos.teste.sh.
-- URL do robô (contêineres na rede `api_net`; o servidor não fala TLS):
--   ROBO_OPR_DIARIO_DATABASE_URL=postgres://robo_opr:<SENHA_ROBO_OPR>@api-db:5432/api?sslmode=disable
\set ON_ERROR_STOP on
\getenv senha SENHA_ROBO_OPR
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_ROBO_OPR no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): sem o EXECUTE de PUBLIC revogado, "só estas funções" seria mentira.
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'robo_opr') as criar \gset
\if :criar
  create role robo_opr login;
\endif
alter role robo_opr with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 3 password :'senha';

grant connect on database :"DBNAME" to robo_opr;
grant usage on schema public to robo_opr;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from robo_opr;
revoke all on all sequences in schema public from robo_opr;
-- sem access_token (CORE_META=true)
grant select (id, instagram_id) on accounts to robo_opr;
grant select (campaign_id, name, objective) on campaigns to robo_opr;
grant select on campaign_insights, followers_leituras to robo_opr;
grant select (tipo, dia_br) on chatwoot_eventos to robo_opr;
-- cache de visitas ao perfil: upsert por (account_id, dia) (salvarVisitasPerfilDoDia)
grant select, insert, update on visitas_perfil_dia to robo_opr;
