#!/usr/bin/env node
// coletor/ativar-estudio.mjs — ativa (status: 'ACTIVE') os ads da rodada do Estúdio de Anúncios
// e, se a rodada criou campanha nova (destino.tipo==='nova' em subir-estudio.mjs), também ativa
// os conjuntos e a campanha. Reusa o mesmo padrão de proxy do subir-estudio.mjs (meta-proxy via
// loginServico + fetch com retry). Ads/conjuntos/campanha que já estão ACTIVE: setar ACTIVE de
// novo é no-op no Graph — sem risco de duplicar nada.
//
// Uso:
//   node --import ./lib/curl-fetch.mjs ativar-estudio.mjs --ads a1,a2 --adsets s1 --campaign c1 --nova
//   node --import ./lib/curl-fetch.mjs ativar-estudio.mjs --ads a1,a2 --campaign c1
//   (--dry só valida o guard: não toca no Graph)
import './lib/carregar-env.mjs';
import { loginServico, urlDaEdge, cabecalhosDaEdge } from './lib/bling-comercial.mjs';
// Tudo pela API (lib/fabrica-banco.mjs); o Supabase foi desligado em 22/10/2026 (plano 01-C).
import { exigirApi, lerFabrica, escreverFabrica } from './lib/fabrica-banco.mjs';
import { carregarMarcasELojas } from './lib/config-lojas.mjs';


// --- leitura de fabrica_marcas/fabrica_lojas (pela API) ---------------------------------------
const sbGet = (p) => lerFabrica(p);

let TOKEN;
// accountId da marca ativa (fabrica_marcas.account_id) — resolvido em run(), consumido por meta().
// Não é passado explicitamente pra run() (ela só recebe adIds/adsetIds/campaign), então usamos a
// marca ativa da tabela em vez de CFG.ACCOUNT_ID hardcoded (mesma lacuna: este job não carrega
// contexto de loja/marca por chamada, só ids de ads já criados por subir-estudio.mjs).
let ACCOUNT_ID;

// --- meta-proxy: GET/POST com retry em rede/429/5xx/rate-limit (mesmo padrão do subir-estudio) --
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function ehRateLimit(status, d) {
  const code = d?.error?.code;
  return status === 429 || status >= 500 || [4, 17, 32, 613].includes(code);
}
async function chamarProxy(body) {
  const { path, method = 'GET' } = body;
  const MAX_TENTATIVAS = 5;
  let ultimoErro;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      // srv_ (robo-fabrica) → API (urlDaEdge)
      const r = await fetch(urlDaEdge('meta-proxy', TOKEN), {
        method: 'POST',
        headers: cabecalhosDaEdge(TOKEN),
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (ehRateLimit(r.status, d) && tentativa < MAX_TENTATIVAS) {
        const espera = 3000 * 2 ** (tentativa - 1);
        console.warn(`  [retry] ${method} ${path} -> HTTP ${r.status}${d?.error?.code ? ' code ' + d.error.code : ''}, tentativa ${tentativa}/${MAX_TENTATIVAS}, aguardando ${espera}ms`);
        await sleep(espera);
        continue;
      }
      return { status: r.status, d };
    } catch (e) {
      ultimoErro = e;
      if (tentativa < MAX_TENTATIVAS) {
        const espera = 3000 * 2 ** (tentativa - 1);
        console.warn(`  [retry] ${method} ${path} -> erro de rede (${e.message}), tentativa ${tentativa}/${MAX_TENTATIVAS}, aguardando ${espera}ms`);
        await sleep(espera);
        continue;
      }
    }
  }
  throw ultimoErro || new Error(`chamarProxy() falhou após ${MAX_TENTATIVAS} tentativas: ${method} ${path}`);
}

async function meta(path, params = {}, method = 'GET') {
  const r = await chamarProxy({ accountId: ACCOUNT_ID, path, params, method });
  if (method === 'POST' && r.status !== 200 && ehRateLimit(r.status, r.d)) {
    throw new Error(`meta ${method} ${path} rate limit / code ${r.d?.error?.code}: ${JSON.stringify(r.d).slice(0, 200)}`);
  }
  return r;
}

// --- alvos(): função pura — resolve quais ids do Graph precisam virar ACTIVE. Numa campanha já
// existente só os ads mudam (conjunto/campanha já estavam ativos); numa campanha nova (criada
// pelo subir-estudio.mjs, tudo PAUSED) também precisa ativar o conjunto e a campanha. ---
export function alvos({ adIds, adsetIds, metaCampaignId, metaCampaignIds, criouCampanha }) {
  if (!criouCampanha) return [...adIds];
  // campanhas novas (subir-estudio, tudo PAUSED): ativa ads + conjuntos + TODAS as campanhas.
  // metaCampaignIds[] (multi-loja) tem prioridade; senão metaCampaignId (single, retrocompat).
  const camps = (metaCampaignIds && metaCampaignIds.length) ? metaCampaignIds : (metaCampaignId ? [metaCampaignId] : []);
  return [...adIds, ...adsetIds, ...camps];
}

// --- run(): API pública do módulo -------------------------------------------------------------
// `meta` (2º arg opcional, nomeado pra não colidir com a função meta() do módulo) é uma seam de
// injeção pros testes (mesmo padrão do `meta` injetado em subirCriativos/meta-subir.mjs) — quando
// injetado, pula o loginServico() (sem rede) e usa o stub direto.
export async function run({ adIds, adsetIds, metaCampaignId, metaCampaignIds, criouCampanha, dry = false, meta: metaInjetado } = {}) {
  const ids = alvos({ adIds, adsetIds, metaCampaignId, metaCampaignIds, criouCampanha });
  const total = ids.length;
  if (dry) return { ativados: 0, total: 0, falhas: [] };

  const chamarMeta = metaInjetado || meta;
  if (!metaInjetado) {
    exigirApi();
    TOKEN = await loginServico({ naApi: true });
    const { marcaAtiva } = await carregarMarcasELojas(sbGet);
    if (!marcaAtiva) throw new Error('nenhuma marca ativa configurada (fabrica_marcas.ativo)');
    ACCOUNT_ID = marcaAtiva.accountId;
  }

  let ativados = 0;
  const falhas = [];
  for (const id of ids) {
    // Cada id é isolado: um throw (ex.: rate-limit que esgotou as retries do meta()) não pode
    // abortar o loop — ads já ativados antes disso já estão gastando (money-path), então a
    // ativação segue tentando o resto e só reporta o id problemático em `falhas`.
    try {
      const r = await chamarMeta('/' + id, { status: 'ACTIVE' }, 'POST');
      if (r.status === 200) ativados++;
      else falhas.push(id);
    } catch {
      falhas.push(id);
    }
  }
  return { ativados, total, falhas };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
  const csv = (v) => (v ? v.split(',').filter(Boolean) : []);
  run({
    adIds: csv(arg('--ads')),
    adsetIds: csv(arg('--adsets')),
    metaCampaignId: arg('--campaign'),
    criouCampanha: process.argv.includes('--nova'),
    dry: process.argv.includes('--dry'),
  }).then((r) => console.log('ativar concluído:', r)).catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
}
