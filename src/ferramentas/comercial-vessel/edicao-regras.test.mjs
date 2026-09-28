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

// ── REVISÃO FINAL (IMPORTANTE 3): O FUSO ───────────────────────────
// `quando` é `timestamptz` e chega em UTC; o banco decide a edição com
// `(quando at time zone 'America/Sao_Paulo')::date`. Os testes de antes só
// usavam 12h e 19h UTC — horas que NÃO cruzam o dia —, e por isso o corte em
// UTC passava verde. As horas abaixo cruzam.
test('o dia do encontro é o dia em SÃO PAULO, não em UTC — hora que cruza a meia-noite', () => {
  // 30/09 às 23h em São Paulo = 01/10 às 02h em UTC. A edição 10 termina em
  // 30/09: o placar conta este encontro nela, e a tela tem de dizer o mesmo.
  assert.equal(edicaoDoEncontro({ quando: '2026-10-01T02:00:00Z', praca_id: 2 }, EDICOES).id, 10)
  // 30/09 às 21h em São Paulo = 01/10 às 00h em UTC — a virada exata.
  assert.equal(edicaoDoEncontro({ quando: '2026-10-01T00:00:00Z', praca_id: 2 }, EDICOES).id, 10)
  // e 01/10 às 00h01 em São Paulo JÁ é a edição 11 — o corte existe, só está
  // no lugar certo (senão o teste acima passaria com "tudo cai na anterior").
  assert.equal(edicaoDoEncontro({ quando: '2026-10-01T03:01:00Z', praca_id: 2 }, EDICOES).id, 11)
  // do outro lado da janela: 31/08 às 22h em São Paulo = 01/09 às 01h em UTC.
  // Em UTC cairia na edição 10 (que começa em 01/09); em São Paulo, fora de tudo.
  assert.equal(edicaoDoEncontro({ quando: '2026-09-01T01:00:00Z', praca_id: 2 }, EDICOES), null)
  // e 01/09 às 00h em São Paulo (03h UTC) já é a edição 10.
  assert.equal(edicaoDoEncontro({ quando: '2026-09-01T03:00:00Z', praca_id: 2 }, EDICOES).id, 10)
})

test('data impossível de ler não estoura — vira "fora de edição"', () => {
  assert.equal(edicaoDoEncontro({ quando: 'não é data', praca_id: 2 }, EDICOES), null)
  assert.equal(edicaoDoEncontro({ quando: '', praca_id: 2 }, EDICOES), null)
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
