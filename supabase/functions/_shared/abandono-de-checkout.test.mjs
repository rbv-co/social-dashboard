import test from 'node:test'
import assert from 'node:assert/strict'
import { decidir } from './abandono-de-checkout.js'

test('checkout com e-mail vira registro, com o total como número', () => {
  const r = decidir('checkouts/create', {
    token: 'abc', email: 'a@b.com', total_price: '199.90', currency: 'BRL',
    abandoned_checkout_url: 'https://loja/recover', customer: { first_name: 'Ana' },
  })
  assert.equal(r.acao, 'registrar')
  assert.deepEqual(r.args, {
    p_token: 'abc', p_email: 'a@b.com', p_telefone: null, p_nome: 'Ana',
    p_total: 199.9, p_moeda: 'BRL', p_url: 'https://loja/recover',
  })
})

test('só telefone (no endereço de entrega) também conta como contato', () => {
  const r = decidir('checkouts/update', { token: 't', shipping_address: { phone: '+5511999999999' } })
  assert.equal(r.acao, 'registrar')
  assert.equal(r.args.p_telefone, '+5511999999999')
})

test('sem e-mail e sem telefone é ignorado (o Shopify também não trata como abandono)', () => {
  assert.deepEqual(decidir('checkouts/create', { token: 't', email: '  ', phone: '' }),
    { acao: 'ignorar', motivo: 'sem_contato' })
})

test('checkout já concluído (completed_at) conta como compra', () => {
  assert.deepEqual(decidir('checkouts/update', { token: 't', email: 'a@b.com', completed_at: '2026-09-28T10:00:00Z' }),
    { acao: 'comprou', token: 't' })
})

test('orders/create casa pelo checkout_token; pedido sem checkout é ignorado', () => {
  assert.deepEqual(decidir('orders/create', { checkout_token: 'zzz' }), { acao: 'comprou', token: 'zzz' })
  assert.equal(decidir('orders/create', { checkout_token: null }).acao, 'ignorar')
})

test('sem token, tópico desconhecido e corpo inválido são ignorados', () => {
  assert.equal(decidir('checkouts/create', { email: 'a@b.com' }).motivo, 'sem_token')
  assert.equal(decidir('products/update', { token: 't', email: 'a@b.com' }).motivo, 'topico_nao_tratado')
  assert.equal(decidir('checkouts/create', null).motivo, 'corpo_invalido')
})

test('total ausente ou lixo vira null, não NaN', () => {
  assert.equal(decidir('checkouts/create', { token: 't', email: 'a@b.com', total_price: 'x' }).args.p_total, null)
})
