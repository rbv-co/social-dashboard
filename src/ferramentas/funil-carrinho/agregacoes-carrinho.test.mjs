import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankearProdutos, ordenarAbandonados, foiCortado, agruparPorSessao, LIMITE_CARRINHO } from './agregacoes-carrinho.js'

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

test('agruparPorSessao: sessão com mais de um evento vira grupo expansível', () => {
  const linhas = [
    { id: 1, session_id: 's1', tipo: 'sessao_iniciada', criado_em: '2026-09-18T10:00:00Z' },
    { id: 2, session_id: 's1', tipo: 'produto_adicionado', criado_em: '2026-09-18T10:01:00Z' },
  ]
  const r = agruparPorSessao(linhas)
  assert.equal(r.length, 1)
  assert.equal(r[0].agrupado, true)
  assert.equal(r[0].session_id, 's1')
  assert.deepEqual(r[0].eventos.map((e) => e.id), [1, 2])
})

test('agruparPorSessao: sessão com um evento só não vira grupo (nada pra expandir)', () => {
  const linhas = [{ id: 1, session_id: 's1', tipo: 'sessao_iniciada', criado_em: '2026-09-18T10:00:00Z' }]
  const r = agruparPorSessao(linhas)
  assert.equal(r.length, 1)
  assert.equal(r[0].agrupado, undefined)
  assert.equal(r[0].id, 1)
})

test('agruparPorSessao: sem session_id nunca agrupa, mesmo repetido (ex.: checkout_iniciado do webhook)', () => {
  const linhas = [
    { id: 1, session_id: null, tipo: 'checkout_iniciado', criado_em: '2026-09-18T10:00:00Z' },
    { id: 2, session_id: null, tipo: 'checkout_iniciado', criado_em: '2026-09-18T10:01:00Z' },
  ]
  const r = agruparPorSessao(linhas)
  assert.equal(r.length, 2)
  assert.ok(r.every((item) => !item.agrupado))
})

test('agruparPorSessao: dentro do grupo fica do mais antigo pro mais novo (a narrativa da visita)', () => {
  const linhas = [
    { id: 2, session_id: 's1', tipo: 'produto_adicionado', criado_em: '2026-09-18T10:05:00Z' },
    { id: 1, session_id: 's1', tipo: 'sessao_iniciada', criado_em: '2026-09-18T10:00:00Z' },
    { id: 3, session_id: 's1', tipo: 'checkout_iniciado', criado_em: '2026-09-18T10:10:00Z' },
  ]
  const [grupo] = agruparPorSessao(linhas)
  assert.deepEqual(grupo.eventos.map((e) => e.id), [1, 2, 3])
})

test('agruparPorSessao: a lista toda ordena pelo evento mais recente de cada item/grupo', () => {
  const linhas = [
    { id: 1, session_id: 's1', tipo: 'sessao_iniciada', criado_em: '2026-09-18T09:00:00Z' },
    { id: 2, session_id: 's1', tipo: 'produto_adicionado', criado_em: '2026-09-18T09:05:00Z' },
    { id: 3, session_id: null, tipo: 'checkout_iniciado', criado_em: '2026-09-18T10:00:00Z' },
  ]
  const r = agruparPorSessao(linhas)
  assert.equal(r[0].id, 3)
  assert.equal(r[1].session_id, 's1')
})

test('agruparPorSessao: lista vazia não quebra', () => {
  assert.deepEqual(agruparPorSessao([]), [])
  assert.deepEqual(agruparPorSessao(undefined), [])
})
