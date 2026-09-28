//
// O que fazer com cada webhook do Shopify na fila de abandono. Função pura:
// recebe o tópico (cabeçalho X-Shopify-Topic) e o corpo já lido, devolve a
// decisão. Quem grava é a edge `receber-webhook-abandono` (ver lá).
//
// ⚠️ Diferente de `extrairEventoDeCheckout` (verificar-webhook-shopify.js), que
// descarta e-mail e telefone de propósito: aqui o contato é o objetivo — sem o
// telefone não há WhatsApp de recuperação. Só que "sem contato" também é a
// regra do Shopify para NÃO haver abandono, então checkout sem os dois é ignorado.

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * @returns {{acao:'registrar', args:object} | {acao:'comprou', token:string} | {acao:'ignorar', motivo:string}}
 */
export function decidir(topico, corpo) {
  if (!corpo || typeof corpo !== 'object') return { acao: 'ignorar', motivo: 'corpo_invalido' }

  if (topico === 'orders/create') {
    const token = texto(corpo.checkout_token)
    return token ? { acao: 'comprou', token } : { acao: 'ignorar', motivo: 'pedido_sem_checkout' }
  }

  if (topico === 'checkouts/create' || topico === 'checkouts/update') {
    const token = texto(corpo.token)
    if (!token) return { acao: 'ignorar', motivo: 'sem_token' }
    // O checkout que já virou pedido chega como update com completed_at.
    if (corpo.completed_at) return { acao: 'comprou', token }

    const email = texto(corpo.email) ?? texto(corpo.customer?.email)
    const telefone = texto(corpo.phone) ?? texto(corpo.customer?.phone)
      ?? texto(corpo.shipping_address?.phone) ?? texto(corpo.billing_address?.phone)
    if (!email && !telefone) return { acao: 'ignorar', motivo: 'sem_contato' }

    const total = Number.parseFloat(corpo.total_price)
    return {
      acao: 'registrar',
      args: {
        p_token: token,
        p_email: email,
        p_telefone: telefone,
        p_nome: texto(corpo.customer?.first_name) ?? texto(corpo.billing_address?.first_name)
          ?? texto(corpo.shipping_address?.first_name),
        p_total: Number.isFinite(total) ? total : null,
        p_moeda: texto(corpo.currency) ?? texto(corpo.presentment_currency),
        p_url: texto(corpo.abandoned_checkout_url),
      },
    }
  }

  return { acao: 'ignorar', motivo: 'topico_nao_tratado' }
}
