//
// Chamadas diretas à Admin API da Shopify (REST). Paralelo a
// bling-comercial.mjs, mas SEM proxy: o token de app fica só aqui, no robô
// que roda no servidor — nunca chega ao navegador, então não precisa do
// desenho de "edge function com allowlist" que o Bling exige.
const API_VERSION = '2026-01';

// A Shopify pagina orders.json por CURSOR, no cabeçalho Link (RFC 8288) — não
// por número de página. Pura: só parseia texto, não faz rede.
export function linkDaProximaPagina(cabecalhoLink) {
  if (!cabecalhoLink || typeof cabecalhoLink !== 'string') return null;
  for (const parte of cabecalhoLink.split(',')) {
    const [urlBruta, relBruto] = parte.split(';').map((s) => s?.trim());
    if (!urlBruta || !relBruto) continue;
    if (relBruto.replace(/\s/g, '') !== 'rel="next"') continue;
    const m = urlBruta.match(/^<(.+)>$/);
    if (m) return m[1];
  }
  return null;
}

// O token do app: ou client_credentials (SHOPIFY_CLIENT_ID/SECRET — o mesmo
// padrão já usado por coletor/estoque-do-site.mjs para outro app Shopify
// deste projeto), ou um token fixo (SHOPIFY_ACCESS_TOKEN) se for essa a
// credencial que o dono tiver em mãos. Sem cache entre rodadas — diferente de
// estoque-do-site.mjs (que roda a cada minuto), este robô roda só ~25x por
// dia, não precisa guardar o token em disco.
export async function tokenShopify(dominioDaLoja) {
  const { SHOPIFY_CLIENT_ID: id, SHOPIFY_CLIENT_SECRET: segredo, SHOPIFY_ACCESS_TOKEN: fixo } = process.env;
  if (!id || !segredo) {
    if (!fixo) throw new Error('faltam SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET (ou SHOPIFY_ACCESS_TOKEN) em coletor/.env');
    return fixo;
  }
  const r = await fetch(`https://${dominioDaLoja}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: segredo }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('token do Shopify recusado: ' + r.status);
  return j.access_token;
}

// Busca TODOS os pedidos (qualquer status) atualizados a partir de uma data,
// seguindo a paginação por cursor até acabar. `status=any` é necessário: por
// padrão a Shopify só devolve pedidos "open" (não cancelados/arquivados), e
// pedido cancelado é um FATO a medir (mesma lição do robô do Bling), não um
// erro a esconder.
export async function shopifyPedidos(dominioDaLoja, token, { atualizadosApartirDe } = {}) {
  let url = `https://${dominioDaLoja}/admin/api/${API_VERSION}/orders.json?status=any&limit=250`
    + (atualizadosApartirDe ? `&updated_at_min=${encodeURIComponent(atualizadosApartirDe)}` : '');
  const todos = [];
  while (url) {
    let resposta;
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      resposta = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' } });
      if (resposta.status === 429) { await new Promise((r) => setTimeout(r, 1000 * (tentativa + 1))); continue; }
      if (resposta.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (tentativa + 1))); continue; }
      break;
    }
    if (!resposta.ok) {
      throw new Error(`Shopify orders.json -> ${resposta.status} ${(await resposta.text()).slice(0, 200)}`);
    }
    const corpo = await resposta.json();
    todos.push(...(corpo.orders || []));
    url = linkDaProximaPagina(resposta.headers.get('Link'));
  }
  return todos;
}
