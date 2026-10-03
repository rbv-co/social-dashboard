import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pedidoDoPayload, ehVendaValida } from './pedido-shopify.js';

// Payload real da Shopify tem dezenas de campos; aqui só os que usamos, no
// formato documentado publicamente pela Admin API (2024-01).
const payloadCompleto = () => ({
  id: 5987654321098,
  name: '#1042',
  order_number: 1042,
  total_price: '349.90',
  currency: 'BRL',
  financial_status: 'paid',
  created_at: '2026-10-02T18:30:00-03:00',
  customer: { first_name: 'Maria', last_name: 'Silva', email: 'maria@exemplo.com' },
});

test('o caso comum: payload completo vira pedido pronto pra gravar', () => {
  const p = pedidoDoPayload(payloadCompleto());
  assert.equal(p.id, 5987654321098);
  assert.equal(p.numero, '#1042');
  assert.equal(p.loja_id, 205512275);
  assert.equal(p.total, 349.90);
  assert.equal(p.moeda, 'BRL');
  assert.equal(p.status_financeiro, 'paid');
  assert.equal(p.cliente_nome, 'Maria Silva');
  assert.equal(p.cliente_email, 'maria@exemplo.com');
  assert.equal(p.criado_em_shopify, '2026-10-02T18:30:00-03:00');
  assert.deepEqual(p.bruto, payloadCompleto());
});

test('sem customer (comprador anônimo/removido): não quebra, campos ficam nulos', () => {
  const payload = { ...payloadCompleto(), customer: null };
  const p = pedidoDoPayload(payload);
  assert.equal(p.cliente_nome, null);
  assert.equal(p.cliente_email, null);
});

test('customer com só um dos nomes: junta o que tem', () => {
  const payload = { ...payloadCompleto(), customer: { first_name: 'Maria', email: 'maria@exemplo.com' } };
  const p = pedidoDoPayload(payload);
  assert.equal(p.cliente_nome, 'Maria');
});

test('sem id: payload inválido, não dá pra gravar sem chave', () => {
  const payload = { ...payloadCompleto(), id: undefined };
  assert.equal(pedidoDoPayload(payload), null);
});

test('sem created_at: payload inválido, a coluna criado_em_shopify é not null', () => {
  const payload = { ...payloadCompleto(), created_at: undefined };
  assert.equal(pedidoDoPayload(payload), null);
});

test('sem name nem order_number: numero fica nulo, resto do pedido entra do mesmo jeito', () => {
  const payload = { ...payloadCompleto(), name: undefined, order_number: undefined };
  const p = pedidoDoPayload(payload);
  assert.equal(p.numero, null);
  assert.equal(p.id, payloadCompleto().id);
});

test('sem moeda: assume BRL (toda venda desta loja é em reais)', () => {
  const payload = { ...payloadCompleto(), currency: undefined };
  assert.equal(pedidoDoPayload(payload).moeda, 'BRL');
});

test('total_price ausente ou quebrado vira 0, nunca NaN', () => {
  for (const ruim of [undefined, null, '', 'abacaxi']) {
    const p = pedidoDoPayload({ ...payloadCompleto(), total_price: ruim });
    assert.equal(p.total, 0);
  }
});

test('paid e partially_refunded contam como venda', () => {
  assert.equal(ehVendaValida('paid'), true);
  assert.equal(ehVendaValida('partially_refunded'), true);
});

test('qualquer outro status, inclusive um que a Shopify ainda não inventou, NÃO conta', () => {
  for (const naoConta of ['pending', 'authorized', 'partially_paid', 'refunded', 'voided', 'um_status_novo_que_nao_existe_ainda', '', null, undefined]) {
    assert.equal(ehVendaValida(naoConta), false, `"${naoConta}" não podia contar como venda`);
  }
});

test('null/undefined no payload inteiro não quebra', () => {
  assert.equal(pedidoDoPayload(null), null);
  assert.equal(pedidoDoPayload(undefined), null);
});
