-- Fecha o EXECUTE de PUBLIC nas funções SECURITY DEFINER do api-db e no que o dono `api_app` criar daqui em diante.
--
-- Por quê (POS-VIRADA plano 03, item C): o papel-copia.sql revoga o EXECUTE de PUBLIC nas funções que EXISTEM quando roda, e foi
-- rodado ANTES do restore final do corte; as funções restauradas depois voltaram com o default do Postgres (PUBLIC pode executar).
-- Entre elas há 35 SECURITY DEFINER do dono api_app (conta_ativa, pode_ver_*, meus_vinculos, vessel_espelhar_agora,
-- frota_fechar_posse_orfa...): quem tivesse a senha de QUALQUER papel de robô as executaria com os poderes do dono. Os papéis de robô
-- foram desenhados para não poder isso (papel-robo-*.sql: "nenhuma função além das listadas").
--
-- Não mexe em ALTER DEFAULT PRIVILEGES: função nova do api_app continua nascendo com PUBLIC (mudar isso muda o contrato de
-- `api conferir`, que espera EXECUTE do `authenticated` nas RPCs); quem criar função definer nova reaplica este arquivo.
--
-- O que NÃO muda: a API/worker (api_app é o dono), os papéis com GRANT explícito (robo_cartoes, robo_pedidos_vessel,
-- robo_vigia_meta, anon/authenticated/service_role) e as funções NÃO-definer (auxiliares puras como fone11, que robôs chamam
-- por dentro de funções que rodam com os direitos DELES). Gatilho não checa EXECUTE ao disparar. Reaplicar é seguro.
--
-- Rodar como o dono do banco, depois de `api migrar`:
--   docker exec -i api-db psql -U api -d api -v ON_ERROR_STOP=1 -f - < ops/vps/api-db/revogar-execute-public.sql
-- Reverter: GRANT EXECUTE ON FUNCTION <assinatura> TO PUBLIC, uma a uma (o arquivo de reversão sai da foto da ACL antes da aplicação).
\set ON_ERROR_STOP on
begin;
select format('revoke execute on function %s from public', p.oid::regprocedure)
  from pg_proc p
 where p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace)
   and p.prosecdef
   and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
   and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
 order by p.oid::regprocedure::text \gexec
commit;
