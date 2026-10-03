import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarPedidosShopifyDoPeriodo, mesclarPedidosShopify } from './pedidos-shopify.js';

const pedBling = (id, lojaId, total = 100) => ({ id, total, loja: { id: lojaId } });
const linhaShopify = (id, total, data = '2026-10-02') => ({ id, total, criado_em_shopify: `${data}T12:00:00Z`, status_financeiro: 'paid' });

function sbComResposta(linhas, chamadas = []) {
  return {
    from: () => ({
      select: () => ({
        gte: (campo, valor) => { chamadas.push(['gte', campo, valor]); return {
          lt: (campo2, valor2) => { chamadas.push(['lt', campo2, valor2]); return {
            in: (campo3, valor3) => { chamadas.push(['in', campo3, valor3]); return {
              range: () => Promise.resolve({ data: linhas, error: null }),
            }; },
          }; },
        }; },
      }),
    }),
  };
}

test('mescla: pedido Bling de OUTRA loja não é tocado', () => {
  const r = mesclarPedidosShopify([pedBling(1, 999999)], []);
  assert.deepEqual(r, [pedBling(1, 999999)]);
});

test('mescla: pedido Bling da loja Shopify é descartado', () => {
  const r = mesclarPedidosShopify([pedBling(1, 205512275)], []);
  assert.equal(r.length, 0);
});

test('mescla: pedido Shopify entra no formato de pedido do Bling', () => {
  const r = mesclarPedidosShopify([], [linhaShopify(555, 349.90, '2026-10-02')]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 555);
  assert.equal(r[0].total, 349.90);
  assert.equal(r[0].data, '2026-10-02');
  assert.equal(r[0].loja.id, 205512275);
});

test('mescla: pedido de outra loja sobrevive junto com o da Shopify', () => {
  const r = mesclarPedidosShopify([pedBling(1, 999999, 50)], [linhaShopify(555, 100)]);
  assert.equal(r.length, 2);
  assert.ok(r.some((p) => p.id === 1 && p.loja.id === 999999));
  assert.ok(r.some((p) => p.id === 555 && p.loja.id === 205512275));
});

test('mescla: listas vazias não quebram', () => {
  assert.deepEqual(mesclarPedidosShopify([], []), []);
  assert.deepEqual(mesclarPedidosShopify(null, null), []);
});

test('busca: filtra por período e por status que conta como venda', async () => {
  const chamadas = [];
  await buscarPedidosShopifyDoPeriodo(sbComResposta([], chamadas), '2026-10-01', '2026-10-31');
  assert.deepEqual(chamadas[0], ['gte', 'criado_em_shopify', '2026-10-01T00:00:00-03:00']);
  assert.deepEqual(chamadas[1], ['lt', 'criado_em_shopify', '2026-11-01T00:00:00-03:00']);
  assert.deepEqual(chamadas[2], ['in', 'status_financeiro', ['paid', 'partially_refunded']]);
});

test('busca: um dia só (di === df) vai até o início do dia SEGUINTE em Brasília', async () => {
  const chamadas = [];
  await buscarPedidosShopifyDoPeriodo(sbComResposta([], chamadas), '2026-10-02', '2026-10-02');
  assert.deepEqual(chamadas[0], ['gte', 'criado_em_shopify', '2026-10-02T00:00:00-03:00']);
  assert.deepEqual(chamadas[1], ['lt', 'criado_em_shopify', '2026-10-03T00:00:00-03:00']);
});

test('busca: pagina de 1000 em 1000 até a página vir incompleta', async () => {
  const ranges = [];
  const paginas = [Array.from({ length: 1000 }, (_, i) => ({ id: i })), [{ id: 1000 }]];
  const sb = { from: () => ({ select: () => ({ gte: () => ({ lt: () => ({ in: () => ({
    range: (de, ate) => { ranges.push([de, ate]); return Promise.resolve({ data: paginas[ranges.length - 1], error: null }); },
  }) }) }) }) }) };
  const r = await buscarPedidosShopifyDoPeriodo(sb, '2026-10-01', '2026-10-31');
  assert.equal(r.length, 1001);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});

test('mescla: pedido das 22h30 de Brasília conta no dia de Brasília, não no dia UTC', () => {
  // 01h30 UTC do dia 4 = 22h30 de Brasília do dia 3.
  const r = mesclarPedidosShopify([], [{ id: 1, total: 100, criado_em_shopify: '2026-10-04T01:30:00+00:00' }]);
  assert.equal(r[0].data, '2026-10-03');
});

test('mescla: pedido da Shopify sai marcado com fonte "shopify" (as telas não buscam detalhe dele no Bling)', () => {
  const r = mesclarPedidosShopify([], [linhaShopify(555, 100)]);
  assert.equal(r[0].fonte, 'shopify');
});

test('busca: banco fora do ar devolve null — "não sei", nunca lista vazia disfarçada de "sem venda"', async () => {
  const sbFalso = { from: () => ({ select: () => ({ gte: () => ({ lt: () => ({ in: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'caiu' } }) }) }) }) }) }) };
  assert.equal(await buscarPedidosShopifyDoPeriodo(sbFalso, '2026-10-01', '2026-10-31'), null);
});

test('busca: exceção também devolve null, sem derrubar', async () => {
  const sbFalso = { from: () => { throw new Error('sem rede'); } };
  assert.equal(await buscarPedidosShopifyDoPeriodo(sbFalso, '2026-10-01', '2026-10-31'), null);
});
