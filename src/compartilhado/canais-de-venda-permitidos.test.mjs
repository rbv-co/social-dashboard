import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canaisDaApi } from './canais-de-venda-permitidos.js'

test('canaisDaApi: null = vê todos; lista vira números', () => {
  assert.equal(canaisDaApi({ data: { canais: null }, error: null }, { escopoPorEquipe: true }), null)
  assert.deepEqual(canaisDaApi({ data: { canais: ['203', 7] }, error: null }, { escopoPorEquipe: true }), [203, 7])
  assert.deepEqual(canaisDaApi({ data: { canais: [] }, error: null }, {}), [])
})

test('canaisDaApi: falha cai no lado seguro — quem é limitado fica com [], nunca com tudo', () => {
  const falha = { data: null, error: { tipo: 'rede' } }
  assert.deepEqual(canaisDaApi(falha, { isSuperadmin: false, escopoPorEquipe: true }), [])
  assert.equal(canaisDaApi(falha, { isSuperadmin: true, escopoPorEquipe: true }), null)
  assert.equal(canaisDaApi(falha, { isSuperadmin: false, escopoPorEquipe: false }), null)
  // resposta fora do formato é falha, não "vê tudo"
  assert.deepEqual(canaisDaApi({ data: { outra: 1 }, error: null }, { escopoPorEquipe: true }), [])
  assert.deepEqual(canaisDaApi(undefined, { escopoPorEquipe: true }), [])
})
