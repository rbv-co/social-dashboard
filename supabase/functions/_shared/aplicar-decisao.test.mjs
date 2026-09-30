import test from 'node:test'
import assert from 'node:assert/strict'
import { aplicarDecisao } from './aplicar-decisao.js'

const fakeSb = (error = null) => {
  const chamadas = []
  return { chamadas, rpc: async (nome, args) => { chamadas.push([nome, args]); return { error } } }
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
