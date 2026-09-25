import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarVendedorCorrigido } from './vendedor-corrigido.js';

// A REGRA mora aqui (e não em src/) pelo mesmo motivo do vizinho
// valor-corrigido.js. Os testes do que é do navegador ficam em
// src/compartilhado/vendedor-corrigido.test.mjs.

const ajuste = (pedido_id, vendor_id_corrigido) => ({ pedido_id, vendor_id_corrigido, motivo: 'vendedor da NFC-e diverge do pedido' });

test('o caso do dono: pedido com vendedor errado passa a valer o vendedor da nota', () => {
  const r = aplicarVendedorCorrigido({ 111: 5 }, [ajuste(111, 9)]);
  assert.equal(r.mapa[111], 9);
  assert.equal(r.ajustados, 1);
  assert.ok(r.corrigidosIds.has('111'));
});

test('pedido sem ajuste não é tocado', () => {
  const r = aplicarVendedorCorrigido({ 1: 5, 2: 6 }, [ajuste(1, 9)]);
  assert.equal(r.mapa[2], 6);
  assert.equal(r.corrigidosIds.has('2'), false);
});

test('ajuste de pedido que não está no mapa é ignorado, mas ainda entra no mapa corrigido (não inventa venda, só marca o id)', () => {
  // A regra "nunca traz pedido" é responsabilidade de quem monta o mapa
  // original (a tela só tem no mapa pedidos que já estão na janela dela) — a
  // função em si é pura e não sabe o que é "a janela". Ela só aplica.
  const r = aplicarVendedorCorrigido({}, [ajuste(999, 9)]);
  assert.equal(r.mapa[999], 9);
  assert.equal(r.ajustados, 1);
});

test('ajuste com vendor_id quebrado NÃO passa — o mapa fica como está', () => {
  for (const ruim of [null, undefined, '', 'abacaxi', NaN, 0, -1]) {
    const r = aplicarVendedorCorrigido({ 1: 5 }, [ajuste(1, ruim)]);
    assert.equal(r.mapa[1], 5, `vendor_id ${String(ruim)} não podia passar`);
    assert.equal(r.ajustados, 0);
    assert.equal(r.corrigidosIds.size, 0);
  }
});

test('vendor_id em texto (bigint do Postgres pode voltar como string) é aceito', () => {
  const r = aplicarVendedorCorrigido({ 1: 5 }, [ajuste(1, '9')]);
  assert.equal(r.mapa[1], 9);
});

test('sem ajuste nenhum, o mapa volta como veio', () => {
  for (const vazio of [[], null, undefined]) {
    const r = aplicarVendedorCorrigido({ 1: 5 }, vazio);
    assert.deepEqual(r.mapa, { 1: 5 });
    assert.equal(r.ajustados, 0);
    assert.equal(r.corrigidosIds.size, 0);
  }
});

test('mapa vazio não quebra', () => {
  for (const vazio of [{}, null, undefined]) {
    const r = aplicarVendedorCorrigido(vazio, [ajuste(1, 9)]);
    assert.equal(r.mapa[1], 9);
  }
});

test('não muda o mapa original — a tela guarda o cache em window._gvPedidoVendorMap', () => {
  const original = { 1: 5 };
  aplicarVendedorCorrigido(original, [ajuste(1, 9)]);
  assert.equal(original[1], 5);
});

test('dois ajustes distintos, ambos aplicados', () => {
  const r = aplicarVendedorCorrigido({ 1: 5, 2: 6 }, [ajuste(1, 9), ajuste(2, 10)]);
  assert.equal(r.mapa[1], 9);
  assert.equal(r.mapa[2], 10);
  assert.equal(r.ajustados, 2);
  assert.equal(r.corrigidosIds.size, 2);
});
