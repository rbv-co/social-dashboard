import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehDevolucaoDeMercadoria, aplicarValorLiquidoDeTroca } from './valor-liquido-de-troca.js';

// A REGRA mora aqui (e não em src/) pelo mesmo motivo do data-da-venda/valor-
// corrigido: a Edge e os robôs não alcançam src/. Testes do que é do navegador
// ficam em src/compartilhado/valor-liquido-de-troca.test.mjs.

const ped = (id, total, extra = {}) => ({ id, total, loja: { id: 205834116 }, ...extra });
const linha = (pedido_id, valor) => ({ pedido_id, valor });

test('tipoPagamento=5 é devolução de mercadoria; qualquer outro, não', () => {
  assert.equal(ehDevolucaoDeMercadoria(5), true);
  assert.equal(ehDevolucaoDeMercadoria('5'), false, 'o Bling manda número, não string — não forçar conversão aqui');
  for (const outro of [1, 3, 4, 15, 16, 20, 99, 0, null, undefined]) {
    assert.equal(ehDevolucaoDeMercadoria(outro), false, `tipoPagamento ${outro} não é devolução`);
  }
});

test('o caso real: pedido #2708, total 1900 com 1600 de devolução vira 300', () => {
  const r = aplicarValorLiquidoDeTroca([ped(27018529287, 1900)], [linha(27018529287, 1600)]);
  assert.equal(r.pedidos[0].total, 300);
  assert.equal(r.pedidos[0].totalComTroca, 1900, 'o valor bruto fica guardado para explicar depois');
  assert.equal(r.pedidos[0].valorDevolucao, 1600);
  assert.equal(r.ajustados, 1);
});

test('pedido sem devolução não é tocado — nem ganha marca', () => {
  const r = aplicarValorLiquidoDeTroca([ped(1, 1900), ped(2, 500)], [linha(1, 1600)]);
  assert.equal(r.pedidos[1].total, 500);
  assert.equal(r.pedidos[1].totalComTroca, undefined);
  assert.equal(r.pedidos[1].valorDevolucao, undefined);
  assert.equal(r.ajustados, 1);
});

test('duas parcelas de devolução no mesmo pedido somam', () => {
  const r = aplicarValorLiquidoDeTroca([ped(1, 1000)], [linha(1, 300), linha(1, 200)]);
  assert.equal(r.pedidos[0].total, 500);
  assert.equal(r.pedidos[0].valorDevolucao, 500);
});

test('entra DEPOIS de valor-corrigido na cadeia: subtrai do total já corrigido', () => {
  // Simula o pedido já tendo passado por aplicarValorCorrigido.
  const jaCorrigido = { ...ped(1, 1900), total: 1615, totalDoBling: 1900, valorAjustado: true };
  const r = aplicarValorLiquidoDeTroca([jaCorrigido], [linha(1, 600)]);
  assert.equal(r.pedidos[0].total, 1015, 'subtrai do total corrigido, não do bruto do Bling');
  assert.equal(r.pedidos[0].totalComTroca, 1615, 'guarda o total ANTES da devolução, que já era o corrigido');
  assert.equal(r.pedidos[0].valorAjustado, true, 'marca de valor-corrigido não se perde');
});

test('devolução de pedido que não está na lista é ignorada — não inventa venda', () => {
  const r = aplicarValorLiquidoDeTroca([ped(1, 1900)], [linha(1, 100), linha(999, 50)]);
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.ajustados, 1);
});

test('valor quebrado (zero, negativo, texto, nulo) não é aplicado', () => {
  for (const ruim of [0, -1, null, undefined, '', 'abacaxi', NaN]) {
    const r = aplicarValorLiquidoDeTroca([ped(1, 1900)], [linha(1, ruim)]);
    assert.equal(r.pedidos[0].total, 1900, `devolução ${String(ruim)} não podia passar`);
    assert.equal(r.ajustados, 0);
  }
});

test('valor em texto (numeric do Postgres volta como string) é aceito', () => {
  const r = aplicarValorLiquidoDeTroca([ped(1, 1900)], [linha(1, '1600.00')]);
  assert.equal(r.pedidos[0].total, 300);
});

test('sem devolução nenhuma, a lista volta como veio', () => {
  for (const vazio of [[], null, undefined]) {
    const r = aplicarValorLiquidoDeTroca([ped(1, 1900)], vazio);
    assert.equal(r.pedidos[0].total, 1900);
    assert.equal(r.ajustados, 0);
  }
});

test('lista de pedidos vazia não quebra', () => {
  for (const vazio of [[], null, undefined]) {
    const r = aplicarValorLiquidoDeTroca(vazio, [linha(1, 100)]);
    assert.deepEqual(r.pedidos, []);
  }
});

test('não muda o objeto original', () => {
  const original = ped(1, 1900);
  aplicarValorLiquidoDeTroca([original], [linha(1, 600)]);
  assert.equal(original.total, 1900);
});
