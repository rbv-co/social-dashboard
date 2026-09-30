import test from 'node:test'
import assert from 'node:assert/strict'
import { aplicarDecisao, aplicarPedido, processarWebhook } from './aplicar-decisao.js'

// `error` vale para todas as chamadas; `falhaEm` (lista de nomes) faz falhar só essas.
const fakeSb = (error = null, falhaEm = null) => {
  const chamadas = []
  return {
    chamadas,
    rpc: async (nome, args) => { chamadas.push([nome, args]); return { error: !falhaEm || falhaEm.includes(nome) ? error : null } },
  }
}
const calar = (t) => t.mock.method(console, 'error', () => {})

test('ignorar: 200 com o motivo e nenhuma chamada ao banco', async () => {
  const sb = fakeSb()
  const r = await aplicarDecisao(sb, { acao: 'ignorar', motivo: 'sem_contato' })
  assert.deepEqual(r, { status: 200, corpo: { ok: true, ignorado: 'sem_contato' } })
  assert.deepEqual(sb.chamadas, [])
})

test('cada ação chama a função certa do banco; comprou leva o contato do pedido', async () => {
  const casos = [
    [{ acao: 'registrar', args: { p_token: 't' } }, ['registrar_checkout_abandono', { p_token: 't' }]],
    [{ acao: 'comprou', token: 't', email: 'a@b.com', telefone: '1' }, ['marcar_checkout_comprou', { p_token: 't', p_email: 'a@b.com', p_telefone: '1' }]],
    [{ acao: 'pagamento_pendente', token: 't' }, ['marcar_checkout_pagamento_pendente', { p_token: 't' }]],
    [{ acao: 'reabrir', token: 't' }, ['reabrir_checkout_abandono', { p_token: 't' }]],
  ]
  for (const [decisao, esperado] of casos) {
    const sb = fakeSb()
    const r = await aplicarDecisao(sb, decisao)
    assert.deepEqual(sb.chamadas, [esperado], decisao.acao)
    assert.deepEqual(r, { status: 200, corpo: { ok: true } })
  }
})

test('⚠️ erro de banco vira 500 (a Shopify reenvia; as funções são idempotentes) em TODAS as ações, sem engolir', async (t) => {
  calar(t)
  for (const decisao of [{ acao: 'registrar', args: {} }, { acao: 'comprou', token: 't', email: null, telefone: null },
    { acao: 'pagamento_pendente', token: 't' }, { acao: 'reabrir', token: 't' }]) {
    const r = await aplicarDecisao(fakeSb({ message: '504' }), decisao)
    assert.equal(r.status, 500, decisao.acao)
    assert.equal(r.corpo.ok, false)
  }
})

// ── pedido ────────────────────────────────────────────────────────────────────
test('aplicarPedido: registrar e cancelar chamam as funções certas; ignorar não chama nada', async () => {
  const sb = fakeSb()
  assert.deepEqual(await aplicarPedido(sb, { acao: 'registrar_pedido', args: { p_pedido_id: 5 } }), { status: 200, corpo: { ok: true } })
  assert.deepEqual(await aplicarPedido(sb, { acao: 'cancelar_pedido', pedidoId: 5 }), { status: 200, corpo: { ok: true } })
  assert.deepEqual(sb.chamadas, [['registrar_pedido_para_mensagem', { p_pedido_id: 5 }], ['cancelar_mensagem_pedido', { p_pedido_id: 5 }]])
  const sb2 = fakeSb()
  assert.deepEqual(await aplicarPedido(sb2, { acao: 'ignorar', motivo: 'pedido_de_teste' }), { status: 200, corpo: { ok: true, ignorado: 'pedido_de_teste' } })
  assert.deepEqual(sb2.chamadas, [])
})

test('⚠️ aplicarPedido: erro de banco vira 500 (a Shopify reenvia; o registro é idempotente)', async (t) => {
  calar(t)
  for (const decisao of [{ acao: 'registrar_pedido', args: {} }, { acao: 'cancelar_pedido', pedidoId: 1 }]) {
    assert.equal((await aplicarPedido(fakeSb({ message: '504' }), decisao)).status, 500)
  }
})

// ── o webhook inteiro (checkout + pedido) ─────────────────────────────────────
const PEDIDO_WEB = {
  id: 6012345678901, name: '#1001', source_name: 'web', checkout_token: 'tok1', financial_status: 'pending',
  shipping_address: { first_name: 'Ana', phone: '+5519982621828' },
}

test('⚠️ orders/create da loja: marca o checkout como pagamento pendente E registra a mensagem do pedido', async () => {
  const sb = fakeSb()
  const r = await processarWebhook(sb, 'orders/create', PEDIDO_WEB)
  assert.equal(r.status, 200)
  assert.deepEqual(sb.chamadas.map((c) => c[0]), ['marcar_checkout_pagamento_pendente', 'registrar_pedido_para_mensagem'])
  assert.equal(sb.chamadas[1][1].p_pedido_id, 6012345678901)
})

test('orders/cancelled: reabre o checkout E cancela a mensagem do pedido; orders/paid só marca comprou', async () => {
  const c = fakeSb()
  await processarWebhook(c, 'orders/cancelled', PEDIDO_WEB)
  assert.deepEqual(c.chamadas.map((x) => x[0]), ['reabrir_checkout_abandono', 'cancelar_mensagem_pedido'])
  const p = fakeSb()
  await processarWebhook(p, 'orders/paid', PEDIDO_WEB)
  assert.deepEqual(p.chamadas.map((x) => x[0]), ['marcar_checkout_comprou'])
})

test('checkouts/update só mexe na fila de abandono (nada de pedido)', async () => {
  const sb = fakeSb()
  await processarWebhook(sb, 'checkouts/update', { token: 't', email: 'a@b.com' })
  assert.deepEqual(sb.chamadas.map((x) => x[0]), ['registrar_checkout_abandono'])
})

test('⚠️ se UMA das duas gravações falha, o webhook devolve 500 e a outra JÁ foi feita (as duas são idempotentes)', async (t) => {
  calar(t)
  const a = fakeSb({ message: '504' }, ['marcar_checkout_pagamento_pendente'])
  assert.equal((await processarWebhook(a, 'orders/create', PEDIDO_WEB)).status, 500)
  assert.deepEqual(a.chamadas.map((x) => x[0]), ['marcar_checkout_pagamento_pendente', 'registrar_pedido_para_mensagem'])
  const b = fakeSb({ message: '504' }, ['registrar_pedido_para_mensagem'])
  assert.equal((await processarWebhook(b, 'orders/create', PEDIDO_WEB)).status, 500)
})

test('pedido de teste ou de outro canal: o checkout segue o fluxo normal e a mensagem do pedido é ignorada, sem erro', async () => {
  const sb = fakeSb()
  const r = await processarWebhook(sb, 'orders/create', { ...PEDIDO_WEB, source_name: 'pos' })
  assert.equal(r.status, 200)
  assert.deepEqual(sb.chamadas.map((x) => x[0]), ['marcar_checkout_pagamento_pendente'])
})
