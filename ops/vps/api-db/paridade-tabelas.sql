-- Impressão digital do banco (só SELECT): por tabela do public, linhas e md5 do conteúdo (independe da ordem física);
-- sequences (last_value); contagem de objetos; e um md5 dos GRANTs (ACL nula = padrão do dono, normalizada: o pg_dump
-- omite a que é igual ao padrão, e `{dono=rwU/dono}` explícito é a mesma coisa). Igual nos dois lados da comparação.
select 'T ' || c.relname || ' ' ||
       (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', c.relname), false, true, '')))[1]::text || ' ' ||
       (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(md5(t::text), '''' order by md5(t::text)), '''')) h from public.%I t', c.relname), false, true, '')))[1]::text
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and not c.relispartition
 order by c.relname;
select 'S ' || sequencename || ' ' || coalesce(last_value::text, 'null') from pg_sequences where schemaname = 'public' order by sequencename;
select 'O indices '  || count(*) from pg_indexes where schemaname = 'public';
select 'O constraints ' || count(*) from pg_constraint where connamespace = 'public'::regnamespace;
select 'O funcoes '  || count(*) from pg_proc where pronamespace = 'public'::regnamespace;
select 'O gatilhos ' || count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal;
select 'O views '    || count(*) from pg_views where schemaname = 'public';
select 'O papeis '   || count(*) from pg_roles where rolname !~ '^pg_' and rolname <> 'postgres';  -- o contêiner de teste tem `postgres`; o api-db só `api`
select 'O grants '   || md5(string_agg(c.relname || ':' || coalesce(c.relacl, acldefault((case c.relkind when 'S' then 's' else 'r' end)::"char", c.relowner))::text, ',' order by c.relname)) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','S');
-- GRANTs das funções (EXECUTE de PUBLIC incluído; padrão do dono normalizado): o dump do Supabase voltava com PUBLIC EXECUTE
-- e o revogar-execute-public.sql tira; a restauração tem de trazer o estado de produção, não o de fábrica.
select 'O grants_funcoes ' || count(*) || ' ' || md5(string_agg(p.oid::regprocedure::text || ':' || (select string_agg((case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end) || a.privilege_type || a.is_grantable::text || pg_get_userbyid(a.grantor), ',' order by (case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end), a.privilege_type) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), ',' order by p.oid::regprocedure::text))
  from pg_proc p where p.pronamespace = 'public'::regnamespace;
