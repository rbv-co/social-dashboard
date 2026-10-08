import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blingDoColetor } from './bling-token.mjs';

const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
const CENTRAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function falso() {
  const chamadas = [];
  const fetchImpl = async (url, init) => {
    chamadas.push(String(url));
    return String(url).includes('/api/interno/bling/token') ? resp({ access_token: 'DO-CORE' }) : resp({ data: [] });
  };
  return { fetchImpl, chamadas };
}
const ENV = { CORE_BLING_TOKEN: 'true', CORE_API_TOKEN: 'seg' };

// Ponto do tipo REFRESH (trazer-vendedores, classificar-material-dos-lotes): o `senao` e
// "ler bling_tokens e, vencido, POST oauth/token + gravar". Ligada, ele nunca roda.
test('tipo refresh: ligada nao renova nem toca o banco; desligada roda o caminho antigo', async () => {
  const { fetchImpl, chamadas } = falso();
  let renovacoes = 0;
  const senao = async () => { renovacoes++; return 'RENOVADO'; };
  assert.equal(await blingDoColetor(ENV, { fetchImpl }).token(senao), 'DO-CORE');
  assert.equal(renovacoes, 0);
  assert.ok(!chamadas.some((u) => u.includes('oauth/token')));
  assert.equal(await blingDoColetor({}, { fetchImpl }).token(senao), 'RENOVADO');
  assert.equal(renovacoes, 1);
});

// Ponto do tipo LEITURA (trazer-pedidos, fotos-do-selo, classificar-material-vessel): o
// cabecalho sai do banco, mas ligada o fetch o troca pelo do core e repete uma vez em 401.
test('tipo leitura: cabecalho do banco e trocado pelo do core; 401 relê e repete uma vez', async () => {
  let bling = 0;
  const chamadas = [];
  const fetchImpl = async (url, init) => {
    chamadas.push({ url: String(url), auth: init?.headers?.Authorization });
    if (String(url).includes('/api/interno/bling/token')) return resp({ access_token: `T${chamadas.length}` });
    return ++bling === 1 ? resp({}, 401) : resp({ data: [{ id: 1 }] });
  };
  const b = blingDoColetor(ENV, { fetchImpl });
  const r = await b.fetch('https://api.bling.com.br/Api/v3/produtos/1', { headers: { Authorization: 'Bearer do-banco' } });
  assert.equal(r.status, 200);
  const doBling = chamadas.filter((c) => c.url.includes('api.bling.com.br'));
  assert.equal(doBling.length, 2);
  assert.ok(doBling.every((c) => c.auth.startsWith('Bearer T')), 'nenhum Authorization do banco vazou');
});

test('desligada: fetch do coletor e o fetch global de sempre', async () => {
  const { fetchImpl, chamadas } = falso();
  const b = blingDoColetor({}, { fetchImpl });
  await b.fetch('https://api.bling.com.br/Api/v3/x', { headers: { Authorization: 'Bearer banco' } });
  assert.deepEqual(chamadas, ['https://api.bling.com.br/Api/v3/x']);
});

// Trava de regressao: todo ponto que fala com o Bling passa pelo helper. Se alguem
// adicionar um `fetch` cru ao Bling (ou um POST em oauth/token fora do `senao`), cai aqui.
const PONTOS = [
  'coletor/trazer-vendedores-do-bling.mjs',
  'coletor/classificar-material-dos-lotes.mjs',
  'coletor/classificar-material-vessel.mjs',
  'coletor/trazer-pedidos-do-bling.mjs',
  'coletor/fotos-do-selo-do-bling.mjs',
  'supabase/functions/bling-proxy/index.ts',
  'supabase/functions/vessel-registrar-garantia/index.ts',
  'supabase/functions/vessel-espelhar-lista/index.ts',
  'supabase/functions/estoque-do-site/index.ts',
  'supabase/functions/enviar-push-vendas/index.ts',
];
for (const p of PONTOS) {
  test(`ponto ${p}: usa CORE_BLING e nenhum fetch cru ao Bling fora do oauth/token`, () => {
    const src = readFileSync(join(CENTRAL, p), 'utf8');
    assert.match(src, /CORE_BLING\.token\(/);
    const linhas = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const crus = linhas.filter((l) => /(?<![.\w])fetch\(/.test(l) && /BLING|api\.bling/.test(l) && !/oauth\/token/.test(l));
    assert.deepEqual(crus, []);
  });
}
