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
import { STATUS_QUE_CONTAM, LOJA_ID_SHOPIFY } from '../../supabase/functions/_shared/pedido-shopify.js';
import { diaEmSaoPaulo } from '../../supabase/functions/_shared/hora-de-sao-paulo.js';

const PAGINA = 1000;   // o PostgREST corta em 1000 sem avisar — paginar sempre

// A Shopify guarda em UTC (criado_em_shopify é timestamptz). di/df são datas
// puras 'AAAA-MM-DD' em America/Sao_Paulo — comparar direto contra a coluna
// de instante leria a meia-noite como UTC e cortaria o fim de cada dia (medido
// em 03/10/2026: "Hoje" sempre dava R$0 pra esta loja). Por isso o limite
// inferior e o superior levam o offset fixo de Brasília, e o superior é o
// INÍCIO do dia seguinte com `.lt` (nunca `.lte` numa data pura contra
// timestamptz) — mesma régua de supabase/functions/_shared/hora-de-sao-paulo.js.
function inicioDoDiaEmSaoPaulo(dataISO) {
  return `${dataISO}T00:00:00-03:00`;
}
function proximoDiaEmSaoPaulo(dataISO) {
  const d = new Date(`${dataISO}T00:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Devolve null quando não deu para consultar — "não sei"; quem chama trata
// isso como lista vazia (a loja fica temporariamente sem a correção, nunca a
// tela toda quebra ou fica vazia).
export async function buscarPedidosShopifyDoPeriodo(sbClient, di, df) {
  const inicio = inicioDoDiaEmSaoPaulo(di);
  const fim = inicioDoDiaEmSaoPaulo(proximoDiaEmSaoPaulo(df));
  const linhas = [];
  try {
    for (let offset = 0; ; offset += PAGINA) {
      const { data, error } = await sbClient
        .from('shopify_pedidos')
        .select('id,total,criado_em_shopify,status_financeiro')
        .gte('criado_em_shopify', inicio)
        .lt('criado_em_shopify', fim)
        .in('status_financeiro', STATUS_QUE_CONTAM)
        .range(offset, offset + PAGINA - 1);
      if (error) return null;
      linhas.push(...(data || []));
      if (!data || data.length < PAGINA) break;
    }
  } catch {
    return null;
  }
  return linhas;
}

// pedidosBling   : o array de pedidos que a tela já tem (formato do Bling)
// linhasShopify  : o que buscarPedidosShopifyDoPeriodo devolveu (nunca null aqui — quem chama já tratou isso)
// Devolve um array no MESMO formato de pedido do Bling — a loja Shopify
// passa a vir só desta fonte, nunca das duas ao mesmo tempo. `fonte:'shopify'`
// marca o pedido como NÃO sendo do Bling — usado pelas telas para não tentar
// buscar detalhe desse id no Bling (ele não existe lá), ver chamadores de
// blingCall('pedidos/vendas/${p.id}',...).
export function mesclarPedidosShopify(pedidosBling, linhasShopify, lojaIdShopify = LOJA_ID_SHOPIFY) {
  const semShopify = (pedidosBling || []).filter((p) => Number(p?.loja?.id) !== lojaIdShopify);
  const doShopify = (linhasShopify || []).map((l) => ({
    id: l.id,
    total: Number(l.total) || 0,
    data: diaEmSaoPaulo(l.criado_em_shopify) || '',
    loja: { id: lojaIdShopify },
    fonte: 'shopify',
  }));
  return [...semShopify, ...doShopify];
}
