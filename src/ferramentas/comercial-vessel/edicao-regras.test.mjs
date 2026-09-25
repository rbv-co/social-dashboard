import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDaEdicao, rotuloCurtoDaEdicao, edicaoDoEncontro, placarPorEtapa } from './edicao-regras.js'

const EDICOES = [
  { id: 10, praca_id: 2, praca_nome: 'Limeira', numero: 1, comeca_em: '2026-09-01', termina_em: '2026-09-30', situacao: 'encerrada' },
  { id: 11, praca_id: 2, praca_nome: 'Limeira', numero: 2, comeca_em: '2026-10-01', termina_em: null,         situacao: 'aberta' },
  { id: 12, praca_id: 1, praca_nome: 'Campinas', numero: 1, comeca_em: '2026-09-01', termina_em: null,        situacao: 'aberta' },
]

test('o rótulo diz praça e número', () => {
  assert.equal(rotuloDaEdicao(EDICOES[0]), 'Limeira · Edição 1')
})

// ── Rodada 1 de conserto (Task 7, MENOR 6): o rótulo curto, sem repetir a
// praça — para um select ou uma lista que já a mostra do lado de fora. ─────
test('o rótulo curto não repete a praça, e leva o nome quando ela tem', () => {
  assert.equal(rotuloCurtoDaEdicao(EDICOES[2]), 'Edição 1')
  assert.equal(rotuloCurtoDaEdicao({ numero: 3, nome: 'Verão' }), 'Edição 3 — Verão')
  assert.equal(rotuloCurtoDaEdicao(null), 'Edição ?')
})

test('o encontro cai na edição DA PRAÇA DELE cuja janela contém o dia', () => {
  assert.equal(edicaoDoEncontro({ quando: '2026-09-15T19:00:00Z', praca_id: 2 }, EDICOES).id, 10)
  assert.equal(edicaoDoEncontro({ quando: '2026-10-20T19:00:00Z', praca_id: 2 }, EDICOES).id, 11)
  // mesma data, outra praça: nunca pega a edição da vizinha
  assert.equal(edicaoDoEncontro({ quando: '2026-09-15T19:00:00Z', praca_id: 1 }, EDICOES).id, 12)
})

test('edição sem fim vale daí em diante, e fora de tudo é nulo (nunca escondido)', () => {
  assert.equal(edicaoDoEncontro({ quando: '2027-01-01T12:00:00Z', praca_id: 2 }, EDICOES).id, 11)
  assert.equal(edicaoDoEncontro({ quando: '2026-08-01T12:00:00Z', praca_id: 2 }, EDICOES), null)
  assert.equal(edicaoDoEncontro({ quando: null, praca_id: 2 }, EDICOES), null)
})

test('o placar traz TODAS as etapas na ordem, inclusive as de zero', () => {
  const etapas = [
    { id: 1, nome: 'Identificado', ordem: 1, tipo: 'funil' },
    { id: 2, nome: 'Conversado',   ordem: 2, tipo: 'funil' },
    { id: 3, nome: 'Prospectado',  ordem: 3, tipo: 'funil' },
    { id: 9, nome: 'Ativada',      ordem: 9, tipo: 'saida' },
  ]
  const stylists = [{ etapa_id: 1 }, { etapa_id: 1 }, { etapa_id: 3 }, { etapa_id: null }]
  assert.deepEqual(placarPorEtapa(etapas, stylists), [
    { id: 1, nome: 'Identificado', ordem: 1, tipo: 'funil', stylists: 2 },
    { id: 2, nome: 'Conversado',   ordem: 2, tipo: 'funil', stylists: 0 },
    { id: 3, nome: 'Prospectado',  ordem: 3, tipo: 'funil', stylists: 1 },
    { id: 9, nome: 'Ativada',      ordem: 9, tipo: 'saida', stylists: 0 },
  ])
})
