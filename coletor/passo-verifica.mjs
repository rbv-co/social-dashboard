// PASSO 6 (final) do agente: GUARDA DE COMPLETUDE. Audita a rodada recém-criada, loga em coletor_log,
// dispara webhook e SAI com código 1 (sinal de falha no GitHub) se faltar algo crítico.
// Cobre #1 (edição incompleta) e #2 (loja vazia em silêncio).
import fs from 'fs';
import { LOJAS } from './lojas.mjs';
import { abrirRest } from './lib/rest-pg.mjs';

const env = {};
try { for (const l of fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (e) {}
const WEBHOOK = process.env.ALERT_WEBHOOK_URL || env.ALERT_WEBHOOK_URL || '';
const RODADA = process.env.RODADA || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
// REST_VIA_PG=1 (plano 03 da virada): o mesmo caminho vira SQL no api-db; sem a flag segue o REST do Supabase.
const R = await abrirRest({ ...env, ...process.env }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
async function rest(method, path, body, prefer = 'return=representation') {
  const r = await R.fetch(R.REST + '/' + path, { method, headers: { ...R.sb, Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(method + ' ' + path + ' → ' + r.status + ' ' + t.slice(0, 160)); return t ? JSON.parse(t) : null;
}
const prods = n => Array.isArray(n && n.produtos) ? n.produtos : [];

const PRODUTO = Object.keys(LOJAS);            // marcas com loja (esperam best-seller + Desenvolvimento)
const MKT_ONLY = ["L'Occitane"];                // monitoradas só em Marketing
const ESPERADAS = [...PRODUTO, ...MKT_ONLY];
const IG_CATS = ['Top Viral', 'Últimos Posts', 'Reels'];

const all = await rest('GET', `noticias_concorrentes?rodada=eq.${RODADA}&select=marca,categoria,produtos`);
const by = {}; for (const r of all) (by[r.marca] = by[r.marca] || []).push(r);

const fail = [], warn = [];
for (const marca of ESPERADAS) {
  const rs = by[marca] || [];
  if (!rs.length) { fail.push(`${marca}: AUSENTE na rodada`); continue; }
  const has = c => rs.some(r => r.categoria === c);
  const igN = rs.filter(r => IG_CATS.includes(r.categoria)).length;
  const ehProduto = PRODUTO.includes(marca);
  if (ehProduto) {
    const bs = rs.find(r => r.categoria === 'Best-seller');
    if (!bs || prods(bs).length < 6) fail.push(`${marca}: best-sellers vazios/insuficientes (loja quebrou?)`);
    if (!has('Desenvolvimento')) warn.push(`${marca}: sem hero Desenvolvimento`);
    if (!has('Resumo Comercial')) fail.push(`${marca}: sem Resumo Comercial`);
  }
  if (!has('Resumo Marketing')) fail.push(`${marca}: sem Resumo Marketing`);
  if (igN === 0) fail.push(`${marca}: sem nenhuma galeria de Instagram`);
  else if (igN < 3) warn.push(`${marca}: só ${igN}/3 galerias de Instagram`);
}

// Quantas MARCAS (não quantos problemas) ficaram incompletas.
const marcasComFalha = new Set(fail.map(s => s.split(':')[0]));
const okN = ESPERADAS.length - new Set([...fail, ...warn].map(s => s.split(':')[0])).size;
// TOLERÂNCIA: uma ou duas marcas incompletas (de 12) NÃO derrubam a rodada. Motivo: a causa
// mais comum é timeout transitório da API da Anthropic numa marca ou outra (conta lenta no
// momento), e a PRÓXIMA rodada recolhe. Falhar o job inteiro por 1 marca enche o dono de
// e-mail de falha à toa. Só é FALHA de verdade se muitas marcas caírem (3+) — aí é sistêmico
// (API fora, crédito acabou, lojas quebradas), que merece alerta.
const TOLERANCIA_MARCAS = 2;
const rodadaFalhou = marcasComFalha.size > TOLERANCIA_MARCAS;
const status = rodadaFalhou ? 'FALHA' : (fail.length ? 'PARCIAL' : warn.length ? 'AVISO' : 'OK');
const resumo = `Rodada ${RODADA} · ${status} · ${okN}/${ESPERADAS.length} marcas completas · ❌${fail.length} ⚠️${warn.length}`;
const detalhe = [resumo, ...fail.map(s => '❌ ' + s), ...warn.map(s => '⚠️ ' + s)].join('\n');
console.log(detalhe);

try {
  await rest('POST', 'coletor_log', [{ fase: 'verificacao', encontradas: ESPERADAS.length, inseridas: okN, erro: fail.length ? fail.join(' · ').slice(0, 900) : null, detalhe: detalhe.slice(0, 1500) }], 'return=minimal'); // o papel só tem INSERT em coletor_log: sem RETURNING
} catch (e) { console.log('aviso: falha ao logar verificação:', String(e).slice(0, 100)); }

if (fail.length && WEBHOOK) {
  const msg = rodadaFalhou
    ? `❌ Observatório (Vessel) — rodada ${RODADA} FALHOU (${marcasComFalha.size} marcas incompletas):\n${fail.map(s => '• ' + s).join('\n')}\nChecar lojas/Meta/crédito da API e re-disparar.`
    : `⚠️ Observatório (Vessel) — rodada ${RODADA} saiu PARCIAL (${marcasComFalha.size} marca(s) ficaram para a próxima, portal seguiu no ar):\n${fail.map(s => '• ' + s).join('\n')}`;
  try { await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msg, content: msg }) }); } catch (e) {}
}

await R.fechar();
if (rodadaFalhou) { console.error(`\n✗ Rodada com falha sistêmica — ${marcasComFalha.size} marcas incompletas (acima da tolerância de ${TOLERANCIA_MARCAS}).`); process.exit(1); }
if (fail.length) { console.log(`\n✓ Rodada parcial — ${marcasComFalha.size} marca(s) ficaram para a próxima (dentro da tolerância). Portal segue no ar.`); }
else { console.log('\n✓ Rodada completa.'); }
