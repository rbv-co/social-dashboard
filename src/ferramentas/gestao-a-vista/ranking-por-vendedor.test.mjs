import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRankingPorVendedor } from './ranking-por-vendedor.js';

const ped = (id, vendedorId, total, lojaId = 1) => ({ id, total, vendedor: { id: vendedorId }, loja: { id: lojaId } });

test('soma total e conta pedidos por vendedora', () => {
  const r = calcularRankingPorVendedor(
    [ped(1, 10, 300), ped(2, 10, 200), ped(3, 20, 500)],
    [],
    {},
    { 10: { nome: 'Kariny Stefany' }, 20: { nome: 'Outra Vendedora' } },
    { 1: 'Shopping Tivoli' },
  );
  const kariny = r.vendsArr.find((v) => v.nm === 'Kariny Stefany');
  assert.equal(kariny.total, 500);
  assert.equal(kariny.cnt, 2);
  assert.equal(kariny.canal, 'Shopping Tivoli');
});

test('usa pedidoVendorMap por cima de p.vendedor?.id quando presente', () => {
  const r = calcularRankingPorVendedor(
    [ped(1, 10, 300)], [], { 1: 999 }, { 999: { nome: 'Corrigida' }, 10: { nome: 'Errada' } }, {},
  );
  assert.equal(r.vendsArr[0].nm, 'Corrigida');
});

test('sem nome conhecido, cai em "Sem vendedor"', () => {
  const r = calcularRankingPorVendedor([ped(1, 77, 100)], [], {}, {}, {});
  assert.equal(r.vendsArr[0].nm, 'Sem vendedor');
});

test('porVendPrev soma o período anterior pela mesma chave', () => {
  const r = calcularRankingPorVendedor(
    [ped(1, 10, 300)], [ped(2, 10, 250)], {}, { 10: { nome: 'Kariny' } }, {},
  );
  assert.equal(r.porVendPrev['10'], 250);
});

test('ordena do maior para o menor total', () => {
  const r = calcularRankingPorVendedor(
    [ped(1, 10, 100), ped(2, 20, 900)], [], {}, { 10: { nome: 'A' }, 20: { nome: 'B' } }, {},
  );
  assert.equal(r.vendsArr[0].nm, 'B');
  assert.equal(r.vendsArr[1].nm, 'A');
});

test('listas vazias não quebram', () => {
  const r = calcularRankingPorVendedor([], [], {}, {}, {});
  assert.deepEqual(r.vendsArr, []);
  assert.deepEqual(r.porVendPrev, {});
});
