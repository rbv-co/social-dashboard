import { test } from 'node:test'
import assert from 'node:assert/strict'
import { valorDoCampo, metaPorDia, mudancas, reescalarDiarias, rotuloDeVendedora, agruparPorLoja } from './metas.js'

test('valorDoCampo entende o jeito brasileiro de digitar', () => {
  assert.equal(valorDoCampo('R$ 74.151,13'), 74151.13)
  assert.equal(valorDoCampo('74151,13'), 74151.13)
  assert.equal(valorDoCampo('60000'), 60000)
  assert.equal(valorDoCampo(''), null)
  assert.equal(valorDoCampo('   '), null)
  assert.ok(Number.isNaN(valorDoCampo('abc')))
})

test('metaPorDia divide pelos dias do mês (setembro tem 30)', () => {
  assert.equal(metaPorDia(30000, 2026, 9), 1000)
  assert.equal(metaPorDia(31000, 2026, 10), 1000)
})

test('mudancas só devolve o que mudou de verdade', () => {
  const atuais = { 1: 1000, 2: 2000, 3: 3000 }
  const r = mudancas(atuais, { 1: '1.000,00', 2: '2500', 3: '', 4: '500', 5: '0' })
  assert.deepEqual(r.gravar, [{ id: '2', valor: 2500 }, { id: '4', valor: 500 }])
  assert.deepEqual(r.apagar, ['3'])
  assert.deepEqual(r.invalidos, [])
})

test('mudancas aponta o campo inválido e não grava nem apaga por causa dele', () => {
  const r = mudancas({ 1: 1000 }, { 1: 'oi' })
  assert.deepEqual(r, { gravar: [], apagar: [], invalidos: ['1'] })
})

test('reescalarDiarias mantém a forma do mês e fecha no novo total', () => {
  const novo = reescalarDiarias({ 1: 100, 2: 300 }, 800)
  assert.deepEqual(novo, { 1: 200, 2: 600 })
  assert.equal(Object.values(novo).reduce((a, b) => a + b, 0), 800)
})

test('reescalarDiarias sem dias gravados devolve null (a dashboard divide por igual)', () => {
  assert.equal(reescalarDiarias(null, 800), null)
  assert.equal(reescalarDiarias({}, 800), null)
  assert.equal(reescalarDiarias({ 1: 0 }, 800), null)
})

test('rotuloDeVendedora só acrescenta o código quando o nome repete', () => {
  const todas = [{ vendor_id: 1, nome: 'Elen' }, { vendor_id: 2, nome: 'Elen' }, { vendor_id: 3, nome: 'Ana' }]
  assert.equal(rotuloDeVendedora(todas[0], todas), 'Elen (cód. 1)')
  assert.equal(rotuloDeVendedora(todas[2], todas), 'Ana')
})

test('agruparPorLoja põe cada vendedora na loja onde mais vendeu', () => {
  const lojas = [{ id: '1', nome: 'A' }, { id: '2', nome: 'B' }]
  const vend = [{ id: '10', nome: 'Ana' }, { id: '11', nome: 'Bia' }, { id: '12', nome: 'Cida' }, { id: '13', nome: 'Duda' }]
  const pedidos = [
    { vendor_id: 10, loja_id: 1 }, { vendor_id: 10, loja_id: 1 }, { vendor_id: 10, loja_id: 2 },
    { vendor_id: 11, loja_id: 2 },
    { vendor_id: 13, loja_id: 99 },          // loja que não está na lista
  ]
  const r = agruparPorLoja(lojas, vend, pedidos)
  assert.deepEqual(r.grupos.map((g) => g.vendedoras.map((v) => v.nome)), [['Ana'], ['Bia']])
  assert.deepEqual(r.sem.map((v) => v.nome), ['Cida', 'Duda'])   // sem venda, e loja desconhecida
})
