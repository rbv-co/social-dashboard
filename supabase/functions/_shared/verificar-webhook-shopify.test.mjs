import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assinaturaValida, extrairEventoDeCheckout } from './verificar-webhook-shopify.js'

async function assinarComoAShopify(segredo, corpoCru) {
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpoCru))
  return btoa(String.fromCharCode(...new Uint8Array(assinatura)))
}

test('assinatura correta valida', async () => {
  const corpo = '{"cart_token":"abc123"}'
  const assinatura = await assinarComoAShopify('segredo-de-teste', corpo)
  assert.equal(await assinaturaValida('segredo-de-teste', corpo, assinatura), true)
})

test('rejeita com segredo errado', async () => {
  const corpo = '{"cart_token":"abc123"}'
  const assinatura = await assinarComoAShopify('segredo-certo', corpo)
  assert.equal(await assinaturaValida('segredo-errado', corpo, assinatura), false)
})

test('rejeita se o corpo foi alterado depois de assinado', async () => {
  const assinatura = await assinarComoAShopify('segredo-de-teste', '{"cart_token":"abc123"}')
  assert.equal(await assinaturaValida('segredo-de-teste', '{"cart_token":"outro"}', assinatura), false)
})

test('rejeita sem cabeçalho de assinatura', async () => {
  assert.equal(await assinaturaValida('segredo-de-teste', '{"cart_token":"abc123"}', null), false)
  assert.equal(await assinaturaValida('segredo-de-teste', '{"cart_token":"abc123"}', ''), false)
})

test('rejeita sem segredo configurado (nunca deixar passar por omissão de config)', async () => {
  const corpo = '{"cart_token":"abc123"}'
  const assinatura = await assinarComoAShopify('segredo-de-teste', corpo)
  assert.equal(await assinaturaValida('', corpo, assinatura), false)
})

test('extrai cart_token do corpo do webhook de checkout', () => {
  assert.deepEqual(extrairEventoDeCheckout({ cart_token: 'abc123' }), { tipo: 'checkout_iniciado', cart_token: 'abc123' })
})

test('checkout sem cart_token (raro, mas não pode quebrar) vira null', () => {
  assert.deepEqual(extrairEventoDeCheckout({}), { tipo: 'checkout_iniciado', cart_token: null })
  assert.deepEqual(extrairEventoDeCheckout({ cart_token: '' }), { tipo: 'checkout_iniciado', cart_token: null })
})
