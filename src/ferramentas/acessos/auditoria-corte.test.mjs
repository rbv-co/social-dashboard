// Testes da lógica pura que detecta corte silencioso nas consultas da
// Auditoria (patrimonio_bens e frota_veiculos vêm sem `.limit()` explícito e
// o PostgREST corta em 1000 linhas por padrão, sem avisar ninguém).
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIMITE_AUDITORIA, foiCortado, avisoDeCorte } from './auditoria-corte.js'

test('lista menor que o limite não foi cortada', () => {
  assert.equal(foiCortado(new Array(LIMITE_AUDITORIA - 1)), false)
})

test('lista exatamente no limite é tratada como cortada (não dá pra distinguir)', () => {
  assert.equal(foiCortado(new Array(LIMITE_AUDITORIA)), true)
})

test('lista vazia não é cortada', () => {
  assert.equal(foiCortado([]), false)
})

test('entrada que não é array nunca quebra, nunca é "cortada"', () => {
  for (const bad of [null, undefined, 'x', 42, {}]) {
    assert.equal(foiCortado(bad), false)
  }
})

test('sem nenhum rótulo cortado, o aviso é vazio (não aparece na tela)', () => {
  assert.equal(avisoDeCorte([]), '')
  assert.equal(avisoDeCorte([false, false]), '')
})

test('um rótulo cortado nomeia só ele no aviso', () => {
  const msg = avisoDeCorte(['bens'])
  assert.match(msg, /bens/)
  assert.match(msg, new RegExp(String(LIMITE_AUDITORIA)))
  assert.match(msg, /incompletos/)
})

test('dois rótulos cortados aparecem os dois, ligados por "e"', () => {
  const msg = avisoDeCorte(['bens', 'veículos'])
  assert.match(msg, /bens e veículos/)
})

test('rótulo falso/vazio é ignorado, não vira "undefined" no texto', () => {
  const msg = avisoDeCorte(['bens', false, null, ''])
  assert.match(msg, /^A lista de bens\b/)
  assert.doesNotMatch(msg, /undefined/)
})
