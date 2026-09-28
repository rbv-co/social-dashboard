import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDaEdicao, rotuloCurtoDaEdicao, placarPorEtapa,
  eventoDeOrigem, rotuloDoEncontro, funilDoEvento,
  fraseDaOrigem, marcasDaLinha, metaDoEvento, notaDaVolta } from './edicao-regras.js'

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

// ── O EVENTO (Task 1): a edição vira EVENTO, e o encontro leva a origem da
// stylist, não a data (a regra antiga por data saiu na Task 4). ──────────
test('evento de origem = a 1ª presença; sem presença, nulo', () => {
  assert.equal(eventoDeOrigem([{ edicao_id: 2, presente_em: '2026-11-10T20:00:00Z' },
                               { edicao_id: 1, presente_em: '2026-10-15T22:00:00Z' }]), 1)
  assert.equal(eventoDeOrigem([{ edicao_id: 1, presente_em: null }]), null)
  assert.equal(eventoDeOrigem([]), null)
})

test('⚠️ presença no MESMO instante em duas edições: desempata pelo menor id', () => {
  assert.equal(eventoDeOrigem([{ edicao_id: 7, presente_em: '2026-10-15T22:00:00Z' },
                               { edicao_id: 5, presente_em: '2026-10-15T22:00:00Z' }]), 5)
})

test('o encontro leva o evento de origem da STYLIST, não a data', () => {
  const eds = [{ id: 46, praca_nome: 'Campinas', numero: 1 }]
  assert.equal(rotuloDoEncontro({ stylist_id: 9, quando: '2027-03-01T20:00:00Z' }, { 9: 46 }, eds), 'Campinas · Edição 1')
  assert.equal(rotuloDoEncontro({ stylist_id: 8, quando: '2026-10-20T20:00:00Z' }, { 9: 46 }, eds), 'Sem evento')
  assert.equal(rotuloDoEncontro({ stylist_id: null }, {}, eds), 'Sem evento')
})

const T = (o) => ({ convidada_em: '2026-10-01', confirmou_em: null, presente_em: null, indisponivel_em: null, origem: null, ...o })

test('funil do evento: cada passo sobre o anterior, e a meta é sobre as presentes', () => {
  const turma = [
    T({ stylist_id: 1, confirmou_em: 'x', presente_em: 'x', origem: 46 }),
    T({ stylist_id: 2, confirmou_em: 'x', presente_em: 'x', origem: 46 }),
    T({ stylist_id: 3, confirmou_em: 'x' }),
    T({ stylist_id: 4, indisponivel_em: 'x' }),
  ]
  const encontros = [{ stylist_id: 1, status: 'realizado', realizado_em: '2026-10-20' },
                     { stylist_id: 1, status: 'realizado', realizado_em: '2026-10-27' },
                     { stylist_id: 2, status: 'agendado', realizado_em: null }]
  const f = funilDoEvento(turma, encontros, 46)
  assert.deepEqual(f.passos.map((p) => [p.chave, p.n]),
    [['convidadas', 4], ['confirmaram', 3], ['presentes', 2], ['agendaram', 2], ['fizeram', 1], ['repetiram', 1]])
  assert.equal(f.indisponiveis, 1)
  assert.deepEqual(f.meta, { pct: 100, bateu: true })
})

test('⚠️ Private Edit de quem tem ORIGEM em outra edição não conta aqui', () => {
  const f = funilDoEvento([T({ stylist_id: 1, presente_em: 'x', confirmou_em: 'x', origem: 40 })],
    [{ stylist_id: 1, status: 'realizado', realizado_em: '2026-10-20' }], 46)
  assert.equal(f.passos.find((p) => p.chave === 'agendaram').n, 0)
})

test('⚠️ zero presentes: a meta é "—" (nulo), nunca 0%', () => {
  const f = funilDoEvento([T({ stylist_id: 1 })], [], 46)
  assert.deepEqual(f.meta, { pct: null, bateu: null })
  assert.equal(f.passos.find((p) => p.chave === 'agendaram').pct, null)
})

test('status em_planejamento não conta como agendou', () => {
  const f = funilDoEvento([T({ stylist_id: 1, presente_em: 'x', origem: 46 })],
    [{ stylist_id: 1, status: 'em_planejamento' }], 46)
  assert.equal(f.passos.find((p) => p.chave === 'agendaram').n, 0)
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

// ── AS TELAS (Task 4): o que a ficha, a turma e o placar escrevem ─────────
test('a ficha diz de que evento ela veio — número, praça e o dia do evento', () => {
  assert.equal(fraseDaOrigem({ numero: 1, praca_nome: 'Campinas', comeca_em: '2026-10-15' }),
    'Veio pelo evento: Edição 1 · Campinas · 15/10')
  assert.equal(fraseDaOrigem({ numero: 2, praca_nome: 'Limeira', comeca_em: null }), 'Veio pelo evento: Edição 2 · Limeira')
  assert.equal(fraseDaOrigem(null), 'Ainda sem evento')
})

test('as 3 marcas da turma, com o dia EM SÃO PAULO (não em UTC)', () => {
  // 15/10 às 22h em São Paulo = 16/10 à 01h em UTC — tem de dizer 15/10.
  const m = marcasDaLinha({ convidada_em: '2026-09-12T15:00:00Z', confirmou_em: null, presente_em: '2026-10-16T01:00:00Z' })
  assert.deepEqual(m.map((x) => [x.chave, x.feita, x.texto]), [
    ['convidada', true, 'Convidada em 12/09'],
    ['confirmou', true, 'Confirmou'],
    ['presente', true, 'Presente em 15/10'],
  ])
  const n = marcasDaLinha({ convidada_em: null, confirmou_em: null, presente_em: null })
  assert.deepEqual(n.map((x) => [x.feita, x.texto]),
    [[false, 'Sem data de convite'], [false, 'Ainda não confirmou'], [false, 'Ainda sem presença']])
})

test('a meta do evento: verde se bateu, âmbar se não, "—" sem presentes (nunca 0%)', () => {
  assert.deepEqual([metaDoEvento({ pct: 60, bateu: true }).valor, metaDoEvento({ pct: 60, bateu: true }).tom], ['60%', 'viva'])
  assert.deepEqual([metaDoEvento({ pct: 40, bateu: false }).valor, metaDoEvento({ pct: 40, bateu: false }).tom], ['40%', 'queda'])
  const sem = metaDoEvento({ pct: null, bateu: null })
  assert.equal(sem.valor, '—')
  assert.equal(sem.tom, null)
  assert.equal(metaDoEvento(undefined).valor, '—')
})

test('a nota da volta: a MAIS RECENTE "Voltou: indisponível…" do histórico de etapas', () => {
  const h = [
    { em: '2026-11-01T12:00:00Z', nota: 'Voltou: indisponível na Edição 1 · Campinas' },
    { em: '2026-12-01T12:00:00Z', nota: 'Voltou: indisponível na Edição 2 · Campinas' },
    { em: '2026-12-05T12:00:00Z', nota: 'outra coisa' },
  ]
  assert.equal(notaDaVolta(h), 'Voltou: indisponível na Edição 2 · Campinas')
  assert.equal(notaDaVolta([{ em: 'x', nota: null }]), '')
  assert.equal(notaDaVolta(null), '')
})
