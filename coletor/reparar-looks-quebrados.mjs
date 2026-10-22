#!/usr/bin/env node
// coletor/reparar-looks-quebrados.mjs
// CORREÇÃO do bug "UNDEFINED": os looks produto-split / editorial-sale / editorial-v2 subiram
// com a arte quebrada (dados.oferta ausente → "undefined" gigante estourando pra dentro da
// foto). Já corrigido em criativo-modelo.mjs (passa oferta) + templates.mjs (fallback + 1b com
// fontes/hierarquia). Este script:
//   FASE 1 — regenera SÓ esses 3 looks (Story 1080x1920) dos 2 pools ([IA] Tivoli/Dom Pedro
//            Full), sobrescrevendo o MESMO storage_path (x-upsert) → a URL não muda, os bytes
//            ficam corrigidos. Nada é criado/duplicado.
//   FASE 2 — (só com --subir) sobe 1 ad PAUSED por produto desses looks DENTRO dos adsets
//            "De x Por" JÁ EXISTENTES das campanhas ao vivo. NÃO cria campanha/adset novo, NÃO
//            toca nos 24 ads bons/ativos.
// Uso:  node --import ./lib/curl-fetch.mjs reparar-looks-quebrados.mjs            # só regenera
//       node --import ./lib/curl-fetch.mjs reparar-looks-quebrados.mjs --subir    # regen + sobe
import './lib/carregar-env.mjs';
import { loginServico } from './lib/bling-comercial.mjs';
import { fotoDataUrl } from './lib/foto-produto.mjs';
import { renderPNG, fecharRender } from './lib/render-criativo.mjs';
import { TEMPLATES, DIM } from './templates-criativos/templates.mjs';
import { variacoesProduto } from './lib/criativo-modelo.mjs';
import { gerarCopysProduto } from './lib/copy-efeito.mjs';

const SUBIR = process.argv.includes('--subir');
// --regen-looks a,b limita a FASE 1 a esses looks (default: os 3). A FASE 2 sempre usa os 3.
const REGEN_LOOKS = process.argv.includes('--regen-looks')
  ? process.argv[process.argv.indexOf('--regen-looks') + 1].split(',').map((s) => s.trim()).filter(Boolean)
  : null;
const PULAR_REGEN = process.argv.includes('--pular-regen');
const URL = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY || '';
const REST = URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
const BUCKET = 'fabrica-criativos';
const sane = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '_');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CFG = {
  ACCOUNT_ID: 'b6883e82-07cb-4f21-9fd7-ea7626786174',
  ACT: 'act_1197997517858139',
  PAGE: '324679337390168',
  IG: '17841462952561833',
  MODELO_CAMPANHA: '199723e1-d0a6-4aaa-b718-a083844512ec',
};
const CAPTION_PADRAO = '50% OFF em bolsas La Vessel · chame no WhatsApp 💬';
const BROKEN = ['produto-split', 'editorial-sale', 'editorial-v2'];
const MODELO_SKUS = new Set(['LV1030-Preto', 'LV1040-Preto', 'LV1047-Preto', 'LV1072-CG_Preto', 'LV1090-Platinum', 'LV1130-Preto', 'LV1162-Preto']);
const LOOKS = ['produto-heroi', 'produto-sage-circulo', 'produto-preco-tipo', 'produto-split', 'editorial-sale', 'editorial-v2'];

const LOJAS = [
  { nome: 'Tivoli', pool: 'cd67464d-aa25-4af1-826e-edb3b249f71f', adsetDePor: '120248971668460342', whatsapp: '+5519971690502', esperado: 8 },
  { nome: 'Dom Pedro', pool: 'b8fce4bf-88ae-4854-bf82-6878a164f3dc', adsetDePor: '120248971714550342', whatsapp: '+5519999545112', esperado: 6 },
];

let TOKEN;

// --- Supabase REST/Storage ---------------------------------------------------------------
async function sbGet(p) { const r = await fetch(REST + p, { headers: H }); if (!r.ok) throw new Error('GET ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200)); return r.json(); }
async function subirStorage(path, buf) {
  let ultimo;
  for (let t = 1; t <= 10; t++) {
    try {
      const r = await fetch(`${URL}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: buf });
      if (r.ok) return `${URL}/storage/v1/object/public/${BUCKET}/${path}`;
      ultimo = new Error('upload ' + path + ' ' + r.status + ' ' + (await r.text()).slice(0, 120));
    } catch (e) { ultimo = e; }
    if (t < 10) { console.warn(`  [storage retry ${t}/9] ${path.split('/').pop()}: ${ultimo.message.slice(0, 60)}`); await sleep(Math.min(1500 * t, 8000)); }
  }
  throw ultimo;
}

// --- meta-proxy (com retry) --------------------------------------------------------------
async function chamarProxy(body) {
  for (let t = 1; t <= 5; t++) {
    try {
      const r = await fetch(URL + '/functions/v1/meta-proxy', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if ((r.status === 429 || r.status >= 500 || d?.error?.code === 17 || d?.error?.code === 4) && t < 5) { await sleep(2000 * t); continue; }
      return { status: r.status, d };
    } catch (e) { if (t < 5) { await sleep(2000 * t); continue; } throw e; }
  }
  return { status: 599, d: { error: 'retries esgotados' } };
}
const meta = (path, params = {}, method = 'GET') => chamarProxy({ accountId: CFG.ACCOUNT_ID, path, params, method });
async function uploadImagemBytes(url) {
  const r = await chamarProxy({ accountId: CFG.ACCOUNT_ID, path: `/${CFG.ACT}/adimages`, method: 'POST', imageFromUrl: url, imageField: 'img0' });
  if (r.status !== 200 || !r.d?.images) throw new Error('adimages falhou: ' + JSON.stringify(r.d).slice(0, 400));
  const hash = Object.values(r.d.images)[0]?.hash;
  if (!hash) throw new Error('adimages sem hash: ' + JSON.stringify(r.d).slice(0, 400));
  return hash;
}
const waLink = (loja) => 'https://wa.me/' + String(loja.whatsapp).replace(/\D/g, '');
async function criarAdCreative(params) {
  let r = await meta(`/${CFG.ACT}/adcreatives`, params, 'POST');
  if (r.status !== 200 && /instagram_(user|actor)_id/i.test(JSON.stringify(r.d))) {
    const semIG = JSON.parse(JSON.stringify(params));
    if (semIG.object_story_spec) { delete semIG.object_story_spec.instagram_user_id; delete semIG.object_story_spec.instagram_actor_id; }
    r = await meta(`/${CFG.ACT}/adcreatives`, semIG, 'POST');
  }
  if (r.status !== 200 || !r.d?.id) throw new Error('adcreatives falhou: ' + JSON.stringify(r.d).slice(0, 500));
  return r.d.id;
}
async function criarAdDeImagem(loja, adsetId, nome, storyUrl) {
  const hash = await uploadImagemBytes(storyUrl);
  const params = { object_story_spec: { page_id: CFG.PAGE, instagram_user_id: CFG.IG, link_data: { image_hash: hash, link: waLink(loja), message: CAPTION_PADRAO, call_to_action: { type: 'WHATSAPP_MESSAGE' } } } };
  const creativeId = await criarAdCreative(params);
  const ad = await meta(`/${CFG.ACT}/ads`, { name: nome, adset_id: adsetId, creative: { creative_id: creativeId }, status: 'PAUSED' }, 'POST');
  if (ad.status !== 200 || !ad.d?.id) throw new Error('ads falhou: ' + JSON.stringify(ad.d).slice(0, 400));
  return ad.d.id;
}

// --- helpers de dados --------------------------------------------------------------------
function skuDe(storagePath, variante, formato) {
  const file = (storagePath || '').split('/').pop() || '';
  const sufixo = `-${variante}-${formato}.png`;
  return file.endsWith(sufixo) ? file.slice(0, -sufixo.length) : file.replace(/\.png$/, '');
}
const nomeCache = new Map();
async function nomeProduto(skuSane) {
  if (nomeCache.has(skuSane)) return nomeCache.get(skuSane);
  let rows = await sbGet(`/gc_vendas_item?select=produto&sku=eq.${encodeURIComponent(skuSane)}&limit=1`);
  if (!rows.length) { const e = skuSane.replace(/_/g, ' '); if (e !== skuSane) rows = await sbGet(`/gc_vendas_item?select=produto&sku=eq.${encodeURIComponent(e)}&limit=1`); }
  const nome = rows[0]?.produto || null; nomeCache.set(skuSane, nome); return nome;
}

// replica buscarProdutosRotacaoLook() do motor pro pool dado (mesma rotação determinística)
let _modeloRows;
async function modeloRowsMap() {
  if (_modeloRows) return _modeloRows;
  const rows = await sbGet(`/fabrica_criativos?select=*&campanha_id=eq.${CFG.MODELO_CAMPANHA}&arquetipo=eq.produto&formato=eq.1080x1920&order=storage_path`);
  const m = new Map();
  for (const r of rows) { const file = (r.storage_path || '').split('/').pop() || ''; const suf = `-${r.formato}.png`; const sku = file.endsWith(suf) ? file.slice(0, -suf.length) : file.replace(/\.png$/, ''); if (!m.has(sku)) m.set(sku, r); }
  _modeloRows = m; return m;
}
async function rotacaoLook(pool) {
  const rows = await sbGet(`/fabrica_criativos?select=*&campanha_id=eq.${pool}&arquetipo=eq.produto&formato=eq.1080x1920&order=storage_path`);
  const porSku = new Map(); const ordem = [];
  for (const r of rows) { const sku = skuDe(r.storage_path, r.variante, r.formato); if (!porSku.has(sku)) { porSku.set(sku, []); ordem.push(sku); } porSku.get(sku).push(r); }
  const modelo = await modeloRowsMap();
  let rot = 0;
  return ordem.map((sku) => {
    const cands = porSku.get(sku);
    if (MODELO_SKUS.has(sku) && modelo.get(sku)) { const mr = modelo.get(sku); return { sku, look: 'modelo', url: mr.url }; }
    const lookAlvo = LOOKS[rot % LOOKS.length]; rot++;
    let row = cands.find((r) => r.variante && r.variante.includes(lookAlvo)) || cands[0];
    return { sku, look: row.variante.includes(lookAlvo) ? lookAlvo : row.variante, url: row.url };
  });
}

// ==========================================================================================
async function fase1Regen(loja) {
  console.log(`\n--- FASE 1 regen [${loja.nome}] pool ${loja.pool.slice(0, 8)} ---`);
  const rows = await sbGet(`/fabrica_criativos?select=*&campanha_id=eq.${loja.pool}&arquetipo=eq.produto&formato=eq.1080x1920&order=storage_path`);
  const looksRegen = REGEN_LOOKS || BROKEN;
  const alvo = rows.filter((r) => looksRegen.some((b) => (r.variante || '').includes(b)));
  console.log(`  linhas 1080x1920 nos 3 looks quebrados: ${alvo.length}`);
  // Nome do produto por sku via gc_vendas_item (fabrica_candidatos foi aposentada na migration 019).
  const porSku = new Map();
  for (const r of alvo) { const sku = skuDe(r.storage_path, r.variante, r.formato); if (!porSku.has(sku)) porSku.set(sku, { sku, nome: (await nomeProduto(sane(sku))) || sku }); }
  const copys = await gerarCopysProduto([...porSku.values()], { desconto_tipo: 'fixo', desconto_pct: 50, parcelas: 10 });
  const fotoCache = new Map();
  let ok = 0, pulados = 0, falhas = [];
  for (const r of alvo) {
    const sku = skuDe(r.storage_path, r.variante, r.formato);
    if (!fotoCache.has(sku)) fotoCache.set(sku, await fotoDataUrl(TOKEN, sku));
    const foto = fotoCache.get(sku);
    if (!foto) { console.warn(`  sem foto, pulado: ${sku} (${r.variante})`); pulados++; continue; }
    const ci = copys.get(sku) || {};
    const preco = r.preco_de != null ? Number(r.preco_de) : null;
    if (preco == null) { console.warn(`  sem preco_de, pulado: ${sku}`); pulados++; continue; }
    const modoParcelado = /-parcelado$/.test(r.variante || '');
    const look = (r.variante || '').replace(/-(avista|parcelado)$/, '');
    const vars = variacoesProduto({ sku, preco, fotoDataUrl: foto }, { desconto_tipo: 'fixo', desconto_pct: 50, parcelas: 10 }, { looks: [look], modos: [modoParcelado] });
    const v = vars.find((x) => x.formato === r.formato && x.variante === r.variante);
    if (!v) { console.warn(`  variante ${r.variante} não reproduzida p/ ${sku}, pulado`); pulados++; continue; }
    v.dados.nome = ci.nome || v.dados.nome; v.dados.copyEfeito = ci.copy;
    const buf = await renderPNG(TEMPLATES[v.template].render(v.dados, v.formato), DIM[v.formato]);
    try { await subirStorage(r.storage_path, buf); ok++; } // MESMO path → mesma URL, bytes corrigidos
    catch (e) { console.warn(`  [falha upload, na fila de mop-up] ${r.storage_path.split('/').pop()}`); falhas.push({ path: r.storage_path, buf }); }
  }
  // mop-up: retenta uploads que falharam, em rodadas, até zerar ou esgotar
  for (let rodada = 1; falhas.length && rodada <= 8; rodada++) {
    console.log(`  mop-up rodada ${rodada}: ${falhas.length} pendentes`);
    const aindaFalha = [];
    for (const f of falhas) { try { await subirStorage(f.path, f.buf); ok++; } catch { aindaFalha.push(f); } }
    falhas = aindaFalha;
    if (falhas.length) await sleep(5000);
  }
  console.log(`  regenerados (sobrescritos in-place): ${ok} | pulados: ${pulados} | falhas persistentes: ${falhas.length}`);
}

async function fase2Subir(loja) {
  console.log(`\n--- FASE 2 subir [${loja.nome}] adset De x Por ${loja.adsetDePor} ---`);
  const produtos = (await rotacaoLook(loja.pool)).filter((p) => BROKEN.includes(p.look));
  console.log(`  produtos nos 3 looks: ${produtos.length} (esperado ${loja.esperado})`);
  if (produtos.length !== loja.esperado) console.warn(`  ATENÇÃO: contagem diferente do esperado — conferir antes de confiar.`);
  const adIds = [];
  for (const p of produtos) {
    const nomeReal = await nomeProduto(sane(p.sku));
    const nome = `${p.sku} · ${nomeReal || p.sku} · [${p.look}]`;
    const adId = await criarAdDeImagem(loja, loja.adsetDePor, nome, p.url);
    adIds.push(adId);
    console.log(`  + ad ${adId}  ${nome.slice(0, 60)}`);
  }
  console.log(`  subidos PAUSED: ${adIds.length}`);
  return adIds;
}

async function main() {
  TOKEN = await loginServico();
  if (!PULAR_REGEN) { for (const loja of LOJAS) await fase1Regen(loja); }
  await fecharRender();
  if (!SUBIR) { console.log('\n== FASE 1 concluída (regen in-place). Rode com --subir pra subir os ads PAUSED. =='); return; }
  const resumo = [];
  for (const loja of LOJAS) resumo.push({ loja: loja.nome, adIds: await fase2Subir(loja) });
  console.log('\n========== resumo ==========');
  for (const r of resumo) console.log(`${r.loja}: ${r.adIds.length} ads PAUSED subidos`);
  console.log('\nreparo concluído — ads novos TODOS PAUSED, nos adsets existentes. Nenhum ad bom/ativo foi tocado.');
}
main().catch(async (e) => { await fecharRender(); console.error('FALHOU:', e.message); process.exit(1); });
