//
// Regra pura de validação do payload que o Web Pixel Extension manda pra
// capturar-evento-carrinho, e da decisão de rate limit por IP. Separado do
// index.ts porque o Deno da edge não roda `node --test`, e aqui dá pra testar
// sem subir nada — ver spec
// docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.

// sessao_iniciada removido da lista em 21/09/2026 — ~25% do volume era bot
// conhecido (Googlebot, crawler da própria Meta), sem user_agent gravado
// pra filtrar isso de forma confiável. Rejeitar aqui barra a escrita no
// banco mesmo antes de republicar o tema — o interceptador silencia erro
// de rede de propósito (ver `enviar()`), então uma cópia antiga ainda
// mandando o evento falha em silêncio, sem quebrar nada pro visitante.
export const TIPOS_ACEITOS = ['produto_adicionado', 'produto_removido', 'checkout_iniciado']

// session_id (cookie _shopify_s da própria Shopify) é quem liga tudo,
// obrigatório em todo evento — ver
// db/migrations/2026-09-18-carrinho-eventos-sessao.sql.
const TIPOS_QUE_EXIGEM_CART_TOKEN = ['produto_adicionado', 'produto_removido', 'checkout_iniciado']

// Teto de eventos por IP, por minuto. Por IP, nunca por cart_token — pedido
// explícito do dono, pra nunca barrar um cliente de verdade por conta de
// demanda alta (um carrinho não é o alvo do abuso; um IP martelando é).
export const TETO_POR_MINUTO = 60

function numeroOuNulo(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function textoOuNulo(v) {
  if (typeof v !== 'string') return null
  const limpo = v.trim()
  return limpo ? limpo : null
}

/**
 * Valida o corpo cru recebido pela edge function.
 * @returns {{ok:true, evento:object}|{ok:false, motivo:string}}
 */
export function validarPayload(corpo) {
  if (!corpo || typeof corpo !== 'object') return { ok: false, motivo: 'corpo_invalido' }
  if (!TIPOS_ACEITOS.includes(corpo.tipo)) return { ok: false, motivo: 'tipo_invalido' }
  if (TIPOS_QUE_EXIGEM_CART_TOKEN.includes(corpo.tipo) && (typeof corpo.cart_token !== 'string' || !corpo.cart_token.trim())) {
    return { ok: false, motivo: 'cart_token_obrigatorio' }
  }
  if (typeof corpo.session_id !== 'string' || !corpo.session_id.trim()) {
    return { ok: false, motivo: 'session_id_obrigatorio' }
  }
  return {
    ok: true,
    evento: {
      tipo: corpo.tipo,
      session_id: corpo.session_id.trim(),
      cart_token: textoOuNulo(corpo.cart_token),
      produto_id: corpo.produto_id != null ? String(corpo.produto_id) : null,
      produto_titulo: corpo.produto_titulo != null ? String(corpo.produto_titulo) : null,
      variante_id: corpo.variante_id != null ? String(corpo.variante_id) : null,
      quantidade: numeroOuNulo(corpo.quantidade),
      preco: numeroOuNulo(corpo.preco),
      // Atribuição do Meta, quando existir — ver
      // db/migrations/2026-09-18-carrinho-eventos-fbp-fbc.sql.
      fbp: textoOuNulo(corpo.fbp),
      fbc: textoOuNulo(corpo.fbc),
      // Atribuição multi-canal (Google Ads, e-mail, orgânico) — ver
      // db/migrations/2026-09-19-carrinho-eventos-origem.sql.
      utm_source: textoOuNulo(corpo.utm_source),
      utm_medium: textoOuNulo(corpo.utm_medium),
      utm_campaign: textoOuNulo(corpo.utm_campaign),
      gclid: textoOuNulo(corpo.gclid),
      referrer: textoOuNulo(corpo.referrer),
    },
  }
}

/** Já passou do teto de eventos por IP no último minuto? */
export function passouDoLimite(contagemUltimoMinuto, teto = TETO_POR_MINUTO) {
  return contagemUltimoMinuto >= teto
}
