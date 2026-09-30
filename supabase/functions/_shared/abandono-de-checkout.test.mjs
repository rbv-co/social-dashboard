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

test('⚠️ checkout com completed_at NÃO é compra (Pix conclui o checkout ao gerar o QR, antes de pagar)', () => {
  assert.deepEqual(decidir('checkouts/update', { token: 't', email: 'a@b.com', completed_at: '2026-09-28T10:00:00Z' }),
    { acao: 'ignorar', motivo: 'checkout_concluido' })
})

test('⚠️ orders/create com pagamento PENDENTE (Pix/boleto) não é compra: vira pagamento_pendente', () => {
  for (const financial_status of ['pending', 'voided', undefined]) {
    assert.deepEqual(decidir('orders/create', { checkout_token: 'zzz', financial_status }),
      { acao: 'pagamento_pendente', token: 'zzz' })
  }
})

test('orders/create já pago (cartão) é compra; orders/paid sempre é compra', () => {
  for (const financial_status of ['paid', 'authorized', 'partially_paid']) {
    assert.deepEqual(decidir('orders/create', { checkout_token: 'zzz', financial_status }), { acao: 'comprou', token: 'zzz', email: null, telefone: null })
  }
  assert.deepEqual(decidir('orders/paid', { checkout_token: 'zzz' }), { acao: 'comprou', token: 'zzz', email: null, telefone: null })
})

test('⚠️ compra leva o contato do PEDIDO (o endereço vence o cadastro), para tirar da fila os outros checkouts da mesma pessoa', () => {
  const pedido = { checkout_token: 'zzz', email: 'ana@x.com', customer: { email: 'velho@x.com', phone: '+5511000000000' }, shipping_address: { phone: '+5519982621828' } }
  assert.deepEqual(decidir('orders/paid', pedido), { acao: 'comprou', token: 'zzz', email: 'ana@x.com', telefone: '+5519982621828' })
  assert.deepEqual(decidir('orders/paid', { checkout_token: 'zzz', contact_email: 'b@x.com', billing_address: { phone: '+5511988887777' } }),
    { acao: 'comprou', token: 'zzz', email: 'b@x.com', telefone: '+5511988887777' })
})

test('⚠️ pedido PAGO sem checkout (admin, WhatsApp) mas com contato também tira o abandonado da fila; pendente ou cancelado, não', () => {
  const contato = { email: 'ana@x.com', phone: '+5519982621828', checkout_token: null }
  assert.deepEqual(decidir('orders/paid', contato), { acao: 'comprou', token: null, email: 'ana@x.com', telefone: '+5519982621828' })
  assert.equal(decidir('orders/create', { ...contato, financial_status: 'paid' }).acao, 'comprou')
  assert.equal(decidir('orders/create', { ...contato, financial_status: 'pending' }).motivo, 'pedido_sem_checkout')
  assert.equal(decidir('orders/cancelled', contato).motivo, 'pedido_sem_checkout')
})

test('orders/cancelled (Pix expirado) reabre o checkout', () => {
  assert.deepEqual(decidir('orders/cancelled', { checkout_token: 'zzz' }), { acao: 'reabrir', token: 'zzz' })
})

test('pedido sem checkout_token (pedido manual, PDV) é ignorado em qualquer tópico de pedido', () => {
  for (const t of ['orders/create', 'orders/paid', 'orders/cancelled']) {
    assert.equal(decidir(t, { checkout_token: null }).motivo, 'pedido_sem_checkout')
  }
})

test('sem token, tópico desconhecido e corpo inválido são ignorados', () => {
  assert.equal(decidir('checkouts/create', { email: 'a@b.com' }).motivo, 'sem_token')
  assert.equal(decidir('products/update', { token: 't', email: 'a@b.com' }).motivo, 'topico_nao_tratado')
  assert.equal(decidir('checkouts/create', null).motivo, 'corpo_invalido')
})

test('total ausente ou lixo vira null, não NaN', () => {
  assert.equal(decidir('checkouts/create', { token: 't', email: 'a@b.com', total_price: 'x' }).args.p_total, null)
})

test('⚠️ o nome que o cliente TROCOU no endereço vence o registro antigo de customer', () => {
  const r = decidir('checkouts/update', {
    token: 't', email: 'a@b.com',
    customer: { first_name: 'Gabrie' },          // registro criado no 1º passo, não acompanha a troca
    shipping_address: { first_name: 'Gabriel' }, // o que ele digitou depois
  })
  assert.equal(r.args.p_nome, 'Gabriel')
})

test('sem endereço, o nome cai para billing e depois para customer', () => {
  const base = { token: 't', email: 'a@b.com' }
  assert.equal(decidir('checkouts/update', { ...base, billing_address: { first_name: 'Bia' }, customer: { first_name: 'Ana' } }).args.p_nome, 'Bia')
  assert.equal(decidir('checkouts/update', { ...base, customer: { first_name: 'Ana' } }).args.p_nome, 'Ana')
})

test('o nome vem COMPLETO (nome + sobrenome), não só o primeiro', () => {
  const base = { token: 't', email: 'a@b.com' }
  assert.equal(decidir('checkouts/update', { ...base, shipping_address: { first_name: 'Luis', last_name: 'Fulano de Tal' } }).args.p_nome, 'Luis Fulano de Tal')
  assert.equal(decidir('checkouts/update', { ...base, customer: { first_name: 'Ana', last_name: 'Silva' } }).args.p_nome, 'Ana Silva')
})

test('sem sobrenome (ou só com sobrenome) o nome não fica com espaço sobrando nem vira "null"', () => {
  const base = { token: 't', email: 'a@b.com' }
  assert.equal(decidir('checkouts/update', { ...base, shipping_address: { first_name: 'Luis', last_name: '  ' } }).args.p_nome, 'Luis')
  assert.equal(decidir('checkouts/update', { ...base, shipping_address: { first_name: null, last_name: 'Silva' } }).args.p_nome, 'Silva')
  assert.equal(decidir('checkouts/update', { ...base, shipping_address: { first_name: '', last_name: '' } }).args.p_nome, null)
})

test('⚠️ o telefone corrigido no endereço vence o de customer', () => {
  const r = decidir('checkouts/update', {
    token: 't', customer: { phone: '+551100000000' }, shipping_address: { phone: '+5511999999999' },
  })
  assert.equal(r.args.p_telefone, '+5511999999999')
})
