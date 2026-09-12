import { test } from 'node:test'
import assert from 'node:assert/strict'
import { temMais, proximoLimite, rotuloDeVerMais, PRIMEIRO_DEGRAU } from './mostrar-mais.js'

test('sem nada escondido, não há botão', () => {
  // A base tinha 6 checklists em 21/08/2026: um "ver mais" fixo nasceria morto,
  // e controle que não faz nada ensina a ignorar controle.
  assert.equal(temMais(6, PRIMEIRO_DEGRAU), false)
  assert.equal(temMais(10, 10), false)
  assert.equal(rotuloDeVerMais(10, 6), null)
})

test('com mais do que cabe, o botão aparece e promete o número certo', () => {
  assert.equal(temMais(35, 10), true)
  assert.equal(proximoLimite(10, 35), 20)
  assert.equal(rotuloDeVerMais(10, 35), 'Ver mais 10')
  assert.equal(rotuloDeVerMais(20, 35), 'Ver as 15 restantes')
})

test('não promete um degrau maior que a lista', () => {
  // "Ver mais 50" pra revelar duas linhas é promessa que a tela não cumpre.
  assert.equal(proximoLimite(10, 12), Infinity)
  assert.equal(rotuloDeVerMais(10, 12), 'Ver as 2 restantes')
  assert.equal(rotuloDeVerMais(10, 11), 'Ver a última')
})

test('os degraus vão 10 → 20 → 50 → tudo', () => {
  assert.equal(proximoLimite(10, 200), 20)
  assert.equal(proximoLimite(20, 200), 50)
  assert.equal(proximoLimite(50, 200), Infinity)
  assert.equal(rotuloDeVerMais(50, 200), 'Ver as 150 restantes')
})

test('número estranho não vira botão nem quebra', () => {
  assert.equal(temMais(null, 10), false)
  assert.equal(temMais(10, undefined), false)
  assert.equal(temMais(5, Infinity), false)
  assert.equal(rotuloDeVerMais(Infinity, 200), null)
})
