// supabase/functions/_shared/cliente-chatwoot.js
//
// Cliente mínimo da API do Chatwoot para o robô de mensagens de abandono. `fetchFn` injetável:
// o teste não envia nada. ⚠️ Endereços conforme a API pública do Chatwoot; a Task 7 do plano os
// confirma contra a versão instalada. O token NUNCA aparece em log nem em mensagem de erro.

export class ErroChatwoot extends Error {
  constructor(status, corpo, passo) {
    super(`chatwoot ${passo}: HTTP ${status}`)
    this.status = status
    this.corpo = corpo
    this.passo = passo
  }
}

/** 401/403 -> parar a rodada (credencial); 429/5xx/rede -> tentar de novo; demais 4xx -> falhou. */
export function classificarErro(e) {
  if (!(e instanceof ErroChatwoot)) return 'tentar_de_novo'
  if (e.status === 401 || e.status === 403) return 'parar'
  if (e.status === 429 || e.status >= 500) return 'tentar_de_novo'
  return 'falhou'
}

export function criarClienteChatwoot({ url, contaId, caixaId, token, fetchFn = fetch }) {
  const base = `${url.replace(/\/$/, '')}/api/v1/accounts/${contaId}`

  async function chamar(passo, caminho, { metodo = 'GET', corpo } = {}) {
    const r = await fetchFn(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', api_access_token: token },
      body: corpo ? JSON.stringify(corpo) : undefined,
    })
    const texto = await r.text()
    let json = null
    try { json = texto ? JSON.parse(texto) : null } catch { /* corpo que não é JSON: fica só o texto */ }
    if (!r.ok) throw new ErroChatwoot(r.status, json ?? texto, passo)
    return json
  }

  return {
    async acharOuCriarContato({ nome, telefone }) {
      const e164 = '+' + telefone
      const achados = await chamar('buscar_contato', `/contacts/search?q=${encodeURIComponent(e164)}`)
      const existente = (achados?.payload ?? []).find((c) => c.phone_number === e164)
      if (existente) return existente.id
      const criado = await chamar('criar_contato', '/contacts', {
        metodo: 'POST', corpo: { inbox_id: caixaId, name: nome || e164, phone_number: e164 },
      })
      return criado?.payload?.contact?.id ?? criado?.id
    },

    // Para WhatsApp, o source_id do contato na caixa é o número sem o "+".
    async abrirConversa({ contatoId, telefone }) {
      const c = await chamar('abrir_conversa', '/conversations', {
        metodo: 'POST', corpo: { inbox_id: caixaId, contact_id: contatoId, source_id: telefone },
      })
      return c?.id
    },

    async enviarTemplate({ conversaId, texto, templateParams }) {
      const m = await chamar('enviar_template', `/conversations/${conversaId}/messages`, {
        metodo: 'POST',
        corpo: { content: texto, message_type: 'outgoing', private: false, template_params: templateParams },
      })
      return m?.id
    },
  }
}
