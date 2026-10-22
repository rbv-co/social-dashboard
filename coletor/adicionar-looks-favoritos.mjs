#!/usr/bin/env node
// coletor/adicionar-looks-favoritos.mjs
// Adiciona ~28 ads NOVOS (PAUSED) nas campanhas ao vivo, usando os looks favoritos do Breno:
//   4=produto-split, 5=editorial-sale, 7=produto-modelo (SKUs com foto de pessoa), 10=promo-minimal-pearl
// Mantém os 32 atuais intactos. Renderiza FRESCO (recorte BiRefNet novo — não reaproveita o
// storage antigo com isnet). Sobe nos adsets EXISTENTES (De×Por p/ produto, Geral p/ promo).
// Uso: node --import ./lib/curl-fetch.mjs adicionar-looks-favoritos.mjs [--dry] [--por-loja 14]
import './lib/carregar-env.mjs';
import { loginServico } from './lib/bling-comercial.mjs';
import { fotoDataUrl } from './lib/foto-produto.mjs';
import { renderPNG, fecharRender } from './lib/render-criativo.mjs';
import { TEMPLATES, DIM } from './templates-criativos/templates.mjs';
import { variacoesProduto, precoDePor } from './lib/criativo-modelo.mjs';
import { gerarCopysProduto } from './lib/copy-efeito.mjs';
import { readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DRY = process.argv.includes('--dry');
const ONLY_SKU = process.argv.includes('--only-sku') ? process.argv[process.argv.indexOf('--only-sku') + 1] : null;
const ONLY_LOJA = process.argv.includes('--only-loja') ? process.argv[process.argv.indexOf('--only-loja') + 1] : null;
const ONLY_LOOK = process.argv.includes('--only-look') ? process.argv[process.argv.indexOf('--only-look') + 1] : null;
const POR_LOJA = process.argv.includes('--por-loja') ? Number(process.argv[process.argv.indexOf('--por-loja') + 1]) : 14;
const URL = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY || '';
const REST = URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
const BUCKET = 'fabrica-criativos';
const CUTOUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fotos-cutout');
const sane = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '_');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CFG = { ACCOUNT_ID: 'b6883e82-07cb-4f21-9fd7-ea7626786174', ACT: 'act_1197997517858139', PAGE: '324679337390168', IG: '17841462952561833', MODELO_CAMPANHA: '199723e1-d0a6-4aaa-b718-a083844512ec' };
const CAPTION = '50% OFF em bolsas La Vessel · chame no WhatsApp 💬';
const CAMPANHA = { desconto_tipo: 'fixo', desconto_pct: 50, parcelas: 10 };
const MODELO_SKUS = new Set(['LV1030-Preto', 'LV1040-Preto', 'LV1047-Preto', 'LV1072-CG_Preto', 'LV1090-Platinum', 'LV1130-Preto', 'LV1162-Preto']);
const LOOKS_ROT = ['produto-heroi', 'produto-sage-circulo', 'produto-preco-tipo', 'produto-split', 'editorial-sale', 'editorial-v2'];
const FAV_PRODUTO = ['produto-split', 'editorial-sale']; // 4 e 5
const FMT = '1080x1920';

const LOJAS = [
  { nome: 'Tivoli', pool: 'cd67464d-aa25-4af1-826e-edb3b249f71f', adsetDePor: '120248971668460342', adsetPromo: '120248971666930342', whatsapp: '+5519971690502' },
  { nome: 'Dom Pedro', pool: 'b8fce4bf-88ae-4854-bf82-6878a164f3dc', adsetDePor: '120248971714550342', adsetPromo: '120248971711700342', whatsapp: '+5519999545112' },
];
let TOKEN;

// ---- Supabase ----
async function sbGet(p) { const r = await fetch(REST + p, { headers: H }); if (!r.ok) throw new Error('GET ' + p + ' ' + r.status); return r.json(); }
async function subirStorage(path, buf) {
  let ultimo;
  for (let t = 1; t <= 10; t++) {
    try { const r = await fetch(`${URL}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: buf }); if (r.ok) return `${URL}/storage/v1/object/public/${BUCKET}/${path}`; ultimo = new Error('upload ' + r.status); } catch (e) { ultimo = e; }
    if (t < 10) await sleep(Math.min(1500 * t, 8000));
  }
  throw ultimo;
}
// ---- meta-proxy ----
async function chamarProxy(body) {
  for (let t = 1; t <= 6; t++) {
    try { const r = await fetch(URL + '/functions/v1/meta-proxy', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json(); if ((r.status === 429 || r.status >= 500 || d?.error?.code === 17 || d?.error?.code === 4) && t < 6) { await sleep(3000 * t); continue; } return { status: r.status, d }; } catch (e) { if (t < 6) { await sleep(3000 * t); continue; } throw e; }
  }
  return { status: 599, d: { error: 'retries' } };
}
const meta = (path, params = {}, method = 'GET') => chamarProxy({ accountId: CFG.ACCOUNT_ID, path, params, method });
async function uploadImagemBytes(url) { const r = await chamarProxy({ accountId: CFG.ACCOUNT_ID, path: `/${CFG.ACT}/adimages`, method: 'POST', imageFromUrl: url, imageField: 'img0' }); if (r.status !== 200 || !r.d?.images) throw new Error('adimages: ' + JSON.stringify(r.d).slice(0, 300)); const h = Object.values(r.d.images)[0]?.hash; if (!h) throw new Error('adimages sem hash'); return h; }
const waLink = (l) => 'https://wa.me/' + String(l.whatsapp).replace(/\D/g, '');
async function criarAdCreative(params) {
  let r = await meta(`/${CFG.ACT}/adcreatives`, params, 'POST');
  if (r.status !== 200 && /instagram_(user|actor)_id/i.test(JSON.stringify(r.d))) { const s = JSON.parse(JSON.stringify(params)); if (s.object_story_spec) { delete s.object_story_spec.instagram_user_id; delete s.object_story_spec.instagram_actor_id; } r = await meta(`/${CFG.ACT}/adcreatives`, s, 'POST'); }
  if (r.status !== 200 || !r.d?.id) throw new Error('adcreatives: ' + JSON.stringify(r.d).slice(0, 400)); return r.d.id;
}
async function subirAd(loja, adsetId, nome, storyUrl) {
  const hash = await uploadImagemBytes(storyUrl);
  const params = { object_story_spec: { page_id: CFG.PAGE, instagram_user_id: CFG.IG, link_data: { image_hash: hash, link: waLink(loja), message: CAPTION, call_to_action: { type: 'WHATSAPP_MESSAGE' } } } };
  const creativeId = await criarAdCreative(params);
  const ad = await meta(`/${CFG.ACT}/ads`, { name: nome, adset_id: adsetId, creative: { creative_id: creativeId }, status: 'PAUSED' }, 'POST');
  if (ad.status !== 200 || !ad.d?.id) throw new Error('ads: ' + JSON.stringify(ad.d).slice(0, 300)); return ad.d.id;
}
// ---- dados ----
function skuDe(sp, v, f) { const file = (sp || '').split('/').pop() || ''; const suf = `-${v}-${f}.png`; return file.endsWith(suf) ? file.slice(0, -suf.length) : file.replace(/\.png$/, ''); }
const nomeCache = new Map();
async function nomeProduto(skuSane) { if (nomeCache.has(skuSane)) return nomeCache.get(skuSane); let rows = await sbGet(`/gc_vendas_item?select=produto&sku=eq.${encodeURIComponent(skuSane)}&limit=1`); if (!rows.length) { const e = skuSane.replace(/_/g, ' '); if (e !== skuSane) rows = await sbGet(`/gc_vendas_item?select=produto&sku=eq.${encodeURIComponent(e)}&limit=1`); } const n = rows[0]?.produto || null; nomeCache.set(skuSane, n); return n; }

// rotação determinística do pool (mesma do motor) — pra saber o look "assigned" de cada produto
let _modelo;
async function modeloMap() { if (_modelo) return _modelo; const rows = await sbGet(`/fabrica_criativos?select=*&campanha_id=eq.${CFG.MODELO_CAMPANHA}&arquetipo=eq.produto&formato=eq.${FMT}&order=storage_path`); const m = new Map(); for (const r of rows) { const file = (r.storage_path || '').split('/').pop() || ''; const suf = `-${r.formato}.png`; const sku = file.endsWith(suf) ? file.slice(0, -suf.length) : file.replace(/\.png$/, ''); if (!m.has(sku)) m.set(sku, r); } _modelo = m; return m; }
async function produtosPool(pool) {
  const rows = await sbGet(`/fabrica_criativos?select=*&campanha_id=eq.${pool}&arquetipo=eq.produto&formato=eq.${FMT}&order=storage_path`);
  const porSku = new Map(); const ordem = [];
  for (const r of rows) { const sku = skuDe(r.storage_path, r.variante, r.formato); if (!porSku.has(sku)) { porSku.set(sku, r); ordem.push(sku); } }
  const modelo = await modeloMap();
  let rot = 0;
  return ordem.map((sku) => { const row = porSku.get(sku); if (MODELO_SKUS.has(sku) && modelo.get(sku)) return { sku, assigned: 'modelo', preco_de: row.preco_de }; const look = LOOKS_ROT[rot % LOOKS_ROT.length]; rot++; return { sku, assigned: look, preco_de: row.preco_de }; });
}

function limparCutoutCache() { try { for (const f of readdirSync(CUTOUT_DIR)) { try { unlinkSync(join(CUTOUT_DIR, f)); } catch {} } } catch {} }

async function planoLoja(loja) {
  const produtos = await produtosPool(loja.pool);
  const modelo = await modeloMap();
  const prod = [], mod = [];
  for (const p of produtos) {
    for (const fav of FAV_PRODUTO) if (fav !== p.assigned) prod.push({ sku: p.sku, look: fav, preco_de: p.preco_de, tipo: 'produto' });
    if (MODELO_SKUS.has(p.sku) && p.assigned !== 'modelo' && modelo.get(p.sku)) mod.push({ sku: p.sku, look: 'produto-modelo', url: modelo.get(p.sku).url, tipo: 'modelo' });
  }
  // produto-fav (split/editorial) + modelo (se algum SKU sem modelo ainda) enchem POR_LOJA-1;
  // +1 promo-minimal-pearl. (Look 7=modelo já está 100% no ar nos 7 SKUs com foto de pessoa.)
  const base = [...prod, ...mod];
  const plano = base.slice(0, POR_LOJA - 1);
  // minimal-pearl (look 10) mostra nome + De/Por → usa um produto real de referência
  const hero = base.find((x) => x.tipo === 'produto');
  plano.push({ look: 'promo-minimal-pearl', tipo: 'promo', sku: hero?.sku, preco_de: hero?.preco_de });
  return plano;
}

// render resiliente: se o Chromium cair (Protocol error/Connection closed/Target closed),
// fecha o singleton e relança, tentando de novo.
async function renderResiliente(html, dim) {
  let ultimo;
  for (let t = 0; t < 4; t++) {
    try { return await renderPNG(html, dim); }
    catch (e) { ultimo = e; if (/Protocol error|Connection closed|Target closed|Session closed|browser has disconnected/i.test(e.message)) { await fecharRender().catch(() => {}); await sleep(2000); continue; } throw e; }
  }
  throw ultimo;
}

async function gerarUploadProduto(loja, item, foto, copy) {
  const vars = variacoesProduto({ sku: item.sku, preco: Number(item.preco_de), fotoDataUrl: foto }, CAMPANHA, { looks: [item.look], modos: [false] });
  const v = vars.find((x) => x.formato === FMT);
  v.dados.nome = copy?.nome || v.dados.nome; v.dados.copyEfeito = copy?.copy;
  const buf = await renderResiliente(TEMPLATES[v.template].render(v.dados, FMT), DIM[FMT]);
  const url = await subirStorage(`favoritos/${sane(item.sku)}-${item.look}-${FMT}.png`, buf);
  const nomeReal = await nomeProduto(sane(item.sku));
  return subirAd(loja, loja.adsetDePor, `${item.sku} · ${nomeReal || item.sku} · [${item.look}]`, url);
}
async function gerarUploadPromo(loja, item, foto, copy) {
  const { de, por } = precoDePor(Number(item.preco_de) || 0, 50);
  const dados = { oferta: '50%', nome: copy?.nome || 'Coleção', precoDe: de, precoPor: por, copyEfeito: copy?.copy, fotoDataUrl: foto, eyebrow: 'Season Sale', cta: 'Eu quero a minha' };
  const buf = await renderResiliente(TEMPLATES['promo-minimal-pearl'].render(dados, FMT), DIM[FMT]);
  const url = await subirStorage(`favoritos/promo-minimal-pearl-${sane(loja.nome)}-${FMT}.png`, buf);
  return subirAd(loja, loja.adsetPromo, `Geral (Minimal Pearl · ${item.sku || loja.nome})`, url);
}

const fotoCache = new Map();

async function main() {
  TOKEN = await loginServico();
  // monta planos das 2 lojas
  const planos = [];
  for (const loja of LOJAS) {
    if (ONLY_LOJA && loja.nome !== ONLY_LOJA) continue;
    let plano = await planoLoja(loja);
    if (ONLY_SKU) plano = plano.filter((x) => x.sku === ONLY_SKU); // mop-up de SKU específico
    if (ONLY_LOOK) plano = plano.filter((x) => x.look === ONLY_LOOK); // mop-up de look específico
    const cont = {}; plano.forEach((x) => cont[x.look] = (cont[x.look] || 0) + 1);
    console.log(`\n=== ${loja.nome}: ${plano.length} novos === ${JSON.stringify(cont)}`);
    plano.forEach((x) => console.log('   +', x.look, x.sku || '(coleção)'));
    planos.push({ loja, plano });
  }
  if (DRY) { console.log('\n========== resumo =========='); let t = 0; for (const { loja, plano } of planos) { console.log(`${loja.nome}: ${plano.length} planejados`); t += plano.length; } console.log(`TOTAL novos: ${t} (--dry, nada subiu)`); return; }

  // SKUs (distintos) que precisam de foto/cutout — inclui o hero dos itens promo
  const skusProd = [...new Set(planos.flatMap(({ plano }) => plano.filter((x) => x.tipo === 'produto' || x.tipo === 'promo').map((x) => x.sku).filter(Boolean)))];

  // ── FASE 1: pré-recorte BiRefNet de todos os SKUs (Chromium ocioso; recortar.py roda e sai) ──
  limparCutoutCache(); // força recorte BiRefNet novo
  console.log(`\n--- FASE 1: recorte BiRefNet de ${skusProd.length} SKUs ---`);
  for (const sku of skusProd) {
    try { fotoCache.set(sku, await fotoDataUrl(TOKEN, sku)); process.stdout.write('.'); }
    catch (e) { console.warn('\n  cutout falhou', sku, e.message.slice(0, 60)); }
  }
  await fecharRender().catch(() => {}); // browser fresco pra fase 2
  console.log(`\n  recortados: ${[...fotoCache.values()].filter(Boolean).length}/${skusProd.length}`);

  // copy em lote (nome curto + copyEfeito) pros produtos
  const nomes = await Promise.all(skusProd.map(async (s) => ({ sku: s, nome: (await nomeProduto(sane(s))) || s })));
  const copys = skusProd.length ? await gerarCopysProduto(nomes, CAMPANHA) : new Map();

  // ── FASE 2: render + upload (só Chromium; BiRefNet não roda mais) ──
  console.log('\n--- FASE 2: render + upload PAUSED ---');
  const resumo = [];
  for (const { loja, plano } of planos) {
    console.log(`\n[${loja.nome}]`);
    let ok = 0;
    for (const item of plano) {
      try {
        if (item.tipo === 'produto') { const foto = fotoCache.get(item.sku); if (!foto) { console.warn('  sem foto:', item.sku); continue; } const id = await gerarUploadProduto(loja, item, foto, copys.get(item.sku)); console.log('  + ad', id, item.look, item.sku); ok++; }
        else if (item.tipo === 'modelo') { const id = await subirAd(loja, loja.adsetDePor, `${item.sku} · [produto-modelo]`, item.url); console.log('  + ad', id, 'modelo', item.sku); ok++; }
        else if (item.tipo === 'promo') { const foto = fotoCache.get(item.sku) || [...fotoCache.values()].find(Boolean); const id = await gerarUploadPromo(loja, item, foto, copys.get(item.sku)); console.log('  + ad', id, 'promo-minimal-pearl', item.sku || ''); ok++; }
      } catch (e) { console.warn('  FALHOU', item.look, item.sku || '', '-', e.message.slice(0, 80)); }
    }
    resumo.push({ loja: loja.nome, n: ok });
  }
  await fecharRender();
  console.log('\n========== resumo ==========');
  let tot = 0; for (const r of resumo) { console.log(`${r.loja}: ${r.n} ${DRY ? 'planejados' : 'ads PAUSED subidos'}`); tot += r.n; }
  console.log(`TOTAL novos: ${tot}${DRY ? ' (--dry, nada subiu)' : ' — PAUSED nos adsets existentes'}`);
}
main().catch(async (e) => { await fecharRender(); console.error('FALHOU:', e.message); process.exit(1); });
