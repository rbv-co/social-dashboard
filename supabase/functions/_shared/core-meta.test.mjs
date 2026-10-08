import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  metaLigada, metaDoCore, traduzirUrl, comoGraph, emOndas, chamarGraphNoCore, CAMINHO_GRAPH,
} from './core-meta.js';

const ON = { CORE_META: 'true', CORE_URL: 'https://core.teste', CORE_API_TOKEN: 'segredo-do-core' };

// fetch falso: guarda o que saiu e responde com `resposta(chamada, n)` -> { status, corpo, headers }.
function falso(resposta) {
  const chamadas = [];
  const fetchImpl = async (url, init) => {
    chamadas.push({ url: String(url), init, corpo: init?.body ? JSON.parse(init.body) : null });
    const { status = 200, corpo = {}, headers = {} } = resposta(chamadas.at(-1), chamadas.length);
    return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status, headers });
  };
  return { fetchImpl, chamadas };
}

test('flag: só true/1 liga; ausente ou outra coisa = desligada', () => {
  assert.equal(metaLigada({ CORE_META: 'true' }), true);
  assert.equal(metaLigada({ CORE_META: ' 1 ' }), true);
  for (const v of [undefined, '', 'false', '0', 'sim']) assert.equal(metaLigada({ CORE_META: v }), false);
  assert.equal(metaLigada(undefined), false);
});

test('desligada: o fetch é o de sempre e o token/colunas ficam como estão', async () => {
  const { fetchImpl, chamadas } = falso(() => ({ corpo: { ok: 1 } }));
  const m = metaDoCore({}, { fetchImpl });
  assert.equal(m.ligada, false);
  const url = 'https://graph.facebook.com/v21.0/123/insights?access_token=TOKEN-REAL&metric=reach';
  const r = await m.fetch(url, { method: 'GET' });
  assert.deepEqual(await r.json(), { ok: 1 });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, url, 'URL intocada, com o token da conta');
  assert.equal(m.token({ access_token: 'abc' }), 'abc');
  assert.equal(m.colunas('id,name,access_token'), 'id,name,access_token');
  assert.throws(() => m.chamar({}), /desligada/);
});

test('traduzirUrl: tira versao e access_token; fora da Graph = null', () => {
  assert.deepEqual(
    traduzirUrl('https://graph.facebook.com/v21.0/act_9/insights?fields=spend&access_token=***&time_range=%7B%22since%22%3A%221%22%7D'),
    { caminho: '/act_9/insights', parametros: { fields: 'spend', time_range: '{"since":"1"}' } },
  );
  assert.equal(traduzirUrl('https://scontent.fbcdn.net/x.jpg'), null);
  assert.equal(traduzirUrl('http://graph.facebook.com/v21.0/me'), null);
  assert.equal(traduzirUrl('nao e url'), null);
});

test('ligada: GET da Graph vira POST no proxy, sem access_token, Bearer do core, resposta tal qual', async () => {
  const graph = { data: [{ spend: '10.5' }], paging: { next: 'https://graph.facebook.com/v22.0/act_9/insights?after=Q&access_token=***' } };
  const { fetchImpl, chamadas } = falso(() => ({ corpo: graph }));
  const m = metaDoCore(ON, { fetchImpl });
  const r = await m.fetch('https://graph.facebook.com/v21.0/act_9/insights?fields=spend&access_token=TOKEN-DA-CONTA', { headers: { Authorization: 'Bearer OUTRO' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), graph);
  const [c] = chamadas;
  assert.equal(c.url, `https://core.teste${CAMINHO_GRAPH}`);
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers.Authorization, 'Bearer segredo-do-core');
  assert.deepEqual(c.corpo, { caminho: '/act_9/insights', metodo: 'GET', parametros: { fields: 'spend' } });
  assert.ok(!JSON.stringify(c).includes('TOKEN-DA-CONTA') && !JSON.stringify(c).includes('OUTRO'), 'nenhum token Meta sai daqui');
});

test('ligada: seguir paging.next (mascarado) funciona', async () => {
  const { fetchImpl, chamadas } = falso(() => ({ corpo: { data: [] } }));
  const m = metaDoCore(ON, { fetchImpl });
  await m.fetch('https://graph.facebook.com/v22.0/act_9/insights?after=Q&limit=500&access_token=***');
  assert.deepEqual(chamadas[0].corpo, { caminho: '/act_9/insights', metodo: 'GET', parametros: { after: 'Q', limit: '500' } });
});

test('ligada: POST com corpo form (string / URLSearchParams) vira parametros; FormData com arquivo e recusado', async () => {
  const { fetchImpl, chamadas } = falso(() => ({ corpo: { id: '77' } }));
  const m = metaDoCore(ON, { fetchImpl });
  await m.fetch('https://graph.facebook.com/v22.0/123/media', { method: 'POST', body: 'image_url=https%3A%2F%2Fx&access_token=T&caption=oi' });
  assert.deepEqual(chamadas[0].corpo, { caminho: '/123/media', metodo: 'POST', parametros: { image_url: 'https://x', caption: 'oi' } });
  await m.fetch('https://graph.facebook.com/v22.0/123/media_publish', { method: 'POST', body: new URLSearchParams({ creation_id: '9', access_token: 'T' }) });
  assert.deepEqual(chamadas[1].corpo.parametros, { creation_id: '9' });
  const fd = new FormData(); fd.set('img0', new Blob(['x']), 'a.png');
  await assert.rejects(m.fetch('https://graph.facebook.com/v22.0/act_1/adimages', { method: 'POST', body: fd }), /upload de arquivo/);
});

test('ligada: URL fora da Graph passa direto, sem passar pelo core', async () => {
  const { fetchImpl, chamadas } = falso(() => ({ corpo: 'bytes' }));
  const m = metaDoCore(ON, { fetchImpl });
  await m.fetch('https://scontent.fbcdn.net/v/foto.jpg');
  assert.equal(chamadas[0].url, 'https://scontent.fbcdn.net/v/foto.jpg');
});

test('ligada: erro do core vira o formato de erro da Graph; erro da Graph passa igual', async () => {
  assert.deepEqual(comoGraph(400, { erro: 'caminho ou metodo nao permitido' }),
    { error: { message: 'core: caminho ou metodo nao permitido', type: 'CoreProxy', code: 400 } });
  assert.equal(comoGraph(401, { message: 'Unauthenticated.' }).error.message, 'core: Unauthenticated.');
  assert.equal(comoGraph(502, { raw: '<html>bad gateway</html>' }).error.code, 502);
  const daGraph = { error: { message: 'Invalid parameter', code: 100 } };
  assert.equal(comoGraph(400, daGraph), daGraph);
  assert.deepEqual(comoGraph(200, { data: [] }), { data: [] });

  const { fetchImpl } = falso(() => ({ status: 400, corpo: { erro: 'conta sem token' } }));
  const r = await metaDoCore(ON, { fetchImpl }).fetch('https://graph.facebook.com/v22.0/me');
  assert.equal(r.status, 400);
  assert.equal(r.ok, false);
  assert.match((await r.json()).error.message, /conta sem token/);
});

test('ligada: 429 de recuo espera o Retry-After e tenta de novo; esgotando devolve o 429', async () => {
  const esperas = [];
  const esperar = async (ms) => { esperas.push(ms); };
  let { fetchImpl, chamadas } = falso((c, n) => (n < 3 ? { status: 429, corpo: { erro: 'meta_em_recuo' }, headers: { 'Retry-After': '7' } } : { corpo: { ok: true } }));
  let r = await metaDoCore(ON, { fetchImpl, esperar }).fetch('https://graph.facebook.com/v22.0/me');
  assert.equal(r.status, 200);
  assert.equal(chamadas.length, 3);
  assert.deepEqual(esperas, [7000, 7000]);

  ({ fetchImpl, chamadas } = falso(() => ({ status: 429, corpo: { erro: 'meta_em_recuo' }, headers: { 'Retry-After': '99' } })));
  esperas.length = 0;
  r = await metaDoCore(ON, { fetchImpl, esperar }).fetch('https://graph.facebook.com/v22.0/me');
  assert.equal(r.status, 429);
  assert.equal(chamadas.length, 3);
  assert.deepEqual(esperas, [30000, 30000], 'espera limitada a 30 s');

  // `tentativas: 1` (o meta-proxy): sem retry, devolve o recuo na hora
  ({ fetchImpl, chamadas } = falso(() => ({ status: 429, corpo: { erro: 'meta_em_recuo' }, headers: { 'Retry-After': '4' } })));
  const out = await chamarGraphNoCore({ token: 't', fetchImpl, esperar })({ caminho: '/me' }, { tentativas: 1 });
  assert.equal(chamadas.length, 1);
  assert.deepEqual([out.status, out.json.erro, out.retryAfter], [429, 'meta_em_recuo', 4]);
});

test('ligada: sem CORE_API_TOKEN lanca (e a mensagem nao tem token)', async () => {
  const m = metaDoCore({ CORE_META: 'true' }, { fetchImpl: async () => new Response('{}') });
  await assert.rejects(m.fetch('https://graph.facebook.com/v22.0/me'), /CORE_API_TOKEN ausente/);
});

test('ligada: token() devolve marcador, colunas() tira access_token', () => {
  const m = metaDoCore(ON, { fetchImpl: async () => new Response('{}') });
  assert.equal(m.token({ access_token: 'REAL' }), 'core');
  assert.equal(m.token({}), 'core');
  assert.equal(m.colunas('id, name ,access_token,ad_account_id'), 'id,name,ad_account_id');
  assert.equal(m.colunas('instagram_id,access_token'), 'instagram_id');
});

test('emOndas: respeita a ordem e o tamanho da onda', async () => {
  let ativos = 0, pico = 0;
  const out = await emOndas([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
    ativos++; pico = Math.max(pico, ativos);
    await new Promise((r) => setTimeout(r, 5));
    ativos--; return x * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.equal(pico, 3);
});

// ── GUARDA: nenhum ponto migrado lê accounts.access_token sem passar por META.colunas ──────────────
// Com CORE_META ligada o token Meta nao pode ser lido. Um `select(...access_token...)` solto reabre isso.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRADOS = [
  'supabase/functions/meta-proxy/index.ts', 'supabase/functions/coletar-dados/index.ts',
  'supabase/functions/coletar-dados-hora/index.ts', 'supabase/functions/auditar-dados/index.ts',
  'supabase/functions/insights-ao-vivo/index.ts', 'supabase/functions/serie-novos-dia/index.ts',
  'supabase/functions/enviar-push-saldo/index.ts', 'supabase/functions/contar-collabs/index.ts',
  'supabase/functions/conteudo-espelho/index.ts', 'supabase/functions/conteudo-hora-h/index.ts',
  'coletor/ig-coletor.mjs', 'coletor/budget-ia.mjs', 'coletor/vigia-problemas-meta.mjs',
  'coletor/preencher-numeros-de-campanha.mjs', 'coletor/recuperar-curtidas-zeradas.mjs',
  'coletor/backfill-visitas-perfil-dia.mjs', 'coletor/gerar-opr-diario.mjs',
];

test('guarda: pontos migrados so selecionam access_token por META.colunas()', () => {
  for (const arq of MIGRADOS) {
    const src = readFileSync(join(RAIZ, arq), 'utf8');
    assert.match(src, /core-meta/, `${arq} deveria usar o helper`);
    let linhas = src.split('\n');
    if (arq.endsWith('meta-proxy/index.ts')) {
      // o select antigo so existe DEPOIS do retorno antecipado da flag ligada
      const corte = linhas.findIndex((l) => /if \(META\.ligada\) return await viaCore/.test(l));
      assert.ok(corte > 0, 'meta-proxy precisa desviar para o core antes de ler a conta');
      linhas = linhas.slice(0, corte);
    }
    linhas.forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      if (/(select\(|select=)/.test(l) && /access_token/.test(l)) {
        assert.match(l, /META\.(colunas|ligada)/, `${arq}:${i + 1} le access_token sem META.colunas: ${l.trim()}`);
      }
    });
  }
});

test('guarda: nenhum arquivo de edge/coletor fora do helper chama graph.facebook.com com fetch cru nos pontos migrados', () => {
  for (const arq of MIGRADOS) {
    const src = readFileSync(join(RAIZ, arq), 'utf8');
    if (arq.endsWith('meta-proxy/index.ts')) continue; // tem o caminho antigo de proposito (flag desligada)
    for (const [i, l] of src.split('\n').entries()) {
      if (/^\s*\/\//.test(l)) continue;
      assert.ok(!/[^.\w]fetch\((url|u|proxima|next|urlMeta)\b/.test(l) || /fbcdn|urlMeta/.test(l) || /\.fetch\(/.test(l),
        `${arq}:${i + 1} fetch cru de URL da Graph: ${l.trim()}`);
    }
  }
});
