import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarValorCorrigido } from './valor-corrigido.js';

// A REGRA mora aqui (e não em src/) pelo mesmo motivo do data-da-venda: a Edge
// e os robôs não alcançam src/, e duas cópias da mesma regra discordam cedo ou
// tarde. Os testes do que é do navegador ficam em
// src/compartilhado/valor-corrigido.test.mjs.

const ped = (id, total = 1900, extra = {}) => ({ id, numero: id, data: '2026-09-11', total, loja: { id: 205834116 }, ...extra });
const ajuste = (pedido_id, total_corrigido) => ({ pedido_id, total_corrigido, motivo: 'desconto à vista no Pix' });

test('o caso do dono: pedido congelado em 1.900 passa a valer 1.615 na tela', () => {
  const r = aplicarValorCorrigido([ped(26851358889)], [ajuste(26851358889, 1615)]);
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].total, 1615);
  assert.equal(r.ajustados, 1);
});

test('o valor do Bling não se perde — fica guardado ao lado, para a tela poder explicar', () => {
  const r = aplicarValorCorrigido([ped(1, 1900)], [ajuste(1, 1615)]);
  assert.equal(r.pedidos[0].totalDoBling, 1900, 'sem isto, ninguém descobre depois de onde veio a diferença');
  assert.equal(r.pedidos[0].valorAjustado, true);
});

test('pedido sem ajuste não é tocado — nem ganha marca', () => {
  const r = aplicarValorCorrigido([ped(1), ped(2)], [ajuste(1, 1615)]);
  assert.equal(r.pedidos[1].total, 1900);
  assert.equal(r.pedidos[1].valorAjustado, undefined);
  assert.equal(r.ajustados, 1);
});

test('O PONTO DA HISTÓRIA: o pedido TRAZIDO de outro dia também é corrigido', () => {
  // O valor dele não vem da resposta do Bling, vem de `bling_pedido_nota.total`.
  // São dois caminhos para o mesmo número: corrigir só um faz a mesma venda
  // aparecer 1.615 num dia e 1.900 noutro.
  const trazido = ped(26851358889, 1900, { trazidoDeOutroDia: true });
  const r = aplicarValorCorrigido([trazido], [ajuste(26851358889, 1615)]);
  assert.equal(r.pedidos[0].total, 1615);
  assert.equal(r.pedidos[0].trazidoDeOutroDia, true, 'e continua sabendo que veio de outro dia');
});

test('id casa mesmo vindo como texto de um lado e número do outro', () => {
  const r = aplicarValorCorrigido([ped('26851358889')], [ajuste(26851358889, 1615)]);
  assert.equal(r.pedidos[0].total, 1615);
});

test('ajuste de pedido que não está na janela é ignorado — não inventa venda', () => {
  const r = aplicarValorCorrigido([ped(1)], [ajuste(1, 1615), ajuste(999, 50)]);
  assert.equal(r.pedidos.length, 1, 'ao contrário do data-da-venda, este ajuste nunca TRAZ pedido');
  assert.equal(r.ajustados, 1);
});

test('sem ajuste nenhum, a lista volta como veio', () => {
  for (const vazio of [[], null, undefined]) {
    const r = aplicarValorCorrigido([ped(1), ped(2)], vazio);
    assert.equal(r.pedidos.length, 2);
    assert.equal(r.ajustados, 0);
    assert.equal(r.pedidos[0].total, 1900);
  }
});

test('ajuste com valor quebrado NÃO zera a venda — o pedido fica como está', () => {
  // Um ajuste torto tem que valer menos que o dado do Bling, nunca mais.
  for (const ruim of [null, undefined, '', 'abacaxi', NaN, -1]) {
    const r = aplicarValorCorrigido([ped(1, 1900)], [ajuste(1, ruim)]);
    assert.equal(r.pedidos[0].total, 1900, `valor ${String(ruim)} não podia passar`);
    assert.equal(r.pedidos[0].valorAjustado, undefined);
    assert.equal(r.ajustados, 0);
  }
});

test('zero é valor válido — venda cancelada de fato pode ir a zero', () => {
  const r = aplicarValorCorrigido([ped(1, 1900)], [ajuste(1, 0)]);
  assert.equal(r.pedidos[0].total, 0);
  assert.equal(r.ajustados, 1);
});

test('valor em texto (o numeric do Postgres volta como string) é aceito', () => {
  const r = aplicarValorCorrigido([ped(1, 1900)], [ajuste(1, '1615.00')]);
  assert.equal(r.pedidos[0].total, 1615);
});

test('lista de pedidos vazia não quebra', () => {
  for (const vazio of [[], null, undefined]) {
    const r = aplicarValorCorrigido(vazio, [ajuste(1, 1615)]);
    assert.deepEqual(r.pedidos, []);
    assert.equal(r.ajustados, 0);
  }
});

test('não muda o objeto original — a tela guarda cache do que veio do Bling', () => {
  const original = ped(1, 1900);
  aplicarValorCorrigido([original], [ajuste(1, 1615)]);
  assert.equal(original.total, 1900);
});
