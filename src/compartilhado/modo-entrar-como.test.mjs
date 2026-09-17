import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularModoEntrarComo } from './modo-entrar-como.js'

test('com ?modo=entrar-como, é true', () => {
  assert.equal(calcularModoEntrarComo('?modo=entrar-como'), true)
})

test('sem o parâmetro, é false', () => {
  assert.equal(calcularModoEntrarComo(''), false)
  assert.equal(calcularModoEntrarComo(undefined), false)
})

test('com outro valor de modo, é false', () => {
  assert.equal(calcularModoEntrarComo('?modo=outracoisa'), false)
})

test('funciona sem o "?" na frente também', () => {
  assert.equal(calcularModoEntrarComo('modo=entrar-como'), true)
})

test('ignora outros parâmetros junto', () => {
  assert.equal(calcularModoEntrarComo('?diag=1&modo=entrar-como'), true)
})
