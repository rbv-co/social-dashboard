import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustarPelaDataDaNota } from './data-da-venda.js';

// A REGRA mora aqui (e não em src/) porque a Edge da notificação de vendas roda
// no Deno e não alcança src/. Estes testes são os da regra; os que dependem do
// cliente do navegador ficam em src/compartilhado/data-da-venda.test.mjs.

const ped = (id, data, total = 100, loja = 205451611, numero = id) => ({ id, numero, data, total, loja: { id: loja } });
const linha = (pedido_id, data_pedido, data_da_venda, total = 100) => ({
  pedido_id, pedido_numero: String(pedido_id), data_pedido, data_da_venda, total, loja_id: 205451611,
});

test('o caso do dono: pedido na quinta, nota na sexta — sai da quinta e entra na sexta', () => {
  const quinta = ajustarPelaDataDaNota([ped(1, '2026-08-06')], [linha(1, '2026-08-06', '2026-08-07')], '2026-08-06', '2026-08-06');
  assert.equal(quinta.pedidos.length, 0, 'a quinta não conta mais essa venda');
  assert.equal(quinta.removidos, 1);

  const sexta = ajustarPelaDataDaNota([], [linha(1, '2026-08-06', '2026-08-07')], '2026-08-07', '2026-08-07');
  assert.equal(sexta.pedidos.length, 1, 'a sexta passa a contar');
  assert.equal(sexta.trazidos, 1);
  assert.equal(sexta.pedidos[0].data, '2026-08-07');
  assert.equal(sexta.pedidos[0].total, 100);
});

test('venda faturada no mesmo dia não se mexe', () => {
  const r = ajustarPelaDataDaNota([ped(1, '2026-08-06')], [linha(1, '2026-08-06', '2026-08-06')], '2026-08-06', '2026-08-06');
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.trazidos, 0);
  assert.equal(r.removidos, 0);
});

test('pedido sem linha nossa FICA — sumir por falta de informação seria pior', () => {
  const r = ajustarPelaDataDaNota([ped(9, '2026-08-11')], [], '2026-08-11', '2026-08-11');
  assert.equal(r.pedidos.length, 1, 'o robô ainda não passou por ele; a tela não pode perdê-lo');
  assert.equal(r.semResposta, 1);
  assert.equal(r.pedidos[0].data, '2026-08-11');
});

test('a data ORIGINAL do pedido é preservada — o cache grava essa, não a da nota', () => {
  const r = ajustarPelaDataDaNota([ped(1, '2026-08-06')], [linha(1, '2026-08-06', '2026-08-07')], '2026-08-01', '2026-08-31');
  assert.equal(r.pedidos[0].data, '2026-08-07', 'a tela soma pela data da nota');
  assert.equal(r.pedidos[0].dataDoPedido, '2026-08-06', 'e o cache continua sabendo o dia do pedido');
});

test('dentro do mesmo mês, o mês não muda — só o dia', () => {
  const mes = ajustarPelaDataDaNota(
    [ped(1, '2026-08-04', 3644.30), ped(2, '2026-08-04', 2550.74)],
    [linha(1, '2026-08-04', '2026-08-05', 3644.30), linha(2, '2026-08-04', '2026-08-05', 2550.74)],
    '2026-08-01', '2026-08-31');
  assert.equal(mes.pedidos.length, 2, 'os dois seguem dentro do mês');
  assert.equal(mes.pedidos.reduce((s, p) => s + p.total, 0), 6195.04);
  assert.ok(mes.pedidos.every(p => p.data === '2026-08-05'));
});

test('pedido trazido de outro dia vem com número e canal, pra esteira e o ranking', () => {
  const r = ajustarPelaDataDaNota([], [linha(2429, '2026-08-04', '2026-08-05', 3644.30)], '2026-08-05', '2026-08-05');
  const p = r.pedidos[0];
  assert.equal(p.numero, '2429');
  assert.equal(p.loja.id, 205451611);
  assert.equal(p.trazidoDeOutroDia, true);
  assert.equal(p.dataDoPedido, '2026-08-04');
});

test('linha fora da janela não entra de carona', () => {
  const r = ajustarPelaDataDaNota([], [linha(1, '2026-07-01', '2026-07-02')], '2026-08-01', '2026-08-31');
  assert.equal(r.pedidos.length, 0);
});

test('a borda do último dia conta (df é inclusivo)', () => {
  const r = ajustarPelaDataDaNota([], [linha(1, '2026-07-30', '2026-08-31')], '2026-08-01', '2026-08-31');
  assert.equal(r.pedidos.length, 1, 'o dia 31 faz parte de agosto');
});

test('data com hora (o Bling às vezes manda) não quebra a comparação', () => {
  const r = ajustarPelaDataDaNota([ped(1, '2026-08-06 14:22:00')], [linha(1, '2026-08-06', '2026-08-06')], '2026-08-06', '2026-08-06');
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].dataDoPedido, '2026-08-06');
});

