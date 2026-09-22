import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  precoPorLitro, problemasDoAbastecimento, trechosDeConsumo, consumoDoVeiculo, avisosDeConsumo,
} from './abastecimentos.js'

const bom = {
  km: 36900, kmConhecido: 36896, litros: 41.3, totalCentavos: 25000,
  tanqueDepois: 4, abastecidoEm: '2026-09-21T12:00:00Z', agoraIso: '2026-09-21T15:00:00Z',
}

test('o preço por litro é o que a pessoa confere no cupom', () => {
  assert.equal(precoPorLitro(25000, 41.3).toFixed(2), '6.05')
  assert.equal(precoPorLitro(25000, 0), null, 'sem litros não há preço — e não é zero')
  assert.equal(precoPorLitro(null, 41.3), null)
})

test('registro completo e coerente não barra nem avisa', () => {
  const r = problemasDoAbastecimento(bom)
  assert.deepEqual(r.barra, [])
  assert.deepEqual(r.avisa, [])
})

test('km menor que o já conhecido BARRA — o odômetro só anda pra frente', () => {
  const r = problemasDoAbastecimento({ ...bom, km: 30000 })
  assert.equal(r.barra.length, 1)
  assert.match(r.barra[0], /36\.896/, 'mostrar os dois números é o que faz achar o erro')
})

test('os quatro campos que fazem o registro valer BARRAM quando faltam', () => {
  for (const campo of ['km', 'litros', 'totalCentavos', 'tanqueDepois']) {
    const r = problemasDoAbastecimento({ ...bom, [campo]: null })
    assert.ok(r.barra.length >= 1, `${campo} vazio devia barrar`)
  }
})

test('data no futuro BARRA — abastecimento é coisa que já aconteceu', () => {
  const r = problemasDoAbastecimento({ ...bom, abastecidoEm: '2026-09-22T12:00:00Z' })
  assert.equal(r.barra.length, 1)
  assert.match(r.barra[0], /futuro/i)
})

test('litros acima do tanque do carro AVISA e deixa salvar', () => {
  const r = problemasDoAbastecimento({ ...bom, litros: 90, tanqueDoCarro: 50 })
  assert.deepEqual(r.barra, [], 'aviso não barra')
  assert.equal(r.avisa.length, 1)
})

test('preço por litro fora do pé AVISA — pega o dedo errado, não a variação', () => {
  assert.equal(problemasDoAbastecimento({ ...bom, totalCentavos: 650000 }).avisa.length, 1)
  assert.deepEqual(problemasDoAbastecimento({ ...bom, totalCentavos: 26500 }).avisa, [],
    'R$ 6,42 o litro é normal e não pode virar aviso')
})

test('sem km conhecido ainda dá para registrar — carro novo na frota', () => {
  const r = problemasDoAbastecimento({ ...bom, kmConhecido: null })
  assert.deepEqual(r.barra, [])
})

test('Reserva (0) é nível LEGÍTIMO e não pode barrar — a outra metade do bug', () => {
  // Par do teste "os quatro campos barram quando faltam": um conserta o outro.
  // `Number(null)` é 0 em JavaScript, e 0 é Reserva.
  const r = problemasDoAbastecimento({
    km: 36900, kmConhecido: 36896, litros: 41.3, totalCentavos: 25000,
    tanqueDepois: 0, abastecidoEm: '2026-09-21T12:00:00Z', agoraIso: '2026-09-21T15:00:00Z',
  })
  assert.deepEqual(r.barra, [], 'quem abasteceu R$ 20 para chegar no posto certo fica na reserva')
})

const ab = (km, litros, tanque, extra = {}) => ({
  id: `a-${km}`, veiculo_id: 'v1', km, litros, tanque_depois: tanque,
  total_centavos: Math.round(litros * 605), combustivel: 'GASOLINA',
  abastecido_em: `2026-09-${String(extra.dia || 1).padStart(2, '0')}T12:00:00Z`, ...extra,
})

test('D36 · o trecho vai de um CHEIO ao próximo CHEIO', () => {
  // 36.000 cheio → 36.400 cheio, com 40 litros no meio: 10 km/l.
  const t = trechosDeConsumo([ab(36000, 30, 4, { dia: 1 }), ab(36400, 40, 4, { dia: 10 })])
  assert.equal(t.length, 1)
  assert.equal(t[0].km, 400)
  assert.equal(t[0].litros, 40, 'os litros do PRIMEIRO cheio encheram o tanque que veio ANTES')
  assert.equal(t[0].kmPorLitro, 10)
})

test('D36 · o parcial do meio ENTRA na conta do trecho', () => {
  // cheio 36.000 → parcial 20 L → cheio 36.600 com 40 L = 60 L para 600 km.
  const t = trechosDeConsumo([
    ab(36000, 30, 4, { dia: 1 }), ab(36300, 20, 2, { dia: 5 }), ab(36600, 40, 4, { dia: 10 }),
  ])
  assert.equal(t.length, 1)
  assert.equal(t[0].litros, 60)
  assert.equal(t[0].kmPorLitro, 10)
})

test('D36 · com um cheio só, não há consumo — e a resposta é NULA, não zero', () => {
  assert.deepEqual(trechosDeConsumo([ab(36000, 30, 4)]), [])
  assert.equal(consumoDoVeiculo([ab(36000, 30, 4)]), null)
})

test('D37 · trecho com combustível diferente nas pontas não vira consumo', () => {
  // Etanol rende menos que gasolina: misturar os dois inventaria uma piora.
  const t = trechosDeConsumo([
    ab(36000, 30, 4, { dia: 1, combustivel: 'GASOLINA' }),
    ab(36400, 40, 4, { dia: 10, combustivel: 'ETANOL' }),
  ])
  assert.deepEqual(t, [])
})

test('o consumo do veículo devolve o trecho mais novo e a média', () => {
  const c = consumoDoVeiculo([
    ab(36000, 30, 4, { dia: 1 }), ab(36400, 40, 4, { dia: 10 }), ab(36900, 50, 4, { dia: 20 }),
  ])
  assert.equal(c.trechos.length, 2)
  assert.equal(c.kmPorLitro, 10, 'o mais novo: 500 km / 50 L')
  assert.equal(c.media, 10)
})

test('lista fora de ordem não quebra a conta', () => {
  const t = trechosDeConsumo([ab(36400, 40, 4, { dia: 10 }), ab(36000, 30, 4, { dia: 1 })])
  assert.equal(t.length, 1)
  assert.equal(t[0].kmPorLitro, 10)
})

test('nada quebra com entrada vazia', () => {
  assert.deepEqual(trechosDeConsumo([]), [])
  assert.deepEqual(trechosDeConsumo(null), [])
  assert.equal(consumoDoVeiculo(null), null)
})

test('D39 · consumo absurdo no trecho fechado AVISA', () => {
  // 400 km com 300 litros = 1,3 km/l: quase sempre litro digitado no lugar do
  // valor pago. Avisa, não barra — o registro do que aconteceu não se recusa.
  const a = [ab(36000, 30, 4, { dia: 1 }), ab(36400, 300, 4, { dia: 10 })]
  const avisos = avisosDeConsumo(a, 'v1')
  assert.equal(avisos.length, 1)
  assert.match(avisos[0], /1,3 km\/l/)
})

test('D39 · consumo normal não avisa nada', () => {
  const a = [ab(36000, 30, 4, { dia: 1 }), ab(36400, 40, 4, { dia: 10 })]
  assert.deepEqual(avisosDeConsumo(a, 'v1'), [], '10 km/l é normal')
})

test('D39 · sem trecho fechado não há aviso — a maioria dos casos', () => {
  assert.deepEqual(avisosDeConsumo([ab(36000, 30, 4)], 'v1'), [])
  assert.deepEqual(avisosDeConsumo([], 'v1'), [])
})

test('D39 · o aviso olha só o carro pedido', () => {
  const a = [
    ab(36000, 30, 4, { dia: 1 }), ab(36400, 300, 4, { dia: 10 }),
    { ...ab(1000, 30, 4, { dia: 1 }), veiculo_id: 'v2' },
  ]
  assert.equal(avisosDeConsumo(a, 'v2').length, 0, 'v2 não tem trecho fechado')
})
