// supabase/functions/_shared/opt-out.js
//
// Reconhece, no webhook de mensagem recebida do Chatwoot, o cliente pedindo para NÃO receber
// mais mensagem (o botão do template ou as palavras PARAR/SAIR). Frase exata: uma palavra solta
// dentro de uma conversa normal ("posso parar na loja?") NÃO bloqueia ninguém.
import { normalizarTelefone } from './mensagem-de-abandono.js'

const FRASES = new Set(['parar', 'pare', 'sair'])
const PREFIXO = 'nao quero receber'

const limpar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

export function extrairOptOut(corpo) {
  if (!corpo || corpo.event !== 'message_created' || corpo.message_type !== 'incoming') return null
  const texto = limpar(String(corpo.content ?? ''))
  if (!(FRASES.has(texto) || texto.startsWith(PREFIXO))) return null
  const bruto = corpo.sender?.phone_number ?? corpo.conversation?.meta?.sender?.phone_number ?? ''
  const telefone = normalizarTelefone(bruto)
  return telefone ? { telefone, motivo: `resposta: ${texto}` } : null
}
