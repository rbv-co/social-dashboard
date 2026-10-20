import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blingDoColetor } from './bling-token.mjs';

const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo), headers: { get: () => null } });
const CENTRAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function falso() {
  const chamadas = [];
  const fetchImpl = async (url, init) => {
    chamadas.push({ url: String(url), corpo: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization });
    return resp({ data: [] });
  };
  return { fetchImpl, chamadas };
}
const ENV = { CORE_BLING_PROXY: 'true', CORE_API_TOKEN: 'seg', CORE_URL: 'https://core.teste' };

// Ligada: o token não existe no robô (placeholder) e o fetch vira POST no proxy do core, com o token do CORE, nunca o do banco.
test('ligada: token e placeholder e toda chamada passa pelo proxy do core', async () => {
  const { fetchImpl, chamadas } = falso();
  const b = blingDoColetor(ENV, { fetchImpl });
  assert.equal(await b.token(), 'via-core');
  const r = await b.fetch('https://api.bling.com.br/Api/v3/produtos/1?criterio=5', { headers: { Authorization: 'Bearer do-banco' } });
  assert.equal(r.status, 200);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'https://core.teste/api/interno/bling/proxy');
  assert.equal(chamadas[0].auth, 'Bearer seg', 'nenhum Authorization do banco vazou');
  assert.deepEqual(chamadas[0].corpo, { metodo: 'GET', caminho: '/produtos/1', query: { criterio: '5' }, prioridade: 'sync' });
});

// Sem CORE_BLING_PROXY (ou com so CORE_BLING_TOKEN) NAO ha caminho antigo: nada de bling_tokens, nada de fetch direto.
test('desligada: token() e fetch() lancam e nada sai pela rede', async () => {
  for (const env of [{}, { CORE_BLING_PROXY: 'false' }, { CORE_BLING_TOKEN: 'true', CORE_API_TOKEN: 'seg' }]) {
    const { fetchImpl, chamadas } = falso();
    const b = blingDoColetor(env, { fetchImpl });
    await assert.rejects(() => b.token(), /CORE_BLING_PROXY=true é obrigatório/);
    await assert.rejects(() => b.fetch('https://api.bling.com.br/Api/v3/x'), /CORE_BLING_PROXY=true é obrigatório/);
    assert.deepEqual(chamadas, []);
  }
});

// Os 5 robos do coletor nao tocam bling_tokens (nem leem, nem renovam): o token e do core.
for (const p of ['trazer-vendedores-do-bling', 'classificar-material-dos-lotes', 'classificar-material-vessel', 'trazer-pedidos-do-bling', 'fotos-do-selo-do-bling']) {
  test(`coletor/${p}.mjs nao le bling_tokens`, () => {
    const src = readFileSync(join(CENTRAL, 'coletor', `${p}.mjs`), 'utf8');
    const codigo = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(codigo, /bling_tokens|oauth\/token/);
  });
}

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
