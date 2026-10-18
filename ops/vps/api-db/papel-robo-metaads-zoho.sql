-- Papel `robo_metaads_zoho`: robô meta-ads-no-zoho: lê campanhas/anúncios/leads e as credenciais do Zoho. Só leitura.
-- Menor privilégio: só as tabelas/colunas que o código do robô toca (levantamento do plano 02, ver o quadro robô→papel→env no
-- LEIA-ME.md). Nenhuma outra tabela, nenhuma função além das listadas no fim. No `api-db` não há RLS: o GRANT é a única tranca.
-- Quem precisar de coluna nova pede GRANT novo (o robô falha alto: `permission denied`), nunca `grant ... on all tables`.
--
-- Rodar como o dono do banco, DEPOIS do papel-copia.sql (que tira o EXECUTE de PUBLIC) e de `api migrar`. A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_ROBO_METAADS_ZOHO="$(cat /root/secrets/robo-metaads-zoho.senha)" docker exec -i -e SENHA_ROBO_METAADS_ZOHO api-db psql -U api -d api < /root/api-db/papel-robo-metaads-zoho.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-robos.teste.sh.
-- URL do robô (contêineres na rede `api_net`; o servidor não fala TLS):
--   ROBO_META_ADS_NO_ZOHO_DATABASE_URL=postgres://robo_metaads_zoho:<SENHA_ROBO_METAADS_ZOHO>@api-db:5432/api?sslmode=disable
\set ON_ERROR_STOP on
\getenv senha SENHA_ROBO_METAADS_ZOHO
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_ROBO_METAADS_ZOHO no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): sem o EXECUTE de PUBLIC revogado, "só estas funções" seria mentira.
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'robo_metaads_zoho') as criar \gset
\if :criar
  create role robo_metaads_zoho login;
\endif
alter role robo_metaads_zoho with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 3 password :'senha';

grant connect on database :"DBNAME" to robo_metaads_zoho;
grant usage on schema public to robo_metaads_zoho;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from robo_metaads_zoho;
revoke all on all sequences in schema public from robo_metaads_zoho;
grant select (id, name, ad_account_id) on accounts to robo_metaads_zoho;
grant select on campaigns, campaign_insights, ads, ad_insights_hora, gt_problemas_meta to robo_metaads_zoho;
grant select (nome, whatsapp, email, criado_em, utm_source, utm_medium, utm_campaign, utm_content, utm_term, clique_meta, origem) on vessel_lista_espera to robo_metaads_zoho;
-- só o que o Zoho usa: sem oauth_state, conectado_por etc.
grant select (provedor, client_id, client_secret, refresh_token, data_center) on acessos_conexoes to robo_metaads_zoho;
grant select (pedido_id, total_corrigido) on bling_pedido_ajuste_valor to robo_metaads_zoho;
