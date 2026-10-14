import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recusaDoPortao, clienteDoSelo, SEM_FRASE } from './cliente-do-selo.js'

test('403 sem frase vira o `ok:false, sem_permissao` que as telas já tratam', () => {
  const r = recusaDoPortao({ data: null, error: { status: 403, message: SEM_FRASE } })
  assert.deepEqual(r, { data: { ok: false, motivo: 'sem_permissao' }, error: null })
})

test('403 COM frase ("entrar como") continua erro, com a frase', () => {
  const e = { status: 403, message: 'Quem entrou como outra pessoa só consulta.' }
  assert.deepEqual(recusaDoPortao({ data: null, error: e }), { data: null, error: e })
})

test('sucesso, recusa de negócio (200 ok:false) e outros erros passam intactos', () => {
  for (const r of [{ data: { ok: true }, error: null }, { data: { ok: false, motivo: 'esta_gravada' }, error: null },
    { data: null, error: { status: 500, message: 'x' } }, { data: null, error: { status: 429, message: SEM_FRASE } }]) {
    assert.equal(recusaDoPortao(r), r)
  }
})

test('chave desligada: from, rpc e o resto são os do supabase-js (ligados ao cliente)', async () => {
  const visto = []
  const sb = {
    from: (t) => ({ tabela: t }), rpc: async (n, a) => { visto.push([n, a]); return { data: 1, error: null } },
    auth: { x: 1 }, functions: { invoke() { return this === sb.functions } },
  }
  const c = clienteDoSelo(sb)
  assert.deepEqual(c.from('vessel_lotes'), { tabela: 'vessel_lotes' })
  assert.deepEqual(await c.rpc('vessel_alertas', { a: 1 }), { data: 1, error: null })
  assert.deepEqual(visto, [['vessel_alertas', { a: 1 }]])
  assert.equal(c.auth.x, 1)
  assert.equal(c.functions.invoke(), true)
})
