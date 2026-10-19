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

import { apagarSessaoGuardadaDoSupabase } from './opcoes-do-supabase.js'
const falso = (o) => Object.assign(Object.create({ removeItem(k) { delete this[k] } }), o)

test('apaga só a sessão do supabase-js dos armazenamentos; a da API e o resto ficam', () => {
  const l = falso({ 'sb-abc-auth-token': '1', 'sb-abc-auth-token-code-verifier': '2', central_sessao_api: 'tok', tema: 'dark' })
  const s = falso({ 'sb-abc-auth-token': '1' })
  apagarSessaoGuardadaDoSupabase(l, s)
  assert.deepEqual(Object.keys(l).sort(), ['central_sessao_api', 'tema'])
  assert.deepEqual(Object.keys(s), [])
})

test('armazenamento que lança não derruba o login', () => {
  const ruim = { get length() { throw new Error('bloqueado') } }
  assert.doesNotThrow(() => apagarSessaoGuardadaDoSupabase(ruim, undefined))
})
