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

// Nome e sobrenome de um bloco do payload (endereço ou customer). Antes só o first_name
// era guardado e "Luis Fulano" aparecia como "Luis". Quem manda a mensagem que quiser só
// o primeiro nome separa na hora de enviar (a parte antes do primeiro espaço).
const nomeDe = (p) => [texto(p?.first_name), texto(p?.last_name)].filter(Boolean).join(' ') || null

// Pedido só conta como COMPRA quando está pago (ou autorizado). Pix e boleto criam o pedido
// ANTES de pagar, com financial_status 'pending' — isso NÃO é compra (visto em 28/09/2026:
// o QR do Pix foi gerado e o painel já dizia "comprou", com o pedido em Pagamento pendente).
const PAGO = ['paid', 'authorized', 'partially_paid']

/**
 * @returns {{acao:'registrar', args:object}
 *   | {acao:'comprou', token:string|null, email:string|null, telefone:string|null}
 *   | {acao:'pagamento_pendente'|'reabrir', token:string}
 *   | {acao:'ignorar', motivo:string}}
 */
export function decidir(topico, corpo) {
  if (!corpo || typeof corpo !== 'object') return { acao: 'ignorar', motivo: 'corpo_invalido' }

  if (topico === 'orders/create' || topico === 'orders/paid' || topico === 'orders/cancelled') {
    const token = texto(corpo.checkout_token)
    const pago = topico === 'orders/paid' || PAGO.includes(corpo.financial_status)
    // Contato do PEDIDO (o endereço vence o cadastro, como no checkout). Serve para tirar da fila os
    // OUTROS checkouts da mesma pessoa: quem abandona um e compra por outro não pode receber a mensagem.
    const email = texto(corpo.email) ?? texto(corpo.contact_email) ?? texto(corpo.customer?.email)
    const telefone = texto(corpo.phone) ?? texto(corpo.shipping_address?.phone)
      ?? texto(corpo.billing_address?.phone) ?? texto(corpo.customer?.phone)
    if (!token) {
      // Pedido pago sem checkout (admin, WhatsApp) também é uma compra dessa pessoa.
      if (topico !== 'orders/cancelled' && pago && (email || telefone)) return { acao: 'comprou', token: null, email, telefone }
      return { acao: 'ignorar', motivo: 'pedido_sem_checkout' }
    }
    // Pedido cancelado (Pix que expirou): o checkout volta a valer para a recuperação.
    if (topico === 'orders/cancelled') return { acao: 'reabrir', token }
    if (pago) return { acao: 'comprou', token, email, telefone }
    return { acao: 'pagamento_pendente', token }
  }

  if (topico === 'checkouts/create' || topico === 'checkouts/update') {
    const token = texto(corpo.token)
    if (!token) return { acao: 'ignorar', motivo: 'sem_token' }
    // ⚠️ `completed_at` NÃO é compra: com Pix o checkout é "concluído" ao gerar o QR, antes de
    // pagar. Quem decide o destino do checkout são os webhooks de PEDIDO.
    if (corpo.completed_at) return { acao: 'ignorar', motivo: 'checkout_concluido' }

    // ⚠️ ORDEM: o que o cliente DIGITOU no checkout (endereço) vem antes de `customer`.
    // `customer` é o registro do cliente no Shopify: nasce no primeiro passo e NÃO acompanha
    // o que se troca depois no endereço. Com `customer` primeiro, o nome/telefone que o
    // cliente corrigiu no checkout nunca chegava à fila (visto em 28/09/2026, teste real).
    const email = texto(corpo.email) ?? texto(corpo.customer?.email)
    const telefone = texto(corpo.phone) ?? texto(corpo.shipping_address?.phone)
      ?? texto(corpo.billing_address?.phone) ?? texto(corpo.customer?.phone)
    if (!email && !telefone) return { acao: 'ignorar', motivo: 'sem_contato' }

    const total = Number.parseFloat(corpo.total_price)
    return {
      acao: 'registrar',
      args: {
        p_token: token,
        p_email: email,
        p_telefone: telefone,
        p_nome: nomeDe(corpo.shipping_address) ?? nomeDe(corpo.billing_address) ?? nomeDe(corpo.customer),
        p_total: Number.isFinite(total) ? total : null,
        p_moeda: texto(corpo.currency) ?? texto(corpo.presentment_currency),
        p_url: texto(corpo.abandoned_checkout_url),
      },
    }
  }

  return { acao: 'ignorar', motivo: 'topico_nao_tratado' }
}
