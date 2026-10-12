// O CLIENTE DA API EM GO (Plano 7 da saída do Supabase).
//
// Fala o contrato II.2 do plano-mãe (docs/superpowers/plans/2026-10-11-api-go-
// plano-5-dominios.md) e devolve `{ data, error }` NO MESMO FORMATO do
// supabase-js. É de propósito: cada sítio trocado continua lendo `data` e
// `error` como lia, e a troca vira mecânica em vez de reescrita.
//
// ⚠️ TUDO ATRÁS DE CHAVE, E A CHAVE É DE BUILD. `VITE_API_AREAS` diz quais áreas
// já falam com a API (lista por vírgula, ou `*`). O build de produção não define
// a variável: nenhuma área liga e a Central segue inteira no Supabase até a
// virada (Plano 8). As áreas e as telas de cada uma: Plano 7, seção I.
//
// ⚠️ `conta` É A BASE. A sessão do Supabase e a da API não convivem: uma tela na
// API sem a sessão da API toma 401. Por isso lista com área e sem `conta` não é
// "meio ligado", é erro — e falha ALTO no carregamento. Com `conta` ligada, as
// telas ainda no Supabase ficam sem sessão (o login e o sair pela API encerram
// a do Supabase guardada neste navegador, para nenhuma tela usar a de outra
// pessoa) e mostram "sua sessão expirou" até a área delas ligar.

import { classificarErro, ERRO_DE_REDE, CONTA_DESATIVADA, MUITAS_TENTATIVAS } from './classificar-erro.js'
import { calcularModoEntrarComo } from './modo-entrar-como.js'

export const AREAS = Object.freeze([
  'conta', 'edges-core', 'admin', 'patrimonio', 'frota', 'acessos', 'comercial',
  'meta', 'trafego', 'fabrica', 'conteudo', 'autenticidade', 'vessel', 'paineis',
])

/** O texto de `VITE_API_AREAS` → conjunto de áreas ligadas. Lança se inválido. */
export function lerAreas(texto) {
  const nomes = String(texto || '').split(',').map(s => s.trim()).filter(Boolean)
  if (nomes.includes('*')) return new Set(AREAS)
  for (const n of nomes) {
    if (!AREAS.includes(n)) throw new Error(`VITE_API_AREAS: área desconhecida "${n}" (conhecidas: ${AREAS.join(', ')})`)
  }
  if (nomes.length && !nomes.includes('conta')) {
    throw new Error('VITE_API_AREAS: toda área depende da sessão da API — inclua "conta"')
  }
  return new Set(nomes)
}

// `import.meta.env` só existe no Vite; no `node --test` é undefined.
const ENV = import.meta.env || {}
const LIGADAS = lerAreas(ENV.VITE_API_AREAS)
export const BASE_DA_API = ENV.VITE_API_BASE || '/api'

/** Esta área já fala com a API em Go? */
export function areaNaApi(area) {
  return LIGADAS.has(area)
}

// ── O token da sessão ────────────────────────────────────────────────────────
// Mesma regra de casa da sessão do Supabase (conectar-no-banco-de-dados.js): a
// aba de "entrar como" guarda no sessionStorage, isolado por aba, para não
// sobrescrever a sessão real do admin nas outras abas.
export const CHAVE_DO_TOKEN = 'central_sessao_api'

function armazenamento() {
  try {
    const entrarComo = window.sessionStorage.getItem('modo_entrar_como') === '1'
      || calcularModoEntrarComo(window.location.search)
    return entrarComo ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

export function lerToken() {
  try { return armazenamento()?.getItem(CHAVE_DO_TOKEN) || null } catch { return null }
}
export function guardarToken(token) {
  armazenamento()?.setItem(CHAVE_DO_TOKEN, token)
}
export function apagarToken() {
  try { armazenamento()?.removeItem(CHAVE_DO_TOKEN) } catch { /* nada a apagar */ }
}

// ── A chamada ────────────────────────────────────────────────────────────────

/** Monta o erro: a classificação da casa + o que a API disse. */
export function erroDaApi(status, corpo) {
  // Só da API: o login com a senha certa de uma conta desativada e o limite de
  // tentativas têm resposta própria (antes do 403 genérico, senão a conta
  // desativada leria "sem permissão"). Fica AQUI e não em classificarErro, que
  // o caminho do Supabase também usa — lá um 429 continua "tente de novo".
  const c = corpo?.error === 'conta_desativada' ? CONTA_DESATIVADA
    : status === 429 ? MUITAS_TENTATIVAS
      : classificarErro(status, corpo)
  return { ...c, status, codigo: corpo?.error || null, message: corpo?.mensagem || c.mensagem }
}

/**
 * Uma chamada à API. Nunca lança.
 * @returns {Promise<{data: any, error: object|null, status: number, total: number|null}>}
 */
export async function pedir(metodo, caminho, { corpo, params, semSessao = false } = {}) {
  const headers = {}
  if (!semSessao) {
    const token = lerToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  if (corpo !== undefined) headers['Content-Type'] = 'application/json'
  const busca = params ? '?' + new URLSearchParams(params).toString() : ''
  let r
  try {
    r = await fetch(BASE_DA_API + caminho + busca, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
  } catch {
    return { data: null, error: { ...ERRO_DE_REDE, status: 0, codigo: null, message: ERRO_DE_REDE.mensagem }, status: 0, total: null }
  }
  const texto = r.status === 204 ? '' : await r.text().catch(() => '')
  let dados = null
  let ilegivel = false
  try { dados = texto ? JSON.parse(texto) : null } catch { ilegivel = true }
  const total = r.headers.get('X-Total-Count')
  if (!r.ok) return { data: dados, error: erroDaApi(r.status, dados), status: r.status, total: null }
  // 2xx com HTML (um rewrite do servidor de páginas respondendo no lugar da API)
  // não é sucesso vazio: é a API fora do caminho, e a tela tem de dizer isso.
  if (ilegivel) return { data: null, error: erroDaApi(502, null), status: r.status, total: null }
  return { data: dados, error: null, status: r.status, total: total === null ? null : Number(total) }
}

/** `POST /rpc/{nome}` com o mesmo corpo de `.rpc(nome, args)`. */
export function rpc(nome, args) {
  return pedir('POST', '/rpc/' + encodeURIComponent(nome), { corpo: args ?? {} })
}

/** Edge portada: `POST /<nome>` com o corpo e a resposta da edge. */
export function edge(nome, corpo) {
  return pedir('POST', '/' + nome, { corpo: corpo ?? {} })
}

/**
 * O corpo de uma edge portada, como a tela lia de `await r.json()` na edge do
 * Supabase: sucesso = o corpo; falha = `{ error: <frase> }`. As edges respondem
 * erro com FRASE (`{ error: 'Apenas administradores…' }`); o núcleo da API, com
 * CÓDIGO e `mensagem` (`403 { error: 'sem_permissao', mensagem }` na aba de
 * "entrar como"). Aqui as duas viram frase, para o `throw new Error(res.error)`
 * da tela mostrar coisa legível — nunca "sem_permissao" cru.
 */
export async function corpoDaEdge(nome, corpo) {
  const { data, error } = await edge(nome, corpo)
  if (!error) return data ?? {}
  const daEdge = typeof data?.error === 'string' && !/^[a-z_]+$/.test(data.error) ? data.error : null
  return { ...(data || {}), error: data?.mensagem || daEdge || error.message }
}

/**
 * `conferir-senha` no formato que as telas de assinatura já leem: `{ ok, erro }`,
 * com os códigos da edge (`senha_incorreta`, `bloqueado`, `sem_senha`,
 * `sem_sessao`, `falha_interna`). A API devolve o corpo da edge também no 4xx
 * (429 bloqueado, 400 sem senha); só o "sem sessão" mudou de forma
 * (`401 nao_autenticado`). Na dúvida é senha RECUSADA, nunca concedida.
 */
export async function conferirSenhaPelaApi(senha) {
  const { data, error } = await edge('conferir-senha', { senha })
  if (!error && data?.ok === true) return { ok: true }
  if (data?.erro) return { ok: false, erro: data.erro }
  if (error?.codigo === 'nao_autenticado') return { ok: false, erro: 'sem_sessao' }
  // Aba de "entrar como": a API não confere a senha de ninguém por outra pessoa.
  if (error?.codigo === 'sem_permissao') return { ok: false, erro: 'entrou_como_outra_pessoa' }
  return { ok: false, erro: 'falha_interna' }
}

/**
 * Edge portada no formato de `sbClient.functions.invoke(nome, { body })`:
 * sucesso = `{ data: corpo, error: null }`; falha = `{ data: null, error }`, com
 * `error.context.json()` devolvendo o corpo da resposta — o caminho por onde as
 * telas já leem o motivo de um não-2xx (o supabase-js zera o `data` nesse caso).
 * `error.message` é a frase da classificação da casa.
 */
export async function invocar(nome, corpo) {
  const r = await edge(nome, corpo)
  if (!r.error) return { data: r.data, error: null }
  const daResposta = r.data
  return { data: null, error: { ...r.error, context: { status: r.status, json: async () => daResposta } } }
}

/**
 * Para o sítio que já faz `fetch` numa edge e lê o `Response` (`r.ok`,
 * `r.status`, `r.json()`): mesmo `Response`, outro endereço e o token da API.
 * `caminho` começa com `/` (`/meta-proxy`). O `apikey` do Supabase não vai.
 */
export function fetchDaApi(caminho, init = {}) {
  const headers = { ...(init.headers || {}) }
  delete headers.apikey
  const token = lerToken()
  if (token) headers.Authorization = `Bearer ${token}`
  else delete headers.Authorization
  return fetch(BASE_DA_API + caminho, { ...init, headers })
}

/**
 * `sbClient.functions.invoke(nome, opcoes)` ou a API, pela chave da área. A
 * troca no sítio vira um prefixo, e o ramo do Supabase segue a MESMA chamada.
 */
export function invocarNaArea(area, sbClient, nome, opcoes) {
  return areaNaApi(area) ? invocar(nome, opcoes?.body) : sbClient.functions.invoke(nome, opcoes)
}
