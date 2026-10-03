//
// Chamadas diretas à Admin API da Shopify (REST). Paralelo a
// bling-comercial.mjs, mas SEM proxy: o token de app fica só aqui, no robô
// que roda no servidor — nunca chega ao navegador, então não precisa do
// desenho de "edge function com allowlist" que o Bling exige.
const API_VERSION = '2024-01';

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
