// Escritas e leituras do Bling pelo PROXY do `core` (POST /api/interno/bling/proxy).
//
// POR QUE EXISTE: o `core` é o dono do token, do gate de cota e da idempotência
// do Bling. Com `CORE_BLING_PROXY=true` a edge deixa de chamar o Bling direto e
// manda `{metodo, caminho, query?, corpo?, prioridade?, idempotency_key?}` ao
// core, autenticada com `Authorization: Bearer <CORE_API_TOKEN>`.
// Ausente ou qualquer outra coisa = DESLIGADO: a chamada direta segue idêntica.
//
// Contrato do core (BlingProxyController):
//  - 2xx/4xx/429 do Bling voltam tal qual (corpo do Bling). Replay = header `Idempotent-Replay: true`.
//  - 409 {erro:'reautorizacao_necessaria'} = Bling pede nova autorização.
//  - 504 {erro:'resultado_incerto'} (escrita) = não se sabe se o Bling aplicou. NUNCA reenviar sozinho:
//    o core repete esse mesmo 504 para a mesma chave até alguém conciliar.
//  - 409 {erro:'em_andamento'} = outra chamada com a mesma chave está correndo; tentar na próxima rodada.
//  - 422 {erro:'chave_reutilizada'} = mesma chave com corpo diferente (por isso o hash do corpo na chave).
//
// IDEMPOTÊNCIA: a chave é ESTÁVEL — origem + operação + hash curto do corpo, nunca
// aleatória por tentativa. Repetir a mesma tentativa = mesma chave (o core não duplica);
// corpo corrigido = chave nova (o core repete um 4xx já gravado para a mesma chave).
//
// Nunca loga token nem telefone. Módulo puro (sem Deno/Node); `fetchImpl` é injetável.

import { blingDoCore } from './core-bling-token.js';

export const BLING_BASE = 'https://api.bling.com.br/Api/v3';
export const CAMINHO_PROXY = '/api/interno/bling/proxy';
export const CORE_URL_PADRAO = 'https://core.rbvcompany.com';
export const TIMEOUT_MS = 30e3;

/** `CORE_BLING_PROXY` ligada? `env` é um objeto (process.env / Deno.env.toObject()). */
export function ligada(env) {
  const v = String(env?.CORE_BLING_PROXY ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** Chave estável: `<origem>:<operacao>:<hash12 do corpo>`; só [A-Za-z0-9._:-], ≤ 120. */
export async function chaveIdempotente(origem, operacao, corpo) {
  const bytes = new TextEncoder().encode(JSON.stringify(corpo ?? null));
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  const o = String(origem).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120 - 12 - operacao.length - 2);
  return `${o}:${operacao}:${h}`;
}

function resposta(status, texto, extra = {}) {
  let json;
  return {
    status, ok: status >= 200 && status < 300, text: async () => texto,
    json: async () => (json ??= JSON.parse(texto)),
    replay: false, incerto: false, reautorizar: false, retryAfter: null, ...extra,
  };
}

/**
 * `chamar(metodo, caminho, { query, corpo, chave, prioridade, token })` devolve algo com
 * `status/ok/text()/json()` e os sinais `incerto`, `reautorizar`, `replay`.
 * Desligada: chama `direto(url, init)` (o `fetch` de sempre) em `base`+caminho, com `token`.
 * Escrita que não sabe se foi aplicada (504 do core, queda, timeout) volta `incerto: true`
 * e NÃO é reenviada aqui.
 */
export function blingViaCore(env, { fetchImpl = globalThis.fetch, direto, base, timeoutMs = TIMEOUT_MS } = {}) {
  const liga = ligada(env);

  async function chamar(metodo, caminho, { query, corpo, chave, prioridade, token, signal } = {}) {
    const escrita = metodo !== 'GET';
    if (!liga) {
      const qs = query ? `?${new URLSearchParams(query)}` : '';
      return direto(`${base}${caminho}${qs}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
                   ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
      });
    }
    const t = env?.CORE_API_TOKEN;
    if (!t) throw new Error('CORE_BLING_PROXY=true exige o secret CORE_API_TOKEN (e CORE_URL); nenhum token do Bling é lido ou renovado aqui');
    const url = `${String(env.CORE_URL || CORE_URL_PADRAO).replace(/\/+$/, '')}${CAMINHO_PROXY}`;
    let r;
    try {
      r = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          metodo, caminho,
          ...(query ? { query } : {}), ...(corpo !== undefined ? { corpo } : {}),
          ...(prioridade ? { prioridade } : {}), ...(chave ? { idempotency_key: chave } : {}),
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Queda/timeout: na escrita não dá para saber se o core chegou a mandar. Não reenvia.
      return resposta(escrita ? 504 : 0, '', { incerto: escrita });
    }
    const texto = await r.text();
    let erro;
    if (r.headers.get('X-Core-Origem') === 'proxy') {
      try { erro = JSON.parse(texto)?.erro; } catch { /* corpo ilegível: segue como status puro */ }
    }
    return resposta(r.status, texto, {
      replay: r.headers.get('Idempotent-Replay') === 'true',
      incerto: erro === 'resultado_incerto',
      reautorizar: erro === 'reautorizacao_necessaria',
      retryAfter: r.headers.get('Retry-After'),
    });
  }

  return { ligada: liga, chamar };
}

/**
 * Encaixe PRONTO para quem já fazia `fetch` direto no Bling com o token do core:
 * devolve `{ ligada, fetch(url, init), token(senao) }`, o mesmo formato de `blingDoCore`.
 *  - DESLIGADA (padrão): é o `blingDoCore` de sempre (token do core se CORE_BLING_TOKEN, senão o
 *    caminho antigo `senao()`), nada muda.
 *  - LIGADA: `fetch` recebe a URL do Bling (`BLING_BASE/...`) e a manda ao proxy do core
 *    (GET/escrita pelo método de `init`). Devolve algo com `status/ok/headers.get('retry-after')/text()/json()`.
 *    `token()` devolve 'via-core' (o core põe o token; `senao` NUNCA roda, então `bling_tokens` não é lido nem renovado).
 *    Falha de transporte de GET LANÇA (como o fetch); escrita incerta volta 504 com `incerto`.
 */
export function blingPeloCore(env, { fetchImpl, base = BLING_BASE, prioridade = 'sync', leitor } = {}) {
  if (!ligada(env)) return blingDoCore(env, { fetchImpl, leitor });
  const b = blingViaCore(env, { fetchImpl, base });
  return {
    ligada: true,
    token: async () => 'via-core', // placeholder: não é segredo; só faz o `if (!token)` das edges passar
    async fetch(url, init = {}) {
      const u = new URL(String(url));
      const caminho = u.pathname.replace(new URL(base).pathname, '') || '/';
      const query = {};
      for (const [k, v] of u.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;
      let corpo;
      if (init.body !== undefined && init.body !== null) corpo = JSON.parse(String(init.body));
      const metodo = (init.method || 'GET').toUpperCase();
      const r = await b.chamar(metodo, caminho, {
        ...(Object.keys(query).length ? { query } : {}), corpo, prioridade, signal: init.signal,
      });
      if (r.status === 0) throw new Error('core indisponível');
      return { ...r, headers: { get: (k) => (String(k).toLowerCase() === 'retry-after' ? r.retryAfter : null) } };
    },
  };
}
