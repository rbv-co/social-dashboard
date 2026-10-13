// Descobre se a pessoa chegou por um link de "esqueci a senha" ou de convite.
//
// Por que existe: o SDK do Supabase tem detectSessionInUrl ligado por padrão, então
// ele consome o #access_token e cria a sessão sozinho. Sem esta detecção, a pessoa
// era jogada direto no Início e NUNCA via o formulário de senha nova — continuava
// sem saber a senha e ficava trancada quando a sessão expirava.
//
// Roda ANTES do SDK limpar o hash.
//
// Sem imports de propósito: é uma função pura, e qualquer import da cadeia do
// Supabase quebraria o teste no Node (`window is not defined`).
export function detectarFluxoDeSenha(hash, query) {
  const h = new URLSearchParams((hash || '').replace(/^#/, ''))
  const q = new URLSearchParams((query || '').replace(/^\?/, ''))
  const tipo = h.get('type') || q.get('type')
  if (tipo === 'recovery') return 'recovery'
  if (tipo === 'invite') return 'invite'
  return null
}

// API EM GO (Plano 7, chave `conta`). Os links da API trazem o segredo no
// FRAGMENTO, nunca na query (não chega ao servidor, ao log do nginx nem ao
// Referer):
//   - link de senha:      #type=recovery|invite&token=<token de uso único>
//   - aba "entrar como":  ?modo=entrar-como#sessao=<token de sessão>
// Quem lê PRECISA limpar o hash na hora (history.replaceState) — ver
// ponto-de-partida.js.
export function lerSegredoDoLink(hash) {
  const h = new URLSearchParams((hash || '').replace(/^#/, ''))
  return { tokenDeSenha: h.get('token') || null, sessao: h.get('sessao') || null }
}
