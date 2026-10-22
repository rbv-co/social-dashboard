#!/usr/bin/env node
// coletor/excluir-estudio.mjs — apaga na Meta APENAS o que esta remessa do Estúdio criou.
// - Se a rodada criou campanha(s) nova(s) (destino 'nova'): DELETE nas campanhas — a Graph
//   cascateia e remove conjuntos + anúncios junto.
// - Se subiu numa campanha EXISTENTE: apaga só os ADS que esta remessa adicionou (adIds),
//   preservando a campanha/conjunto que já existiam.
// Mesmo padrão de proxy do ativar-estudio.mjs (meta-proxy via loginServico + retry). DELETE é
// idempotente no Graph (id já apagado → erro tratado como falha isolada, não aborta o loop).
//
// Uso:
//   node --import ./lib/curl-fetch.mjs excluir-estudio.mjs --campaigns c1,c2 --nova
//   node --import ./lib/curl-fetch.mjs excluir-estudio.mjs --ads a1,a2
//   (--dry só valida o guard: não toca no Graph)
import './lib/carregar-env.mjs';
import { loginServico, urlDaEdge, cabecalhosDaEdge } from './lib/bling-comercial.mjs';
// Tudo pela API (lib/fabrica-banco.mjs); o Supabase foi desligado em 22/10/2026 (plano 01-C).
import { exigirApi, lerFabrica, escreverFabrica } from './lib/fabrica-banco.mjs';
import { carregarMarcasELojas } from './lib/config-lojas.mjs';


const sbGet = (p) => lerFabrica(p);

let TOKEN;
let ACCOUNT_ID;

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
  return r;
}

// --- alvos(): função pura — o que apagar nesta remessa. Campanha nova → apaga a(s) campanha(s)
// (a Graph cascateia conjuntos/anúncios). Campanha existente → apaga só os ads adicionados. ---
export function alvos({ adIds = [], metaCampaignId, metaCampaignIds, criouCampanha }) {
  if (criouCampanha) {
    const camps = (metaCampaignIds && metaCampaignIds.length) ? metaCampaignIds : (metaCampaignId ? [metaCampaignId] : []);
    return [...camps];
  }
  return [...adIds];
}

// --- run(): API pública. `meta` injetável (seam de teste, igual ativar-estudio). ---
export async function run({ adIds, adsetIds, metaCampaignId, metaCampaignIds, criouCampanha, dry = false, meta: metaInjetado } = {}) {
  const ids = alvos({ adIds, metaCampaignId, metaCampaignIds, criouCampanha });
  const total = ids.length;
  if (dry) return { excluidos: 0, total: 0, falhas: [] };

  const chamarMeta = metaInjetado || meta;
  if (!metaInjetado) {
    exigirApi();
    TOKEN = await loginServico({ naApi: true });
    const { marcaAtiva } = await carregarMarcasELojas(sbGet);
    if (!marcaAtiva) throw new Error('nenhuma marca ativa configurada (fabrica_marcas.ativo)');
    ACCOUNT_ID = marcaAtiva.accountId;
  }

  let excluidos = 0;
  const falhas = [];
  for (const id of ids) {
    // Isolado: um id que já não existe (ex.: apagado à mão no Gerenciador) não pode abortar o
    // resto. DELETE /{id} devolve { success: true }.
    try {
      const r = await chamarMeta('/' + id, {}, 'DELETE');
      if (r.status === 200 && (r.d?.success === true || r.d?.success === undefined)) excluidos++;
      else falhas.push(id);
    } catch {
      falhas.push(id);
    }
  }
  return { excluidos, total, falhas };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
  const csv = (v) => (v ? v.split(',').filter(Boolean) : []);
  run({
    adIds: csv(arg('--ads')),
    metaCampaignIds: csv(arg('--campaigns')),
    metaCampaignId: arg('--campaign'),
    criouCampanha: process.argv.includes('--nova'),
    dry: process.argv.includes('--dry'),
  }).then((r) => console.log('excluir concluído:', r)).catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
}
