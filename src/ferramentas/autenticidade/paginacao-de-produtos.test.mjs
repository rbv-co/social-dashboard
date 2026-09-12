import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fatiarProdutos, numerosDePagina, PRODUTOS_POR_PAGINA } from './produtos-do-bling.js'

const lista = (n) => Array.from({ length: n }, (_, i) => ({ codigo: `SS${i}` }))

test('a lista inteira e fatiada, e nao cortada em 12', () => {
  const r = fatiarProdutos(lista(95), 1)
  assert.equal(r.total, 95)
  assert.equal(r.paginas, Math.ceil(95 / PRODUTOS_POR_PAGINA))
  assert.equal(r.itens.length, PRODUTOS_POR_PAGINA)
})

test('a ultima pagina traz o resto, e nao uma pagina cheia', () => {
  const r = fatiarProdutos(lista(95), 4)
  assert.equal(r.itens.length, 95 - 3 * PRODUTOS_POR_PAGINA)
  assert.equal(r.itens.at(-1).codigo, 'SS94')
})

test('⚠️ PAGINA FORA DO INTERVALO E PRESA, e nao devolve lista vazia', () => {
  // Estar na pagina 9 e digitar uma busca curta deixaria a pessoa olhando uma
  // lista vazia com resultados existindo — parece defeito da busca.
  assert.equal(fatiarProdutos(lista(10), 9).pagina, 1)
  assert.equal(fatiarProdutos(lista(10), 9).itens.length, 10)
  assert.equal(fatiarProdutos(lista(10), 0).pagina, 1)
  assert.equal(fatiarProdutos(lista(10), -3).pagina, 1)
})

test('lista vazia tem UMA pagina, e nao zero', () => {
  const r = fatiarProdutos([], 1)
  assert.equal(r.paginas, 1)
  assert.deepEqual(r.itens, [])
})

test('poucos numeros: aparecem todos, sem reticencia', () => {
  assert.deepEqual(numerosDePagina(1, 4), [1, 2, 3, 4])
})

test('muitos numeros: primeira, ultima e a janela em volta da atual', () => {
  assert.deepEqual(numerosDePagina(10, 20), [1, null, 8, 9, 10, 11, 12, null, 20])
})

test('no comeco e no fim nao sobra reticencia de um lado so', () => {
  assert.deepEqual(numerosDePagina(1, 20), [1, 2, 3, null, 20])
  assert.deepEqual(numerosDePagina(20, 20), [1, null, 18, 19, 20])
})

test('uma pagina so devolve so o 1', () => {
  assert.deepEqual(numerosDePagina(1, 1), [1])
  assert.deepEqual(numerosDePagina(5, 1), [1], 'pagina invalida nao inventa numero')
})
