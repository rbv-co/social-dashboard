import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PASSOS, roteiroVazio, aplicarAviso, resumoDoRoteiro } from './roteiro.js'

/* O ROTEIRO SE MARCA PELO GESTO, E SÓ PELO GESTO. */
const seguir = (avisos) => avisos.reduce((r, [evento, dados]) => aplicarAviso(r, evento, dados), roteiroVazio())

test('cinco passos, cada um com quem faz e onde tocar', () => {
  assert.equal(PASSOS.length, 5)
  assert.deepEqual(PASSOS.map((p) => p.id), [1, 2, 3, 4, 5])
  for (const p of PASSOS) {
    assert.ok(['Ionara', 'Gerente', 'Sistema'].includes(p.quem), `quem do passo ${p.id}`)
    assert.ok(p.titulo && p.onde, `texto do passo ${p.id}`)
  }
})

test('o roteiro inteiro, na ordem, marca os cinco: cadastrar → conversar → validar → mover para Conversa → ativar', () => {
  const r = seguir([
    ['stylist_criada'], ['contato_registrado'],
    ['etapa_mudada', { para: 'Validado', libera_private_edit: false }],
    ['etapa_mudada', { para: 'Conversa', libera_private_edit: false }],
    ['etapa_mudada', { para: 'Ativada', libera_private_edit: true }],
  ])
  assert.deepEqual(r.feitos, [1, 2, 3, 4, 5])
  assert.equal(resumoDoRoteiro(r), 'Roteiro · 5 de 5 ✓')
})

test('passo 3 só quando ela chega em Validado; passo 4 só em Conversa', () => {
  assert.deepEqual(seguir([['etapa_mudada', { para: 'Confirmado', libera_private_edit: false }]]).feitos, [])
  assert.deepEqual(seguir([['etapa_mudada', { para: 'Validado', libera_private_edit: false }]]).feitos, [3])
  assert.deepEqual(seguir([['etapa_mudada', { para: 'Conversa', libera_private_edit: false }]]).feitos, [4])
})

test('passo 5 só quando ela chega numa etapa que libera Private Edit (a Ativada)', () => {
  assert.deepEqual(seguir([['etapa_mudada', { para: 'Confirmado', libera_private_edit: false }]]).feitos, [])
  assert.deepEqual(seguir([['etapa_mudada', { para: 'Ativada', libera_private_edit: true }]]).feitos, [5])
})

test('"pronta" (a Central recarregou) zera o roteiro; aviso desconhecido não mexe', () => {
  const r = seguir([['stylist_criada'], ['contato_registrado']])
  assert.equal(aplicarAviso(r, 'qualquer_coisa', {}), r)
  assert.deepEqual(aplicarAviso(r, 'pronta', {}).feitos, [])
  assert.deepEqual(r.feitos, [1, 2], 'não muta o de entrada')
})

test('eventos que só faziam sentido no Private Edit não marcam mais nada (fora do roteiro)', () => {
  assert.deepEqual(seguir([
    ['encontro_criado'], ['convidada_incluida', { id: 201 }], ['convidada_incluida', { id: 202 }],
    ['cartao_gerado'], ['convite_marcado', { marca: 'enviado' }], ['convite_marcado', { marca: 'sim' }],
    ['presenca_marcada', { situacao: 'realizado' }], ['presenca_marcada', { situacao: 'no_show' }],
    ['encontro_situacao', { status: 'realizado' }], ['placar_lido'], ['recusa_sem_motivo'],
  ]).feitos, [])
})
