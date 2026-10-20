-- ETAPA 1 da eliminação de bling_tokens, estoque_do_site_estado e vessel_envios_ao_meta (plano 05 C). NÃO APLICADA.
-- Reversível por inteiro (1-revogar-reverter.sql). Aplicar à mão, como superusuário do api-db, DEPOIS do backup do runbook:
--   docker exec -i api-db sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < 1-revogar.sql
-- Tira o acesso de todo papel que a Central conhece MENOS o `copia`: a cópia diária lê TODAS as tabelas do banco
-- (guardar-copia-do-banco.mjs) e um `permission denied` aqui derrubaria a cópia inteira. O `copia` sai junto com a
-- tabela, na etapa 2. Se algum robô ainda dependia de uma das tabelas, ele falha ALTO (permission denied) nesta etapa,
-- e a reversão devolve tudo em segundos, sem perda de dado.
begin;
set local lock_timeout = '5s';
revoke all on table public.bling_tokens, public.estoque_do_site_estado, public.vessel_envios_ao_meta
  from anon, authenticated, service_role;
revoke select (id, access_token) on public.bling_tokens from robo_selo, robo_pedidos_vessel;
commit;
