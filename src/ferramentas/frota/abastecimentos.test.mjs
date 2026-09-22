import { test } from 'node:test'
import assert from 'node:assert/strict'
import { precoPorLitro, problemasDoAbastecimento } from './abastecimentos.js'

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
