#!/usr/bin/env node
// coletor/subir-estudio.mjs — sobe os criativos ESCOLHIDOS de uma rodada do Estúdio de Anúncios
// (fabrica_criativos.escolhido=true, não-purgados) pro Meta, de forma idempotente. Diferente do
// subir-campanha-genspark.mjs (que lê PNGs locais), aqui cada item já é uma URL pública na coluna
// `url` de fabrica_criativos — o upload pro /adimages sai direto dessa URL (imageFromUrl).
//
// destino:
//   { tipo: 'existente', campaignId } → injeta os criativos NOS conjuntos da campanha já existente
//       (lê destination_type + whatsapp_phone_number REAIS de cada conjunto, pra payloadCriativa
//        escolher multi-destino vs WhatsApp-puro). Produto cartesiano criativos × conjuntos.
//   { tipo: 'nova', loja } → cria 1 campanha WhatsApp (OUTCOME_ENGAGEMENT, PAUSED) + 1 conjunto e
//       sobe os criativos nesse conjunto.
//
// Idempotência: nomes de ad são determinísticos (nomeAd) — pré-busca os ads já existentes na
// campanha e pula os que já estão lá (permite re-disparar após um blip/rate-limit sem duplicar).
// Em rate limit (Meta code 17) subirCriativos para e devolve pendentes>0 — o chamador re-dispara.
//
// TUDO PAUSED — a ativação agora está disponível via o job 'ativar' (ativar-estudio.mjs), disparado
// à parte pela UI. Só o chamador (Task 5) fecha a rodada (fabrica_campanhas.fechada_em); aqui só sobe.
//
// Uso:
//   node --import ./lib/curl-fetch.mjs subir-estudio.mjs --campanha <uuid> --campaign <metaCampaignId>
//   node --import ./lib/curl-fetch.mjs subir-estudio.mjs --campanha <uuid> --loja tivoli
//   (--dry só valida o guard: não toca no Graph)
import './lib/carregar-env.mjs';
import tls from 'node:tls';
import { loginServico } from './lib/bling-comercial.mjs';
import { subirCriativos } from './lib/meta-subir.mjs';
import { carregarMarcasELojas, montarLegenda } from './lib/config-lojas.mjs';
import { carregarObjetivos, mapaObjetivo, montaPromotedObject } from './lib/objetivos.mjs';
import { montarTargeting } from './lib/publico.mjs';
import { orcamentoMeta } from './lib/orcamento.mjs';

// Fix TLS1.2 (ECONNRESET determinístico atrás do Cloudflare/*.supabase.co nesta máquina). Antes de
// qualquer fetch — inclusive o de dentro do loginServico().
tls.DEFAULT_MAX_VERSION = 'TLSv1.2';

const URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdW5xdGRvaW9vb3R4cWVna2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDMwMDUsImV4cCI6MjA5NDc3OTAwNX0.MVXa6jngjKXkH3eZ7as_j_k8Eb7lJKcFmO4kCKAnuHM';
const SK = process.env.SUPABASE_SERVICE_KEY;
const REST = URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };

const CFG_ADSET = { DAILY_BUDGET: 5000, DATA_CAMPANHA: '11-07-2026' };

// Aliases antigos de slug (CLI --loja tivoli|dp|dompedro) pro `nome` real das lojas na tabela
// fabrica_lojas (que não tem coluna de slug — só deposito_id/nome). Ver Task 3 do plano.
const ALIAS_LOJA = { tivoli: 'tivoli', dp: 'dom pedro', dompedro: 'dom pedro' };
export function resolverLoja(lojas, slug) {
  if (!slug) return undefined;   // slug vazio/undefined -> não casa nada (o chamador lança "loja inválida")
  const alvo = ALIAS_LOJA[String(slug).toLowerCase()] || String(slug).toLowerCase();
  return lojas.find((l) => l.ativo && l.nome.toLowerCase().includes(alvo));
}

let TOKEN;
let MARCA; // marca (ad account/page/ig/caption) resolvida em run(), consumida pelas funções abaixo

// --- Supabase REST (leitura service-role dos criativos escolhidos) ----------------------------
async function sbGet(p) {
  const r = await fetch(REST + p, { headers: H });
  if (!r.ok) throw new Error('GET ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function sbPost(p, body, prefer) {
  const r = await fetch(REST + p, { method: 'POST', headers: prefer ? { ...H, Prefer: prefer } : H, body: JSON.stringify(body) });
  if (!r.ok && ![200, 201, 204].includes(r.status)) throw new Error('POST ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r;
}

// --- meta-proxy: GET/POST com retry em rede/429/5xx/rate-limit (padrão do genspark) -----------
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
      const r = await fetch(URL + '/functions/v1/meta-proxy', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + TOKEN, apikey: ANON, 'Content-Type': 'application/json' },
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
  const r = await chamarProxy({ accountId: MARCA.accountId, path, params, method });
  // subirCriativos detecta rate limit pela mensagem do throw (regex code 17 / request limit).
  if ((method === 'POST') && r.status !== 200 && ehRateLimit(r.status, r.d)) {
    throw new Error(`meta ${method} ${path} rate limit / code ${r.d?.error?.code}: ${JSON.stringify(r.d).slice(0, 200)}`);
  }
  return r;
}

// GET paginado (segue paging.cursors.after) — devolve .data concatenado.
async function metaTodos(path, params = {}) {
  const itens = [];
  let after = null;
  do {
    const p = after ? { ...params, after } : params;
    const r = await meta(path, p, 'GET');
    if (r.status !== 200 || !r.d) throw new Error(`GET ${path} falhou (status ${r.status}): ${JSON.stringify(r.d).slice(0, 400)}`);
    if (Array.isArray(r.d.data)) itens.push(...r.d.data);
    after = r.d.paging?.cursors?.after && r.d.data?.length ? r.d.paging.cursors.after : null;
  } while (after);
  return itens;
}

// Upload da imagem pública (fabrica_criativos.url) pro /adimages via imageFromUrl → image_hash real
// (nível da conta, reusado em todos os conjuntos). Igual ao uploadImagemBytes do genspark.
async function uploadImagemBytes(url, field) {
  const r = await chamarProxy({ accountId: MARCA.accountId, path: `/${MARCA.adAccount}/adimages`, method: 'POST', imageFromUrl: url, imageField: field });
  if (r.status !== 200 || !r.d?.images) {
    if (ehRateLimit(r.status, r.d)) throw new Error(`/adimages rate limit / code ${r.d?.error?.code}`);
    throw new Error(`POST /adimages (field=${field}) falhou (status ${r.status}): ${JSON.stringify(r.d).slice(0, 500)}`);
  }
  const hash = Object.values(r.d.images)[0]?.hash;
  if (!hash) throw new Error(`POST /adimages (field=${field}) sem hash: ${JSON.stringify(r.d).slice(0, 500)}`);
  return hash;
}

// --- destino 'existente': lista os conjuntos REAIS (destination_type + whatsapp por conjunto) --
async function adsetsDaCampanha(campaignId) {
  const raw = await metaTodos(`/${campaignId}/adsets`, { fields: 'id,name,effective_status,destination_type,promoted_object', limit: 200 });
  return raw.map((a) => ({
    id: a.id,
    name: a.name,
    destinationType: a.destination_type,
    whatsapp: a.promoted_object?.whatsapp_phone_number || null,
  }));
}

// O payload de campanha+conjunto mora em lib/payload-campanha.mjs desde
// 2026-08-03, para a TELA de criar campanha usar o MESMO montador — copiar seria
// repetir o erro que fez a Meta recusar quatro vezes. Reexportado aqui porque
// meia dúzia de scripts já importa daqui.
export { rotuloObjetivo, nomeCampanha, nomeConjunto, payloadCampanhaAdset } from './lib/payload-campanha.mjs';

// --- destino 'nova': cria campanha + 1 conjunto a partir do objetivo da rodada -----------------
async function criarCampanhaNova(loja, objetivoRow, publico = null, orcamento = null) {
  const { campaign: campaignPayload, adset: adsetPayload } = payloadCampanhaAdset(
    objetivoRow, MARCA, loja, { DAILY_BUDGET: CFG_ADSET.DAILY_BUDGET, DATA: CFG_ADSET.DATA_CAMPANHA }, publico, orcamento,
  );

  const campaign = await meta(`/${MARCA.adAccount}/campaigns`, campaignPayload, 'POST');
  if (campaign.status !== 200 || !campaign.d?.id) throw new Error(`POST /campaigns falhou (status ${campaign.status}): ${JSON.stringify(campaign.d).slice(0, 500)}`);
  const campaignId = campaign.d.id;

  const adset = await meta(`/${MARCA.adAccount}/adsets`, { ...adsetPayload, campaign_id: campaignId }, 'POST');
  if (adset.status !== 200 || !adset.d?.id) throw new Error(`POST /adsets falhou (status ${adset.status}): ${JSON.stringify(adset.d).slice(0, 500)}`);

  return { campaignId, adsets: [{ id: adset.d.id, name: adsetPayload.name, destinationType: objetivoRow.destination_type, whatsapp: loja.whatsapp }] };
}

// Normaliza o destino p/ [{ slug, publico, orcamento }] — público e orçamento POR loja. destino.lojas
// pode vir como array de slugs (retrocompat: público único = destino.publico, orcamento=null) OU
// array de {slug, publico, orcamento}. Fallback single: destino.loja. Pura p/ teste.
export function lojasDoDestino(destino) {
  const arr = (destino?.lojas && destino.lojas.length) ? destino.lojas : (destino?.loja ? [destino.loja] : []);
  return arr.map((l) => (typeof l === 'string')
    ? { slug: l, publico: destino?.publico ?? null, orcamento: null }
    : { slug: l.slug, publico: (l.publico !== undefined ? l.publico : (destino?.publico ?? null)), orcamento: (l.orcamento ?? null) });
}

// Idempotência do destino 'nova': acha a campanha que ESTA rodada já criou pra ESTA loja.
//
// POR QUE: quando o subir para por rate limit, o job vira 'erro' com "re-disparar pra continuar" —
// e não existe botão de re-disparar: o dono clica em Publicar de novo. Sem esta busca, o segundo
// clique chamava criarCampanhaNova outra vez e criava uma SEGUNDA campanha por loja na Meta. O
// cabeçalho deste arquivo promete "re-disparar sem duplicar", e isso só valia pro destino
// 'existente'; a idempotência por nome de anúncio só evita ad repetido DENTRO de uma campanha.
//
// A chave é (rodada, loja), NUNCA o nome da campanha: `CFG_ADSET.DATA_CAMPANHA` é uma constante
// congelada ('11-07-2026'), então TODA campanha da mesma loja+objetivo nasce com nome idêntico, em
// qualquer rodada. Casar por nome faria uma rodada nova despejar anúncios na campanha de uma rodada
// velha. Dentro de uma rodada, porém, é uma campanha por loja por definição. Pura p/ teste.
export function campanhaDoRastro(rastros, lojaNome) {
  const r = (rastros || []).find((x) => x?.meta_campaign_id && x.loja === lojaNome);
  return r ? r.meta_campaign_id : null;
}

// O LAÇO MULTI-LOJA. Recebe `criar` e `subir` injetados (mesma costura do ativar-estudio.mjs) para
// ser testável sem tocar no Graph. Devolve { resultados, falhas }.
export async function subirPorLoja({ alvosLoja, lojas, objetivoRow, criar, subir, log = console.log }) {
  const resultados = [];
  const falhas = [];
  for (const { slug, publico, orcamento } of alvosLoja) {
    const loja = resolverLoja(lojas, slug);
    if (!loja || !loja.marca) {
      falhas.push({ loja: slug, erro: `loja inválida p/ destino 'nova': ${slug} (não está em fabrica_lojas, ativa e com marca)` });
      log(`  loja ${slug}: FALHOU — não está cadastrada como loja ativa com marca`);
      continue;
    }
    try {
      const { campaignId: metaCampaignId, adsets } = await criar(loja, objetivoRow, publico, orcamento);
      const r = await subir({ metaCampaignId, adsets, lojaNome: loja.nome });
      resultados.push(r);
      log(`  loja ${loja.nome}: campanha ${metaCampaignId} (${r.adIds?.length ?? 0} anúncio(s))`);
    } catch (e) {
      // NÃO propaga: a(s) loja(s) anterior(es) já criaram campanha DE VERDADE na Meta. Se o erro
      // subir, o runner grava só `erro` e o `resultado` some — o Conferir e o Ativar deixam de
      // enxergar o que subiu. Mesma política do ativar-estudio.mjs.
      falhas.push({ loja: loja.nome, erro: String(e.message) });
      log(`  loja ${loja.nome}: FALHOU — ${String(e.message).slice(0, 200)}`);
    }
  }
  // Nenhuma subiu = não houve subida nenhuma: aí sim é erro do job inteiro (senão ele diria
  // "concluído" sem ter criado nada).
  if (!resultados.length) {
    throw new Error(`nenhuma loja subiu — ${falhas.map((f) => `${f.loja}: ${f.erro}`).join(' | ')}`);
  }
  return { resultados, falhas };
}

// Sobe os criativos escolhidos NUMA campanha do Meta (idempotência + itens + subir + rastro).
// MARCA já deve estar setada pro contexto da campanha (loja). Retorna { adIds, pendentes,
// metaCampaignId, adsetIds }.
async function subirNumaCampanha({ metaCampaignId, adsets, escolhidos, destino, campanhaId, lojaNome }) {
  if (!adsets.length) throw new Error(`campanha ${metaCampaignId} não tem conjuntos — nada onde subir`);
  const existentes = await metaTodos(`/${metaCampaignId}/ads`, { fields: 'name,adset_id', limit: 500 });
  const jaTem = new Set(existentes.map((a) => `${a.adset_id}::${a.name}`));
  const legendaMarca = montarLegenda(MARCA.captionTemplate, { marca: MARCA.nome }).trim();
  // 1 ANÚNCIO = 1 (sku, variante): as PROPORÇÕES (formatos) do mesmo look+preço viram placements de um
  // único anúncio (não 1 ad por imagem). Agrupa os escolhidos por (sku, variante).
  const grupos = new Map();
  for (const c of escolhidos) {
    const k = `${c.sku}|${c.variante}`;
    if (!grupos.has(k)) grupos.set(k, { sku: c.sku, variante: c.variante, mensagem: c.legenda || legendaMarca, imagens: [] });
    grupos.get(k).imagens.push({ formato: c.formato, url: c.url });
  }
  let _gi = 0;
  const itens = [...grupos.values()].map((g) => {
    const idx = _gi++;
    return {
      chave: `${g.sku}-${g.variante}`, produto: g.sku, variante: g.variante, mensagem: g.mensagem,
      // sobe cada proporção 1x (hash da conta) -> [{formato,hash}] p/ o payloadPlacements montar 1 creative
      getImagens: async () => Promise.all(g.imagens.map((im, j) => uploadImagemBytes(im.url, `img${idx}_${j}`).then((hash) => ({ formato: im.formato, hash })))),
    };
  });
  const adIds = [];
  // Nome do anúncio (único por look+preço, senão a idempotência colide): "Bolsa <sku> · <variante> · <loja>".
  const nomear = (item) => `Bolsa ${item.produto} · ${item.variante} · ${lojaNome || MARCA.nome || 'Loja'}`.slice(0, 200);
  const res = await subirCriativos({
    meta, act: MARCA.adAccount, page: MARCA.pageId, ig: MARCA.igId,
    itens, adsets, prefixo: 'Estudio', mensagem: legendaMarca, jaTem, nomear,
    onAd: ({ adId }) => adIds.push(adId),
  });
  const adsetIds = adsets.map((a) => a.id);
  try {
    await sbPost('/fabrica_meta_jobs', [{
      ad_account_id: MARCA.adAccount, loja: lojaNome || null, tipo: 'estudio',
      meta_campaign_id: metaCampaignId, adset_ids: adsetIds, ad_ids: adIds,
      payload: { campanhaId, destino, escolhidos: escolhidos.length, caption: legendaMarca },
      status: res.pendentes ? 'parcial' : 'criado',
      erro: res.rateLimited ? `rate limit — ${res.pendentes} pendente(s)` : null,
    }], 'return=minimal');
  } catch (e) {
    console.warn(`aviso: não gravou fabrica_meta_jobs (${e.message}) — subida seguiu normal`);
  }
  return { adIds, pendentes: res.pendentes, metaCampaignId, adsetIds };
}

// --- run(): API pública do módulo -------------------------------------------------------------
export async function run({ campanhaId, destino, dry = false }) {
  const criouCampanha = destino?.tipo === 'nova';
  if (dry) return { adIds: [], pendentes: 0, metaCampaignId: null, adsetIds: [], falhas: [], criouCampanha };

  TOKEN = await loginServico();

  // 0) marca+lojas da tabela (fabrica_marcas/fabrica_lojas) — substitui CFG/LOJAS hardcoded.
  const { lojas, marcaAtiva } = await carregarMarcasELojas(sbGet);
  if (!marcaAtiva) throw new Error('nenhuma marca ativa configurada (fabrica_marcas.ativo)');
  MARCA = marcaAtiva; // conta usada p/ upload de imagem e (destino 'existente') pros conjuntos já existentes

  // 1) criativos escolhidos (não-purgados) da rodada.
  //    REGRA (cliente): o formato WIDESCREEN 16:9 (1920x1080) NÃO sobe pro Meta — é reservado pro
  //    Google Ads (YouTube), a conectar depois. Ele segue sendo gerado e curável, só não é veiculado
  //    aqui. Quando entrar o Google Ads, criar o subir-google.mjs que sobe justamente o 1920x1080.
  const escolhidos = await sbGet(`/fabrica_criativos?select=id,url,storage_path,legenda,sku,variante,formato&campanha_id=eq.${campanhaId}&escolhido=eq.true&purgado_em=is.null&formato=neq.1920x1080`);
  // Zero criativos escolhidos NÃO é sucesso. Sem a marca `semCriativos`, este retorno virava
  // {status:'concluido', fecha:true} no runner: a tela dizia "Publicado (pausado)! 0 anúncios" e a
  // rodada era FECHADA sem nada ter subido. Foi exatamente isso que aconteceu no job
  // 66a8e030 (13/07/2026 22:49) — a "primeira vez que bugou e não subiu campanha" do relato do dono.
  if (escolhidos.length === 0) return { adIds: [], pendentes: 0, metaCampaignId: null, adsetIds: [], falhas: [], criouCampanha, semCriativos: true };

  // 2) resolve destino -> sobe em 1 (existente / 1 loja) ou N campanhas (uma por loja). Cada
  //    campanha usa os MESMOS criativos escolhidos; o público é o mesmo (montarTargeting cai nas
  //    cidades da própria loja como fallback de geo). Sequencial (money-path).
  const resultados = [];
  let falhas = [];
  if (destino?.tipo === 'existente') {
    MARCA = marcaAtiva;
    const adsets = await adsetsDaCampanha(destino.campaignId);
    resultados.push(await subirNumaCampanha({ metaCampaignId: destino.campaignId, adsets, escolhidos, destino, campanhaId, lojaNome: null }));
  } else if (destino?.tipo === 'nova') {
    const alvosLoja = lojasDoDestino(destino); // [{ slug, publico, orcamento }] — público e orçamento POR loja
    if (!alvosLoja.length) throw new Error(`destino 'nova' sem loja(s) — use destino.loja ou destino.lojas`);
    // objetivo da rodada (fabrica_campanhas.objetivo) -> linha de fabrica_objetivos (fallback 'engajamento')
    const campanha = (await sbGet(`/fabrica_campanhas?select=objetivo&id=eq.${campanhaId}`))[0];
    const { porChave } = await carregarObjetivos(sbGet);
    const objetivoRow = mapaObjetivo(porChave, campanha?.objetivo || 'engajamento');
    // rastro do que ESTA rodada já criou (uma linha por loja que subiu) — base da idempotência do
    // 'nova'. Best-effort: se a leitura falhar, seguimos criando, que é o comportamento de antes.
    let rastros = [];
    try {
      rastros = await sbGet(`/fabrica_meta_jobs?select=meta_campaign_id,loja,created_at&tipo=eq.estudio&payload->>campanhaId=eq.${campanhaId}&order=created_at.desc&limit=50`);
    } catch (e) {
      console.warn(`aviso: não li fabrica_meta_jobs (${e.message}) — re-disparo pode duplicar campanha`);
    }
    const r = await subirPorLoja({
      alvosLoja, lojas, objetivoRow,
      criar: async (loja, obj, publico, orcamento) => {
        MARCA = loja.marca; // a loja pode pertencer a uma marca diferente da marcaAtiva global
        const ja = campanhaDoRastro(rastros, loja.nome);
        if (ja) {
          // re-disparo: reaproveita a campanha desta rodada em vez de criar outra igual.
          console.log(`  loja ${loja.nome}: reaproveitando a campanha ${ja} que esta rodada já criou`);
          return { campaignId: ja, adsets: await adsetsDaCampanha(ja) };
        }
        return criarCampanhaNova(loja, obj, publico, orcamento);
      },
      subir: ({ metaCampaignId, adsets, lojaNome }) =>
        subirNumaCampanha({ metaCampaignId, adsets, escolhidos, destino, campanhaId, lojaNome }),
    });
    resultados.push(...r.resultados);
    falhas = r.falhas;
  } else {
    throw new Error(`destino inválido: ${JSON.stringify(destino)} (use {tipo:'existente',campaignId} ou {tipo:'nova',loja|lojas})`);
  }

  const adIds = resultados.flatMap((r) => r.adIds);
  const pendentes = resultados.reduce((a, r) => a + r.pendentes, 0);
  return {
    adIds, pendentes, criouCampanha,
    falhas,                                                      // lojas que NÃO subiram (as outras subiram)
    adsetIds: resultados.flatMap((r) => r.adsetIds),             // TODOS os adsets (agregado) — p/ ativar
    metaCampaignId: resultados[0]?.metaCampaignId || null,       // compat (1ª campanha)
    metaCampaignIds: resultados.map((r) => r.metaCampaignId),    // TODAS as campanhas — p/ ativar todas
    campanhas: resultados.map((r) => ({ metaCampaignId: r.metaCampaignId, adsetIds: r.adsetIds, ads: r.adIds.length })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
  run({
    campanhaId: arg('--campanha'),
    destino: arg('--campaign') ? { tipo: 'existente', campaignId: arg('--campaign') } : { tipo: 'nova', loja: arg('--loja') },
    dry: process.argv.includes('--dry'),
  }).then((r) => console.log('subir concluído:', r)).catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
}
