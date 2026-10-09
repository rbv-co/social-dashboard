import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogo } from './policies.mjs'

const um = (sql) => catalogo([{ nome: 'a.sql', sql }])

test('extrai tabela, nome, comando, using e with check', () => {
  const [p] = um(`create policy "User le proprias" on public.user_permissions
    for select to authenticated using (auth.uid() = user_id) with check (true);`)
  assert.equal(p.tabela, 'user_permissions')
  assert.equal(p.nome, 'user le proprias')
  assert.equal(p.comando, 'select')
  assert.deepEqual(p.papeis, ['authenticated'])
  assert.equal(p.using, 'auth.uid() = user_id')
  assert.equal(p.withCheck, 'true')
})

test('sem FOR o comando é all e sem TO o papel é public', () => {
  const [p] = um(`create policy x on t using (true);`)
  assert.equal(p.comando, 'all')
  assert.deepEqual(p.papeis, ['public'])
})

test('using com parênteses aninhados e ponto e vírgula dentro de texto', () => {
  const [p] = um(`create policy x on t for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'a;b'));`)
  assert.equal(p.using, "exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'a;b')")
})

test('drop policy remove e create posterior substitui', () => {
  const r = catalogo([
    { nome: '1.sql', sql: `create policy x on t for select using (true); create policy y on t using (true);` },
    { nome: '2.sql', sql: `drop policy if exists y on t; create policy x on t for select using (false);` },
  ])
  assert.equal(r.length, 1)
  assert.equal(r[0].nome, 'x')
  assert.equal(r[0].using, 'false')
  assert.equal(r[0].arquivo, '2.sql')
})

test('ignora policy dentro de comentário', () => {
  assert.equal(um(`-- create policy x on t using (true);\n/* create policy y on t using (true); */`).length, 0)
})

test('papéis múltiplos', () => {
  const [p] = um(`create policy x on t for select to anon, authenticated using (true);`)
  assert.deepEqual(p.papeis, ['anon', 'authenticated'])
})
