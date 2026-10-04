// supabase/functions/_shared/aplicar-decisao.js
//
// Grava no banco o que `decidir` mandou fazer e devolve a resposta HTTP do webhook. Com `sb` injetado,
// para testar sem a edge. Quem chama: receber-webhook-abandono/index.ts.
//
// ⚠️ Erro de banco devolve 500, NÃO 200: a Shopify reenvia quando não vê 2xx, e as funções são idempotentes
// (reenviar o mesmo evento é inofensivo). Com 200, um soluço do banco perdia o evento "comprou" e a cliente
// que pagou recebia a mensagem de recuperação.
import { decidir } from './abandono-de-checkout.js'
import { decidirPedido, decidirPagamento } from './pedido-para-mensagem.js'

const FUNCAO_DO_PEDIDO = {
  pagamento_pendente: 'marcar_checkout_pagamento_pendente',
  reabrir: 'reabrir_checkout_abandono',
}

/** @returns {Promise<{status: number, corpo: object}>} */
export async function aplicarDecisao(sb, decisao) {
  if (decisao.acao === 'ignorar') return { status: 200, corpo: { ok: true, ignorado: decisao.motivo } }

  const { error } = decisao.acao === 'registrar'
    ? await sb.rpc('registrar_checkout_abandono', decisao.args)
    : decisao.acao === 'comprou'
      ? await sb.rpc('marcar_checkout_comprou', { p_token: decisao.token, p_email: decisao.email, p_telefone: decisao.telefone })
      : await sb.rpc(FUNCAO_DO_PEDIDO[decisao.acao], { p_token: decisao.token })

  if (error) {
    console.error(`falha ao gravar abandono de checkout (${decisao.acao}):`, error.message)
    return { status: 500, corpo: { ok: false, erro: 'falha_ao_gravar' } }
  }
  return { status: 200, corpo: { ok: true } }
}

/** Grava a decisão do PEDIDO (mensagem "já recebemos o seu pedido"). Mesma regra: erro de banco = 500. */
export async function aplicarPedido(sb, decisao) {
  if (decisao.acao === 'ignorar') return { status: 200, corpo: { ok: true, ignorado: decisao.motivo } }

  const { error } = decisao.acao === 'registrar_pedido'
    ? await sb.rpc('registrar_pedido_para_mensagem', decisao.args)
    : await sb.rpc('cancelar_mensagem_pedido', { p_pedido_id: decisao.pedidoId })

  if (error) {
    console.error(`falha ao gravar mensagem de pedido (${decisao.acao}):`, error.message)
    return { status: 500, corpo: { ok: false, erro: 'falha_ao_gravar' } }
  }
  return { status: 200, corpo: { ok: true } }
}

/** Grava a decisão do PAGAMENTO (mensagem "pagamento confirmado"). Mesma regra: erro de banco = 500. */
export async function aplicarPagamento(sb, decisao) {
  if (decisao.acao === 'ignorar') return { status: 200, corpo: { ok: true, ignorado: decisao.motivo } }

  const { error } = await sb.rpc('registrar_pagamento_para_mensagem', decisao.args)
  if (error) {
    console.error('falha ao gravar mensagem de pagamento:', error.message)
    return { status: 500, corpo: { ok: false, erro: 'falha_ao_gravar' } }
  }
  return { status: 200, corpo: { ok: true } }
}

/**
 * O webhook inteiro: a fila de abandono, a mensagem do pedido E a de pagamento. As TRÊS gravações rodam sempre
 * (uma falha não pula as outras) e, se qualquer uma falhar, a resposta é a falha (a Shopify reenvia; são idempotentes).
 */
export async function processarWebhook(sb, topico, corpo) {
  const checkout = await aplicarDecisao(sb, decidir(topico, corpo))
  const pedido = await aplicarPedido(sb, decidirPedido(topico, corpo))
  const pagamento = await aplicarPagamento(sb, decidirPagamento(topico, corpo))
  return [checkout, pedido, pagamento].find((r) => r.status !== 200) ?? checkout
}
