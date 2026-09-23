import test from 'node:test';
import assert from 'node:assert/strict';
import { contasDoItem } from './preco-do-item.mjs';

// ── O conserto de 22/09/2026, com os números reais que o Bling devolveu ─────

test('o total do item é qtd × valor, SEM descontar de novo (pedido 2130)', () => {
  const r = contasDoItem({ quantidade: 1, valor: 224.95, desconto: 50 });
  assert.equal(r.totalDoItem, 224.95);
});

test('as nove linhas do pedido 2649 somam o total do cabeçalho', () => {
  // Lido na API do Bling em 22/09/2026: totalProdutos = 1263.25
  const itens = [
    { quantidade: 5, valor: 29.70, desconto: 84.36 },
    { quantidade: 5, valor: 29.70, desconto: 84.36 },
    { quantidade: 2, valor: 45.15, desconto: 67.73 },
    { quantidade: 1, valor: 97.65, desconto: 66.32 },
    { quantidade: 1, valor: 111.65, desconto: 68.09 },
    { quantidade: 1, valor: 111.65, desconto: 68.09 },
    { quantidade: 2, valor: 99.00, desconto: 74.61 },
    { quantidade: 1, valor: 119.00, desconto: 69.48 },
    { quantidade: 2, valor: 119.00, desconto: 69.48 },
  ];
  const soma = itens.reduce((t, it) => t + contasDoItem(it).totalDoItem, 0);
  assert.equal(Math.round(soma * 100) / 100, 1263.25);
});

test('a conta ANTIGA dava 338,98 no 2649 — a trava contra a volta do defeito', () => {
  const itens = [
    { quantidade: 5, valor: 29.70, desconto: 84.36 },
    { quantidade: 5, valor: 29.70, desconto: 84.36 },
    { quantidade: 2, valor: 45.15, desconto: 67.73 },
    { quantidade: 1, valor: 97.65, desconto: 66.32 },
    { quantidade: 1, valor: 111.65, desconto: 68.09 },
    { quantidade: 1, valor: 111.65, desconto: 68.09 },
    { quantidade: 2, valor: 99.00, desconto: 74.61 },
    { quantidade: 1, valor: 119.00, desconto: 69.48 },
    { quantidade: 2, valor: 119.00, desconto: 69.48 },
  ];
  const soma = itens.reduce((t, it) => t + contasDoItem(it).totalDoItem, 0);
  assert.notEqual(Math.round(soma * 100) / 100, 338.98);
});

// ── O preço de tabela ───────────────────────────────────────────────────────

test('o preço de tabela reconstrói o preço de varejo de verdade', () => {
  // Cada um destes foi conferido contra a base em 22/09/2026.
  assert.equal(contasDoItem({ quantidade: 1, valor: 224.95, desconto: 50 }).precoDeTabela, 449.90);
  assert.equal(contasDoItem({ quantidade: 1, valor: 244.95, desconto: 50 }).precoDeTabela, 489.90);
  assert.equal(contasDoItem({ quantidade: 1, valor: 194.95, desconto: 50 }).precoDeTabela, 389.90);
  assert.equal(contasDoItem({ quantidade: 1, valor: 331.42, desconto: 15 }).precoDeTabela, 389.91);
});

test('sem desconto, o preço de tabela é o próprio valor cobrado', () => {
  const r = contasDoItem({ quantidade: 3, valor: 199.90, desconto: 0 });
  assert.equal(r.precoDeTabela, 199.90);
  assert.equal(r.totalDoItem, 599.70);
});

test('desconto ausente não vira NaN', () => {
  const r = contasDoItem({ quantidade: 2, valor: 50 });
  assert.equal(r.precoDeTabela, 50);
  assert.equal(r.totalDoItem, 100);
  assert.equal(r.percentual, 0);
});

test('desconto de 100% ou mais não vira Infinity nem número negativo', () => {
  // A divisão por (1 - 1) daria Infinity, e um Infinity contamina toda soma
  // que o encostar. Preço cheio vira o próprio valor cobrado.
  for (const pct of [100, 120]) {
    const r = contasDoItem({ quantidade: 1, valor: 80, desconto: pct });
    assert.equal(r.precoDeTabela, 80);
    assert.ok(Number.isFinite(r.precoDeTabela));
  }
});

test('lixo no lugar do número não derruba a conta', () => {
  const r = contasDoItem({ quantidade: 'abc', valor: null, desconto: undefined });
  assert.equal(r.totalDoItem, 0);
  assert.equal(r.precoDeTabela, 0);
});

test('item sem nada devolve zeros, não explode', () => {
  const r = contasDoItem(undefined);
  assert.equal(r.totalDoItem, 0);
  assert.equal(r.precoDeTabela, 0);
});
