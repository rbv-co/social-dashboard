#!/usr/bin/env node
// coletor/gerar-modelo.mjs
// F3+ task 23: gera os criativos "produto-modelo" (foto ORIGINAL da modelo com
// a bolsa, com o fundo dela — SEM recorte) pros SKUs que têm foto de pessoa
// mapeada em coletor/fotos-modelo-map.json (produzido pela task 22).
//
// Reaproveita De/Por já gerado numa rodada de produto anterior (fabrica_criativos,
// por storage_path contendo o SKU) — não recalcula desconto. Nome completo do
// Nome do Bling vem de gc_vendas_item (mesma fonte usada no
// Gestor Comercial); o nome curto "Bolsa <Cidade>" + a linha de impacto vêm do
// gerarCopysProduto (Opus), igual ao fluxo de gerar-criativos.mjs.
//
// Uso: node --import ./lib/curl-fetch.mjs gerar-modelo.mjs [--dry]
import './lib/carregar-env.mjs';
import { renderPNG, fecharRender } from './lib/render-criativo.mjs';
import { TEMPLATES, DIM } from './templates-criativos/templates.mjs';
import { gerarCopysProduto } from './lib/copy-efeito.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DRY = process.argv.includes('--dry');
const DIR = dirname(fileURLToPath(import.meta.url));
const MAPA_PATH = join(DIR, 'fotos-modelo-map.json');
const NOME_CAMPANHA = '[IA] Modelo';
const VARIANTES = ['sage', 'pearl', 'espresso'];

const URL = process.env.SUPABASE_URL || 'https://supabase-desligado.invalid';
const SK = process.env.SUPABASE_SERVICE_KEY;
const REST = URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
const BUCKET = 'fabrica-criativos';
const sane = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '_');

const FMT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => FMT.format(Math.round(Number(n) * 100) / 100);

async function sbGet(p) { const r = await fetch(REST + p, { headers: H }); if (!r.ok) throw new Error('GET ' + p + ' ' + r.status); return r.json(); }
async function sbPost(p, body, prefer) { const r = await fetch(REST + p, { method: 'POST', headers: prefer ? { ...H, Prefer: prefer } : H, body: JSON.stringify(body) }); if (!r.ok && ![200, 201, 204].includes(r.status)) throw new Error('POST ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200)); return r; }
async function garantirBucket() {
  await fetch(URL + '/storage/v1/bucket', { method: 'POST', headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }) }).catch(() => {});
}
async function subir(path, buf) {
  const r = await fetch(`${URL}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: buf });
  if (!r.ok) throw new Error('upload ' + path + ' ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return `${URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// De/Por já calculado numa rodada de produto anterior — busca a linha mais
// recente cujo storage_path contenha o SKU (dedup por preço, todas as linhas
// de um mesmo SKU numa mesma rodada têm o mesmo De/Por).
async function dePorDe(sku) {
  const rows = await sbGet(`/fabrica_criativos?select=preco_de,preco_por&storage_path=ilike.*${encodeURIComponent(sku)}*&order=created_at.desc&limit=1`);
  if (!rows.length) return null;
  return { precoDe: rows[0].preco_de, precoPor: rows[0].preco_por };
}

// Nome completo do Bling a partir de gc_vendas_item (match exato, depois variações
// de espaço/underscore/caixa — o SKU do Bling às vezes vem "LV1072-CG Preto" com
// espaço onde o mapa de fotos usa underscore). (fabrica_candidatos foi aposentada
// na migration 019 — F1 removida; gc_vendas_item é a fonte de nome.)
async function nomeCompletoDe(sku) {
  let rows;
  const variantes = [sku, sku.replace(/_/g, ' ')];
  for (const v of variantes) {
    rows = await sbGet(`/gc_vendas_item?select=produto&sku=eq.${encodeURIComponent(v)}&limit=1`);
    if (rows.length) return rows[0].produto;
  }
  // último recurso: busca aproximada pelo miolo numérico do SKU (ex.: "1072").
  const m = sku.match(/(\d{3,})/);
  if (m) {
    rows = await sbGet(`/gc_vendas_item?select=produto&sku=ilike.*${m[1]}*&limit=1`);
    if (rows.length) return rows[0].produto;
  }
  return sku;
}

async function main() {
  const mapa = JSON.parse(readFileSync(MAPA_PATH, 'utf8'));
  const skus = Object.keys(mapa);
  console.log('fotos-modelo-map.json:', skus.length, 'SKUs');

  // resolve De/Por + nome completo por SKU
  const info = new Map();
  for (const sku of skus) {
    const dp = await dePorDe(sku);
    if (!dp || dp.precoDe == null || dp.precoPor == null) { console.log('  sem De/Por em fabrica_criativos, pulado:', sku); continue; }
    const nomeCompleto = await nomeCompletoDe(sku);
    info.set(sku, { ...dp, nomeCompleto });
    console.log('  ', sku, '| De/Por R$', dp.precoDe, '/ R$', dp.precoPor, '|', nomeCompleto);
  }
  if (!info.size) throw new Error('nenhum SKU com De/Por resolvido — nada a gerar');

  // copy de efeito + nome curto "Bolsa <Cidade>" em lote (mesma chamada Opus
  // usada em gerar-criativos.mjs)
  const pctExemplo = (() => { const [sku] = info.keys(); const { precoDe, precoPor } = info.get(sku); return Math.round((1 - precoPor / precoDe) * 100); })();
  const copys = await gerarCopysProduto([...info.entries()].map(([sku, i]) => ({ sku, nome: i.nomeCompleto })), { desconto_pct: pctExemplo });

  // campanha
  let campanhaId = null;
  if (!DRY) {
    const c = await sbPost('/fabrica_campanhas', [{ nome: NOME_CAMPANHA, desconto_tipo: 'fixo', desconto_pct: pctExemplo, parcelas: 10 }], 'return=representation');
    campanhaId = (await c.json())[0].id;
    await garantirBucket();
  }

  let gerados = 0;
  let i = 0;
  for (const [sku, dados0] of info) {
    const varianteCor = VARIANTES[i++ % VARIANTES.length];
    const copyInfo = copys.get(sku) || {};
    const dadosBase = {
      modeloFotoUrl: mapa[sku],
      nome: copyInfo.nome || dados0.nomeCompleto,
      copyEfeito: copyInfo.copy,
      oferta: '50%',
      precoDe: money(dados0.precoDe),
      precoPor: money(dados0.precoPor),
      cta: 'Comprar agora',
      eyebrow: 'Sale',
      varianteCor,
    };
    for (const formato of Object.keys(DIM)) {
      const html = TEMPLATES['produto-modelo'].render(dadosBase, formato);
      const buf = await renderPNG(html, DIM[formato]);
      gerados++;
      if (DRY) { console.log('  [dry] modelo', sku, varianteCor, formato, buf.length, 'bytes'); continue; }
      const path = `${campanhaId}/produto-modelo/${sane(sku)}-${formato}.png`;
      const url = await subir(path, buf);
      await sbPost('/fabrica_criativos', [{ campanha_id: campanhaId, arquetipo: 'produto', template: 'produto-modelo', formato, variante: 'produto-modelo', preco_de: dados0.precoDe, preco_por: dados0.precoPor, storage_path: path, url }], 'return=minimal');
      console.log('  gerado:', sku, varianteCor, formato);
    }
  }

  await fecharRender();
  console.log(DRY ? `\n(--dry) geraria ${gerados} criativos.` : `\ngerado: ${gerados} criativos | campanha ${campanhaId}`);
}
main().catch(async (e) => { await fecharRender(); console.error('FALHOU:', e.message); process.exit(1); });
