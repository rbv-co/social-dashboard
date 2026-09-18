//
// Regra pura de validação do payload que o Web Pixel Extension manda pra
// capturar-evento-carrinho, e da decisão de rate limit por IP. Separado do
// index.ts porque o Deno da edge não roda `node --test`, e aqui dá pra testar
// sem subir nada — ver spec
// docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.

export const TIPOS_ACEITOS = ['produto_adicionado', 'produto_removido', 'checkout_iniciado']

// Teto de eventos por IP, por minuto. Por IP, nunca por cart_token — pedido
// explícito do dono, pra nunca barrar um cliente de verdade por conta de
// demanda alta (um carrinho não é o alvo do abuso; um IP martelando é).
export const TETO_POR_MINUTO = 60

function numeroOuNulo(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Valida o corpo cru recebido pela edge function.
 * @returns {{ok:true, evento:object}|{ok:false, motivo:string}}
 */
export function validarPayload(corpo) {
  if (!corpo || typeof corpo !== 'object') return { ok: false, motivo: 'corpo_invalido' }
  if (!TIPOS_ACEITOS.includes(corpo.tipo)) return { ok: false, motivo: 'tipo_invalido' }
  if (typeof corpo.cart_token !== 'string' || !corpo.cart_token.trim()) {
    return { ok: false, motivo: 'cart_token_obrigatorio' }
  }
  return {
    ok: true,
    evento: {
      tipo: corpo.tipo,
      cart_token: corpo.cart_token.trim(),
      produto_id: corpo.produto_id != null ? String(corpo.produto_id) : null,
      produto_titulo: corpo.produto_titulo != null ? String(corpo.produto_titulo) : null,
      variante_id: corpo.variante_id != null ? String(corpo.variante_id) : null,
      quantidade: numeroOuNulo(corpo.quantidade),
      preco: numeroOuNulo(corpo.preco),
    },
  }
}

/** Já passou do teto de eventos por IP no último minuto? */
export function passouDoLimite(contagemUltimoMinuto, teto = TETO_POR_MINUTO) {
  return contagemUltimoMinuto >= teto
}
