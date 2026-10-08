// Graph API da Meta (ads / insights / Instagram) pelo proxy do `core`:
// POST /api/interno/meta/graph  { conta?, caminho, metodo, parametros, imagem_url?, imagem_campo?, video_url? }
//
// POR QUE EXISTE: o `core` guarda UM token global da Meta (system user, sem expiração, cobre as
// contas de anúncio e os perfis IG). Com `CORE_META=true` NENHUM ponto da central lê
// `accounts.access_token` da Meta nem renova token Meta por conta própria: todos passam por aqui.
// Ausente ou qualquer outra coisa = DESLIGADO e o caminho antigo (Graph direto, token por conta) segue idêntico.
//
// Config: `CORE_API_TOKEN` (Bearer deste consumidor), `CORE_URL` (padrão https://core.rbvcompany.com).
// Módulo puro (sem Deno/Node): roda na edge e no coletor; `fetchImpl` e `esperar` injetáveis.
//
// DOIS NÍVEIS:
//  - `chamarGraph(corpo)`: o contrato cru do proxy; devolve `{ status, json, retryAfter }`. Quem precisa
//    distinguir erro do core (`erro`) de erro da Graph (`error`) — o `meta-proxy` — usa este.
//  - `metaDoCore(env).fetch(url, init)`: DROP-IN do `fetch` para URLs da Graph. Desligada é o `fetch` de
//    sempre. Ligada traduz a URL (caminho + query, sem `access_token`) para o proxy e devolve um `Response`
//    com o JSON da Graph tal qual; erro do core vira o formato de erro da Graph (`{ error: { message } }`),
//    que é o que os chamadores já tratam. `paging.next` vem mascarado (`access_token=***`): como o `fetch`
//    descarta o `access_token`, seguir a URL do `next` continua funcionando.
import { CORE_URL_PADRAO } from './core-leitura.js';

export const CAMINHO_GRAPH = '/api/interno/meta/graph';
const HOST_GRAPH = 'graph.facebook.com';
export const TENTATIVAS_RECUO = 3;       // 429 do core (recuo por uso alto): espera Retry-After e tenta de novo
export const ESPERA_MAX_S = 30;          // nunca esperar mais que isto por tentativa

/** `CORE_META` ligada? `env` é um objeto (process.env / Deno.env.toObject()). */
export function metaLigada(env) {
  const v = String(env?.CORE_META ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

const esperarPadrao = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chamador do proxy. Lança sem `CORE_API_TOKEN`; o token nunca vai em mensagem de erro. */
export function chamarGraphNoCore({ url, token, fetchImpl = globalThis.fetch, esperar = esperarPadrao } = {}) {
  if (!token) throw new Error('CORE_API_TOKEN ausente');
  const base = String(url || CORE_URL_PADRAO).replace(/\/+$/, '');
  return async function chamarGraph(corpo, { signal, tentativas = TENTATIVAS_RECUO } = {}) {
    for (let t = 1; ; t++) {
      const r = await fetchImpl(`${base}${CAMINHO_GRAPH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(corpo),
        ...(signal ? { signal } : {}),
      });
      const texto = await r.text();
      let json; try { json = JSON.parse(texto); } catch { json = { raw: texto }; }
      const retryAfter = Number(r.headers?.get?.('Retry-After')) || 0;
      if (r.status === 429 && t < tentativas) { await esperar(Math.min(retryAfter || 5, ESPERA_MAX_S) * 1000); continue; }
      return { status: r.status, json, retryAfter };
    }
  };
}

/** `https://graph.facebook.com/v21.0/<caminho>?a=b` -> `{ caminho: '/<caminho>', parametros }` (sem `access_token`); null se não for a Graph. */
export function traduzirUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== HOST_GRAPH) return null;
  const parametros = {};
  for (const [k, v] of u.searchParams) if (k !== 'access_token') parametros[k] = v;
  return { caminho: u.pathname.replace(/^\/v\d+\.\d+(?=\/)/, '') || '/', parametros };
}

/** Parâmetros que vão no corpo (POST form): URLSearchParams, string `a=b&c=d` ou FormData só de texto. */
function parametrosDoCorpo(body) {
  if (body == null) return {};
  let pares;
  if (body instanceof URLSearchParams) pares = body;
  else if (typeof body === 'string') pares = new URLSearchParams(body);
  else if (typeof FormData !== 'undefined' && body instanceof FormData) {
    pares = [...body.entries()];
    if (pares.some(([, v]) => typeof v !== 'string')) throw new Error('core meta: upload de arquivo nao passa pelo proxy (use imagem_url/video_url)');
  } else throw new Error('core meta: corpo de requisicao nao suportado');
  const o = {};
  for (const [k, v] of pares) if (k !== 'access_token') o[k] = v;
  return o;
}

/** Erro do core (`erro`/`message`) ou corpo sem JSON -> formato de erro da Graph, que os chamadores já tratam. */
export function comoGraph(status, json) {
  if (status < 400 || (json && typeof json.error === 'object')) return json;
  const msg = json?.erro || json?.message || json?.raw?.slice?.(0, 200) || `HTTP ${status}`;
  return { error: { message: `core: ${msg}`, type: 'CoreProxy', code: status } };
}

/** `fn` sobre `itens` em ondas de `n` em paralelo, na ordem (o core recua por uso alto: não despejar 50 de uma vez). */
export async function emOndas(itens, n, fn) {
  const out = [];
  for (let i = 0; i < itens.length; i += n) out.push(...await Promise.all(itens.slice(i, i + n).map(fn)));
  return out;
}

/**
 * Cliente da Meta para um ponto da central: `{ ligada, fetch, chamar, token(acc), colunas(select) }`.
 *  - `fetch(url, init)`: drop-in (ver topo). Desligada: o `fetch` de sempre, intocado.
 *  - `token(acc)`: desligada devolve `acc.access_token`; ligada devolve um marcador (`'core'`, que o `fetch`
 *    descarta) — o token Meta nunca é lido.
 *  - `colunas('id,access_token')`: ligada tira `access_token` do select (não lê a coluna).
 *  - `chamar(corpo)`: proxy cru (só ligada).
 */
export function metaDoCore(env, { fetchImpl, esperar } = {}) {
  const f = (...a) => (fetchImpl || globalThis.fetch)(...a);
  if (!metaLigada(env)) {
    return { ligada: false, fetch: f, token: (acc) => acc?.access_token, colunas: (s) => s,
      chamar() { throw new Error('CORE_META desligada'); } };
  }
  let chamarGraph;
  const chamar = (corpo, o) => {
    chamarGraph ??= chamarGraphNoCore({ url: env?.CORE_URL, token: env?.CORE_API_TOKEN, fetchImpl, esperar });
    return chamarGraph(corpo, o);
  };
  return {
    ligada: true,
    chamar,
    token: () => 'core',
    colunas: (s) => String(s).split(',').map((c) => c.trim()).filter((c) => c && c !== 'access_token').join(','),
    async fetch(url, init = {}) {
      const t = traduzirUrl(url instanceof Request ? url.url : url);
      if (!t) return f(url, init);                                  // fora da Graph (CDN, webhook...): intocado
      const metodo = String(init.method || 'GET').toUpperCase();
      const parametros = { ...t.parametros, ...parametrosDoCorpo(init.body) };
      const { status, json } = await chamar({ caminho: t.caminho, metodo, parametros }, { signal: init.signal });
      return new Response(JSON.stringify(comoGraph(status, json)), { status, headers: { 'Content-Type': 'application/json' } });
    },
  };
}
