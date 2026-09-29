// supabase/functions/_shared/template-meta.js
//
// Monta (e valida) o modelo de mensagem da recuperação de checkout no formato da API da Meta
// (POST /{WABA_ID}/message_templates). Função pura: quem chama a Meta é coletor/template-meta.mjs.
// Formato conferido na documentação: BODY com example.body_text, BUTTONS com URL dinâmico
// (example = SÓ o valor da variável) e QUICK_REPLY.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components

const LIMITE_CORPO = 1024
const LIMITE_RODAPE = 60
const LIMITE_BOTAO = 25

/** @returns {object} corpo do POST para a Meta. Categoria sempre MARKETING (recuperação de carrinho). */
export function montarTemplate({ nome, idioma = 'pt_BR', corpo, exemploCorpo, rodape, textoLink, baseLink, exemploLink, textoResposta }) {
  const components = [{ type: 'BODY', text: corpo, example: { body_text: [[exemploCorpo]] } }]
  if (rodape) components.push({ type: 'FOOTER', text: rodape })
  components.push({
    type: 'BUTTONS',
    buttons: [
      // ⚠️ O botão de link é o PRIMEIRO: o robô (Chatwoot) preenche o botão na posição 0.
      { type: 'URL', text: textoLink, url: `${baseLink}{{1}}`, example: [exemploLink] },
      { type: 'QUICK_REPLY', text: textoResposta },
    ],
  })
  return { name: nome, language: idioma, category: 'MARKETING', components }
}

/** Regras da Meta que o modelo tem que respeitar ANTES de gastar uma submissão. Vazio = ok. */
export function validarTemplate({ nome, corpo, exemploCorpo, rodape, textoLink, baseLink, exemploLink, textoResposta }) {
  const p = []
  if (!/^[a-z0-9_]{1,512}$/.test(nome ?? '')) p.push('nome inválido (só minúsculas, números e _)')
  const variaveis = (corpo ?? '').match(/\{\{\s*\w+\s*\}\}/g) ?? []
  if (variaveis.length !== 1 || variaveis[0] !== '{{1}}') p.push('o corpo precisa de exatamente uma variável, a {{1}} (o primeiro nome)')
  if ((corpo ?? '').length > LIMITE_CORPO) p.push(`corpo passa de ${LIMITE_CORPO} caracteres`)
  if ((corpo ?? '').trimStart().startsWith('{{1}}')) p.push('variável no começo do corpo (a Meta recusa)')
  if ((corpo ?? '').trimEnd().endsWith('{{1}}')) p.push('variável no fim do corpo (a Meta recusa)')
  if (!exemploCorpo) p.push('falta o exemplo da variável do corpo')
  if ((rodape ?? '').length > LIMITE_RODAPE) p.push(`rodapé passa de ${LIMITE_RODAPE} caracteres`)
  if (!textoLink || textoLink.length > LIMITE_BOTAO) p.push(`texto do botão de link vazio ou acima de ${LIMITE_BOTAO} caracteres`)
  if (!textoResposta || textoResposta.length > LIMITE_BOTAO) p.push(`texto da resposta rápida vazio ou acima de ${LIMITE_BOTAO} caracteres`)
  if (!/^https:\/\/.+\/$/.test(baseLink ?? '')) p.push('baseLink precisa começar com https:// e terminar com /')
  if (!exemploLink || /^https?:\/\//.test(exemploLink)) p.push('exemploLink deve ser só o valor da variável, sem a URL inteira')
  return p
}

/** Modelo B (versão curta). O A (`recuperacao_checkout_v1`) foi criado pela tela da Meta. */
export const TEMPLATE_B = {
  nome: 'recuperacao_checkout_v2',
  idioma: 'pt_BR',
  corpo: 'Oi, {{1}}! Seu carrinho na Vessel ficou guardado. Quer finalizar? Se precisar de ajuda com a peça, o prazo ou o pagamento, é só responder aqui.',
  exemploCorpo: 'Maria',
  rodape: 'Vessel Brasil',
  textoLink: 'Finalizar compra',
  baseLink: 'https://loja.vesselbrasil.com.br/',
  // Valor inventado, no formato real dos links (token, código e chave falsos).
  exemploLink: '77052313848/checkouts/c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6/hWNAbCdEfGhIjKlMnOpQrStU/recover?key=0a1b2c3d4e5f60718293a4b5c6d7e8f9&locale=pt-BR',
  textoResposta: 'Não quero receber',
}
