//
// Transforma `detalhe.parcelas` (do pedido no Bling) nas linhas que vão para
// `bling_pedido_forma_pagamento`. Pura: não lê nem grava nada — quem chama
// (trazer-pedidos-do-bling.mjs) já tem o catálogo tipoPagamentoPorFormaId em
// mãos (ver blingFormasDePagamento, em bling-comercial.mjs).
import { ehDevolucaoDeMercadoria } from '../../supabase/functions/_shared/valor-liquido-de-troca.js';

// pedidoId, lojaId     : do pedido (detalhe.loja?.id pode vir null)
// parcelas             : detalhe.parcelas do Bling
// tipoPagamentoPorFormaId : Map(String(forma_pagamento_id) -> tipoPagamento)
export function linhasDeFormaPagamento(pedidoId, lojaId, parcelas, tipoPagamentoPorFormaId) {
  return (parcelas || [])
    .filter((parcela) => parcela?.id != null && parcela?.formaPagamento?.id != null)
    .map((parcela) => {
      const formaId = Number(parcela.formaPagamento.id);
      const tipo = tipoPagamentoPorFormaId?.get(String(formaId));
      return {
        parcela_id: parcela.id,
        pedido_id: pedidoId,
        loja_id: lojaId ?? null,
        forma_pagamento_id: formaId,
        valor: Number(parcela.valor) || 0,
        data_vencimento: parcela.dataVencimento || null,
        // tipo===undefined (forma fora do catálogo): grava mesmo assim, do
        // lado seguro (não marca como devolução sem ter certeza).
        eh_devolucao: tipo !== undefined && ehDevolucaoDeMercadoria(tipo),
      };
    });
}
