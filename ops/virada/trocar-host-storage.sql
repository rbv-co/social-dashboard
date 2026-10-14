-- URLs públicas do Storage do Supabase gravadas no banco NOVO passam a apontar para a API (Plano 6, item 3: a rota
-- /storage/v1/object/public/{bucket}/* da API serve o mesmo caminho). Roda no api-db, como `api`, na janela, ANTES do
-- clone api_corte (o delta não leva o host novo de volta ao Supabase, que segue com o antigo). Só troca o prefixo
-- "<de>/storage/v1/object/public/" em colunas text/varchar/json/jsonb; sem gatilho (modo réplica: não enfileira
-- espelho nem mexe em updated_at). Ao fim, avisa o que AINDA cita supabase.co/storage (URL assinada, array): à mão.
-- Uso: psql -X -v ON_ERROR_STOP=1 -v de=https://<ref>.supabase.co -v para=https://central.rbvcompany.com/api -f trocar-host-storage.sql
\set ON_ERROR_STOP 1
begin;
set local session_replication_role = replica;
select set_config('virada.de', :'de' || '/storage/v1/object/public/', true),
       set_config('virada.para', :'para' || '/storage/v1/object/public/', true) \g /dev/null
do $$
declare r record; n bigint; total bigint := 0;
begin
  for r in select c.table_name t, c.column_name col, c.data_type tipo
             from information_schema.columns c
             join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
            where c.table_schema = 'public' and tb.table_type = 'BASE TABLE' and c.is_generated = 'NEVER'
              and c.data_type in ('text', 'character varying', 'json', 'jsonb')
            order by 1, 2 loop
    execute format('update public.%I set %I = replace(%I::text, $1, $2)::%s where strpos(%I::text, $1) > 0',
                   r.t, r.col, r.col, r.tipo, r.col)
      using current_setting('virada.de'), current_setting('virada.para');
    get diagnostics n = row_count;
    if n > 0 then raise notice 'trocado: %.% (% linhas)', r.t, r.col, n; total := total + n; end if;
  end loop;
  raise notice 'total trocado: % linhas', total;
  for r in select c.table_name t, c.column_name col
             from information_schema.columns c
             join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
            where c.table_schema = 'public' and tb.table_type = 'BASE TABLE'
              and (c.data_type in ('text', 'character varying', 'json', 'jsonb') or c.data_type = 'ARRAY')
            order by 1, 2 loop
    execute format('select count(*) from public.%I where strpos(%I::text, %L) > 0', r.t, r.col, 'supabase.co/storage') into n;
    if n > 0 then raise notice 'RESTOU (à mão): %.% (% linhas)', r.t, r.col, n; end if;
  end loop;
end $$;
commit;
