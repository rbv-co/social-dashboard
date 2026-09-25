import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resumoDeOrigem, origemMaisProximaDoMomento, unificarEventos, contarPorTipo,
  foiCortado, LIMITE_LEADS,
} from './base-de-leads.js'

test('resumoDeOrigem: fbc manda primeiro, mesmo com utm presente', () => {
  assert.equal(resumoDeOrigem({ fbc: 'fb.1.123.abc', utm_source: 'google', utm_campaign: 'promo' }), 'Meta Ads · promo')
})

test('resumoDeOrigem: gclid sem fbc vira Google Ads', () => {
  assert.equal(resumoDeOrigem({ gclid: 'abc123', utm_campaign: 'promo' }), 'Google Ads · promo')
})

test('resumoDeOrigem: utm sozinho', () => {
  assert.equal(resumoDeOrigem({ utm_source: 'instagram', utm_medium: 'social' }), 'instagram/social')
  assert.equal(resumoDeOrigem({ utm_source: 'instagram' }), 'instagram')
})

test('resumoDeOrigem: referrer vira hostname', () => {
  assert.equal(resumoDeOrigem({ referrer: 'https://www.google.com/search?q=vessel' }), 'www.google.com')
})

test('resumoDeOrigem: referrer inválido devolve o valor cru, não quebra', () => {
  assert.equal(resumoDeOrigem({ referrer: 'não-é-url' }), 'não-é-url')
})

test('resumoDeOrigem: nada disponível é direto/orgânico; nulo é travessão', () => {
  assert.equal(resumoDeOrigem({}), 'Direto/orgânico')
  assert.equal(resumoDeOrigem(null), '—')
})

test('origemMaisProximaDoMomento: pega a mais próxima do alvo, não a mais recente', () => {
  const origens = [
    { pessoa_id: 1, momento: '2026-09-20T10:00:00Z', utm_source: 'longe' },
    { pessoa_id: 1, momento: '2026-09-24T12:00:01Z', utm_source: 'perto' },
    { pessoa_id: 2, momento: '2026-09-24T12:00:00Z', utm_source: 'outra-pessoa' },
  ]
  const r = origemMaisProximaDoMomento(origens, 1, '2026-09-24T12:00:00Z')
  assert.equal(r.utm_source, 'perto')
})

test('origemMaisProximaDoMomento: sem origem nenhuma da pessoa devolve null', () => {
  assert.equal(origemMaisProximaDoMomento([{ pessoa_id: 9, momento: '2026-09-24T12:00:00Z' }], 1, '2026-09-24T12:00:00Z'), null)
})

test('unificarEventos: junta e ordena os três tipos, mais recente primeiro', () => {
  const linhas = unificarEventos({
    checkouts: [{ criado_em: '2026-09-24T09:00:00Z', session_id: 'abcdef1234567890' }],
    popups: [{ criado_em: '2026-09-24T11:00:00Z', nome: 'Ana', email: 'ana@ex.com' }],
    atendimentos: [{ pessoa_id: 1, criado_em: '2026-09-24T10:00:00Z' }],
    pessoas: [{ id: 1, nome: 'Bia', telefone: '5511999999999' }],
    origens: [],
  })
  assert.deepEqual(linhas.map((l) => l.tipo), ['pop_up', 'atendimento_solicitado', 'checkout_iniciado'])
  assert.equal(linhas[0].quem, 'Ana')
  assert.equal(linhas[1].quem, 'Bia')
  assert.equal(linhas[2].quem, '—')
})

test('unificarEventos: pop-up com clique_meta grava a atribuição e o fbc cru (25/09/2026, o pop-up passou a mandar fbc/utm)', () => {
  const linhas = unificarEventos({
    popups: [{ criado_em: '2026-09-25T10:00:00Z', nome: 'Carla', email: 'carla@ex.com', clique_meta: 'fb.1.123.abc', utm_campaign: 'promo' }],
  })
  assert.equal(linhas[0].origem, 'Meta Ads · promo')
  assert.equal(linhas[0].fbc, 'fb.1.123.abc')
})

test('unificarEventos: sem fbc em nenhuma fonte, a coluna vem null', () => {
  const linhas = unificarEventos({
    checkouts: [{ criado_em: '2026-09-25T09:00:00Z' }],
    popups: [{ criado_em: '2026-09-25T10:00:00Z', nome: 'Bia' }],
    atendimentos: [{ pessoa_id: 1, criado_em: '2026-09-25T11:00:00Z' }],
    pessoas: [{ id: 1, nome: 'Rita' }],
    origens: [],
  })
  assert.deepEqual(linhas.map((l) => l.fbc), [null, null, null])
})

test('unificarEventos: atendimento herda o fbc cru da origem mais próxima', () => {
  const linhas = unificarEventos({
    atendimentos: [{ pessoa_id: 1, criado_em: '2026-09-25T10:00:00Z' }],
    pessoas: [{ id: 1, nome: 'Bia' }],
    origens: [{ pessoa_id: 1, momento: '2026-09-25T10:00:01Z', clique_meta: 'fb.1.999.zzz' }],
  })
  assert.equal(linhas[0].fbc, 'fb.1.999.zzz')
})

test('unificarEventos: pop-up sem nenhum campo de rastreio continua direto/orgânico', () => {
  const linhas = unificarEventos({ popups: [{ criado_em: '2026-09-25T10:00:00Z', nome: 'Bia', email: 'bia@ex.com' }] })
  assert.equal(linhas[0].origem, 'Direto/orgânico')
})

test('unificarEventos: atendimento sem pessoa correspondente não quebra', () => {
  const linhas = unificarEventos({ atendimentos: [{ pessoa_id: 999, criado_em: '2026-09-24T10:00:00Z' }] })
  assert.equal(linhas[0].quem, '—')
  assert.equal(linhas[0].contato, '—')
})

test('unificarEventos: atendimento herda a atribuição da origem mais próxima', () => {
  const linhas = unificarEventos({
    atendimentos: [{ pessoa_id: 1, criado_em: '2026-09-24T10:00:00Z' }],
    pessoas: [{ id: 1, nome: 'Bia', telefone: '5511999999999' }],
    origens: [{ pessoa_id: 1, momento: '2026-09-24T10:00:01Z', utm_source: 'instagram', utm_medium: 'social' }],
  })
  assert.equal(linhas[0].origem, 'instagram/social')
})

test('unificarEventos: vazio não quebra', () => {
  assert.deepEqual(unificarEventos({}), [])
})

test('contarPorTipo', () => {
  const linhas = [{ tipo: 'checkout_iniciado' }, { tipo: 'checkout_iniciado' }, { tipo: 'pop_up' }]
  assert.deepEqual(contarPorTipo(linhas), { checkout_iniciado: 2, pop_up: 1, atendimento_solicitado: 0, total: 3 })
})

test('contarPorTipo: vazio', () => {
  assert.deepEqual(contarPorTipo([]), { checkout_iniciado: 0, pop_up: 0, atendimento_solicitado: 0, total: 0 })
})

test('foiCortado', () => {
  assert.equal(foiCortado(new Array(LIMITE_LEADS).fill({})), true)
  assert.equal(foiCortado(new Array(LIMITE_LEADS - 1).fill({})), false)
  assert.equal(foiCortado(null), false)
})
