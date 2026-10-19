// PASSO 5 do agente: FAXINA do bucket ig-cache (evita crescer pra sempre).
// GC seguro: mantém a mídia da rodada MAIS RECENTE DE CADA MARCA (= o que o front mostra via maxRod)
// + todos os logos (logo/*). Apaga só o órfão dentro das pastas de handles ativos. DRY=1 só lista.
import fs from 'fs';
import { abrirRest } from './lib/rest-pg.mjs';

const env = {};
try { for (const l of fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (e) {}
const URL_SB = process.env.SUPABASE_URL || env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_KEY;
const R = await abrirRest({ ...env, ...process.env }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
const BUCKET = 'ig-cache';
const DRY = process.env.DRY === '1';
const sbH = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const jh = { ...sbH, 'Content-Type': 'application/json' };

async function get(path) { const r = await R.fetch(R.REST + '/' + path, { headers: R.sb }); if (!r.ok) throw new Error('GET ' + path + ' ' + r.status); return r.json(); }

// 1) conjunto a MANTER = mídia da rodada mais recente de cada marca
const rows = await get('noticias_concorrentes?select=marca,rodada,produtos,imagem_url&order=rodada.desc');
const maxRodOf = {}; for (const r of rows) { if (!maxRodOf[r.marca] || r.rodada > maxRodOf[r.marca]) maxRodOf[r.marca] = r.rodada; }
const keep = new Set();
const pathOf = u => { const m = String(u || '').match(/\/ig-cache\/(.+?)(\?|$)/); return m ? decodeURIComponent(m[1]) : null; };
for (const r of rows) {
  if (r.rodada !== maxRodOf[r.marca]) continue;          // só a edição vigente de cada marca
  const p1 = pathOf(r.imagem_url); if (p1) keep.add(p1);
  for (const p of (Array.isArray(r.produtos) ? r.produtos : [])) { const a = pathOf(p.img); if (a) keep.add(a); const b = pathOf(p.video); if (b) keep.add(b); }
}
const handles = new Set([...keep].map(p => p.split('/')[0]).filter(h => h && h !== 'logo'));
console.log(`Faxina ig-cache${DRY ? ' (DRY)' : ''} · manter ${keep.size} mídias · ${handles.size} handles ativos`);

// TRAVA: se o keep vier vazio (query falhou), NÃO apaga nada.
if (keep.size < 20) { console.error('✗ conjunto-a-manter suspeito (' + keep.size + ') — abortando por segurança.'); await R.fechar(); process.exit(0); }

// 2) lista cada pasta de handle ativo e apaga o que não está no keep (logo/* nunca entra aqui)
async function listFolder(prefix) {
  const out = []; let offset = 0;
  for (;;) {
    const r = await fetch(`${URL_SB}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: jh, body: JSON.stringify({ prefix: prefix + '/', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }) });
    if (!r.ok) break;
    const arr = await r.json(); if (!Array.isArray(arr) || !arr.length) break;
    for (const o of arr) if (o && o.name && o.id) out.push(prefix + '/' + o.name);
    if (arr.length < 1000) break; offset += 1000;
  }
  return out;
}
let del = 0, kept = 0, fail = 0;
// Em pg o bucket ig-cache ainda é do Supabase (Storage só migra na fase 2): a limpeza de mídia fica fora, a do banco segue.
if (R.via === 'pg') console.log('Faxina storage: pulada (Storage fica na fase 2 da virada).');
else for (const h of handles) {
  const objs = await listFolder(h);
  for (const path of objs) {
    if (keep.has(path)) { kept++; continue; }
    if (DRY) { del++; continue; }
    const r = await fetch(`${URL_SB}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: sbH });
    if (r.ok) del++; else fail++;
  }
}
if (R.via !== 'pg') console.log(`Faxina storage: mantidas ${kept} · ${DRY ? 'a apagar' : 'apagadas'} ${del}${fail ? ' · falhas ' + fail : ''}.`);

// 3) PRUNE do BANCO: mantém as N rodadas mais recentes (números p/ histórico), apaga as antigas.
const KEEP_ROD = 8;
const rods = [...new Set(rows.map(r => r.rodada).filter(Boolean))].sort().reverse();
if (rods.length > KEEP_ROD) {
  const cutoff = rods[KEEP_ROD - 1]; // a 8ª edição mais recente
  if (DRY) console.log(`prune DB (DRY): apagaria rodadas < ${cutoff} (${rods.length - KEEP_ROD} edições antigas)`);
  else {
    const r = await R.fetch(`${R.REST}/noticias_concorrentes?rodada=lt.${cutoff}`, { method: 'DELETE', headers: { ...R.sb, 'Content-Type': 'application/json' } });
    console.log(`prune DB: rodadas < ${cutoff} → ${r.ok ? 'apagadas' : 'falha ' + r.status}`);
  }
} else console.log(`prune DB: ${rods.length} edições (≤${KEEP_ROD}) — nada a apagar.`);
await R.fechar();
