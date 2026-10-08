import test from 'node:test';
import assert from 'node:assert/strict';
import { ligada, criarLeitor, blingDoCore, CAMINHO_TOKEN } from './core-bling-token.js';

const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
const MIN = 60e3;

/** fetch falso: `rotas(url, init)` → resposta. Guarda as chamadas. */
function falso(rotas) {
  const chamadas = [];
  const fetchImpl = async (url, init) => { chamadas.push({ url: String(url), init }); return rotas(String(url), init, chamadas); };
  return { fetchImpl, chamadas };
}
const doCore = (chamadas) => chamadas.filter((c) => c.url.includes(CAMINHO_TOKEN));

test('ligada: so "true"/"1" ligam; ausente, vazio ou outra coisa desliga', () => {
  assert.equal(ligada({}), false);
  assert.equal(ligada(undefined), false);
  assert.equal(ligada({ CORE_BLING_TOKEN: 'false' }), false);
  assert.equal(ligada({ CORE_BLING_TOKEN: '' }), false);
  assert.equal(ligada({ CORE_BLING_TOKEN: 'sim' }), false);
  assert.equal(ligada({ CORE_BLING_TOKEN: 'true' }), true);
  assert.equal(ligada({ CORE_BLING_TOKEN: ' TRUE ' }), true);
  assert.equal(ligada({ CORE_BLING_TOKEN: '1' }), true);
});

test('leitor: Bearer do consumidor, URL padrao, CORE_URL sem barra final, cache de 4 min', async () => {
  let agora = 1_000_000;
  const { fetchImpl, chamadas } = falso(() => resp({ access_token: 'T1', expira_em: new Date(agora + 60 * MIN).toISOString() }));
  const l = criarLeitor({ token: 'segredo', fetchImpl, agora: () => agora });
  assert.equal(await l.token(), 'T1');
  assert.equal(await l.token(), 'T1');
  assert.equal(chamadas.length, 1, 'segunda leitura vem do cache');
  assert.equal(chamadas[0].url, `https://core.rbvcompany.com${CAMINHO_TOKEN}`);
  assert.equal(chamadas[0].init.headers.Authorization, 'Bearer segredo');
  agora += 3 * MIN;
  await l.token();
  assert.equal(chamadas.length, 1, 'aos 3 min ainda e cache');
  agora += 2 * MIN;
  await l.token();
  assert.equal(chamadas.length, 2, 'aos 5 min releu: o cache nunca passa de 4 min');

  const b = falso(() => resp({ access_token: 'x' }));
  await criarLeitor({ url: 'https://core.teste/', token: 't', fetchImpl: b.fetchImpl }).token();
  assert.ok(b.chamadas[0].url.startsWith('https://core.teste/api/interno/bling/token'));
});

test('leitor: nunca guarda alem do expira_em; sem CORE_API_TOKEN lanca; resposta sem token lanca', async () => {
  let agora = 0;
  const { fetchImpl, chamadas } = falso(() => resp({ access_token: 'T', expira_em: new Date(agora + 60e3).toISOString() }));
  const l = criarLeitor({ token: 't', fetchImpl, agora: () => agora });
  await l.token();
  agora += 40e3; // faltam 20s: dentro da folga de 30s, nao vale cache
  await l.token();
  assert.equal(chamadas.length, 2);
  assert.throws(() => criarLeitor({ fetchImpl }), /CORE_API_TOKEN/);
  const vazio = criarLeitor({ token: 't', fetchImpl: falso(() => resp({})).fetchImpl });
  await assert.rejects(vazio.token(), /sem access_token/);
});

test('leitor: leituras simultaneas viram UMA chamada ao core; erro do core lanca sem vazar o segredo', async () => {
  const { fetchImpl, chamadas } = falso(() => resp({ access_token: 'T' }));
  const l = criarLeitor({ token: 'segredo', fetchImpl });
  assert.deepEqual(await Promise.all([l.token(), l.token(), l.token()]), ['T', 'T', 'T']);
  assert.equal(chamadas.length, 1);
  const ruim = criarLeitor({ token: 'segredo', fetchImpl: falso(() => resp({}, 403)).fetchImpl });
  await assert.rejects(ruim.token(), (e) => /403/.test(e.message) && !/segredo/.test(e.message));
});

test('desligada: fetch e o de sempre (mesmos argumentos, zero chamada ao core) e token(senao) roda o caminho antigo', async () => {
  const { fetchImpl, chamadas } = falso(() => resp({ ok: 1 }));
  const b = blingDoCore({}, { fetchImpl });
  assert.equal(b.ligada, false);
  const init = { headers: { Authorization: 'Bearer do-banco' } };
  await b.fetch('https://api.bling.com.br/Api/v3/produtos', init);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].init, init);
  assert.equal(await b.token(async () => 'do-banco'), 'do-banco');
  assert.equal(doCore(chamadas).length, 0);
});

test('ligada: troca o Authorization pelo token do core e NUNCA chama senao() (a renovacao antiga)', async () => {
  const { fetchImpl, chamadas } = falso((url) => (url.includes(CAMINHO_TOKEN) ? resp({ access_token: 'DO-CORE' }) : resp({ data: [] })));
  const b = blingDoCore({ CORE_BLING_TOKEN: 'true', CORE_API_TOKEN: 'seg' }, { fetchImpl });
  let renovou = false;
  assert.equal(await b.token(async () => { renovou = true; return 'x'; }), 'DO-CORE');
  assert.equal(renovou, false);
  await b.fetch('https://api.bling.com.br/Api/v3/pedidos/vendas', { headers: { Authorization: 'Bearer velho', Accept: 'application/json' } });
  const bling = chamadas.find((c) => c.url.includes('api.bling.com.br'));
  assert.equal(bling.init.headers.Authorization, 'Bearer DO-CORE');
  assert.equal(bling.init.headers.Accept, 'application/json', 'os outros cabecalhos ficam');
  assert.equal(doCore(chamadas).length, 1, 'token do core lido uma vez so (cache)');
  assert.ok(!chamadas.some((c) => c.url.includes('oauth/token')));
});

test('ligada: 401 do Bling -> relê do core e tenta UMA vez; segundo 401 e devolvido sem terceira tentativa', async () => {
  let n = 0;
  const { fetchImpl, chamadas } = falso((url) => {
    if (url.includes(CAMINHO_TOKEN)) return resp({ access_token: `T${++n}` });
    return resp({}, 401);
  });
  const b = blingDoCore({ CORE_BLING_TOKEN: '1', CORE_API_TOKEN: 's' }, { fetchImpl });
  const r = await b.fetch('https://api.bling.com.br/Api/v3/produtos');
  assert.equal(r.status, 401);
  const bling = chamadas.filter((c) => c.url.includes('api.bling.com.br'));
  assert.equal(bling.length, 2, 'uma tentativa + um retry');
  assert.deepEqual(bling.map((c) => c.init.headers.Authorization), ['Bearer T1', 'Bearer T2']);
  assert.equal(doCore(chamadas).length, 2);
});

test('ligada: 401 e depois 200 -> devolve o 200; qualquer outro status nao tenta de novo', async () => {
  let bling = 0;
  const { fetchImpl } = falso((url) => {
    if (url.includes(CAMINHO_TOKEN)) return resp({ access_token: 'T' });
    return ++bling === 1 ? resp({}, 401) : resp({ ok: true });
  });
  const b = blingDoCore({ CORE_BLING_TOKEN: 'true', CORE_API_TOKEN: 's' }, { fetchImpl });
  assert.equal((await b.fetch('https://api.bling.com.br/x')).status, 200);
  const c = falso((url) => (url.includes(CAMINHO_TOKEN) ? resp({ access_token: 'T' }) : resp({}, 429)));
  const b2 = blingDoCore({ CORE_BLING_TOKEN: 'true', CORE_API_TOKEN: 's' }, { fetchImpl: c.fetchImpl });
  assert.equal((await b2.fetch('https://api.bling.com.br/x')).status, 429);
  assert.equal(c.chamadas.filter((x) => x.url.includes('api.bling.com.br')).length, 1);
});

test('ligada sem CORE_API_TOKEN lanca ja na criacao (falha alto, nao cai no refresh antigo)', () => {
  assert.throws(() => blingDoCore({ CORE_BLING_TOKEN: 'true' }), /CORE_API_TOKEN/);
});
