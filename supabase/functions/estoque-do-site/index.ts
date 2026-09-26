// estoque-do-site — o estoque do site (Shopify) segue a loja do Iguatemi (Bling).
//
// A cada minuto, pelo cron do banco (disparar_robo). A regra, do dono em
// 25/09/2026: site = loja − 1, porque a última peça da loja é o MOSTRUÁRIO.
// 10 na loja = 9 no site; 1 ou 0 na loja = esgotado. A regra mora em
// _shared/estoque-do-site.js, com teste; aqui só se busca e se grava.
//
// POR QUE EXISTE: a venda de balcão baixa o Bling e não baixava o Shopify. No dia
// em que isto nasceu, 55 das 81 variantes do site estavam erradas, e havia peça
// vendida na loja ainda à venda no site.
//
// ⚠️ AS TRAVAS, e por quê:
// 1. O TOKEN DO BLING É SÓ LIDO, nunca renovado aqui. O refresh do Bling é de
//    uso único e o bling-proxy renova sem trava; dois renovando juntos podem
//    queimar o refresh_token e deixar o sistema inteiro cego (como em 12/08).
//    Token vencido → a rodada é PULADA (503, sem gravar nada) e o vigia
//    (robos_esperados) avisa se isso durar.
// 2. Falha de leitura no Bling PARA a rodada. Nada de "o lote falhou, segue":
//    aqui isso viraria "saldo 0" e esgotaria o site inteiro.
// 3. SKU do Shopify que o Bling não devolveu fica INTOCADO.
// 4. Toda gravação leva `changeFromQuantity`: se o site vendeu a peça entre a
//    leitura e a gravação, o Shopify recusa em vez de devolver a unidade.
//
// Estado (token do Shopify, mapa SKU→id do Bling) em `estoque_do_site_estado`,
// tabela com RLS e zero policies — só o service role lê.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { calcularAjustes } from '../_shared/estoque-do-site.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHOP = Deno.env.get('SHOPIFY_SHOP') || 'la-vessel.myshopify.com';
const SHOPIFY_CLIENT_ID = Deno.env.get('SHOPIFY_CLIENT_ID');
const SHOPIFY_CLIENT_SECRET = Deno.env.get('SHOPIFY_CLIENT_SECRET');
const API = `https://${SHOP}/admin/api/2026-01/graphql.json`;
const BLING = 'https://api.bling.com.br/Api/v3';

const DEPOSITO_IGUATEMI = '14888726277';                  // "Estoque Loja Iguatemi"
const LOCAL_SHOPIFY = 'gid://shopify/Location/94919065848';
const NOME_LOCAL_SHOPIFY = 'Vessel Shopping Iguatemi';
const SEIS_HORAS = 6 * 3600e3;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SB = ReturnType<typeof createClient>;

async function lerEstado(sb: SB, chave: string): Promise<any> {
  const { data, error } = await sb.from('estoque_do_site_estado').select('valor').eq('chave', chave).maybeSingle();
  if (error) throw new Error('estado ' + chave + ': ' + error.message);
  return data?.valor ?? null;
}
async function gravarEstado(sb: SB, chave: string, valor: unknown) {
  const { error } = await sb.from('estoque_do_site_estado')
    .upsert({ chave, valor, atualizado_em: new Date().toISOString() });
  if (error) throw new Error('gravar estado ' + chave + ': ' + error.message);
}

// ── Bling (só leitura) ──────────────────────────────────────────────────────
async function tokenBling(sb: SB): Promise<string | null> {
  const { data } = await sb.from('bling_tokens').select('access_token, expires_at')
    .order('id', { ascending: false }).limit(1).single();
  if (!data?.access_token) return null;
  if (new Date(data.expires_at as string) <= new Date(Date.now() + 60_000)) return null;
  return data.access_token as string;
}

async function blingGet(token: string, endpoint: string, params: Record<string, string>) {
  const url = new URL(`${BLING}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  for (let t = 0; t < 4; t++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 429 || r.status >= 500) { await sleep(700 * (t + 1)); continue; }
    if (!r.ok) throw new Error(`bling ${endpoint} -> ${r.status}`);
    return r.json();
  }
  throw new Error(`bling ${endpoint} -> 429/5xx repetido`);
}

// Mapa SKU→id: o catálogo inteiro leva ~30s, então fica guardado e só é relido a
// cada 6h ou quando aparece SKU do site que o mapa não conhece.
async function idsDoBling(sb: SB, token: string, skus: Set<string>): Promise<Map<string, string>> {
  const c = await lerEstado(sb, 'ids_bling');
  if (c && Date.now() - c.em < SEIS_HORAS) {
    const m = new Map<string, string>(Object.entries(c.ids || {}));
    if ([...skus].every((s) => m.has(s))) return m;
  }
  const m = new Map<string, string>();
  for (let pagina = 1; pagina <= 40; pagina++) {
    const d = (await blingGet(token, 'produtos', { pagina: String(pagina), limite: '100' }))?.data;
    if (!Array.isArray(d) || !d.length) break;
    for (const p of d) {
      const sku = String(p.codigo || '').trim();
      if (skus.has(sku)) m.set(sku, String(p.id));
    }
    if (d.length < 100) break;
    await sleep(350);
  }
  await gravarEstado(sb, 'ids_bling', { em: Date.now(), ids: Object.fromEntries(m) });
  return m;
}

// Só entra no Map o SKU cujo lote foi lido COM SUCESSO: "zero" ≠ "não sei".
async function saldoDoIguatemi(sb: SB, token: string, skus: Set<string>) {
  const idPorSku = await idsDoBling(sb, token, skus);
  const skuPorId = new Map([...idPorSku].map(([s, id]) => [id, s]));
  const ids = [...skuPorId.keys()];
  const saldo = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 40) {
    const lote = ids.slice(i, i + 40);
    const params: Record<string, string> = {};
    lote.forEach((id, k) => { params[`idsProdutos[${k}]`] = id; });
    const resp = await blingGet(token, 'estoques/saldos', params);   // falhou → LANÇA
    if (!Array.isArray(resp?.data)) throw new Error('estoques/saldos sem lista');
    for (const id of lote) saldo.set(skuPorId.get(id)!, 0);          // lido e ausente = zero
    for (const row of resp.data) {
      const sku = skuPorId.get(String(row.produto?.id || ''));
      if (!sku) continue;
      const dep = (row.depositos || []).find((d: any) => String(d.id) === DEPOSITO_IGUATEMI);
      saldo.set(sku, dep ? Number(dep.saldoFisico) || 0 : 0);
    }
    await sleep(350);
  }
  return saldo;
}

// ── Shopify ─────────────────────────────────────────────────────────────────
// O token vence em 24h: guardado, trocado com 23h (a cada minuto seriam 1.440
// pedidos por dia).
async function tokenShopify(sb: SB): Promise<string> {
  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) throw new Error('faltam SHOPIFY_CLIENT_ID/SECRET nos segredos');
  const c = await lerEstado(sb, 'token_shopify');
  if (c && c.id === SHOPIFY_CLIENT_ID && Date.now() < c.vence) return c.token;
  const r = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('token do Shopify recusado: ' + r.status);
  await gravarEstado(sb, 'token_shopify', { id: SHOPIFY_CLIENT_ID, token: j.access_token, vence: Date.now() + 23 * 3600e3 });
  return j.access_token;
}

async function gql(token: string, query: string, variables?: unknown) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.errors) throw new Error('shopify ' + r.status + ' ' + JSON.stringify(j?.errors || j).slice(0, 300));
  return j.data;
}

async function variantesDoShopify(token: string) {
  const out: any[] = [];
  let after: string | null = null;
  do {
    const d = await gql(token, `query($after:String){ productVariants(first:100, after:$after){
      pageInfo{ hasNextPage endCursor }
      nodes{ sku inventoryItem{ id tracked
        inventoryLevel(locationId:"${LOCAL_SHOPIFY}"){ location{ name } quantities(names:["available"]){ quantity } } } } } }`, { after });
    const pv = d.productVariants;
    for (const v of pv.nodes) {
      if (!v.inventoryItem?.tracked) continue;
      const lvl = v.inventoryItem.inventoryLevel;
      if (lvl && lvl.location?.name !== NOME_LOCAL_SHOPIFY) throw new Error('o local do Shopify mudou de nome: ' + lvl.location?.name);
      out.push({ sku: v.sku, inventoryItemId: v.inventoryItem.id, noLocal: !!lvl,
                 disponivel: lvl ? lvl.quantities[0]?.quantity ?? 0 : null });
    }
    after = pv.pageInfo.hasNextPage ? pv.pageInfo.endCursor : null;
  } while (after);
  return out;
}

async function gravar(token: string, a: any): Promise<string[]> {
  if (a.ativar) {
    const d = await gql(token, `mutation($i:ID!,$l:ID!,$q:Int){ inventoryActivate(inventoryItemId:$i, locationId:$l, available:$q){ userErrors{ message } } }`,
      { i: a.inventoryItemId, l: LOCAL_SHOPIFY, q: a.para });
    return d.inventoryActivate.userErrors.map((e: any) => e.message);
  }
  const d = await gql(token, `mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ message } } }`,
    { input: { name: 'available', reason: 'correction',
      referenceDocumentUri: 'iamundi://estoque-do-site/loja-menos-mostruario',
      quantities: [{ inventoryItemId: a.inventoryItemId, locationId: LOCAL_SHOPIFY, quantity: a.para, changeFromQuantity: a.de }] } });
  return d.inventorySetQuantities.userErrors.map((e: any) => e.message);
}

Deno.serve(async (req: Request) => {
  const negado = await exigirSegredoDeCron(req, 'estoque-do-site');
  if (negado) return negado;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const tBling = await tokenBling(sb);
    if (!tBling) return json({ pulado: 'token do Bling vencido ou ausente — quem renova é o bling-proxy' }, 503);
    const tShop = await tokenShopify(sb);
    const variantes = await variantesDoShopify(tShop);
    const skus = new Set<string>(variantes.map((v) => String(v.sku || '').trim()).filter(Boolean));
    const saldo = await saldoDoIguatemi(sb, tBling, skus);
    const { ajustes, semBling, iguais } = calcularAjustes(variantes, saldo);
    const falhas: string[] = [];
    for (const a of ajustes) {
      const erros = await gravar(tShop, a);
      if (erros.length) falhas.push(`${a.sku}: ${erros.join('; ')}`);
    }
    const resumo = { variantes: variantes.length, iguais: iguais.length, gravados: ajustes.length - falhas.length,
                     ajustes: ajustes.map((a) => `${a.sku} ${a.de}→${a.para}`), semBling, falhas };
    if (ajustes.length || falhas.length) console.log(JSON.stringify(resumo));
    // Recusa por changeFromQuantity = o site vendeu no meio da rodada; a próxima
    // acerta. Ainda assim sai 500, para o vigia contar se isso virar rotina.
    return json(resumo, falhas.length ? 500 : 200);
  } catch (e) {
    console.error('estoque-do-site:', (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
