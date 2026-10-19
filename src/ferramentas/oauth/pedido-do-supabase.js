// O consentimento pelo servidor OAuth do Supabase Auth (supabase/functions/mcp-frota). Diferente da API Go,
// lá o token emitido é um token COMUM da pessoa (vale para a Central inteira pelo PostgREST, não só para a
// Frota) e o Supabase deixa qualquer cliente se registrar. Por isso esta tela só aprova o que o MCP precisa:
// retorno no ChatGPT, gestor da Frota e sessão própria. A tela é a única porta antes do token: o Supabase não
// tem como restringir cliente nem escopo.
// ponytail: trava no front, que basta enquanto o Supabase grava (até a virada); a API Go confere no servidor.
import { areasVisiveis } from '../frota/areas-da-frota.js'

export const HOSTS_DO_CHATGPT = ['chatgpt.com', 'chat.openai.com']
export const FRASE_SO_GESTOR = 'Só quem administra a Frota (aba Gestão) pode ligar o ChatGPT a ela.'

export function avaliarPedido({ pode, entrarComo, redirectUri }) {
  let host = ''
  try {
    const u = new URL(redirectUri)
    if (u.protocol === 'https:' && !u.port) host = u.hostname
  } catch { /* endereço inválido: host fica vazio e o pedido é recusado */ }
  if (!HOSTS_DO_CHATGPT.includes(host)) {
    return { pode: false, mensagem: 'Este pedido não veio do ChatGPT. Por segurança, só o ChatGPT pode ser ligado à Frota.' }
  }
  if (entrarComo) return { pode: false, mensagem: 'No modo "entrar como" não dá para autorizar em nome da outra pessoa.' }
  const gestor = areasVisiveis(pode).includes('gestao') // pode(acao) = hasPermission('frota', acao)
  if (!gestor) return { pode: false, mensagem: FRASE_SO_GESTOR }
  return { pode: true, mensagem: '' }
}
