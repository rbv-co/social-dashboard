import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agruparPorDia, filtrarFichas, resumoDasFichas, FILTROS_DE_FICHA, rotuloDoDia,
} from './historico-de-checklists.js'

// As 3 fichas REAIS do banco em 19/08/2026, com os campos que a tela usa.
const VEICULOS = [
  { id: 'v-bmw', nome: 'BMW X1', placa: 'DCH1J89' },
  { id: 'v-bravo', nome: 'FIAT BRAVO BLACKMOTION', placa: 'FFK9E60' },
]
const FICHAS = [
  { id: 'f1', veiculo_id: 'v-bmw', pessoa_nome: 'Erick Martins', feita_em: '2026-08-07',
    hodometro: 54000, resultado: 'liberado', assinada_em: '2026-08-08T02:16:02.909Z' },
  { id: 'f2', veiculo_id: 'v-bravo', pessoa_nome: 'Erick Martins', feita_em: '2026-08-14',
    hodometro: 185041, resultado: 'com_ressalvas', assinada_em: '2026-08-14T10:59:03.222Z' },
  { id: 'f3', veiculo_id: 'v-bravo', pessoa_nome: 'Erick Martins', feita_em: '2026-08-17',
    hodometro: 185359, resultado: 'liberado', assinada_em: '2026-08-17T20:51:32.772Z' },
]

// ── O rótulo do dia ────────────────────────────────────────────────────────

test('o dia vira "17/08 · segunda"', () => {
  assert.equal(rotuloDoDia('2026-08-17'), '17/08 · segunda')
})

test('A ARMADILHA DO FUSO: o dia da ficha não pode andar pra trás', () => {
  // `new Date('2026-08-17')` é meia-noite em UTC. Num fuso negativo (o nosso),
  // `getDay()` disso devolve o dia ANTERIOR — e a tela mostraria a ficha de
  // segunda como domingo. Esta central já pagou uma dívida inteira de fuso;
  // `feita_em` é DATE, é o dia local, e tem de ser lido como texto.
  assert.equal(rotuloDoDia('2026-08-17'), '17/08 · segunda')  // 17/08/2026 é segunda
  assert.equal(rotuloDoDia('2026-08-14'), '14/08 · sexta')
  assert.equal(rotuloDoDia('2026-08-07'), '07/08 · sexta')
})

test('data estragada não vira um dia plausível', () => {
  assert.equal(rotuloDoDia('sei lá'), 'sem data')
  assert.equal(rotuloDoDia(null), 'sem data')
})

// ── O agrupamento ──────────────────────────────────────────────────────────

test('agrupa por dia, do mais novo pro mais velho', () => {
  const dias = agruparPorDia(FICHAS, { veiculos: VEICULOS })
  assert.deepEqual(dias.map((d) => d.dia), ['2026-08-17', '2026-08-14', '2026-08-07'])
})

test('cada ficha traz o nome do carro, não o id', () => {
  const dias = agruparPorDia(FICHAS, { veiculos: VEICULOS })
  assert.equal(dias[0].fichas[0].veiculoNome, 'FIAT BRAVO BLACKMOTION')
  assert.equal(dias[0].fichas[0].veiculoPlaca, 'FFK9E60')
})

test('carro apagado do cadastro não deixa a linha sem nome', () => {
  const dias = agruparPorDia(FICHAS, { veiculos: [] })
  assert.match(dias[0].fichas[0].veiculoNome, /saiu do cadastro/)
})

test('duas fichas no mesmo dia ficam no mesmo grupo', () => {
  const duas = [...FICHAS, { id: 'f4', veiculo_id: 'v-bmw', pessoa_nome: 'Breno',
    feita_em: '2026-08-17', hodometro: 54100, resultado: 'liberado', assinada_em: null }]
  const dias = agruparPorDia(duas, { veiculos: VEICULOS })
  assert.equal(dias[0].fichas.length, 2)
  assert.equal(dias.length, 3)
})

test('a ficha diz se foi assinada — e "não assinada" nunca vira silêncio', () => {
  const semAssinatura = [{ ...FICHAS[0], assinada_em: null }]
  const dias = agruparPorDia(semAssinatura, { veiculos: VEICULOS })
  assert.equal(dias[0].fichas[0].assinada, false)
  assert.equal(agruparPorDia(FICHAS, { veiculos: VEICULOS })[0].fichas[0].assinada, true)
})

test('sem ficha nenhuma, devolve lista vazia e não estoura', () => {
  assert.deepEqual(agruparPorDia(null, {}), [])
  assert.deepEqual(agruparPorDia([], { veiculos: VEICULOS }), [])
})

// ── Os filtros ─────────────────────────────────────────────────────────────

test('"só com ressalva" traz só a que tem ressalva', () => {
  const r = filtrarFichas(FICHAS, { filtro: 'com-ressalva' })
  assert.equal(r.length, 1)
  assert.equal(r[0].id, 'f2')
})

test('filtrar por carro', () => {
  const r = filtrarFichas(FICHAS, { filtro: 'tudo', veiculoId: 'v-bmw' })
  assert.equal(r.length, 1)
  assert.equal(r[0].id, 'f1')
})

test('filtrar por pessoa', () => {
  assert.equal(filtrarFichas(FICHAS, { filtro: 'tudo', pessoaNome: 'Erick Martins' }).length, 3)
  assert.equal(filtrarFichas(FICHAS, { filtro: 'tudo', pessoaNome: 'Breno' }).length, 0)
})

test('carro e ressalva juntos: os dois filtros somam, não se substituem', () => {
  const r = filtrarFichas(FICHAS, { filtro: 'com-ressalva', veiculoId: 'v-bravo' })
  assert.equal(r.length, 1)
  const nenhuma = filtrarFichas(FICHAS, { filtro: 'com-ressalva', veiculoId: 'v-bmw' })
  assert.equal(nenhuma.length, 0)
})

test('a barra tem "Tudo" e "Só com ressalva"', () => {
  assert.deepEqual(FILTROS_DE_FICHA.map((f) => f.chave), ['tudo', 'com-ressalva'])
})

// ── O resumo do título fechado ─────────────────────────────────────────────

test('o título fechado já responde: "3 fichas em 3 dias"', () => {
  assert.equal(resumoDasFichas(FICHAS), '3 fichas em 3 dias')
})

test('singular não sai errado', () => {
  assert.equal(resumoDasFichas([FICHAS[0]]), '1 ficha em 1 dia')
})

test('sem ficha nenhuma o resumo DIZ isso, em vez de "0 fichas"', () => {
  assert.equal(resumoDasFichas([]), 'nenhuma ficha ainda')
  assert.equal(resumoDasFichas(null), 'nenhuma ficha ainda')
})

test('duas fichas num dia só contam dias distintos, não fichas', () => {
  const duas = [FICHAS[2], { ...FICHAS[2], id: 'f4' }]
  assert.equal(resumoDasFichas(duas), '2 fichas em 1 dia')
})
