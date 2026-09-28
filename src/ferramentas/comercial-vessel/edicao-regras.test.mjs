import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDaEdicao, rotuloCurtoDaEdicao, edicaoDoEncontro, placarPorEtapa,
  eventoDeOrigem, rotuloDoEncontro, funilDoEvento } from './edicao-regras.js'

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

// ── O EVENTO (Task 1): a edição vira EVENTO, e o encontro leva a origem da
// stylist, não a data. `edicaoDoEncontro`, acima, fica só até a Task 4. ────
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
