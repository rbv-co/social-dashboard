import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantidadeNoSite, calcularAjustes } from './estoque-do-site.js';

test('site = loja − 1 (mostruário), nunca negativo', () => {
  assert.equal(quantidadeNoSite(5), 4);
  assert.equal(quantidadeNoSite(2), 1);
  assert.equal(quantidadeNoSite(1), 0);   // só o mostruário: esgota
  assert.equal(quantidadeNoSite(0), 0);   // acabou na loja: esgota
  assert.equal(quantidadeNoSite(-3), 0);
});

test('saldo ilegível não decide nada', () => {
  assert.equal(quantidadeNoSite('abc'), null);
  assert.equal(quantidadeNoSite(undefined), null);
});

test('o caso de 25/09: vendida na loja, ainda à venda no site → esgota', () => {
  const v = [{ sku: 'SS0001CB.M1', inventoryItemId: 'i1', noLocal: true, disponivel: 1 }];
  const { ajustes } = calcularAjustes(v, new Map([['SS0001CB.M1', 0]]));
  assert.deepEqual(ajustes, [{ sku: 'SS0001CB.M1', inventoryItemId: 'i1', de: 1, para: 0, ativar: false }]);
});

test('SKU que o Bling não devolveu fica INTOCADO (falha de leitura não esgota o site)', () => {
  const v = [{ sku: 'SS0003WB.B2', inventoryItemId: 'i2', noLocal: true, disponivel: 2 }];
  const r = calcularAjustes(v, new Map());
  assert.equal(r.ajustes.length, 0);
  assert.deepEqual(r.semBling, ['SS0003WB.B2']);
});

test('valor já certo não gera gravação', () => {
  const v = [{ sku: 'A', inventoryItemId: 'i', noLocal: true, disponivel: 4 }];
  const r = calcularAjustes(v, new Map([['A', 5]]));
  assert.equal(r.ajustes.length, 0);
  assert.deepEqual(r.iguais, ['A']);
});

test('peça fora do local do Iguatemi: ativa só se houver o que vender', () => {
  const v = [
    { sku: 'A', inventoryItemId: 'ia', noLocal: false, disponivel: null },
    { sku: 'B', inventoryItemId: 'ib', noLocal: false, disponivel: null },
  ];
  const r = calcularAjustes(v, new Map([['A', 3], ['B', 1]]));
  assert.deepEqual(r.ajustes, [{ sku: 'A', inventoryItemId: 'ia', de: 0, para: 2, ativar: true }]);
  assert.deepEqual(r.iguais, ['B']);
});
