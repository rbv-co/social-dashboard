import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparPorLote, abrirPorPadrao, contagemDoGrupo } from './lotes.js'

const L1 = { id: 'l1', modelo: 'Handbag Lunea', cor: 'Fendi e Café', sku: 'H0009S' }
const L2 = { id: 'l2', modelo: 'De Ombro Grande Nice', cor: 'Caramelo', sku: 'SS1025' }
const lotes = { l1: L1, l2: L2 }
const loteDaPeca = (id) => lotes[id] || null

const P = (codigo, lote_id, n, gravada_em) => ({ codigo, lote_id, numero_na_serie: n, gravada_em })
const TRES = [
  P('AAA', 'l1', 1, '2026-09-03T10:00:00Z'),
  P('BBB', 'l2', 1, '2026-09-02T10:00:00Z'),
  P('CCC', 'l1', 2, '2026-09-01T10:00:00Z'),
]

test('as etiquetas se juntam sob o lote delas', () => {
  const g = agruparPorLote(TRES, { loteDaPeca })
  assert.equal(g.length, 2)
  assert.deepEqual(g.map((x) => x.lote.modelo), ['Handbag Lunea', 'De Ombro Grande Nice'])
  assert.deepEqual(g[0].etiquetas.map((e) => e.codigo), ['AAA', 'CCC'])
})

test('⚠️ A ORDEM QUE CHEGOU E PRESERVADA', () => {
  // O lote herda a posicao da sua etiqueta mais nova. Reordenar aqui faria a
  // lista pular de lugar entre uma busca e outra.
  const g = agruparPorLote(TRES, { loteDaPeca })
  assert.equal(g[0].chave, 'l1', 'o lote da etiqueta mais recente tem de vir primeiro')
})

test('lote que o sistema nao conhece nao vira lote inventado', () => {
  const g = agruparPorLote([P('ZZZ', 'sumiu', 1, '2026-09-01T10:00:00Z')], { loteDaPeca })
  assert.equal(g.length, 1)
  assert.equal(g[0].etiquetas.length, 1)
  assert.ok(!g[0].lote.modelo, 'inventou modelo para um lote que nao existe')
})

test('a contagem diz gravadas DE quantas', () => {
  const g = agruparPorLote(TRES, { loteDaPeca, totalDoLote: (id) => (id === 'l1' ? 12 : 1) })
  assert.equal(contagemDoGrupo(g[0]), '2 de 12 gravadas')
  assert.equal(contagemDoGrupo(g[1]), '1 gravada')
})

test('sem total conhecido, a contagem nao inventa "de N"', () => {
  const g = agruparPorLote(TRES, { loteDaPeca })
  assert.equal(contagemDoGrupo(g[0]), '2 gravadas')
})

// ══ A REGRA QUE DECIDE SE A TELA PRESTA ══

test('⚠️ BUSCANDO, TODOS OS GRUPOS ABREM', () => {
  // Arvore fechada com busca ativa parece que nao achou nada: a pessoa digita
  // um codigo, ve uma linha de lote fechada, e conclui que a busca quebrou.
  const g = agruparPorLote(TRES, { loteDaPeca })
  assert.deepEqual(abrirPorPadrao(g, { buscando: true }), ['l1', 'l2'])
})

test('sem busca e com varios lotes, nasce tudo fechado', () => {
  const g = agruparPorLote(TRES, { loteDaPeca })
  assert.deepEqual(abrirPorPadrao(g, { buscando: false }), [])
})

test('⚠️ UM LOTE SO ABRE SOZINHO', () => {
  // Uma arvore de uma linha fechada e uma tela escondendo tudo o que tem para
  // mostrar. Hoje existe exatamente UM lote no sistema.
  const g = agruparPorLote([P('AAA', 'l1', 1, '2026-09-03T10:00:00Z')], { loteDaPeca })
  assert.deepEqual(abrirPorPadrao(g, { buscando: false }), ['l1'])
})

test('lista vazia nao estoura', () => {
  assert.deepEqual(agruparPorLote(null, { loteDaPeca }), [])
  assert.deepEqual(abrirPorPadrao(null, {}), [])
  assert.equal(contagemDoGrupo(null), '0 gravadas')
})
