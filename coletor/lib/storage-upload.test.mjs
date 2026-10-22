// coletor/lib/storage-upload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subirStorageResiliente } from './storage-upload.mjs';

const base = (over = {}) => ({
  url: 'http://api:8080', token: 'srv_robo', bucket: 'fabrica-criativos',
  path: 'camp/produto/LV1-heroi-1080x1920.png', buf: Buffer.from('png'),
  urlPublica: 'https://central.rbvcompany.com',
  sleepImpl: async () => {}, // sem espera real nos testes
  ...over,
});

test('sucesso na 1ª tentativa: PUT com upsert na API, devolve a URL pública da Central', async () => {
  const pedidos = [];
  const url = await subirStorageResiliente(base({
    fetchImpl: async (u, init) => { pedidos.push({ u, init }); return { ok: true, status: 200 }; },
  }));
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].u, 'http://api:8080/arquivos/fabrica-criativos/camp/produto/LV1-heroi-1080x1920.png');
  assert.equal(pedidos[0].init.method, 'PUT');
  assert.equal(pedidos[0].init.headers.Authorization, 'Bearer srv_robo');
  assert.equal(pedidos[0].init.headers['x-upsert'], 'true');
  assert.equal(url, 'https://central.rbvcompany.com/storage/v1/object/public/fabrica-criativos/camp/produto/LV1-heroi-1080x1920.png');
});

test('o mesmo caminho 2x dá a mesma URL (repetir o job não duplica)', async () => {
  const f = async () => ({ ok: true, status: 200 });
  assert.equal(await subirStorageResiliente(base({ fetchImpl: f })), await subirStorageResiliente(base({ fetchImpl: f })));
});

test('sem CENTRAL_API_URL/TOKEN: falha alto, sem nenhuma requisição', async () => {
  let n = 0;
  for (const falta of [{ url: '' }, { token: '' }]) {
    await assert.rejects(subirStorageResiliente(base({ ...falta, fetchImpl: async () => { n++; } })), /CENTRAL_API_URL \+ CENTRAL_API_TOKEN/);
  }
  assert.equal(n, 0);
});

test('400 transitório: retenta e sucede (o bug real — nginx 400 no meio do lote)', async () => {
  let n = 0; let retries = 0;
  const url = await subirStorageResiliente(base({
    fetchImpl: async () => {
      n++;
      if (n < 3) return { ok: false, status: 400, text: async () => '<html>400 Bad Request</html>' };
      return { ok: true, status: 200 };
    },
    onRetry: () => { retries++; },
  }));
  assert.equal(n, 3);        // falhou 2x, subiu na 3ª
  assert.equal(retries, 2);  // onRetry chamado a cada falha antes do sucesso
  assert.ok(url.endsWith('.png'));
});

test('erro de rede (fetch lança): também é retentado', async () => {
  let n = 0;
  const url = await subirStorageResiliente(base({
    fetchImpl: async () => { n++; if (n < 2) throw new Error('ECONNRESET'); return { ok: true, status: 200 }; },
  }));
  assert.equal(n, 2);
  assert.ok(url.endsWith('.png'));
});

test('falha persistente: esgota tentativas e lança o último erro', async () => {
  let n = 0;
  await assert.rejects(
    subirStorageResiliente(base({
      tentativas: 3,
      fetchImpl: async () => { n++; return { ok: false, status: 502, text: async () => 'nope' }; },
    })),
    /upload .* 502 nope/,
  );
  assert.equal(n, 3); // tentou exatamente `tentativas` vezes
});

test('401/403/413/415 são definitivos: 1 tentativa só (repetir não muda a permissão)', async () => {
  for (const status of [401, 403, 413, 415]) {
    let n = 0;
    await assert.rejects(
      subirStorageResiliente(base({ fetchImpl: async () => { n++; return { ok: false, status, text: async () => 'sem_permissao' }; } })),
      new RegExp(`upload .* ${status} sem_permissao`),
    );
    assert.equal(n, 1, `HTTP ${status}`);
  }
});
