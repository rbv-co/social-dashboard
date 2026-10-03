// Transforma o payload cru de um pedido da Shopify (da API ou de um webhook —
// é o MESMO formato de objeto "order" nos dois casos) na linha que vai para
// `shopify_pedidos`, e decide o que conta como venda.
//
// POR QUE ISTO MORA EM supabase/functions/_shared/ E NÃO EM src/ OU coletor/
// Mesmo motivo dos vizinhos valor-corrigido.js e pedido-para-mensagem.js: o
// webhook (receber-webhook-pedido-shopify, Deno) e o robô
// (trazer-pedidos-da-shopify.mjs, Node) usam a MESMA regra — duas cópias da
// mesma regra discordam cedo ou tarde.
//
// LOJA_ID É FIXO: esta tabela é só da Loja Shopify (205512275). Não existe
// hoje nenhuma outra loja que fale com este código. Exportado pelo mesmo
// motivo de STATUS_QUE_CONTAM: src/compartilhado/pedidos-shopify.js usa o
// MESMO número, não uma segunda cópia.
export const LOJA_ID_SHOPIFY = 205512275;

// O que conta como venda. "Pending" (Pix/boleto ainda não confirmado) e
// qualquer status que a Shopify venha a inventar NÃO contam — o lado seguro
// é nunca contar um status desconhecido como faturamento.
//
// Exportado (não só a função) porque src/compartilhado/pedidos-shopify.js
// (Task 7) precisa da LISTA, não só do predicado — o filtro `.in()` do
// Supabase pede um array de valores, e duas cópias desta lista discordariam
// cedo ou tarde (mesma lição de todo módulo _shared deste projeto).
export const STATUS_QUE_CONTAM = ['paid', 'partially_refunded'];

export function ehVendaValida(statusFinanceiro) {
  return STATUS_QUE_CONTAM.includes(statusFinanceiro);
}

export function pedidoDoPayload(corpo) {
  if (!corpo || corpo.id == null || !corpo.created_at) return null;
  const nome = [corpo.customer?.first_name, corpo.customer?.last_name].filter(Boolean).join(' ');
  return {
    id: Number(corpo.id),
    numero: corpo.name ?? (corpo.order_number != null ? `#${corpo.order_number}` : null),
    loja_id: LOJA_ID_SHOPIFY,
    total: Number(corpo.total_price) || 0,
    moeda: corpo.currency || 'BRL',
    status_financeiro: corpo.financial_status || 'pending',
    cliente_nome: nome || null,
    cliente_email: corpo.customer?.email || null,
    criado_em_shopify: corpo.created_at || null,
    bruto: corpo,
  };
}
