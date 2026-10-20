// Estoque que nunca zera (plano 05, item B): a regra pura e os dois sinais de "leitura incompleta" do Bling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linhasParaZerar, motivoParaNaoZerar } from './estoque-parado.mjs';
import { blingProdutos, blingSaldoFoco } from './bling-comercial.mjs';

test('linhasParaZerar: zera o que a rodada não viu com saldo; mantém o visto e ignora o que já é 0', () => {
  const existentes = [
    { sku: 'A', saldo: 5 },        // visto: fica
    { sku: 'B', saldo: 3 },        // zerou no Bling: zera
    { sku: '16460833586', saldo: 26 }, // chave numérica velha (o produto ganhou código): zera, sem contar em dobro
    { sku: 'C', saldo: 0 },        // já é 0: não mexe
    { sku: 'D', saldo: -1 },       // saldo negativo também some se não foi visto
  ];
  const r = linhasParaZerar(existentes, new Set(['A', 'Tubox-8106']));
  assert.deepEqual(r.map((l) => l.sku), ['B', '16460833586', 'D']);
});

test('motivoParaNaoZerar: só zera com leitura completa', () => {
  const ok = { catalogoIncompleto: false, lotesComFalha: 0, produtos: 1772, linhasLidasNoDeposito: 40 };
  assert.equal(motivoParaNaoZerar(ok), null);
  assert.match(motivoParaNaoZerar({ ...ok, produtos: 0 }), /catálogo vazio/);
  assert.match(motivoParaNaoZerar({ ...ok, catalogoIncompleto: true }), /pela metade/);
  assert.match(motivoParaNaoZerar({ ...ok, lotesComFalha: 2 }), /2 lote/);
  assert.match(motivoParaNaoZerar({ ...ok, linhasLidasNoDeposito: 0 }), /nenhuma linha/);
});

const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo) });
const pagina = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, nome: 'P' + i, codigo: 'C' + i, preco: 1 }));

test('blingProdutos: lista que termina antes do teto é completa; página cheia no teto ou página que falha é incompleta', async () => {
  const fetchAntes = globalThis.fetch;
  const corAntes = process.env.CORE_LEITURA_CATALOGO;
  delete process.env.CORE_LEITURA_CATALOGO;
  try {
    let estado = {};
    globalThis.fetch = async () => resp({ data: pagina(40) });
    await blingProdutos('jwt', 3, estado);
    assert.equal(estado.incompleto, undefined, 'terminou na 1ª página: completa');

    estado = {};
    globalThis.fetch = async () => resp({ data: pagina(100) });
    await blingProdutos('jwt', 2, estado);
    assert.equal(estado.incompleto, true, 'página cheia no teto: pode haver mais');

    estado = {};
    let n = 0;
    globalThis.fetch = async () => (++n === 1 ? resp({ data: pagina(100) }) : resp({ erro: 'x' }, 400));
    await blingProdutos('jwt', 5, estado);
    assert.equal(estado.incompleto, true, 'página que falhou: incompleta');
  } finally {
    globalThis.fetch = fetchAntes;
    if (corAntes !== undefined) process.env.CORE_LEITURA_CATALOGO = corAntes;
  }
});

test('blingSaldoFoco: conta os lotes que falharam e só devolve saldo > 0', async () => {
  const fetchAntes = globalThis.fetch;
  try {
    const prodMap = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [String(i + 1), {}]));
    let n = 0;
    globalThis.fetch = async () => (++n === 1
      ? resp({ data: [{ produto: { id: 1 }, depositos: [{ id: 9, saldoFisico: 4 }, { id: 8, saldoFisico: 0 }] }] })
      : resp({ erro: 'x' }, 400));
    const estado = {};
    const r = await blingSaldoFoco('jwt', prodMap, estado);
    assert.deepEqual(r, { 9: { 1: 4 } });
    assert.equal(estado.lotesComFalha, 1);
  } finally {
    globalThis.fetch = fetchAntes;
  }
});
