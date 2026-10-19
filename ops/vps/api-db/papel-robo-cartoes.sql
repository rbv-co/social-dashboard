-- Papel `robo_cartoes`: robô de Cartões EAN (coletor/robo-de-cartoes.mjs + o vigia cartoes-ean-vigia.sh, serviço systemd na VPS).
-- Pega o pedido da fila, lê as peças (com o SKU do lote), guarda os ids dos arquivos no Zoho e devolve o resultado. Quem escreve de
-- verdade no pedido são as 3 funções `vessel_cartao_*` (security definer): o papel só recebe EXECUTE nelas, nunca UPDATE na tabela.
-- Menor privilégio: só as tabelas/colunas que coletor/lib/cartoes-dados.mjs toca. No `api-db` não há RLS: o GRANT é a única tranca.
-- Quem precisar de coluna nova pede GRANT novo (o robô falha alto: `permission denied`), nunca `grant ... on all tables`.
--
-- Rodar como o dono do banco, DEPOIS do papel-copia.sql (que tira o EXECUTE de PUBLIC) e de `api migrar`. A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_ROBO_CARTOES="$(cat /root/secrets/robo-cartoes.senha)" docker exec -i -e SENHA_ROBO_CARTOES api-db psql -U api -d api < /root/api-db/papel-robo-cartoes.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-robos.teste.sh.
-- Este robô NÃO passa pelo rodar-robo.sh (é serviço, não cron): a senha vai em CARTOES_DB_SENHA no /etc/cartoes-ean.env e o vigia monta
-- a URL (postgres://robo_cartoes@<ip do api-db>:5432/api?sslmode=disable, com PGPASSWORD no ambiente). O servidor não fala TLS.
\set ON_ERROR_STOP on
\getenv senha SENHA_ROBO_CARTOES
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_ROBO_CARTOES no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): sem o EXECUTE de PUBLIC revogado, "só estas funções" seria mentira.
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'robo_cartoes') as criar \gset
\if :criar
  create role robo_cartoes login;
\endif
-- limite 5: o robô abre uma conexão por operação (uma por vez por worker) e o vigia consulta a fila ao lado
alter role robo_cartoes with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 5 password :'senha';

grant connect on database :"DBNAME" to robo_cartoes;
grant usage on schema public to robo_cartoes;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from robo_cartoes;
revoke all on all sequences in schema public from robo_cartoes;
grant select (codigo, numero_na_serie, lote_id) on vessel_pecas to robo_cartoes;
grant select (id, sku) on vessel_lotes to robo_cartoes;
grant select (id, situacao, criado_em, pecas) on vessel_cartao_pedidos to robo_cartoes;
-- o upsert (on conflict ... do update ... = excluded.x) exige SELECT nas colunas que lê: sem ele dá `permission denied` (provado no teste)
grant select (codigo, nome, zoho_id, pasta_id, atualizado_em), insert (codigo, nome, zoho_id, pasta_id, atualizado_em),
  update (zoho_id, pasta_id, atualizado_em) on vessel_cartao_arquivos to robo_cartoes;
grant select (provedor, client_id, client_secret, refresh_token, data_center) on acessos_conexoes to robo_cartoes;
grant execute on function vessel_cartao_pegar_da_fila() to robo_cartoes;
grant execute on function vessel_cartao_pedido_terminou(uuid, boolean, text, text, text[]) to robo_cartoes;
grant execute on function vessel_cartao_recolocar_travados(integer) to robo_cartoes;
