-- As colunas do schema public de PRODUÇÃO (Supabase), uma linha por tabela.coluna: tipo | NOT NULL | default | gerada | identity.
-- Gerado em 15/10/2026 só com SELECT (sessão read only). Para refazer: psql <produção> -X -At -F $'\t' -f producao_colunas.sql | sort > producao_colunas.tsv
-- (o teste esquema_vs_producao_test.go compara o banco de teste com este arquivo; nada de dado, só estrutura)
set local timezone = 'UTC';
select c.relname || '.' || a.attname,
  regexp_replace(concat_ws(' | ', format_type(a.atttypid, a.atttypmod), case when a.attnotnull then 'NOT NULL' else 'null' end,
    coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), case when a.attgenerated <> '' then 'gerada' else '' end,
    case when a.attidentity <> '' then 'identity ' || a.attidentity::text else '' end), '\s+', ' ', 'g')
from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
order by 1;
