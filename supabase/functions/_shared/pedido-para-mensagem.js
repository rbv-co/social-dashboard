// supabase/functions/_shared/pedido-para-mensagem.js
//
// O que fazer com os webhooks de PEDIDO para as mensagens transacionais (pedido recebido, pagamento confirmado).
// Função pura: recebe o tópico (X-Shopify-Topic) e o corpo já lido. Quem grava é `aplicarPedido`/`aplicarPagamento`
// (aplicar-decisao.js). Design: docs/superpowers/specs/2026-09-30-fluxo-de-mensagens-design.md e
// docs/superpowers/specs/2026-10-04-mensagens-pos-pedido-design.md
import { contatoDoPedido, nomeDe, texto } from './abandono-de-checkout.js'

/**
 * Dados comuns a qualquer mensagem transacional do pedido (pedido recebido, pagamento confirmado):
 * mesmas regras de elegibilidade (loja online, não teste, com telefone e número).
 * @returns {{ok:true, args:object} | {ok:false, motivo:string}}
 */
function dadosDoPedido(corpo) {
  const id = Number.isSafeInteger(corpo.id) ? corpo.id : null
  if (!id) return { ok: false, motivo: 'sem_id' }
  if (corpo.test === true) return { ok: false, motivo: 'pedido_de_teste' }
  // Só a loja online: PDV, rascunho do admin e outros canais não recebem estas mensagens.
  if (corpo.source_name !== 'web') return { ok: false, motivo: 'pedido_de_outro_canal' }

  const { telefone } = contatoDoPedido(corpo)
  if (!telefone) return { ok: false, motivo: 'sem_telefone' }
  const numero = texto(corpo.name) ?? (Number.isSafeInteger(corpo.order_number) ? `#${corpo.order_number}` : null)
  if (!numero) return { ok: false, motivo: 'sem_numero' }

  return {
    ok: true,
    args: {
      p_pedido_id: id,
      p_numero: numero,
      p_nome: nomeDe(corpo.shipping_address) ?? nomeDe(corpo.billing_address) ?? nomeDe(corpo.customer),
      p_telefone: telefone,
      p_criado_em: texto(corpo.created_at),
    },
  }
}

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

  const d = dadosDoPedido(corpo)
  return d.ok ? { acao: 'registrar_pedido', args: d.args } : { acao: 'ignorar', motivo: d.motivo }
}

/**
 * Mensagem de PAGAMENTO CONFIRMADO: mesmas regras de elegibilidade do pedido recebido, disparada em `orders/paid`.
 * @returns {{acao:'registrar_pagamento', args:object} | {acao:'ignorar', motivo:string}}
 */
export function decidirPagamento(topico, corpo) {
  if (!corpo || typeof corpo !== 'object') return { acao: 'ignorar', motivo: 'corpo_invalido' }
  if (topico !== 'orders/paid') return { acao: 'ignorar', motivo: 'topico_nao_tratado' }

  const d = dadosDoPedido(corpo)
  return d.ok ? { acao: 'registrar_pagamento', args: d.args } : { acao: 'ignorar', motivo: d.motivo }
}
