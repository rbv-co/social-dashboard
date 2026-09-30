import test from 'node:test'
import assert from 'node:assert/strict'
import { decidirPedido } from './pedido-para-mensagem.js'

const PEDIDO = {
  id: 6012345678901, name: '#1001', source_name: 'web', test: false, created_at: '2026-09-30T15:00:00-03:00',
  email: 'ana@x.com', shipping_address: { first_name: 'Maysa', last_name: 'Priscila', phone: '+5519982621828' },
  customer: { first_name: 'Ana', last_name: 'Velha', phone: '+5511000000000' },
}

test('orders/create da loja online vira o registro do pedido (nome e telefone do ENDEREÇO vencem o cadastro)', () => {
  assert.deepEqual(decidirPedido('orders/create', PEDIDO), {
    acao: 'registrar_pedido',
    args: { p_pedido_id: 6012345678901, p_numero: '#1001', p_nome: 'Maysa Priscila', p_telefone: '+5519982621828', p_criado_em: '2026-09-30T15:00:00-03:00' },
  })
})

test('sem telefone no endereço, cai no do pedido, no de cobrança e no cadastro (nesta ordem)', () => {
  const sem = { ...PEDIDO, shipping_address: { first_name: 'Maysa' } }
  assert.equal(decidirPedido('orders/create', sem).args.p_telefone, '+5511000000000')
  assert.equal(decidirPedido('orders/create', { ...sem, phone: '+5521999990000' }).args.p_telefone, '+5521999990000')
  assert.equal(decidirPedido('orders/create', { ...sem, billing_address: { phone: '+5531888880000' } }).args.p_telefone, '+5531888880000')
})

test('⚠️ pedido de teste, de outro canal (PDV, rascunho), sem id, sem telefone ou sem número é ignorado com o motivo', () => {
  const motivo = (extra) => decidirPedido('orders/create', { ...PEDIDO, ...extra }).motivo
  assert.equal(motivo({ test: true }), 'pedido_de_teste')
  assert.equal(motivo({ source_name: 'pos' }), 'pedido_de_outro_canal')
  assert.equal(motivo({ source_name: 'shopify_draft_order' }), 'pedido_de_outro_canal')
  assert.equal(motivo({ source_name: undefined }), 'pedido_de_outro_canal')
  assert.equal(motivo({ id: null }), 'sem_id')
  assert.equal(motivo({ shipping_address: {}, customer: {} }), 'sem_telefone')
  assert.equal(motivo({ name: null, order_number: null }), 'sem_numero')
})

test('sem o campo name, o número vem do order_number com "#"', () => {
  assert.equal(decidirPedido('orders/create', { ...PEDIDO, name: undefined, order_number: 1002 }).args.p_numero, '#1002')
})

test('sem nome nenhum, o nome vai nulo (a mensagem cai em "cliente")', () => {
  const r = decidirPedido('orders/create', { ...PEDIDO, shipping_address: { phone: '+5519982621828' }, customer: {} })
  assert.equal(r.args.p_nome, null)
})

test('orders/cancelled cancela a mensagem do pedido; os outros tópicos e corpos inválidos são ignorados', () => {
  assert.deepEqual(decidirPedido('orders/cancelled', { id: 55 }), { acao: 'cancelar_pedido', pedidoId: 55 })
  assert.equal(decidirPedido('orders/cancelled', {}).motivo, 'sem_id')
  assert.equal(decidirPedido('orders/paid', PEDIDO).motivo, 'topico_nao_tratado')
  assert.equal(decidirPedido('checkouts/update', PEDIDO).motivo, 'topico_nao_tratado')
  assert.equal(decidirPedido('orders/create', null).motivo, 'corpo_invalido')
})
