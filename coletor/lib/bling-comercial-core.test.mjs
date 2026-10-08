// blingProdutos com a chave CORE_LEITURA_CATALOGO ligada e desligada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blingProdutos } from './bling-comercial.mjs';

const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo) });

async function comEnv(env, fn) {
  const antes = {};
  for (const k of Object.keys(env)) {
    antes[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  const fetchAntes = globalThis.fetch;
  try { return await fn(); } finally {
    globalThis.fetch = fetchAntes;
    for (const k of Object.keys(antes)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
  }
}

test('desligada (padrao): le do bling-proxy e NAO chama o core', async () => {
  await comEnv({ CORE_LEITURA_CATALOGO: undefined, CORE_API_TOKEN: 'x' }, async () => {
    const urls = [];
    globalThis.fetch = async (url) => { urls.push(String(url)); return resp({ data: [{ id: 1, nome: 'Bolsa', codigo: 'B1', preco: 10 }] }); };
    const prod = await blingProdutos('jwt');
    assert.deepEqual(prod, { 1: { nome: 'Bolsa', codigo: 'B1', preco: 10 } });
    assert.ok(urls.every((u) => u.includes('/functions/v1/bling-proxy')), urls.join());
  });
});

test('ligada: le do core e NAO chama o bling-proxy', async () => {
  await comEnv({ CORE_LEITURA_CATALOGO: 'true', CORE_API_TOKEN: 'x', CORE_URL: 'https://core.teste' }, async () => {
    const urls = [];
    globalThis.fetch = async (url) => { urls.push(String(url)); return resp({ data: [{ id_bling: 1, codigo: 'B1', descricao: 'Bolsa', preco: '10.00' }], proximo_cursor: null }); };
    const prod = await blingProdutos('jwt');
    assert.deepEqual(prod, { 1: { nome: 'Bolsa', codigo: 'B1', preco: 10 } });
    assert.ok(urls.length && urls.every((u) => u.startsWith('https://core.teste/api/interno/espelho/produtos_bling')), urls.join());
  });
});
