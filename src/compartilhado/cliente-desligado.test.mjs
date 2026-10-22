import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarClienteDesligado } from './cliente-desligado.js'

const sb = criarClienteDesligado()

test('auth: sem sessão e sem usuário, como o supabase-js com persistSession:false', async () => {
  assert.deepEqual(await sb.auth.getSession(), { data: { session: null }, error: null })
  assert.equal((await sb.auth.getUser()).data.user, null)
  assert.equal((await sb.auth.signOut({ scope: 'local' })).error, null)
  sb.auth.onAuthStateChange(() => {}).data.subscription.unsubscribe()
})

test('entrar, trocar senha e recuperar respondem erro (a conta mora na API)', async () => {
  for (const r of [await sb.auth.signInWithPassword({}), await sb.auth.updateUser({}), await sb.auth.resetPasswordForEmail('a@b.c')]) {
    assert.equal(r.error.code, 'supabase_desligado')
  }
})

test('from/rpc encadeados resolvem { data: null, error } sem lançar nem fazer rede', async () => {
  const antes = globalThis.fetch
  globalThis.fetch = () => { throw new Error('rede proibida') }
  try {
    const r = await sb.from('x').select('a,b').eq('a', 1).order('b').limit(5)
    assert.equal(r.data, null)
    assert.equal(r.error.code, 'supabase_desligado')
    assert.equal((await sb.rpc('f', { p: 1 })).error.code, 'supabase_desligado')
    assert.equal((await sb.functions.invoke('f')).error.code, 'supabase_desligado')
    assert.equal((await sb.storage.from('b').upload('p', new Blob())).error.code, 'supabase_desligado')
  } finally { globalThis.fetch = antes }
})

test('channel é encadeável e inerte', () => {
  sb.channel('c').on('x', () => {}).subscribe()
  return sb.removeChannel(sb.channel('c'))
})
