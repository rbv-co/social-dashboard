import { test } from 'node:test'
import assert from 'node:assert/strict'
import { achatarCidade, pracaDaCidade, pendenciasDePraca, rotuloDaPraca } from './praca-regras.js'

const MAPA = [
  { cidade_chave: 'campinas',   praca_id: 1, sigla: 'CPS', nome: 'Campinas',   loja_destino: 'iguatemi' },
  { cidade_chave: 'limeira',    praca_id: 2, sigla: 'LIM', nome: 'Limeira',    loja_destino: null },
  { cidade_chave: 'piracicaba', praca_id: 3, sigla: 'PIR', nome: 'Piracicaba', loja_destino: null },
]

test('achata acento, caixa e espaço sobrando', () => {
  assert.equal(achatarCidade('  SÃO Paulo '), 'sao paulo')
  assert.equal(achatarCidade('Limeira'), 'limeira')
  assert.equal(achatarCidade(null), '')
})

test('acha a praça pela cidade, não importa como foi digitada', () => {
  assert.equal(pracaDaCidade('PIRACICABA', MAPA).sigla, 'PIR')
  assert.equal(pracaDaCidade('  limeira', MAPA).praca_id, 2)
})

test('cidade que não casa devolve nulo — nunca a primeira da lista', () => {
  assert.equal(pracaDaCidade('Limeira / Piracicaba', MAPA), null)
  assert.equal(pracaDaCidade('', MAPA), null)
})

test('pendência lista quem ficou sem praça E as cidades órfãs, sem repetir', () => {
  const stylists = [
    { codigo: 'STY-0001', cidade: 'Campinas',             praca_id: 1 },
    { codigo: 'STY-0002', cidade: 'Limeira / Piracicaba', praca_id: null },
    { codigo: 'STY-0003', cidade: 'Limeira / Piracicaba', praca_id: null },
    { codigo: 'STY-0004', cidade: 'Indaiatuba',           praca_id: null },
  ]
  const p = pendenciasDePraca(stylists, MAPA)
  assert.deepEqual(p.semPraca.map((s) => s.codigo), ['STY-0002', 'STY-0003', 'STY-0004'])
  assert.deepEqual(p.cidadesSemPraca, ['Indaiatuba', 'Limeira / Piracicaba'])
})

test('a loja que falta aparece escrita, nunca vazia', () => {
  assert.equal(rotuloDaPraca(MAPA[0]), 'Campinas · iguatemi')
  assert.equal(rotuloDaPraca(MAPA[1]), 'Limeira · loja a definir')
})
