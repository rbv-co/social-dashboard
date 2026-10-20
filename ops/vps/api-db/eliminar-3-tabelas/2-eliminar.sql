-- ETAPA 2 (IRREVERSÍVEL sem o backup): elimina bling_tokens, estoque_do_site_estado e vessel_envios_ao_meta. NÃO APLICADA.
-- NÃO é migration do goose (não está em api/internal/banco/migracoes/ de propósito: `api migrar` a aplicaria sozinha no
-- próximo deploy). Aplicar à mão, só com a aprovação do dono, depois da etapa 1 observada e do backup do runbook.
--   docker exec -i api-db sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < 2-eliminar.sql
-- Sem CASCADE: dependência escondida (view, FK, função) faz o DROP FALHAR em vez de levar junto. Tudo numa transação.
begin;
set local lock_timeout = '5s';
do $$
begin
  -- vessel_envios_ao_meta tem de estar vazia (hoje: 0 linhas; o CAPI é do Core): se tiver linha, alguém voltou a gravar.
  if (select count(*) from public.vessel_envios_ao_meta) > 0 then
    raise exception 'vessel_envios_ao_meta tem linhas: alguem voltou a usar a tabela; abortando o DROP';
  end if;
  -- ninguém pode ter gravado em bling_tokens/estoque_do_site_estado desde a etapa 1 (revogada): as linhas continuam as do backup.
  if (select count(*) from public.bling_tokens) > 1 or (select count(*) from public.estoque_do_site_estado) > 2 then
    raise exception 'bling_tokens/estoque_do_site_estado ganharam linhas desde o backup; abortando o DROP';
  end if;
end $$;
drop table public.vessel_envios_ao_meta;
drop table public.estoque_do_site_estado;
drop table public.bling_tokens;
commit;
