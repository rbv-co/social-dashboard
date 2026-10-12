import { SUPABASE_URL, SUPABASE_ANON_KEY } from './conectar-no-banco-de-dados.js'
import { estado } from './controle-de-login-e-usuario.js'
import { classificarErro, ERRO_DE_REDE } from './classificar-erro.js'
import { pedir, erroDaApi } from './api.js'

// Anexa o erro ao array SEM torná-lo enumerável: quem não sabe do .erro continua
// vendo um array normal (length 0, map, spread, JSON) — é o que mantém os 53
// sítios de chamada existentes funcionando sem alteração. Quem quer tratar,
// faz `if (linhas.erro)`.
//
// Atenção: linhas.filter(...) devolve um array novo e PERDE o .erro. Cheque o
// .erro logo após a chamada, antes de transformar.
export function comErro(array, erro) {
  Object.defineProperty(array, 'erro', { value: erro, enumerable: false, writable: true })
  return array
}

// Helper de leitura ao REST do Supabase.
// Antes: `catch (e) { return [] }` — qualquer falha virava lista vazia, e a tela
// mostrava "R$ 0" como se fosse verdade. Três estados distintos ("não tem nada",
// "falhou", "sem permissão") colapsavam num só.
//
// O que o .erro pega: sessão expirada (401), falta de GRANT (42501), erro do
// servidor (5xx) e queda de rede.
// O que ele NÃO pega: negação de RLS. O PostgREST responde 200 com lista vazia
// quando a política de linha esconde tudo — do lado de cá é idêntico a "a tabela
// realmente não tem nada para você". Isso continua invisível.
export async function sb(path) {
  try {
    const token = estado.currentSession?.access_token || SUPABASE_ANON_KEY
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    })
    const json = await r.json().catch(() => null)
    if (!r.ok) return comErro([], classificarErro(r.status, json))
    if (!Array.isArray(json)) return comErro([], classificarErro(r.status, json))
    return json
  } catch (e) {
    return comErro([], ERRO_DE_REDE)
  }
}

// Leitura de domínio pela API em Go (Plano 7), no MESMO formato de `sb`: array,
// com `.erro` (não enumerável) quando falha. Sem permissão a API responde
// `200 []`, como a RLS — continua invisível, igual ao `sb`.
export async function lerDaApi(caminho, params) {
  const { data, error } = await pedir('GET', caminho, { params })
  if (error) return comErro([], error)
  if (!Array.isArray(data)) return comErro([], erroDaApi(502, null))
  return data
}
