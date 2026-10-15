-- Restrições (PK, UNIQUE, FK, CHECK) e índices do schema public de PRODUÇÃO, sem o nome (escrito à mão no esquema de teste):
-- tabela \t definição. Só SELECT. Para refazer: psql <produção> -X -At -F $'\t' -f producao_restricoes.sql | sort -u > producao_restricoes.tsv
select c.conrelid::regclass::text, c.contype::text || ' ' || regexp_replace(pg_get_constraintdef(c.oid), '\s+', ' ', 'g')
from pg_constraint c where c.connamespace = 'public'::regnamespace and c.contype in ('p', 'u', 'f', 'c')
union all
select t.relname::text, 'i ' || regexp_replace(pg_get_indexdef(ix.indexrelid), '^CREATE (UNIQUE )?INDEX \S+ ON (ONLY )?(public\.)?\S+ ', 'CREATE \1INDEX ')
from pg_index ix join pg_class t on t.oid = ix.indrelid
where t.relnamespace = 'public'::regnamespace and ix.indisunique and not exists (select 1 from pg_constraint k where k.conindid = ix.indexrelid)
order by 1, 2;
