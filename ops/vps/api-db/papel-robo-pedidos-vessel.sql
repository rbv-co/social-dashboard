-- Papel `robo_pedidos_vessel`: robô pedidos-da-vessel (trazer-vendedores/pedidos-do-bling.mjs): traz vendedores e pedidos do Bling para o espelho da Vessel.
-- Menor privilégio: só as tabelas/colunas que o código do robô toca (levantamento do plano 02, ver o quadro robô→papel→env no
-- LEIA-ME.md). Nenhuma outra tabela, nenhuma função além das listadas no fim. No `api-db` não há RLS: o GRANT é a única tranca.
-- Quem precisar de coluna nova pede GRANT novo (o robô falha alto: `permission denied`), nunca `grant ... on all tables`.
--
-- Rodar como o dono do banco, DEPOIS do papel-copia.sql (que tira o EXECUTE de PUBLIC) e de `api migrar`. A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_ROBO_PEDIDOS_VESSEL="$(cat /root/secrets/robo-pedidos-vessel.senha)" docker exec -i -e SENHA_ROBO_PEDIDOS_VESSEL api-db psql -U api -d api < /root/api-db/papel-robo-pedidos-vessel.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-robos.teste.sh.
-- URL do robô (contêineres na rede `api_net`; o servidor não fala TLS):
--   ROBO_PEDIDOS_DA_VESSEL_DATABASE_URL=postgres://robo_pedidos_vessel:<SENHA_ROBO_PEDIDOS_VESSEL>@api-db:5432/api?sslmode=disable
\set ON_ERROR_STOP on
\getenv senha SENHA_ROBO_PEDIDOS_VESSEL
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_ROBO_PEDIDOS_VESSEL no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): sem o EXECUTE de PUBLIC revogado, "só estas funções" seria mentira.
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'robo_pedidos_vessel') as criar \gset
\if :criar
  create role robo_pedidos_vessel login;
\endif
alter role robo_pedidos_vessel with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 4 password :'senha';

grant connect on database :"DBNAME" to robo_pedidos_vessel;
grant usage on schema public to robo_pedidos_vessel;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from robo_pedidos_vessel;
revoke all on all sequences in schema public from robo_pedidos_vessel;
grant select (id, access_token) on bling_tokens to robo_pedidos_vessel;
grant select, insert, update on vessel_vendedores_bling to robo_pedidos_vessel;
grant select, insert, update on vessel_pedidos to robo_pedidos_vessel;
grant usage on sequence vessel_pedidos_id_seq to robo_pedidos_vessel;
grant select, insert, delete on vessel_pedido_itens to robo_pedidos_vessel;
grant usage on sequence vessel_pedido_itens_id_seq to robo_pedidos_vessel;
grant select, insert, update, delete on bling_pedido_forma_pagamento to robo_pedidos_vessel;
grant select on bling_pedido_nota to robo_pedidos_vessel;
grant select (bling_vendedor_id) on vessel_client_advisors to robo_pedidos_vessel;
grant select (id, telefone, bling_contato_id) on vessel_pessoas to robo_pedidos_vessel;
grant update (bling_contato_id) on vessel_pessoas to robo_pedidos_vessel;
-- lista de espera: sem senha_hash nem ip_hash
grant select (id, nome, email, whatsapp, origem, criado_em, bling_id) on vessel_lista_espera to robo_pedidos_vessel;
grant execute on function vessel_chave_do_nome(text) to robo_pedidos_vessel;
-- vessel_chave_do_nome é SECURITY INVOKER e chama unaccent_simples
grant execute on function unaccent_simples(text) to robo_pedidos_vessel;
grant select (pedido_id, total_corrigido) on bling_pedido_ajuste_valor to robo_pedidos_vessel;
