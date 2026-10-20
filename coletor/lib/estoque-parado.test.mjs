// Estoque que nunca zera (plano 05, item B): a regra pura e os dois sinais de "leitura incompleta" do Bling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linhasParaZerar, motivoParaNaoZerar, chavesConhecidas, zerarOQueSumiu } from './estoque-parado.mjs';
import { blingProdutos, blingSaldoFoco } from './bling-comercial.mjs';

const CATALOGO = { 16460833586: { nome: 'Tubox', codigo: 'Tubox-8106' }, 7: { nome: 'B', codigo: 'B' }, 9: { nome: 'sem codigo', codigo: '' } };

test('linhasParaZerar: zera produto do catálogo que a rodada não viu; mantém o visto; não toca o que não conhece nem o que já é 0', () => {
  const existentes = [
    { sku: 'Tubox-8106', saldo: 117 },   // visto: fica
    { sku: 'B', saldo: 3 },              // produto ativo que zerou no Bling: zera
    { sku: '16460833586', saldo: 26 },   // chave numérica velha (o produto ganhou código): zera, sem contar em dobro
    { sku: '9', saldo: 4 },              // produto sem código (chave = id) que zerou: zera
    { sku: 'C', saldo: 0 },              // já é 0: não mexe
    { sku: 'Lona Rosa Cha', saldo: 90 }, // código que não existe mais / produto inativo: NÃO sabemos o saldo, não toca
  ];
  const r = linhasParaZerar(existentes, new Set(['Tubox-8106']), chavesConhecidas(CATALOGO));
  assert.deepEqual(r.map((l) => l.sku), ['B', '16460833586', '9']);
});

test('zerarOQueSumiu: lê as antigas do depósito, grava só 4 colunas com o carimbo, nunca apaga; pula com leitura incompleta', async () => {
  const gravacoes = [];
  const buscas = [];
  const base = {
    depositoId: '14888830073', canal: 'M.P', prodMap: CATALOGO, carimbo: '2026-10-20T12:00:00.000Z',
    vivas: [{ sku: 'Tubox-8106', saldo: 117 }], leitura: { incompleto: false, lotesComFalha: 0 },
    buscar: async (c) => { buscas.push(c); return [{ sku: 'Tubox-8106', saldo: 117 }, { sku: '16460833586', saldo: 26 }, { sku: 'Inativo', saldo: 5 }]; },
    gravar: async (tabela, conflito, linhas) => gravacoes.push({ tabela, conflito, linhas }),
    log: { log() {}, warn() {} },
  };
  assert.equal(await zerarOQueSumiu(base), 1);
  assert.match(buscas[0], /deposito_id=eq\.14888830073&saldo=neq\.0/);
  assert.deepEqual(gravacoes, [{ tabela: 'gc_estoque_item', conflito: 'deposito_id,sku',
    linhas: [{ deposito_id: 14888830073, sku: '16460833586', saldo: 0, atualizado_em: '2026-10-20T12:00:00.000Z' }] }]);
  for (const leitura of [{ incompleto: true, lotesComFalha: 0 }, { incompleto: false, lotesComFalha: 1 }]) {
    gravacoes.length = 0; buscas.length = 0;
    assert.equal(await zerarOQueSumiu({ ...base, leitura }), 0);
    assert.deepEqual([gravacoes, buscas], [[], []], 'leitura incompleta: nem lê nem grava');
  }
  assert.equal(await zerarOQueSumiu({ ...base, vivas: [] }), 0, 'depósito sem nenhuma linha viva: não zera');
});

test('motivoParaNaoZerar: só zera com leitura completa', () => {
  const ok = { catalogoIncompleto: false, lotesComFalha: 0, produtos: 1772, linhasLidasNoDeposito: 40 };
  assert.equal(motivoParaNaoZerar(ok), null);
  assert.match(motivoParaNaoZerar({ ...ok, produtos: 0 }), /catálogo vazio/);
  assert.match(motivoParaNaoZerar({ ...ok, catalogoIncompleto: true }), /não veio completo/);
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

test('2xx sem lista (corpo não-JSON do proxy) conta como leitura incompleta, não como "fim da lista"', async () => {
  const fetchAntes = globalThis.fetch;
  const corAntes = process.env.CORE_LEITURA_CATALOGO;
  delete process.env.CORE_LEITURA_CATALOGO;
  try {
    globalThis.fetch = async () => resp({ raw: '<html>' });
    const estado = {};
    await blingProdutos('jwt', 3, estado);
    assert.equal(estado.incompleto, true);
    const e2 = {};
    await blingSaldoFoco('jwt', { 1: {} }, e2);
    assert.equal(e2.lotesComFalha, 1);
  } finally {
    globalThis.fetch = fetchAntes;
    if (corAntes !== undefined) process.env.CORE_LEITURA_CATALOGO = corAntes;
  }
});

test('catálogo vindo do espelho do Core nunca autoriza zerar (não diz se está completo)', async () => {
  const fetchAntes = globalThis.fetch;
  const antes = { l: process.env.CORE_LEITURA_CATALOGO, t: process.env.CORE_API_TOKEN, u: process.env.CORE_URL };
  process.env.CORE_LEITURA_CATALOGO = 'true'; process.env.CORE_API_TOKEN = 'x'; process.env.CORE_URL = 'https://core.teste';
  try {
    globalThis.fetch = async () => resp({ data: [{ id_bling: 1, codigo: 'B1', descricao: 'Bolsa', preco: '10.00' }], proximo_cursor: null });
    const estado = {};
    await blingProdutos('jwt', 3, estado);
    assert.equal(estado.incompleto, true);
  } finally {
    globalThis.fetch = fetchAntes;
    for (const [k, v] of [['CORE_LEITURA_CATALOGO', antes.l], ['CORE_API_TOKEN', antes.t], ['CORE_URL', antes.u]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
