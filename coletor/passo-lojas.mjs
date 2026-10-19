// PASSO 1 do agente semanal: coleta best-sellers + novidades de TODAS as lojas (lojas.mjs) e grava.
// Determinístico (sem LLM). RODADA = env ou hoje (BR). Idempotente por marca+rodada+categoria.
import fs from 'fs';
import { coletarLoja, LOJAS } from './lojas.mjs';
import { abrirRest } from './lib/rest-pg.mjs';

const env = {};
try { for (const l of fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (e) {}
const RODADA = process.env.RODADA || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const DRY = process.env.DRY === '1';
// REST_VIA_PG=1 (plano 03 da virada): o mesmo caminho vira SQL no api-db; sem a flag segue o REST do Supabase.
const R = await abrirRest({ ...env, ...process.env }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
async function rest(method, path, body) {
  const r = await R.fetch(R.REST + '/' + path, { method, headers: { ...R.sb, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(method + ' ' + path + ' → ' + r.status + ' ' + t.slice(0, 160)); return t ? JSON.parse(t) : null;
}
const base = { url: null, fonte: null, data_publicacao: RODADA, rodada: RODADA, destaque: false, imagem_url: null, produtos: null, resumo: null };

console.log(`PASSO lojas · rodada ${RODADA}${DRY ? ' (DRY)' : ''} · ${Object.keys(LOJAS).length} marcas`);
let okG = 0;
for (const marca of Object.keys(LOJAS)) {
  try {
    const r = await coletarLoja(marca);
    const best = (r.bestsellers || []).filter(p => p.img && p.nome);
    const nov = (r.novidades || []).filter(p => p.img && p.nome);
    const site = (LOJAS[marca].site || '').replace(/^https?:\/\//, '').split('/')[0];
    const rows = [];
    if (best.length) rows.push({ ...base, marca, categoria: 'Best-seller', titulo: 'Mais vendidas — bolsas', fonte: 'Loja oficial · ' + site, imagem_url: best[0].img, produtos: best });
    if (nov.length) rows.push({ ...base, marca, categoria: 'Lançamento', titulo: 'Novidades — chegou agora', fonte: 'Loja oficial · ' + site, imagem_url: nov[0].img, produtos: nov });
    console.log(`  ${marca}: best ${best.length} · nov ${nov.length}`);
    if (DRY || !rows.length) { okG += rows.length ? 1 : 0; continue; }
    for (const c of ['Best-seller', 'Lançamento']) await rest('DELETE', `noticias_concorrentes?marca=eq.${encodeURIComponent(marca)}&rodada=eq.${RODADA}&categoria=eq.${encodeURIComponent(c)}`);
    for (const row of rows) await rest('POST', 'noticias_concorrentes', [row]);
    okG++;
  } catch (e) { console.log(`  ✗ ${marca}: ${String(e).slice(0, 120)}`); }
}
console.log(`Lojas OK em ${okG}/${Object.keys(LOJAS).length} marcas.`);
await R.fechar();
