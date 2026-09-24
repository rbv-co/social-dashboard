// supabase/functions/_shared/verificar-webhook-chatwoot.js
//
// Evento de CRM que o Chatwoot manda (Custom::CrmEventWebhookService, do
// lado de lá) quando uma conversa vira lead novo ou lead quente. Chatwoot
// não assina o corpo (sem HMAC nativo, diferente do webhook da Shopify —
// ver verificar-webhook-shopify.js) — autentica por um segredo fixo, na
// própria URL do webhook, comparado em tempo constante (mesmo motivo do
// outro arquivo: comparar com === vaza, por timing, em qual posição a
// comparação falhou).
// Ver receber-webhook-chatwoot/index.ts e
// docs/superpowers/specs/2026-09-24-chatwoot-leads-design.md.
export function tokenValido(segredo, recebido) {
  if (!segredo || typeof recebido !== 'string' || recebido.length !== segredo.length) return false
  let diferenca = 0
  for (let i = 0; i < recebido.length; i++) diferenca |= recebido.charCodeAt(i) ^ segredo.charCodeAt(i)
  return diferenca === 0
}

const TIPOS_VALIDOS = new Set(['lead_novo', 'lead_quente'])

// `agora` só entra quando o Chatwoot não manda (ou manda inválido) o
// `created_at` — não deveria acontecer, mas nunca trava a gravação por
// isso. Parâmetro pra dar pra testar o fallback sem depender do relógio de
// verdade.
export function extrairEventoDoChatwoot(corpo, agora = new Date()) {
  if (!corpo || !TIPOS_VALIDOS.has(corpo.tipo) || !corpo.conversation_id) return null

  const dataCrua = corpo.created_at ? new Date(corpo.created_at) : null
  const criadoEmChatwoot = dataCrua && !Number.isNaN(dataCrua.getTime()) ? dataCrua : agora

  return {
    tipo: corpo.tipo,
    chatwoot_account_id: corpo.account_id ?? null,
    conversation_id: corpo.conversation_id,
    conversation_display_id: corpo.conversation_display_id ?? null,
    contact_id: corpo.contact_id ?? null,
    contact_name: corpo.contact_name ?? null,
    contact_phone_number: corpo.contact_phone_number ?? null,
    loja: corpo.loja ?? null,
    classificacao_ia: corpo.classificacao_ia ?? null,
    criado_em_chatwoot: criadoEmChatwoot.toISOString(),
    dia_br: criadoEmChatwoot.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
  }
}
