//
// A ponte entre as TELAS e os pedidos da Loja Shopify. Busca no Supabase
// (bridge do navegador) e mescla no formato que as telas já entendem — depois
// disso nenhuma lógica de soma/ranking precisa saber que esta loja tem uma
// fonte diferente.
//
// Mesma régua de "o que conta como venda" do robô/webhook — importada do
// MESMO módulo (ver supabase/functions/_shared/pedido-shopify.js), não uma
// segunda cópia da lista. O arquivo é JS puro sem nada específico de Deno,
// então o navegador (via bundler) consegue importar dele direto.
import { STATUS_QUE_CONTAM } from '../../supabase/functions/_shared/pedido-shopify.js';

const LOJA_ID_SHOPIFY = 205512275;

// Devolve null quando não deu para consultar — "não sei", e quem chama
// mantém a tela como está (nunca interpreta null como "zero venda").
export async function buscarPedidosShopifyDoPeriodo(sbClient, di, df) {
  try {
    const { data, error } = await sbClient
      .from('shopify_pedidos')
      .select('id,total,criado_em_shopify,status_financeiro')
      .gte('criado_em_shopify', di)
      .lte('criado_em_shopify', df)
      .in('status_financeiro', STATUS_QUE_CONTAM);
    if (error) return null;
    return data || [];
  } catch {
    return null;
  }
}

// pedidosBling   : o array de pedidos que a tela já tem (formato do Bling)
// linhasShopify  : o que buscarPedidosShopifyDoPeriodo devolveu (nunca null aqui — quem chama já tratou isso)
// Devolve um array no MESMO formato de pedido do Bling — a loja Shopify
// passa a vir só desta fonte, nunca das duas ao mesmo tempo.
export function mesclarPedidosShopify(pedidosBling, linhasShopify, lojaIdShopify = LOJA_ID_SHOPIFY) {
  const semShopify = (pedidosBling || []).filter((p) => Number(p?.loja?.id) !== lojaIdShopify);
  const doShopify = (linhasShopify || []).map((l) => ({
    id: l.id,
    total: Number(l.total) || 0,
    data: String(l.criado_em_shopify || '').slice(0, 10),
    loja: { id: lojaIdShopify },
  }));
  return [...semShopify, ...doShopify];
}
