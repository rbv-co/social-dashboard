import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PASSOS, roteiroVazio, aplicarAviso, resumoDoRoteiro } from './roteiro.js'

/* O ROTEIRO SE MARCA PELO GESTO, E SÓ PELO GESTO. */
const seguir = (avisos) => avisos.reduce((r, [evento, dados]) => aplicarAviso(r, evento, dados), roteiroVazio())

test('onze passos, cada um com quem faz e onde tocar', () => {
  assert.equal(PASSOS.length, 11)
  assert.deepEqual(PASSOS.map((p) => p.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  for (const p of PASSOS) {
    assert.ok(['Ionara', 'Gerente', 'Sistema'].includes(p.quem), `quem do passo ${p.id}`)
    assert.ok(p.titulo && p.onde, `texto do passo ${p.id}`)
  }
})

test('o roteiro inteiro, na ordem, marca os onze', () => {
  const r = seguir([
    ['stylist_criada'], ['contato_registrado'], ['etapa_mudada', { libera_private_edit: true }], ['encontro_criado'],
    ['convidada_incluida', { id: 201 }], ['convidada_incluida', { id: 202 }], ['cartao_gerado'],
    ['convite_marcado', { marca: 'enviado' }], ['convite_marcado', { marca: 'sim' }],
    ['presenca_marcada', { situacao: 'realizado' }], ['presenca_marcada', { situacao: 'no_show' }],
    ['encontro_situacao', { status: 'realizado' }], ['placar_lido'], ['recusa_sem_motivo'],
  ])
  assert.deepEqual(r.feitos, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  assert.equal(resumoDoRoteiro(r), 'Roteiro · 11 de 11 ✓')
})

test('duas convidadas são duas pessoas: a mesma duas vezes não conta', () => {
  assert.deepEqual(seguir([['convidada_incluida', { id: 7 }], ['convidada_incluida', { id: 7 }]]).feitos, [])
  assert.deepEqual(seguir([['convidada_incluida', { id: 7 }], ['convidada_incluida', { id: 8 }]]).feitos, [5])
})

test('passo 7 pede as DUAS marcas; passo 8, os DOIS gestos', () => {
  assert.deepEqual(seguir([['convite_marcado', { marca: 'enviado' }]]).feitos, [])
  assert.deepEqual(seguir([['convite_marcado', { marca: 'sim' }], ['convite_marcado', { marca: 'enviado' }]]).feitos, [7])
  assert.deepEqual(seguir([['presenca_marcada', { situacao: 'realizado' }]]).feitos, [])
  assert.deepEqual(seguir([['presenca_marcada', { situacao: 'no_show' }], ['presenca_marcada', { situacao: 'realizado' }]]).feitos, [8])
})

test('passo 9 só com "realizado"; passo 10 só depois do 9', () => {
  assert.deepEqual(seguir([['encontro_situacao', { status: 'cancelado' }]]).feitos, [])
  assert.deepEqual(seguir([['placar_lido']]).feitos, [], 'ler o placar antes de fechar o encontro não é ver mudar')
  assert.deepEqual(seguir([['placar_lido'], ['encontro_situacao', { status: 'realizado' }], ['placar_lido']]).feitos, [9, 10])
})

test('"pronta" (a Central recarregou) zera o roteiro; aviso desconhecido não mexe', () => {
  const r = seguir([['stylist_criada'], ['contato_registrado']])
  assert.equal(aplicarAviso(r, 'qualquer_coisa', {}), r)
  assert.deepEqual(aplicarAviso(r, 'pronta', {}).feitos, [])
  assert.deepEqual(r.feitos, [1, 2], 'não muta o de entrada')
})

test('passo 3 só quando ela chega numa etapa que libera Private Edit (a Ativada)', () => {
  assert.deepEqual(seguir([['etapa_mudada', { para: 'Classificação', libera_private_edit: false }]]).feitos, [])
  assert.deepEqual(seguir([['etapa_mudada', { para: 'Ativada', libera_private_edit: true }]]).feitos, [3])
})
