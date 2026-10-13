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
import tls from 'node:tls';
import { loginServico, urlDaEdge, cabecalhosDaEdge } from './lib/bling-comercial.mjs';
// Plano 7 (5.8): as tabelas `fabrica_*` vão pela API quando CENTRAL_API_* estiver no
// ambiente (lib/fabrica-banco.mjs); o resto (Storage, gc_*) segue na REST do Supabase.
import { vaiParaApi, lerFabrica, escreverFabrica } from './lib/fabrica-banco.mjs';
import { carregarMarcasELojas } from './lib/config-lojas.mjs';

tls.DEFAULT_MAX_VERSION = 'TLSv1.2';

const URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdW5xdGRvaW9vb3R4cWVna2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDMwMDUsImV4cCI6MjA5NDc3OTAwNX0.MVXa6jngjKXkH3eZ7as_j_k8Eb7lJKcFmO4kCKAnuHM';
const SK = process.env.SUPABASE_SERVICE_KEY;
const REST = URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK };

async function sbGet(p) {
  if (vaiParaApi(p)) return lerFabrica(p);
  const r = await fetch(REST + p, { headers: H });
  if (!r.ok) throw new Error('GET ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

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
      // o token escolhe o caminho: srv_ (robo-fabrica) → API; JWT → edge do Supabase
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
