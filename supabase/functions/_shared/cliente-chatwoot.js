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

const TIMEOUT_MS = 15000

/**
 * 401/403 -> parar a rodada (credencial); 429/5xx/rede -> tentar de novo; demais 4xx -> falhou.
 * ⚠️ Rede/timeout (status 0) no `enviar_template` NÃO tenta de novo: a requisição pode ter chegado
 * e a mensagem saído, e retentar mandaria DUAS ao cliente. Vira `falhou` (visível na tela).
 */
export function classificarErro(e) {
  if (!(e instanceof ErroChatwoot)) return 'tentar_de_novo'
  if (e.status === 0) return e.passo === 'enviar_template' ? 'falhou' : 'tentar_de_novo'
  if (e.status === 401 || e.status === 403) return 'parar'
  if (e.status === 429 || e.status >= 500) return 'tentar_de_novo'
  return 'falhou'
}

/** O "nome" do contato é só um telefone (ou está vazio)? Ex.: "5521983892620", "+55 21 98389-2620". */
const pareceTelefone = (nome) => /^[+\d\s()-]*$/.test(String(nome ?? '').trim())

export function criarClienteChatwoot({ url, contaId, caixaId, token, botSecret, fetchFn = fetch }) {
  const base = `${url.replace(/\/$/, '')}/api/v1/accounts/${contaId}`

  async function chamar(passo, caminho, { metodo = 'GET', corpo } = {}) {
    let r
    try {
      r = await fetchFn(base + caminho, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', api_access_token: token },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      // Rede ou timeout: erro identificado (status 0), com o passo, para o robô saber o que fazer.
      throw new ErroChatwoot(0, String(e?.message ?? e).slice(0, 160), passo)
    }
    const texto = await r.text()
    let json = null
    try { json = texto ? JSON.parse(texto) : null } catch { /* corpo que não é JSON: fica só o texto */ }
    if (!r.ok) throw new ErroChatwoot(r.status, json ?? texto, passo)
    return json
  }

  return {
    /**
     * Reserva o aviso único no core do Chatwoot (custom_api, autenticado por `X-Bot-Secret`, NÃO pelo api_access_token).
     * Devolve 'reservado' | 'duplicado' | 'janela' | 'adiado'. Qualquer outra coisa LANÇA ErroChatwoot (passo
     * `reservar_aviso`): quem chama só envia se vier 'reservado'. O segredo e o telefone nunca entram em erro nem log.
     */
    async reservarAviso({ phone, tipo, chave }) {
      let r
      try {
        r = await fetchFn(`${url.replace(/\/$/, '')}/custom_api/v1/accounts/${contaId}/avisos/reservar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': botSecret },
          body: JSON.stringify({ phone, tipo, chave }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (e) {
        throw new ErroChatwoot(0, 'rede_ou_timeout', 'reservar_aviso')
      }
      const texto = await r.text()
      let json = null
      try { json = texto ? JSON.parse(texto) : null } catch { /* não é JSON */ }
      if (!r.ok) throw new ErroChatwoot(r.status, null, 'reservar_aviso')
      if (json?.ok !== true || !['reservado', 'duplicado', 'janela', 'adiado'].includes(json.resultado)) {
        throw new ErroChatwoot(r.status, 'resposta_inesperada', 'reservar_aviso')
      }
      return json.resultado
    },

    async acharOuCriarContato({ nome, telefone }) {
      const e164 = '+' + telefone
      const achados = await chamar('buscar_contato', `/contacts/search?q=${encodeURIComponent(e164)}`)
      const existente = (achados?.payload ?? []).find((c) => c.phone_number === e164)
      if (existente) {
        // A automação de triagem do Chatwoot cria o contato com o TELEFONE como nome. Se é só isso (ou
        // vazio), põe o nome da cliente. Nome real que alguém já colocou NUNCA é sobrescrito.
        // `name` ausente da resposta = desconhecido (não mexe); null ou "" = vazio (o Chatwoot sempre devolve o campo).
        if (nome?.trim() && existente.name !== undefined && pareceTelefone(existente.name)) {
          try {
            await chamar('atualizar_contato', `/contacts/${existente.id}`, { metodo: 'PUT', corpo: { name: nome.trim() } })
          } catch (e) {
            // Nome é cosmético: falha aqui não pode impedir o envio. Credencial recusada, sim, para a rodada.
            if (classificarErro(e) === 'parar') throw e
          }
        }
        return existente.id
      }
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

    /**
     * A cliente já respondeu nesta conversa? Mensagem RECEBIDA = `message_type` 0 (enviada 1, atividade 2, template 3),
     * entre as últimas 20 que a API devolve. ⚠️ Falha na leitura LANÇA: "não consegui ler" NÃO é "não respondeu"
     * (quem chama não envia). Quem tocou em "Não quero receber" também chega aqui como mensagem recebida.
     *
     * `desde` (opcional; Date, ISO ou string do banco): só conta a resposta recebida NESSE momento ou depois. A conversa
     * da cliente é reaproveitada (uma por contato), então sem isto uma conversa antiga com a loja contaria como
     * "respondeu". Mensagem recebida sem data legível, ou `desde` inválido, LANÇA (falha fechada).
     */
    async respondeu({ conversaId, desde }) {
      const r = await chamar('ler_conversa', `/conversations/${conversaId}/messages`)
      const mensagens = Array.isArray(r) ? r : r?.payload
      if (!Array.isArray(mensagens)) throw new ErroChatwoot(200, 'resposta_inesperada', 'ler_conversa')
      const recebidas = mensagens.filter((m) => m?.message_type === 0)
      if (desde === undefined || desde === null) return recebidas.length > 0
      const limite = new Date(desde).getTime() / 1000 // o Chatwoot manda created_at em segundos
      if (!Number.isFinite(limite)) throw new ErroChatwoot(200, 'desde_invalido', 'ler_conversa')
      return recebidas.some((m) => {
        if (!Number.isFinite(Number(m.created_at))) throw new ErroChatwoot(200, 'mensagem_sem_data', 'ler_conversa')
        return Number(m.created_at) >= limite
      })
    },
  }
}
