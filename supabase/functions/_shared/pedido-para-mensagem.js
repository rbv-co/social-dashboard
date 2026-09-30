// supabase/functions/_shared/pedido-para-mensagem.js
//
// O que fazer com os webhooks de PEDIDO para a mensagem "já recebemos o seu pedido". Função pura: recebe o tópico
// (X-Shopify-Topic) e o corpo já lido. Quem grava é `aplicarPedido` (aplicar-decisao.js). Design:
// docs/superpowers/specs/2026-09-30-fluxo-de-mensagens-design.md
import { contatoDoPedido, nomeDe, texto } from './abandono-de-checkout.js'

/**
 * @returns {{acao:'registrar_pedido', args:object}
 *   | {acao:'cancelar_pedido', pedidoId:number}
 *   | {acao:'ignorar', motivo:string}}
 */
export function decidirPedido(topico, corpo) {
  if (!corpo || typeof corpo !== 'object') return { acao: 'ignorar', motivo: 'corpo_invalido' }
  if (topico !== 'orders/create' && topico !== 'orders/cancelled') return { acao: 'ignorar', motivo: 'topico_nao_tratado' }

  const id = Number.isSafeInteger(corpo.id) ? corpo.id : null
  if (!id) return { acao: 'ignorar', motivo: 'sem_id' }
  // Pedido cancelado antes da mensagem sair: não sai (não importa o canal; sem linha na fila é inofensivo).
  if (topico === 'orders/cancelled') return { acao: 'cancelar_pedido', pedidoId: id }

  if (corpo.test === true) return { acao: 'ignorar', motivo: 'pedido_de_teste' }
  // Só a loja online: PDV, rascunho do admin e outros canais não recebem "já recebemos o seu pedido".
  if (corpo.source_name !== 'web') return { acao: 'ignorar', motivo: 'pedido_de_outro_canal' }

  const { telefone } = contatoDoPedido(corpo)
  if (!telefone) return { acao: 'ignorar', motivo: 'sem_telefone' }
  const numero = texto(corpo.name) ?? (Number.isSafeInteger(corpo.order_number) ? `#${corpo.order_number}` : null)
  if (!numero) return { acao: 'ignorar', motivo: 'sem_numero' }

  return {
    acao: 'registrar_pedido',
    args: {
      p_pedido_id: id,
      p_numero: numero,
      p_nome: nomeDe(corpo.shipping_address) ?? nomeDe(corpo.billing_address) ?? nomeDe(corpo.customer),
      p_telefone: telefone,
      p_criado_em: texto(corpo.created_at),
    },
  }
}
