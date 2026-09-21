import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankearProdutos, ordenarAbandonados, foiCortado, contarSessoesUnicas, LIMITE_CARRINHO } from './agregacoes-carrinho.js'

test('rankeia por número de eventos, do maior pro menor', () => {
  const linhas = [
    { produto_titulo: 'Bolsa Aurora' }, { produto_titulo: 'Bolsa Aurora' },
    { produto_titulo: 'Cinto Preto' },
    { produto_titulo: 'Bolsa Aurora' },
  ]
  assert.deepEqual(rankearProdutos(linhas), [
    { produto_titulo: 'Bolsa Aurora', contagem: 3 },
    { produto_titulo: 'Cinto Preto', contagem: 1 },
  ])
})

test('conta eventos, não soma quantidade — cada evento é uma vez que alguém mexeu no carrinho', () => {
  const linhas = [{ produto_titulo: 'Bolsa Aurora' }, { produto_titulo: 'Bolsa Aurora' }]
  assert.equal(rankearProdutos(linhas)[0].contagem, 2)
})

test('produto sem título não quebra o ranking', () => {
  const r = rankearProdutos([{ produto_titulo: null }, {}])
  assert.equal(r[0].produto_titulo, '(sem título)')
  assert.equal(r[0].contagem, 2)
})

test('período vazio devolve lista vazia, nunca quebra', () => {
  assert.deepEqual(rankearProdutos([]), [])
  assert.deepEqual(rankearProdutos(undefined), [])
})

test('abandonados: mais recente primeiro', () => {
  const linhas = [
    { cart_token: 'a', iniciado_em: '2026-09-01T10:00:00Z', ultimo_evento: '2026-09-01T10:05:00Z' },
    { cart_token: 'b', iniciado_em: '2026-09-02T09:00:00Z', ultimo_evento: '2026-09-02T09:30:00Z' },
  ]
  const r = ordenarAbandonados(linhas)
  assert.equal(r[0].cart_token, 'b')
})

test('abandonados: lista vazia não quebra', () => {
  assert.deepEqual(ordenarAbandonados([]), [])
  assert.deepEqual(ordenarAbandonados(undefined), [])
})

test('foiCortado: só acusa corte quando bate EXATAMENTE no teto do .limit()', () => {
  assert.equal(foiCortado(new Array(LIMITE_CARRINHO)), true)
  assert.equal(foiCortado(new Array(LIMITE_CARRINHO - 1)), false)
})

test('foiCortado: entrada que não é array nunca acusa corte', () => {
  assert.equal(foiCortado(undefined), false)
  assert.equal(foiCortado(null), false)
})

test('contarSessoesUnicas: conta session_id distintos, não linhas', () => {
  const linhas = [{ session_id: 'a' }, { session_id: 'a' }, { session_id: 'b' }]
  assert.equal(contarSessoesUnicas(linhas), 2)
})

test('contarSessoesUnicas: ignora session_id nulo/vazio', () => {
  assert.equal(contarSessoesUnicas([{ session_id: null }, { session_id: '' }, {}]), 0)
})

test('contarSessoesUnicas: período vazio devolve zero, nunca quebra', () => {
  assert.equal(contarSessoesUnicas([]), 0)
  assert.equal(contarSessoesUnicas(undefined), 0)
})
