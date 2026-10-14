-- Papel de conexão da API e do worker SEM superusuário (spec §3.2): `api_app` vira dono dos objetos do
-- banco restaurado e das funções do compat. O `api` (POSTGRES_USER do api-db) segue superusuário só para
-- administração (restore, backup, papéis). Rodar DEPOIS do restore e do `importar-usuarios`, ANTES de subir a API,
-- e DEPOIS do ops/vps/api-db/papel-copia.sql (o fim deste arquivo estende ao api_app o SELECT padrão do `copia`).
-- Sem RLS no banco novo (o limpar-dump tira; a autorização é do Go): dono basta, sem BYPASSRLS.
-- Uso (no api-db, como `api`): psql -v ON_ERROR_STOP=1 -v senha="$(cat /root/secrets/api-app.senha)" -f papel-da-api.sql
-- Reaplicar é seguro: troca a senha e refaz os donos.
\set ON_ERROR_STOP 1
select format('create role api_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password %L', :'senha')
 where not exists (select 1 from pg_roles where rolname = 'api_app') \gexec
select format('alter role api_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password %L', :'senha') \gexec

begin;
alter schema public owner to api_app;
alter schema auth owner to api_app;
grant usage on schema extensions to api_app;
-- tabelas, visões e sequências soltas (a sequência de coluna serial/identity acompanha a tabela)
select format('alter %s %s owner to api_app',
              case c.relkind when 'S' then 'sequence' when 'v' then 'view' when 'm' then 'materialized view'
                             when 'f' then 'foreign table' else 'table' end, c.oid::regclass)
  from pg_class c
 where c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace)
   and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
   and pg_get_userbyid(c.relowner) <> 'api_app'
   and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid
                      and d.deptype in ('a', 'i') and c.relkind = 'S')
 order by c.relkind = 'S', c.oid \gexec
-- funções e procedimentos (fora os membros de extensão: pgcrypto/uuid-ossp ficam com o `api`, EXECUTE de PUBLIC)
select format('alter routine %s owner to api_app', p.oid::regprocedure)
  from pg_proc p
 where p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace)
   and pg_get_userbyid(p.proowner) <> 'api_app'
   and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') \gexec
-- tipos próprios (enum, domínio, composto solto); o tipo-linha e o array acompanham a tabela/o tipo
select format('alter type %s owner to api_app', t.oid::regtype)
  from pg_type t
 where t.typnamespace in ('public'::regnamespace, 'auth'::regnamespace)
   and (t.typtype in ('e', 'd', 'r') or (t.typtype = 'c' and (select relkind from pg_class where oid = t.typrelid) = 'c'))
   and pg_get_userbyid(t.typowner) <> 'api_app' \gexec
-- tabelas criadas daqui em diante (goose, pelo api_app) também ficam legíveis para a cópia do Zoho
select 'alter default privileges for role api_app in schema public grant select on tables to copia'
 where exists (select 1 from pg_roles where rolname = 'copia') \gexec
commit;

-- conferência: nada no public/auth fora do api_app (exceto membros de extensão); o papel não é superusuário
select 'sobrou_de_outro_dono', count(*)
  from pg_class c
 where c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace) and pg_get_userbyid(c.relowner) <> 'api_app';
select 'api_app', rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication from pg_roles where rolname = 'api_app';
