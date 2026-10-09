import test from 'node:test';
import assert from 'node:assert/strict';
import { blingViaCore, chaveIdempotente, ligada } from './core-bling-proxy.js';

const ENV = { CORE_BLING_PROXY: 'true', CORE_API_TOKEN: 'segredo', CORE_URL: 'https://core.x/' };
const H = (o) => ({ get: (k) => o[k] ?? null });
const core = (status, corpo, h = {}) => ({ status, headers: H(h), text: async () => JSON.stringify(corpo) });
const falso = (...rs) => {
  const c = [];
  const f = async (u, i) => { c.push({ u, i, b: JSON.parse(i.body) }); const r = rs.shift(); if (r instanceof Error) throw r; return r; };
  f.c = c;
  return f;
};

test('flag: só true/1 liga', () => {
  assert.equal(ligada({}), false);
  assert.equal(ligada({ CORE_BLING_PROXY: 'nao' }), false);
  assert.equal(ligada({ CORE_BLING_PROXY: 'TRUE' }), true);
  assert.equal(ligada({ CORE_BLING_PROXY: '1' }), true);
});

test('desligada: não toca o proxy, chama o direto igual ao de sempre', async () => {
  const f = falso();
  let visto;
  const direto = async (u, i) => { visto = { u, i }; return { status: 200, ok: true }; };
  const b = blingViaCore({}, { fetchImpl: f, direto, base: 'https://bling/v3' });
  await b.chamar('GET', '/contatos', { query: { numeroDocumento: '123' }, token: 'tk' });
  assert.equal(f.c.length, 0);
  assert.equal(visto.u, 'https://bling/v3/contatos?numeroDocumento=123');
  assert.equal(visto.i.headers.Authorization, 'Bearer tk');
});

test('ligada: monta corpo e header certos, sem token do Bling', async () => {
  const f = falso(core(201, { data: { id: 7 } }));
  const b = blingViaCore(ENV, { fetchImpl: f, direto: () => { throw new Error('não'); } });
  const r = await b.chamar('POST', '/contatos', { corpo: { nome: 'A' }, chave: 'k1', prioridade: 'sync' });
  const [c] = f.c;
  assert.equal(c.u, 'https://core.x/api/interno/bling/proxy');
  assert.equal(c.i.headers.Authorization, 'Bearer segredo');
  assert.deepEqual(c.b, { metodo: 'POST', caminho: '/contatos', corpo: { nome: 'A' }, prioridade: 'sync', idempotency_key: 'k1' });
  assert.equal((await r.json()).data.id, 7);
  assert.equal(r.ok, true);
});

test('chave estável entre tentativas e diferente se o corpo muda', async () => {
  const a = await chaveIdempotente('lista:abc-123', 'contato-criar', { nome: 'A', celular: '1' });
  const a2 = await chaveIdempotente('lista:abc-123', 'contato-criar', { nome: 'A', celular: '1' });
  const c = await chaveIdempotente('lista:abc-123', 'contato-criar', { nome: 'A', celular: '2' });
  assert.equal(a, a2);
  assert.notEqual(a, c);
  assert.match(a, /^[A-Za-z0-9._:-]{1,120}$/);
  const longa = await chaveIdempotente('x'.repeat(300) + ' ç/', 'contato-criar', {});
  assert.match(longa, /^[A-Za-z0-9._:-]{1,120}$/);
});

test('504 resultado_incerto: sinaliza e não reenvia', async () => {
  const f = falso(core(504, { erro: 'resultado_incerto', idempotency_key: 'k' }, { 'X-Core-Origem': 'proxy' }));
  const r = await blingViaCore(ENV, { fetchImpl: f }).chamar('POST', '/contatos', { corpo: {}, chave: 'k' });
  assert.equal(r.incerto, true);
  assert.equal(f.c.length, 1);
});

test('queda/timeout em escrita = incerto, sem reenviar; em leitura não', async () => {
  const f = falso(new Error('timeout'), new Error('timeout'));
  const b = blingViaCore(ENV, { fetchImpl: f });
  assert.equal((await b.chamar('PUT', '/contatos/1', { corpo: {}, chave: 'k' })).incerto, true);
  assert.equal((await b.chamar('GET', '/contatos/1')).incerto, false);
  assert.equal(f.c.length, 2);
});

test('409 reautorizacao_necessaria mapeado; 4xx do Bling passa tal qual; replay marcado', async () => {
  const f = falso(
    core(409, { erro: 'reautorizacao_necessaria' }, { 'X-Core-Origem': 'proxy' }),
    core(400, { error: { type: 'VALIDATION_ERROR' } }),
    core(201, { data: { id: 1 } }, { 'Idempotent-Replay': 'true' }));
  const b = blingViaCore(ENV, { fetchImpl: f });
  assert.equal((await b.chamar('POST', '/contatos', { corpo: {}, chave: 'k' })).reautorizar, true);
  const r400 = await b.chamar('POST', '/contatos', { corpo: {}, chave: 'k' });
  assert.equal(r400.status, 400);
  assert.equal(r400.reautorizar, false);
  assert.equal(r400.ok, false);
  assert.equal((await b.chamar('POST', '/contatos', { corpo: {}, chave: 'k' })).replay, true);
});

test('ligada sem CORE_API_TOKEN lança sem chamar nada', async () => {
  const f = falso();
  await assert.rejects(blingViaCore({ CORE_BLING_PROXY: '1' }, { fetchImpl: f }).chamar('GET', '/contatos'), /CORE_API_TOKEN/);
  assert.equal(f.c.length, 0);
});
