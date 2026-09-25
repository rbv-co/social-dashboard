#!/usr/bin/env node
// Estoque do site = estoque da loja do Iguatemi − 1 (a peça de mostruário).
//
// Lê o saldo físico do depósito "Estoque Loja Iguatemi" no Bling e grava no
// Shopify, no local "Vessel Shopping Iguatemi" (o que atende o site). A regra
// mora em lib/estoque-do-site.mjs; aqui só se busca e se grava.
//
// Uso:
//   node coletor/estoque-do-site.mjs            # ENSAIO: mostra o que mudaria, não grava
//   node coletor/estoque-do-site.mjs --aplicar  # grava no Shopify
//
// ⚠️ TRÊS TRAVAS, e por quê:
// 1. Falha de leitura no Bling PARA o robô. O leitor antigo (blingSaldoFoco)
//    pula o lote que falha — aqui isso viraria "saldo 0" e esgotaria o site
//    inteiro por um soluço de rede.
// 2. SKU do Shopify que o Bling não devolveu fica INTOCADO.
// 3. Cada gravação leva `changeFromQuantity`: se o site vendeu a peça entre a
//    leitura e a gravação, o Shopify recusa em vez de devolver a unidade vendida.
//
// ⚠️ O REPOSITÓRIO É PÚBLICO e o log do Actions também: o log sai só com
// contagens, nunca com quantidade por peça. O detalhe só aparece rodando local.

import './lib/carregar-env.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { loginServico, blingProxy, blingProdutos } from './lib/bling-comercial.mjs';
import { calcularAjustes } from '../supabase/functions/_shared/estoque-do-site.js';

// As credenciais do Shopify moram no .env da RAIZ do iamundi, e ELAS VENCEM as
// do coletor/.env: lá existe um SHOPIFY_CLIENT_ID de OUTRO app (medido em
// 25/09/2026), carregado primeiro pelo carregar-env. Com ele o pedido de token
// devolvia uma página HTML e o robô caía calado no shpat_ fixo.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(raiz) && !process.env.GITHUB_ACTIONS) {
  for (const l of readFileSync(raiz, 'utf8').split('\n')) {
    const m = l.match(/^\s*(SHOPIFY_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const APLICAR = process.argv.includes('--aplicar');
const LOCAL = !process.env.GITHUB_ACTIONS;           // detalhe por peça só fora do log público
const DEPOSITO_IGUATEMI = '14888726277';             // "Estoque Loja Iguatemi" (ver bling_depositos)
const LOCAL_SHOPIFY = 'gid://shopify/Location/94919065848';
const NOME_LOCAL_SHOPIFY = 'Vessel Shopping Iguatemi';
const SHOP = process.env.SHOPIFY_SHOP;
const API = `https://${SHOP}/admin/api/2026-01/graphql.json`;

// O token do Dev Dashboard vence em 24h. Rodando a cada minuto, pedir um novo
// em toda rodada seria 1.440 por dia: ele fica guardado e é trocado com 23h.
// Pedido recusado PARA o robô — cair calado num token de reserva escondia o
// defeito de cima.
const CACHE_TOKEN = join(homedir(), '.cache', 'iamundi-estoque-do-site-token.json');
async function tokenShopify() {
  const { SHOPIFY_CLIENT_ID: id, SHOPIFY_CLIENT_SECRET: seg, SHOPIFY_ACCESS_TOKEN: fixo } = process.env;
  if (!id || !seg) {
    if (!fixo) throw new Error('faltam SHOPIFY_CLIENT_ID/SECRET');
    return fixo;
  }
  try {
    const c = JSON.parse(readFileSync(CACHE_TOKEN, 'utf8'));
    if (c.id === id && Date.now() < c.vence) return c.token;
  } catch { /* sem cache: pede */ }
  const r = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: seg }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('token do Shopify recusado: ' + r.status);
  try {
    mkdirSync(dirname(CACHE_TOKEN), { recursive: true });
    writeFileSync(CACHE_TOKEN, JSON.stringify({ id, token: j.access_token, vence: Date.now() + 23 * 3600e3 }), { mode: 0o600 });
  } catch {}
  return j.access_token;
}

async function gql(token, query, variables) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.errors) throw new Error('shopify ' + r.status + ' ' + JSON.stringify(j?.errors || j).slice(0, 300));
  return j.data;
}

async function variantesDoShopify(token) {
  const out = [];
  let after = null;
  do {
    const d = await gql(token, `query($after:String){ productVariants(first:100, after:$after){
      pageInfo{ hasNextPage endCursor }
      nodes{ sku displayName inventoryItem{ id tracked
        inventoryLevel(locationId:"${LOCAL_SHOPIFY}"){ location{ name } quantities(names:["available"]){ quantity } } } } } }`, { after });
    const pv = d.productVariants;
    for (const v of pv.nodes) {
      if (!v.inventoryItem?.tracked) continue;       // sem controle de estoque: não é nosso assunto
      const lvl = v.inventoryItem.inventoryLevel;
      if (lvl && lvl.location?.name !== NOME_LOCAL_SHOPIFY) throw new Error('o local do Shopify mudou de nome: ' + lvl.location?.name);
      out.push({ sku: v.sku, nome: v.displayName, inventoryItemId: v.inventoryItem.id,
                 noLocal: !!lvl, disponivel: lvl ? lvl.quantities[0]?.quantity ?? 0 : null });
    }
    after = pv.pageInfo.hasNextPage ? pv.pageInfo.endCursor : null;
  } while (after);
  return out;
}

// Saldo do Iguatemi por SKU. Só entra no Map o SKU cujo lote foi lido COM
// SUCESSO — é o que permite ao cálculo distinguir "zero" de "não sei".
// O catálogo inteiro do Bling leva ~30s para baixar; com o robô rodando a cada
// minuto, o mapa SKU→id fica guardado e só é relido a cada 6h ou quando aparece
// SKU do site que o mapa não conhece (produto novo).
const CACHE = join(homedir(), '.cache', 'iamundi-estoque-do-site-ids.json');
const SEIS_HORAS = 6 * 3600e3;
async function idsDoBling(tokenBling, skus) {
  try {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    const m = new Map(Object.entries(c.ids || {}));
    if (Date.now() - c.em < SEIS_HORAS && [...skus].every((s) => m.has(s))) return m;
  } catch { /* sem cache: relê */ }
  const prod = await blingProdutos(tokenBling, 40);
  const m = new Map();
  for (const [id, p] of Object.entries(prod)) {
    const sku = String(p.codigo || '').trim();
    if (skus.has(sku)) m.set(sku, id);
  }
  try { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify({ em: Date.now(), ids: Object.fromEntries(m) })); } catch {}
  return m;
}

async function saldoDoIguatemi(tokenBling, skus) {
  const idPorSku = await idsDoBling(tokenBling, skus);
  const skuPorId = new Map([...idPorSku].map(([s, id]) => [id, s]));
  const ids = [...skuPorId.keys()];
  const saldo = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const lote = ids.slice(i, i + 40);
    const params = {};
    lote.forEach((id, k) => { params[`idsProdutos[${k}]`] = id; });
    const resp = await blingProxy(tokenBling, 'estoques/saldos', params);   // falhou → LANÇA
    if (!Array.isArray(resp?.data)) throw new Error('estoques/saldos sem lista: ' + JSON.stringify(resp).slice(0, 200));
    for (const id of lote) saldo.set(skuPorId.get(id), 0);   // lido e ausente = zero de verdade
    for (const row of resp.data) {
      const sku = skuPorId.get(String(row.produto?.id || ''));
      if (!sku) continue;
      const dep = (row.depositos || []).find((d) => String(d.id) === DEPOSITO_IGUATEMI);
      saldo.set(sku, dep ? Number(dep.saldoFisico) || 0 : 0);
    }
  }
  return saldo;
}

async function gravar(token, a) {
  if (a.ativar) {
    const d = await gql(token, `mutation($i:ID!,$l:ID!,$q:Int){ inventoryActivate(inventoryItemId:$i, locationId:$l, available:$q){ userErrors{ field message } } }`,
      { i: a.inventoryItemId, l: LOCAL_SHOPIFY, q: a.para });
    return d.inventoryActivate.userErrors;
  }
  const d = await gql(token, `mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message code } } }`,
    { input: { name: 'available', reason: 'correction',
      referenceDocumentUri: 'iamundi://estoque-do-site/loja-menos-mostruario',
      quantities: [{ inventoryItemId: a.inventoryItemId, locationId: LOCAL_SHOPIFY, quantity: a.para, changeFromQuantity: a.de }] } });
  return d.inventorySetQuantities.userErrors;
}

async function main() {
  const tShop = await tokenShopify();
  const variantes = await variantesDoShopify(tShop);
  const tBling = await loginServico();
  const saldo = await saldoDoIguatemi(tBling, new Set(variantes.map((v) => String(v.sku || '').trim()).filter(Boolean)));
  const { ajustes, semBling, iguais } = calcularAjustes(variantes, saldo);

  console.log(`${APLICAR ? 'APLICANDO' : 'ENSAIO (nada gravado)'} — ${variantes.length} variantes, ${iguais.length} já certas, ${ajustes.length} a corrigir, ${semBling.length} sem par no Bling`);
  const nome = new Map(variantes.map((v) => [v.sku, v.nome]));
  if (LOCAL) {
    for (const a of ajustes) console.log(`  ${a.sku.padEnd(13)} ${String(nome.get(a.sku)).replace(' - Default Title', '').padEnd(42)} loja ${saldo.get(a.sku)} → site ${a.de} ⇒ ${a.para}${a.ativar ? ' (ativa no local)' : ''}`);
    if (semBling.length) console.log('  sem par no Bling (intocados): ' + semBling.join(', '));
  }
  if (!APLICAR) return;

  let ok = 0; const falhas = [];
  for (const a of ajustes) {
    const erros = await gravar(tShop, a);
    if (erros.length) falhas.push(`${a.sku}: ${erros.map((e) => e.message).join('; ')}`); else ok++;
  }
  console.log(`gravados ${ok} de ${ajustes.length}`);
  if (falhas.length) {
    // Recusa por changeFromQuantity é o site vendendo no meio da rodada: a
    // próxima rodada acerta. Qualquer falha ainda assim deixa o job vermelho.
    console.error('falhas:\n  ' + (LOCAL ? falhas.join('\n  ') : falhas.length + ' SKU(s)'));
    process.exit(1);
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
