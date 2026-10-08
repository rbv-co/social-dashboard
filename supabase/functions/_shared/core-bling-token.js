// Token do Bling lido do `core` (GET /api/interno/bling/token → { access_token, expira_em }).
//
// POR QUE EXISTE: o `core` é o DONO ÚNICO do OAuth do Bling. Renovar token aqui
// (bling_tokens + refresh_token) compete com ele e queima o refresh. Com
// `CORE_BLING_TOKEN=true` NENHUM ponto da central renova: todos só leem do core.
// Ausente ou qualquer outra coisa = DESLIGADO e o caminho antigo segue idêntico.
//
// Config: `CORE_API_TOKEN` (Bearer deste consumidor), `CORE_URL` (padrão
// https://core.rbvcompany.com). O core nunca devolve refresh_token.
// Módulo puro (sem Deno/Node): roda na edge e no coletor; `fetchImpl` é injetável.

import { criarClienteCore } from './core-leitura.js';

export const CAMINHO_TOKEN = '/api/interno/bling/token';
export const TTL_MAX_MS = 4 * 60e3; // cache curto: o core renova antes de vencer

/** `CORE_BLING_TOKEN` ligada? `env` é um objeto (process.env / Deno.env.toObject()). */
export function ligada(env) {
  const v = String(env?.CORE_BLING_TOKEN ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** Leitor com cache ≤ 4 min (e nunca além do `expira_em`). `invalidar()` força reler. */
export function criarLeitor({ url, token, fetchImpl = globalThis.fetch, agora = Date.now, ttlMs = TTL_MAX_MS, esperar } = {}) {
  const core = criarClienteCore({ url, token, fetchImpl, ...(esperar ? { esperar } : {}) });
  let cache = null; // { valor, ate }
  let voando = null;

  async function ler() {
    const j = await core.get(CAMINHO_TOKEN);
    if (!j?.access_token) throw new Error('core: resposta sem access_token');
    const exp = Date.parse(j.expira_em || '');
    const ate = Math.min(agora() + ttlMs, Number.isFinite(exp) ? exp - 30e3 : Infinity);
    cache = { valor: j.access_token, ate };
    return j.access_token;
  }

  return {
    async token() {
      if (cache && agora() < cache.ate) return cache.valor;
      voando ??= ler().finally(() => { voando = null; });
      return voando;
    },
    invalidar() { cache = null; },
  };
}

export const leitorDoAmbiente = (env, extra = {}) =>
  criarLeitor({ url: env?.CORE_URL, token: env?.CORE_API_TOKEN, ...extra });

/**
 * O que cada ponto usa: `{ ligada, fetch, token }` com UM leitor (um cache) só.
 *  - `fetch`: desligada é o `fetch` de sempre, intocado. Ligada: troca o
 *    `Authorization` pelo token do core e, em 401, relê do core e tenta UMA
 *    vez de novo. Nunca renova nada.
 *  - `token(senao)`: ligada devolve o do core; desligada devolve `senao()` (o
 *    caminho antigo, com a renovação dele). Ligada sem `CORE_API_TOKEN` lança.
 */
export function blingDoCore(env, { leitor, fetchImpl } = {}) {
  const f = (...a) => (fetchImpl || globalThis.fetch)(...a);
  if (!ligada(env)) return { ligada: false, fetch: f, token: (senao) => senao() };
  const l = leitor || leitorDoAmbiente(env, fetchImpl ? { fetchImpl } : {});
  const tentar = async (url, init) => f(url, {
    ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${await l.token()}` },
  });
  return {
    ligada: true,
    token: () => l.token(),
    async fetch(url, init = {}) {
      const r = await tentar(url, init);
      if (r.status !== 401) return r;
      l.invalidar();
      return tentar(url, init);
    },
  };
}
