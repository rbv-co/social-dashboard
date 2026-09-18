import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarPayload, passouDoLimite, TIPOS_ACEITOS, TETO_POR_MINUTO } from './validar-evento-de-carrinho.js'

test('aceita os três tipos do MVP', () => {
  for (const tipo of TIPOS_ACEITOS) {
    const r = validarPayload({ tipo, cart_token: 'abc123' })
    assert.equal(r.ok, true)
    assert.equal(r.evento.tipo, tipo)
  }
})

test('rejeita tipo fora da lista (ex.: carrinho_visualizado, cortado no desenho)', () => {
  const r = validarPayload({ tipo: 'carrinho_visualizado', cart_token: 'abc123' })
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'tipo_invalido')
})

test('rejeita sem cart_token', () => {
  assert.equal(validarPayload({ tipo: 'produto_adicionado' }).ok, false)
  assert.equal(validarPayload({ tipo: 'produto_adicionado', cart_token: '' }).ok, false)
  assert.equal(validarPayload({ tipo: 'produto_adicionado', cart_token: '   ' }).ok, false)
})

test('rejeita corpo que não é objeto', () => {
  assert.equal(validarPayload(null).ok, false)
  assert.equal(validarPayload('x').ok, false)
})

test('sanitiza os campos numéricos: string vira número, lixo vira null', () => {
  const r = validarPayload({ tipo: 'produto_adicionado', cart_token: 'x', quantidade: '3', preco: 'não é número' })
  assert.equal(r.evento.quantidade, 3)
  assert.equal(r.evento.preco, null)
})

test('checkout_iniciado não precisa de produto nenhum', () => {
  const r = validarPayload({ tipo: 'checkout_iniciado', cart_token: 'x' })
  assert.equal(r.ok, true)
  assert.equal(r.evento.produto_id, null)
})

test('rate limit: abaixo do teto passa, no teto e acima barra', () => {
  assert.equal(passouDoLimite(59), false)
  assert.equal(passouDoLimite(60), true)
  assert.equal(passouDoLimite(61), true)
})

test('teto default é 60/minuto', () => {
  assert.equal(TETO_POR_MINUTO, 60)
})

test('fbp/fbc são opcionais: vêm junto quando existem, viram null quando faltam ou são lixo', () => {
  const comAtribuicao = validarPayload({ tipo: 'produto_adicionado', cart_token: 'x', fbp: 'fb.1.111.222', fbc: 'fb.1.111.fbclid' })
  assert.equal(comAtribuicao.evento.fbp, 'fb.1.111.222')
  assert.equal(comAtribuicao.evento.fbc, 'fb.1.111.fbclid')

  const semAtribuicao = validarPayload({ tipo: 'produto_adicionado', cart_token: 'x' })
  assert.equal(semAtribuicao.evento.fbp, null)
  assert.equal(semAtribuicao.evento.fbc, null)

  const lixo = validarPayload({ tipo: 'produto_adicionado', cart_token: 'x', fbp: '   ', fbc: 123 })
  assert.equal(lixo.evento.fbp, null)
  assert.equal(lixo.evento.fbc, null)
})
