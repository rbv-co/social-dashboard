#!/usr/bin/env node
// coletor/subir-campanha-meta.mjs — F3 launch limpo (1 ad por produto, LOOK ROTATIVO,
// Story 1080x1920, IG, WhatsApp). WhatsApp (PAUSED) pra conta Vessel.
//
// Estrutura por loja:
//   Campaign "[IA] <Loja> · WhatsApp · 11-07-2026"
//     └ AdSet "Geral (Promo)"  → 1 ad (o criativo promo, Story 1080x1920)
//     └ AdSet "De x Por"       → 1 ad por PRODUTO (SKU), look ROTATIVO, Story 1080x1920
//
// DECISÃO desta rodada (substitui o look fixo produto-heroi de tentativas anteriores):
// 1 ad por produto, mas o LOOK varia produto a produto — índice de rotação (só entre os
// produtos SEM foto de modelo, ordem estável) % 6: produto-heroi, produto-sage-circulo,
// produto-preco-tipo, produto-split, editorial-sale, editorial-v2 (ver LOOKS). Isso evita que
// a campanha inteira pareça uma "cópia colada" do mesmo template — ver
// buscarProdutosRotacaoLook(). Só o formato Story (1080x1920) sobe nesta rodada; os formatos
// Post (1080x1350) continuam ignorados de propósito. Caption limpa e genérica (o PNG já mostra
// nome do produto + preço, não precisa repetir o nome longo do Bling na legenda) — ver
// CAPTION_PADRAO.
//
// Fallback de look: nem todo SKU tem uma linha pro look sorteado (o pool de 6 looks só existe
// completo depois de uma regen — nas rodadas de transição, alguns looks ainda não têm linha
// pro SKU sorteado). Se o look sorteado não tiver linha 1080x1920 pro SKU, usa QUALQUER linha
// 1080x1920 daquele produto (não pula o produto só por causa do look — ver
// buscarProdutosRotacaoLook()).
//
// MODELO (foto de pessoa) — SKUs com foto de modelo NÃO entram na rotação: pra eles usamos o
// criativo "produto-modelo" (lifestyle, com pessoa) da campanha [IA] Modelo (--modelo-campanha,
// default 199723e1-d0a6-4aaa-b718-a083844512ec), Story 1080x1920, storage_path com o SKU. A
// LISTA de SKUs "modelo" vem de --modelo-map (default ./fotos-modelo-map.json, sku → url da
// foto — só usamos as CHAVES pra decidir quem é modelo; a imagem de fato sobe é a do criativo
// produto-modelo, não a foto crua do mapa). Isso deixa ~7 SKUs (os que têm foto de pessoa) com
// o ad lifestyle, e o resto rotacionando os 6 looks normalmente — ver
// buscarProdutosRotacaoLook() / buscarCreativosModelo().
//
// Mecanismo de imagem (validado ao vivo, reaproveitado das tentativas anteriores): POST
// /adimages por BYTES via meta-proxy (`imageFromUrl` — o meta-proxy baixa a imagem no
// servidor e reenvia multipart/form-data pro Graph, contornando tanto o bloqueio de
// `/adimages` por `url` quanto o limite de URL do modo base64/query-string antigo).
// uploadImagemBytes() devolve um image_hash de verdade.
//
// Creative que FUNCIONA (validado ao vivo, com Instagram — effective_instagram_media_id
// presente): `object_story_spec: { page_id, instagram_actor_id, link_data: { image_hash,
// link: wa.me/<número da loja>, message: <caption>, call_to_action: { type:
// 'WHATSAPP_MESSAGE' } } }`. UM ad por produto/promo, sem asset_feed_spec (o creative
// dinâmico não é suportado pra campanhas OUTCOME_ENGAGEMENT com destino WhatsApp — achado de
// rodada anterior, não retestado aqui pois não é mais necessário: 1 formato só).
//
// Gotcha do Instagram (BM): em rodadas anteriores, `instagram_actor_id` era rejeitado pro
// token do system user "coletor" porque a conta IG não estava atribuída como asset. Nesta
// rodada o `instagram_actor_id` (@vessel.brasil, 17841462952561833) FOI aceito (BM corrigido
// entre rodadas) — confirmado ao vivo com `effective_instagram_media_id` presente no creative
// verificado. Ainda assim, criarAdCreative() mantém o fallback automático (tenta sempre COM
// IG primeiro; se cair no erro específico de novo, refaz sem) — não custa nada manter a
// resiliência.
//
// Uso:
//   node --import ./lib/curl-fetch.mjs subir-campanha-meta.mjs --dry [--tivoli <campanhaId>] [--dompedro <campanhaId>]
//                                            [--modelo-campanha <id>] [--modelo-map <path>]
//                                            # plano completo (2 campanhas/4 conjuntos/~ads), SEM chamar o Graph
//   node --import ./lib/curl-fetch.mjs subir-campanha-meta.mjs [--tivoli <id> --dompedro <id>]
//                                            # subida REAL completa (2 lojas, ~20 ads/campanha, tudo PAUSED)
// --tivoli/--dompedro sobrescrevem o campanhaId (fabrica_campanhas) de origem dos criativos
// por loja — default são os lotes isnet da Config desta task (b5a4bdd0.../730b9e0a...).
// --modelo-campanha sobrescreve a campanha [IA] Modelo (default 199723e1-...) e --modelo-map
// sobrescreve o caminho do JSON sku→foto (default ./fotos-modelo-map.json, ao lado deste
// arquivo) — ver bloco MODELO acima.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import './lib/carregar-env.mjs';
import { loginServico, urlDaEdge, cabecalhosDaEdge } from './lib/bling-comercial.mjs';
// Tudo pela API (o Supabase foi desligado em 22/10/2026, plano 01-C): `fabrica_*`, nomes de
// produto, e o `meta-proxy` com o token srv_ do robo-fabrica (módulo `meta`).
import { exigirApi, lerFabrica, escreverFabrica, lerNomesPorSku } from './lib/fabrica-banco.mjs';

const DRY = process.argv.includes('--dry');

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
}
const CLI_TIVOLI = argVal('--tivoli');
const CLI_DOMPEDRO = argVal('--dompedro');
const CLI_MODELO_CAMPANHA = argVal('--modelo-campanha');
const CLI_MODELO_MAP = argVal('--modelo-map');

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- CFG: valores REAIS (conta Vessel, app Live) ------------------------------------------
const CFG = {
  ACCOUNT_ID: 'b6883e82-07cb-4f21-9fd7-ea7626786174', // accountId do meta-proxy
  ACT: 'act_1197997517858139',
  PAGE: '324679337390168',
  IG: '17841462952561833',
  DAILY_BUDGET: 5000, // centavos = R$50/dia por conjunto (ABO)
  DATA_CAMPANHA: '11-07-2026',
  // Campanha [IA] Modelo (fabrica_campanhas) — fonte do criativo lifestyle (produto-modelo,
  // Story 1080x1920) pros SKUs com foto de pessoa. Ver --modelo-campanha e bloco MODELO no
  // cabeçalho do arquivo.
  MODELO_CAMPANHA: CLI_MODELO_CAMPANHA || '199723e1-d0a6-4aaa-b718-a083844512ec',
};

// Caption limpa e genérica — o PNG (qualquer look) já mostra nome do produto + preço, não
// precisa repetir o nome longo do Bling na legenda. Usada em TODOS os ads (produto e
// promo), pra manter a coerência visual/textual da campanha.
const CAPTION_PADRAO = '50% OFF em bolsas La Vessel · chame no WhatsApp 💬';

// --- MODELO_SKUS: SKUs com foto de pessoa (não rotacionam — usam o criativo produto-modelo,
// ver buscarCreativosModelo()) --------------------------------------------------------------
// --modelo-map aponta pro JSON sku→url da foto crua (default ./fotos-modelo-map.json, ao lado
// deste arquivo); usamos só as CHAVES pra decidir quem é "modelo" — a imagem que de fato sobe
// pro ad é o criativo produto-modelo da campanha [IA] Modelo (CFG.MODELO_CAMPANHA), não a foto
// crua do mapa. Se o arquivo não existir/estiver malformado, avisa e segue com o Set vazio
// (nenhum SKU vira "modelo" — todos rotacionam os 6 looks normalmente; não trava a subida).
const MODELO_MAP_PATH = resolvePath(__dirname, CLI_MODELO_MAP || './fotos-modelo-map.json');
let MODELO_MAP = {};
try {
  MODELO_MAP = JSON.parse(readFileSync(MODELO_MAP_PATH, 'utf8'));
} catch (e) {
  console.warn(`aviso: não consegui ler --modelo-map (${MODELO_MAP_PATH}): ${e.message} — nenhum SKU será tratado como "modelo"`);
}
const MODELO_SKUS = new Set(Object.keys(MODELO_MAP));

// Lojas: campanhaId = lote isnet (F3, cutout corrigido) que contém os criativos `produto`
// (looks produto-heroi + produto-sage-circulo, à-vista, 2 formatos por SKU) E `promo` (Geral,
// 1 par dual-formato) daquela loja. Só Story (1080x1920) sobe nesta rodada, com o look
// rotacionando por produto (ver buscarProdutosRotacaoLook()). canalLojaId usado só pra
// enriquecer o nome do produto via gc_vendas_item (não vai pro Graph).
const LOJAS = [
  {
    nome: 'Tivoli',
    campanhaId: 'b5a4bdd0-a56f-48c3-a07c-09cf822c1de5',
    whatsapp: '+5519971690502',
    geoCities: [267873, 241913], // Santa Bárbara d'Oeste, Americana
    canalLojaId: '205834140',
  },
  {
    nome: 'Dom Pedro',
    campanhaId: '730b9e0a-6fc1-498c-ae17-39f6776c1a16',
    whatsapp: '+5519999545112',
    geoCities: [247071], // Campinas
    canalLojaId: '205657609',
  },
];
if (CLI_TIVOLI) LOJAS[0].campanhaId = CLI_TIVOLI;
if (CLI_DOMPEDRO) LOJAS[1].campanhaId = CLI_DOMPEDRO;

let TOKEN;

// --- chamarProxy(): chamada de baixo nível ao meta-proxy, com retry em erro de rede E em
// 429/5xx (até 4 tentativas, backoff exponencial 1s/2s/4s). --dry nunca toca o Graph: só
// imprime o corpo e devolve uma resposta fake pro fluxo seguir até o fim. meta() (GET/POST/
// DELETE via query string) e uploadImagemBytes() (POST multipart via imageFromUrl — ver
// cabeçalho do arquivo) são as duas casas que usam isto.
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
let fakeSeq = 0;
async function chamarProxy(body) {
  const { path, method = 'GET', imageFromUrl } = body;
  if (DRY) {
    console.log(`\n[dry] ${method} ${path}${imageFromUrl ? ' (imageFromUrl, field=' + body.imageField + ')' : ''}`);
    console.log(JSON.stringify(imageFromUrl ? { ...body, imageFromUrl: '<url omitida no log>' } : body.params, null, 2));
    fakeSeq++;
    if (imageFromUrl) return { status: 200, d: { images: { [`fake-${fakeSeq}.png`]: { hash: `fake_hash_${fakeSeq}` } } } };
    if (method === 'POST') return { status: 200, d: { id: `fake_id_${fakeSeq}` } };
    return { status: 200, d: {} };
  }
  const MAX_TENTATIVAS = 4;
  let ultimoErro;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const r = await fetch(urlDaEdge('meta-proxy', TOKEN), {
        method: 'POST',
        headers: cabecalhosDaEdge(TOKEN),
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if ((r.status === 429 || r.status >= 500) && tentativa < MAX_TENTATIVAS) {
        const espera = 1000 * 2 ** (tentativa - 1);
        console.warn(`  [retry] ${method} ${path} -> HTTP ${r.status}, tentativa ${tentativa}/${MAX_TENTATIVAS}, aguardando ${espera}ms`);
        await sleep(espera);
        continue;
      }
      return { status: r.status, d };
    } catch (e) {
      ultimoErro = e;
      if (tentativa < MAX_TENTATIVAS) {
        const espera = 1000 * 2 ** (tentativa - 1);
        console.warn(`  [retry] ${method} ${path} -> erro de rede (${e.message}), tentativa ${tentativa}/${MAX_TENTATIVAS}, aguardando ${espera}ms`);
        await sleep(espera);
        continue;
      }
    }
  }
  throw ultimoErro || new Error(`chamarProxy() falhou após ${MAX_TENTATIVAS} tentativas: ${method} ${path}`);
}

async function meta(path, params = {}, method = 'GET') {
  return chamarProxy({ accountId: CFG.ACCOUNT_ID, path, params, method });
}

// --- uploadImagemBytes(): POST /adimages por BYTES (meta-proxy, param `imageFromUrl`), não
// por `url`. Devolve o image_hash de verdade. `field` só nomeia o campo do multipart/filename
// (ex.: "img0") — não afeta o hash.
async function uploadImagemBytes(url, field) {
  const r = await chamarProxy({ accountId: CFG.ACCOUNT_ID, path: `/${CFG.ACT}/adimages`, method: 'POST', imageFromUrl: url, imageField: field });
  if (r.status !== 200 || !r.d?.images) {
    throw new Error(`POST /adimages (bytes, field=${field}) falhou (status ${r.status}): ${JSON.stringify(r.d).slice(0, 500)}`);
  }
  const hash = Object.values(r.d.images)[0]?.hash;
  if (!hash) throw new Error(`POST /adimages (bytes, field=${field}) sem hash na resposta: ${JSON.stringify(r.d).slice(0, 500)}`);
  return hash;
}

const sbGet = (p) => lerFabrica(p);
const sbPost = (p, body) => escreverFabrica('POST', p, body);

// storage_path: <campanha>/produto/<sku-saneado>-<variante>-<formato>.png (variante já inclui
// o look, ex.: produto-heroi-avista, produto-sage-circulo-avista). Extrai o sku saneado
// tirando o sufixo conhecido -variante-formato.png.
function skuDe(storagePath, variante, formato) {
  const file = (storagePath || '').split('/').pop() || '';
  const sufixo = `-${variante}-${formato}.png`;
  return file.endsWith(sufixo) ? file.slice(0, -sufixo.length) : file.replace(/\.png$/, '');
}

// Nome real do produto via gc_vendas_item (o sku no storage é saneado — espaços viram "_" —
// então tenta exato, depois com "_"→" "; se não achar nada, cai num rótulo legível a partir
// do próprio sku saneado). Usado só pro NOME do ad (`<sku> · <nome>`), nunca na caption.
let nomesPorSku;
async function nomeProduto(skuSane) {
  nomesPorSku ??= lerNomesPorSku();
  const nomes = await nomesPorSku;
  return nomes.get(skuSane) || nomes.get(skuSane.replace(/_/g, ' ')) || null;
}

// --- LOOKS: ordem de rotação (índice de rotação, só entre produtos SEM foto de modelo, % 6) -
// 0=produto-heroi, 1=produto-sage-circulo, 2=produto-preco-tipo, 3=produto-split,
// 4=editorial-sale, 5=editorial-v2. O pool completo de 6 looks só existe depois de uma regen —
// em rodadas de transição, alguns looks ainda não têm linha pro SKU sorteado e caem no fallback
// abaixo (não é bug: o requisito é "não pular produto por falta de look", não "só rotacionar
// entre looks existentes").
const LOOKS = ['produto-heroi', 'produto-sage-circulo', 'produto-preco-tipo', 'produto-split', 'editorial-sale', 'editorial-v2'];

// --- buscarCreativosModelo(): busca (1x, cacheado) todas as linhas produto/1080x1920 da
// campanha [IA] Modelo (CFG.MODELO_CAMPANHA) e devolve um Map sku -> linha. O storage_path de
// lá é `<campanha>/produto-modelo/<sku>-<formato>.png` (SEM repetir a variante no nome do
// arquivo, diferente das lojas normais) — por isso o sku é extraído tirando só o sufixo
// `-<formato>.png`, não reaproveita skuDe().
let _modeloRowsPromise;
async function buscarCreativosModelo() {
  if (MODELO_SKUS.size === 0) return new Map(); // sem --modelo-map válido: não busca à toa
  const rows = await sbGet(
    `/fabrica_criativos?select=*&campanha_id=eq.${CFG.MODELO_CAMPANHA}&arquetipo=eq.produto&formato=eq.1080x1920&order=storage_path`
  );
  const porSku = new Map();
  for (const r of rows) {
    const file = (r.storage_path || '').split('/').pop() || '';
    const sufixo = `-${r.formato}.png`;
    const sku = file.endsWith(sufixo) ? file.slice(0, -sufixo.length) : file.replace(/\.png$/, '');
    if (!porSku.has(sku)) porSku.set(sku, r); // 1ª linha por sku (não deve haver duplicata)
  }
  return porSku;
}
function getCreativosModelo() {
  if (!_modeloRowsPromise) _modeloRowsPromise = buscarCreativosModelo();
  return _modeloRowsPromise;
}

// --- buscarProdutosRotacaoLook(): DECISÃO desta rodada — 1 ad por PRODUTO (SKU distinto), só
// no formato Story (1080x1920). Os formatos Post (1080x1350) continuam ignorados de propósito.
// Busca todas as linhas 1080x1920/produto da loja numa query só (evita N+1), agrupa por SKU
// (ordem de 1ª aparição em `order=storage_path` = ordem estável e determinística) e, pra cada
// SKU:
//   - se o SKU está em MODELO_SKUS (chaves de --modelo-map) E existe criativo produto-modelo
//     pra ele na campanha [IA] Modelo → usa esse criativo (look "modelo"), NÃO entra na
//     rotação (não consome nem avança o contador de rotação);
//   - senão, rotaciona: look = LOOKS[contador de rotação % 6], contador avança só nos produtos
//     que rotacionam (mantém o ciclo 0..5 "limpo", sem buracos pelos SKUs modelo espalhados no
//     meio da lista). Se o look sorteado não tiver linha 1080x1920 pro SKU, cai pra QUALQUER
//     linha 1080x1920 daquele SKU — nenhum produto é pulado só por causa do look.
async function buscarProdutosRotacaoLook(loja) {
  const rows = await sbGet(
    `/fabrica_criativos?select=*&campanha_id=eq.${loja.campanhaId}&arquetipo=eq.produto&formato=eq.1080x1920&order=storage_path`
  );
  const porSku = new Map(); // sku -> linhas 1080x1920 (todas as variantes) daquele SKU
  const ordemSkus = [];
  for (const r of rows) {
    const sku = skuDe(r.storage_path, r.variante, r.formato);
    if (!porSku.has(sku)) { porSku.set(sku, []); ordemSkus.push(sku); }
    porSku.get(sku).push(r);
  }
  const modeloRows = await getCreativosModelo();

  let rotIdx = 0; // contador de rotação — só avança pra SKUs que NÃO usam o criativo modelo
  return ordemSkus.map((sku) => {
    const candidatas = porSku.get(sku);
    if (MODELO_SKUS.has(sku)) {
      const modeloRow = modeloRows.get(sku);
      if (modeloRow) {
        return { sku, variante: modeloRow.variante, look: 'modelo', precoDe: modeloRow.preco_de, precoPor: modeloRow.preco_por, url: modeloRow.url };
      }
      console.warn(`  aviso: SKU ${sku} está no --modelo-map mas sem criativo produto-modelo (Story) na campanha ${CFG.MODELO_CAMPANHA} — caindo pra rotação normal`);
    }
    const lookAlvo = LOOKS[rotIdx % LOOKS.length];
    rotIdx++;
    let row = candidatas.find((r) => r.variante && r.variante.includes(lookAlvo));
    if (!row) {
      row = candidatas[0]; // fallback: nenhuma linha do look sorteado — usa qualquer 1080x1920 do SKU
      console.warn(`  aviso: SKU ${sku} sem look "${lookAlvo}" (Story) — fallback pra "${row.variante}"`);
    }
    return {
      sku,
      variante: row.variante,
      look: row.variante.includes(lookAlvo) ? lookAlvo : row.variante,
      precoDe: row.preco_de,
      precoPor: row.preco_por,
      url: row.url,
    };
  });
}

async function buscarPromoStory(loja) {
  const rows = await sbGet(`/fabrica_criativos?select=*&campanha_id=eq.${loja.campanhaId}&arquetipo=eq.promo&formato=eq.1080x1920`);
  return rows[0] || null;
}

const waLink = (loja) => 'https://wa.me/' + String(loja.whatsapp).replace(/\D/g, '');

// --- POST /adcreatives com fallback automático de instagram_actor_id -----------------------
// Tenta sempre COM IG primeiro; se cair no erro específico de "instagram_actor_id must be a
// valid Instagram account id" (gotcha do BM de rodadas anteriores — ver cabeçalho do
// arquivo), refaz sem IG e avisa no log.
async function criarAdCreative(params) {
  let r = await meta(`/${CFG.ACT}/adcreatives`, params, 'POST');
  if (r.status !== 200 && /instagram_(user|actor)_id/i.test(JSON.stringify(r.d))) {
    console.warn('  aviso: instagram_user_id rejeitado — refazendo SEM Instagram (ad roda só no Facebook)');
    const semIG = JSON.parse(JSON.stringify(params));
    if (semIG.object_story_spec) { delete semIG.object_story_spec.instagram_user_id; delete semIG.object_story_spec.instagram_actor_id; }
    r = await meta(`/${CFG.ACT}/adcreatives`, semIG, 'POST');
    params = semIG;
  }
  if (r.status !== 200 || !r.d?.id) {
    throw new Error(`POST /adcreatives falhou (status ${r.status}): ${JSON.stringify(r.d).slice(0, 800)}\npayload enviado: ${JSON.stringify(params).slice(0, 800)}`);
  }
  return { creativeId: r.d.id, payload: params };
}

// Payload do creative validado ao vivo (com Instagram — effective_instagram_media_id
// presente): object_story_spec.link_data com image_hash direto, sem asset_feed_spec (1
// formato só nesta rodada, não precisa de creative dinâmico/placement-aware).
function payloadImagemUnica({ hash, waLinkUrl, mensagem }) {
  return {
    object_story_spec: {
      page_id: CFG.PAGE,
      instagram_user_id: CFG.IG,
      link_data: {
        image_hash: hash,
        link: waLinkUrl,
        message: mensagem,
        call_to_action: { type: 'WHATSAPP_MESSAGE' },
      },
    },
  };
}

async function criarAd({ adsetId, name, creativeId }) {
  const ad = await meta(`/${CFG.ACT}/ads`, {
    name,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: 'PAUSED',
  }, 'POST');
  if (ad.status !== 200 || !ad.d?.id) {
    throw new Error(`POST /ads falhou (status ${ad.status}): ${JSON.stringify(ad.d).slice(0, 500)}`);
  }
  return ad.d.id;
}

// --- criarAdDeImagem(): upload por bytes (uploadImagemBytes) + creative (payloadImagemUnica,
// com fallback de IG) + 1 ad, PAUSED. Usado tanto pro conjunto "De x Por" (1 por produto)
// quanto pro "Geral (Promo)" (1 pro criativo promo).
async function criarAdDeImagem(loja, { adsetId, nome, storyUrl }) {
  const hash = await uploadImagemBytes(storyUrl, 'img0');
  const waLinkUrl = waLink(loja);
  const params = payloadImagemUnica({ hash, waLinkUrl, mensagem: CAPTION_PADRAO });
  const { creativeId } = await criarAdCreative(params);
  const adId = await criarAd({ adsetId, name: nome, creativeId });
  return { adId, hash };
}

async function criarCampanha(loja) {
  const campaign = await meta(`/${CFG.ACT}/campaigns`, {
    name: `[IA] ${loja.nome} · WhatsApp · ${CFG.DATA_CAMPANHA}`,
    objective: 'OUTCOME_ENGAGEMENT',
    status: 'PAUSED',
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  }, 'POST');
  if (campaign.status !== 200 || !campaign.d?.id) {
    throw new Error(`POST /campaigns falhou (status ${campaign.status}): ${JSON.stringify(campaign.d).slice(0, 500)}`);
  }
  return campaign.d.id;
}

async function criarAdSet(loja, campaignId, nomeConjunto) {
  const targeting = { geo_locations: { cities: loja.geoCities.map((key) => ({ key })) } };
  const adset = await meta(`/${CFG.ACT}/adsets`, {
    name: nomeConjunto,
    campaign_id: campaignId,
    daily_budget: CFG.DAILY_BUDGET,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'CONVERSATIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP', // conta exige estratégia de lance explícita
    destination_type: 'WHATSAPP',
    promoted_object: { page_id: CFG.PAGE, whatsapp_phone_number: loja.whatsapp },
    targeting,
    status: 'PAUSED',
  }, 'POST');
  if (adset.status !== 200 || !adset.d?.id) {
    throw new Error(`POST /adsets falhou (status ${adset.status}): ${JSON.stringify(adset.d).slice(0, 500)}`);
  }
  return adset.d.id;
}

// --- subida completa (2 lojas, PAUSED) ----------------------------------------------------
// 1 ad por produto (De x Por) + 1 ad promo (Geral) — ver DECISÃO no cabeçalho do arquivo.
async function subirConjuntoProduto(loja, campaignId) {
  const produtos = await buscarProdutosRotacaoLook(loja);
  const adsetId = await criarAdSet(loja, campaignId, 'De x Por');
  const adIds = [];
  const looksUsados = [];
  for (const p of produtos) {
    const nomeReal = await nomeProduto(p.sku);
    const nome = `${p.sku} · ${nomeReal || p.sku} · [${p.look}]`;
    const { adId } = await criarAdDeImagem(loja, { adsetId, nome, storyUrl: p.url });
    adIds.push(adId);
    looksUsados.push(p.look);
  }
  return { adsetId, adIds, count: produtos.length, looksUsados };
}

async function subirConjuntoPromo(loja, campaignId) {
  const promo = await buscarPromoStory(loja);
  const adsetId = await criarAdSet(loja, campaignId, 'Geral (Promo)');
  const adIds = [];
  if (promo) {
    const { adId } = await criarAdDeImagem(loja, { adsetId, nome: `Geral (Promo) · ${loja.nome}`, storyUrl: promo.url });
    adIds.push(adId);
  } else {
    console.warn(`  aviso: sem criativo promo (Story 1080x1920) pra ${loja.nome} — conjunto Geral (Promo) ficará sem ad`);
  }
  return { adsetId, adIds, count: adIds.length };
}

async function subirLoja(loja) {
  console.log(`\n========== ${loja.nome} ==========`);
  const campaignId = await criarCampanha(loja);
  const geral = await subirConjuntoPromo(loja, campaignId);
  const dePor = await subirConjuntoProduto(loja, campaignId);

  const job = {
    conta_id: null,
    ad_account_id: CFG.ACT,
    loja: loja.nome,
    tipo: 'whatsapp',
    meta_campaign_id: campaignId,
    adset_ids: [geral.adsetId, dePor.adsetId],
    ad_ids: [...geral.adIds, ...dePor.adIds],
    payload: {
      geoCities: loja.geoCities,
      whatsapp: loja.whatsapp,
      criativos: { promo: geral.count, produto: dePor.count },
      looks: `rotativo (${LOOKS.join('/')}, %${LOOKS.length} entre SKUs sem foto de modelo) + "modelo" pros SKUs de --modelo-map`,
      looksUsados: dePor.looksUsados,
      formato: '1080x1920',
      caption: CAPTION_PADRAO,
    },
    status: 'criado',
  };
  if (!DRY) await sbPost('/fabrica_meta_jobs', [job], 'return=minimal');
  else console.log(`\n[dry] fabrica_meta_jobs (NÃO gravado em --dry):\n${JSON.stringify(job, null, 2)}`);

  return { loja: loja.nome, campaignId, adsetIds: job.adset_ids, adCount: job.ad_ids.length };
}

// --- --dry: plano completo, sem chamadas reais ao Graph -----------------------------------
async function rodarDry() {
  const resumo = [];
  for (const loja of LOJAS) resumo.push(await subirLoja(loja));
  console.log('\n========== resumo (--dry) ==========');
  for (const r of resumo) console.log(r);
  const totalAds = resumo.reduce((s, r) => s + r.adCount, 0);
  console.log(`\ncampanhas: ${resumo.length} | conjuntos: ${resumo.length * 2} | ads: ${totalAds}`);
  console.log('(--dry) nenhuma chamada real ao Graph. Todos os ids acima são fake.');
}

async function main() {
  exigirApi();
  if (DRY) return rodarDry();

  TOKEN = await loginServico({ naApi: true });

  // Subida REAL completa (2 lojas, ~20 ads/loja).
  const resumo = [];
  for (const loja of LOJAS) resumo.push(await subirLoja(loja));
  console.log('\n========== resumo ==========');
  for (const r of resumo) console.log(r);
  const totalAds = resumo.reduce((s, r) => s + r.adCount, 0);
  console.log(`\ncampanhas: ${resumo.length} | conjuntos: ${resumo.length * 2} | ads: ${totalAds}`);
  console.log('\nsubida concluída — TUDO PAUSED. Revisar no Gerenciador de Anúncios e ativar manualmente.');
}
main().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
