import test from 'node:test'
import assert from 'node:assert/strict'
import { opcoesDoSupabase } from './opcoes-do-supabase.js'

test('conta na API: o supabase-js não guarda nem renova sessão (nenhum pedido ao Supabase ao abrir)', () => {
  assert.deepEqual(opcoesDoSupabase(true, null), { auth: { persistSession: false, autoRefreshToken: false } })
  assert.deepEqual(opcoesDoSupabase(true, {}), { auth: { persistSession: false, autoRefreshToken: false } })
})

test('conta no Supabase (como hoje): nada muda; a aba "entrar como" segue com o storage dela', () => {
  assert.equal(opcoesDoSupabase(false, null), undefined)
  const s = {}
  assert.deepEqual(opcoesDoSupabase(false, s), { auth: { storage: s } })
})
