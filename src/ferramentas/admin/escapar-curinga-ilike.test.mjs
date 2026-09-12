import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paraIlike } from './escapar-curinga-ilike.js'

test('escapa os curingas do ILIKE', () => {
  assert.equal(paraIlike('erick_martins@rbv.com'), 'erick\\_martins@rbv.com')
  assert.equal(paraIlike('a%b@rbv.com'), 'a\\%b@rbv.com')
  assert.equal(paraIlike('a\\b@rbv.com'), 'a\\\\b@rbv.com')
})

test('e-mail comum passa intacto', () => {
  assert.equal(paraIlike('erick.martins@rbv.com'), 'erick.martins@rbv.com')
})

test('a barra e escapada ANTES dos curingas, senao ela reescapa o proprio escape', () => {
  assert.equal(paraIlike('a\\_b'), 'a\\\\\\_b')
})

test('nao estoura com nulo', () => {
  assert.equal(paraIlike(null), '')
})

test('nao estoura com undefined nem string vazia', () => {
  assert.equal(paraIlike(undefined), '')
  assert.equal(paraIlike(''), '')
})

test('varios curingas seguidos escapam todos, cada um por si', () => {
  assert.equal(paraIlike('%_%'), '\\%\\_\\%')
})

test('o asterisco do PostgREST tambem e curinga e precisa escapar', () => {
  // O PostgREST traduz `*` para `%` em like/ilike — e-mail com `*` sem escapar
  // vira padrao aberto e casa conta de outra pessoa.
  assert.equal(paraIlike('a*@rbv.com'), 'a\\*@rbv.com')
  assert.equal(paraIlike('*'), '\\*')
})

test('a barra e escapada ANTES do asterisco tambem', () => {
  assert.equal(paraIlike('a\\*b'), 'a\\\\\\*b')
})
