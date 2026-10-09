import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dividir, limpar } from './limpar-dump.mjs'

test('dividir não corta ponto e vírgula dentro de $$ nem de aspas', () => {
  const sql = `create function f() returns text language plpgsql as $$ begin return 'a;b'; end $$;
select 1;`
  const c = dividir(sql)
  assert.equal(c.length, 2)
  assert.match(c[0], /return 'a;b'; end \$\$;$/)
})

test('dividir entende $tag$ com nome e aspas duplas e aspas dobradas', () => {
  const c = dividir(`create function g() returns int as $corpo$ select 1; $corpo$ language sql;
alter table "a;b" add column x text default 'it''s;ok';`)
  assert.equal(c.length, 2)
})

test('dividir mantém comentário junto do comando e linha \\meta do psql como item próprio', () => {
  const c = dividir(`\\restrict abc123\n-- Name: t; Type: TABLE\ncreate table t (id int);\n\\unrestrict abc123\n`)
  assert.equal(c.length, 3)
  assert.match(c[1], /^-- Name: t; Type: TABLE\ncreate table t/)
})

test('limpar remove policies, RLS, grants, publicações e extensões do Supabase', () => {
  const sql = `
create table t (id int);
alter table t enable row level security;
alter table t force row level security;
create policy "p ; x" on t for select to authenticated using (id = (select 1));
grant all on table t to anon;
revoke all on table t from authenticated;
alter default privileges in schema public grant all on tables to service_role;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pgcrypto with schema extensions;
create publication supabase_realtime;
`
  const r = limpar(sql)
  assert.deepEqual(r.removidos, { policies: 1, rls: 2, grants: 3, extensoes: 1, publicacoes: 1 })
  assert.deepEqual(r.reescritos, { fks_usuarios: 0 })
  assert.match(r.sql, /create table t/)
  assert.match(r.sql, /create extension if not exists pgcrypto/)
  assert.doesNotMatch(r.sql, /create policy|row level security|grant all|pg_cron|publication/i)
})

test('limpar NÃO remove o texto "create policy" que está dentro do corpo de uma função', () => {
  const sql = `create function cria() returns void language plpgsql as $f$
begin
  execute 'create policy x on t using (true)';
  perform 1; -- grant all on t to anon;
end $f$;`
  const r = limpar(sql)
  assert.equal(r.sql.trim(), sql.trim())
  assert.deepEqual(r.removidos, { policies: 0, rls: 0, grants: 0, extensoes: 0, publicacoes: 0 })
})

test('limpar reescreve FK para auth.users(id) em alter table e create table, mantendo o ON DELETE', () => {
  const sql = `alter table only public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
create table public.t (id int, u uuid references auth.users (id) on delete set null, v uuid references auth.users(id));`
  const r = limpar(sql)
  assert.equal(r.reescritos.fks_usuarios, 3)
  assert.match(r.sql, /references public\.usuarios\(id\) on delete cascade/i)
  assert.match(r.sql, /references public\.usuarios\(id\) on delete set null/i)
  assert.doesNotMatch(r.sql, /auth\.users/)
})

test('limpar NÃO mexe em "references auth.users" dentro de corpo de função nem de comentário', () => {
  const sql = `create function f() returns void language plpgsql as $$ begin perform 1; -- references auth.users(id)
  execute 'alter table t add foreign key (u) references auth.users(id)'; end $$;
-- alter table x add foreign key (u) references auth.users(id);
select 1;`
  const r = limpar(sql)
  assert.equal(r.sql, sql)
  assert.equal(r.reescritos.fks_usuarios, 0)
})

test('limpar mantém o resto do dump byte a byte', () => {
  const sql = `-- cabeçalho\nset check_function_bodies = false;\ncreate table a (id int);\ncomment on table a is 'x;y';\n`
  assert.equal(limpar(sql).sql, sql)
})
