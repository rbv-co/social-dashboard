//
// Verificação de assinatura HMAC dos Webhooks nativos da Shopify (não tem
// relação com o Web Pixel nem com o interceptador de tema — este é o
// mecanismo de webhook de verdade da Shopify, servidor-a-servidor). A
// Shopify assina o CORPO CRU da requisição com HMAC-SHA256 e manda em
// base64 no cabeçalho X-Shopify-Hmac-Sha256; confirma quem está chamando
// de verdade é a Shopify, já que quem chama não é navegador (não tem
// Origin de página pra conferir, como no capturar-evento-carrinho).
// Ver receber-webhook-checkout/index.ts.

async function calcularAssinatura(segredo, corpoCru) {
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpoCru))
  return btoa(String.fromCharCode(...new Uint8Array(assinatura)))
}

// Comparação em tempo constante — comparar string com === vaza, por timing,
// em qual posição a comparação falhou. Não é hipotético demais pra isto
// aqui: é exatamente a superfície que autentica quem pode gravar evento em
// nome da Shopify.
function compararSemVazarTempo(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diferenca = 0
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diferenca === 0
}

/** @returns {Promise<boolean>} */
export async function assinaturaValida(segredo, corpoCru, assinaturaRecebida) {
  if (!segredo || !corpoCru || typeof assinaturaRecebida !== 'string' || !assinaturaRecebida) return false
  const esperada = await calcularAssinatura(segredo, corpoCru)
  return compararSemVazarTempo(esperada, assinaturaRecebida)
}

/**
 * Extrai só o que interessa do corpo do webhook checkouts/create — o resto
 * do payload (endereço, e-mail, itens) fica de fora de propósito, o mesmo
 * corte de dado que os outros eventos de carrinho já seguem.
 * @returns {{tipo:'checkout_iniciado', cart_token:string|null}}
 */
export function extrairEventoDeCheckout(corpo) {
  const cartToken = corpo && typeof corpo.cart_token === 'string' && corpo.cart_token.trim()
    ? corpo.cart_token.trim() : null
  return { tipo: 'checkout_iniciado', cart_token: cartToken }
}
