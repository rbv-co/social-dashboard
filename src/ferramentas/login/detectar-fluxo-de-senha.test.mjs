import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectarFluxoDeSenha, lerSegredoDoLink } from './detectar-fluxo-de-senha.js'

test('link de recuperacao no hash e detectado', () => {
  assert.equal(detectarFluxoDeSenha('#access_token=abc&type=recovery&expires_in=3600', ''), 'recovery')
})

test('link de convite no hash e detectado', () => {
  assert.equal(detectarFluxoDeSenha('#access_token=abc&type=invite', ''), 'invite')
})

test('type=recovery na query string tambem conta', () => {
  assert.equal(detectarFluxoDeSenha('', '?type=recovery&code=xyz'), 'recovery')
})

test('login normal nao dispara nada', () => {
  assert.equal(detectarFluxoDeSenha('', ''), null)
  assert.equal(detectarFluxoDeSenha('#', '?foo=bar'), null)
})

test('type desconhecido nao dispara', () => {
  assert.equal(detectarFluxoDeSenha('#access_token=abc&type=magiclink', ''), null)
})

test('signup nao e tratado como convite', () => {
  assert.equal(detectarFluxoDeSenha('#access_token=abc&type=signup', ''), null)
})

test('API em Go: link de senha traz o tipo e o token no hash', () => {
  const hash = '#type=recovery&token=abc_DEF-123'
  assert.equal(detectarFluxoDeSenha(hash, ''), 'recovery')
  assert.deepEqual(lerSegredoDoLink(hash), { tokenDeSenha: 'abc_DEF-123', sessao: null })
  assert.equal(detectarFluxoDeSenha('#type=invite&token=x', ''), 'invite')
})

test('API em Go: aba de "entrar como" traz a sessão no hash; hash vazio não traz nada', () => {
  assert.deepEqual(lerSegredoDoLink('#sessao=tok'), { tokenDeSenha: null, sessao: 'tok' })
  assert.deepEqual(lerSegredoDoLink(''), { tokenDeSenha: null, sessao: null })
  assert.deepEqual(lerSegredoDoLink('#access_token=abc&type=recovery'), { tokenDeSenha: null, sessao: null })
})
