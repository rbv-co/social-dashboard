/* A INSTALAÇÃO DO BANCO DE MENTIRA — roda ANTES de a Central carregar.
 *
 * ⚠️ A ORDEM É TUDO. `conectar-no-banco-de-dados.js` cria o cliente com
 * `window.supabase.createClient(...)` no instante do import, e o supabase-js
 * guarda a referência do `fetch` NESSE instante. Então aqui se troca
 * `window.fetch` primeiro, e só depois `entrada-da-central.js` importa a
 * Central. Trocado depois, o cliente continuaria com o `fetch` de verdade.
 *
 * ⚠️ NADA PARA `*.supabase.co` SAI DO NAVEGADOR. Toda chamada é respondida
 * aqui: a sessão e o perfil são de mentira, as funções do Comercial Vessel vão
 * para `banco-de-mentira.js`, e o que não estava previsto recebe uma resposta
 * vazia com um `console.info('[demonstração] não previsto: …')` — nunca a rede.
 * O mesmo vale para o `fetch` direto que as telas fazem com o token.
 */
import { criarBancoDeMentira, MARCA_DO_BANCO_DE_MENTIRA } from './banco-de-mentira.js'
import { USUARIO_DA_DEMONSTRACAO } from './dados-iniciais.js'
import { ORIGEM_DOS_AVISOS } from './roteiro.js'
import { FERRAMENTAS } from '../compartilhado/catalogo-de-ferramentas.js'

export const REF = 'kounqtdoioootxqegkij'
export const CHAVE_DA_SESSAO = `sb-${REF}-auth-token`
const MARCA_DA_DEMONSTRACAO = 'demonstracao-vessel'
const UID = '00000000-0000-4000-8000-00000000d3e0'
const EMAIL = 'ionara.exemplo@demonstracao.invalido'
const DO_SUPABASE = /^https?:\/\/[^/]*\.supabase\.co(\/|$)/i

const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const CRACHA = [b64({ alg: 'HS256', typ: 'JWT' }),
  b64({ sub: UID, role: 'authenticated', exp: 4102444800, email: EMAIL, aud: 'authenticated' }), 'demonstracao'].join('.')
const USUARIO = { id: UID, aud: 'authenticated', role: 'authenticated', email: EMAIL,
  app_metadata: { provider: 'email' }, user_metadata: { name: USUARIO_DA_DEMONSTRACAO }, created_at: '2026-01-01T00:00:00Z' }
const SESSAO = { access_token: CRACHA, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  refresh_token: 'demonstracao', user: USUARIO }
// ⚠️ O PERFIL DE QUEM USA O COMERCIAL VESSEL: tudo da família 'atendimentos'
// (desde 24/09/2026 cada tela tem a sua chave — sai do catálogo, para a
// demonstração não perder um cartão quando nascer a próxima tela), e só.
const DA_FAMILIA = FERRAMENTAS.filter((f) => f.key === 'atendimentos' || f.key.startsWith('atendimentos.'))
const PERFIL = [{ role: 'viewer', features: ['atendimentos', ...DA_FAMILIA.map((f) => f.key).filter((k) => k !== 'atendimentos')], avatar_url: null,
  permissions: Object.fromEntries(DA_FAMILIA.map((f) => [f.key, f.acoes.slice()])), allowed_accounts: [], is_superadmin: false,
  precisa_trocar_senha: false, escopo_por_equipe: false }]

function resposta(corpo, status = 200, cabecalhos = {}) {
  const sem = status === 204 || corpo === undefined
  return new Response(sem ? null : JSON.stringify(corpo), {
    status, headers: { 'Content-Type': 'application/json', ...cabecalhos },
  })
}

async function lerCorpo(entrada, init) {
  try {
    if (init && typeof init.body === 'string') return init.body ? JSON.parse(init.body) : {}
    if (entrada instanceof Request) { const t = await entrada.clone().text(); return t ? JSON.parse(t) : {} }
  } catch { /* corpo que não é JSON: segue vazio */ }
  return {}
}

/**
 * Pode instalar aqui? ⚠️ A sessão de mentira mora na MESMA chave do
 * `localStorage` que a Central de verdade usa. Se esta página for aberta no
 * endereço da Central (por engano de publicação), ela apagaria a sessão real
 * de quem está logado. Então: só instala se não há sessão, ou se a sessão que
 * há é a da própria demonstração.
 */
export function podeInstalar(armazenamento) {
  try {
    const havia = armazenamento.getItem(CHAVE_DA_SESSAO)
    return !havia || armazenamento.getItem(MARCA_DA_DEMONSTRACAO) === '1'
  } catch { return true }
}

export function instalarBancoDeMentira() {
  const naoPrevistos = []
  const chamadas = []
  const avisar = (evento, dados) => {
    try { window.parent.postMessage({ origem: ORIGEM_DOS_AVISOS, evento, dados }, '*') } catch { /* sem roteiro */ }
  }
  const banco = criarBancoDeMentira({ aoAvisar: avisar })

  // Recarregar volta ao começo: o aparelho também esquece (vista escolhida,
  // "quem envia" do cartão, tema). A trava de `podeInstalar` já garantiu que
  // aqui não há sessão de verdade para perder.
  try {
    localStorage.clear()
    localStorage.setItem(MARCA_DA_DEMONSTRACAO, '1')
    localStorage.setItem(CHAVE_DA_SESSAO, JSON.stringify(SESSAO))
    const escuro = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    localStorage.setItem('tema', escuro ? 'dark' : 'light')
  } catch { /* modo privado: a sessão não fica, e a Central pede login — sem rede de qualquer jeito */ }

  const naoPrevisto = (descricao, corpo) => {
    naoPrevistos.push(descricao)
    console.info(`[demonstração] não previsto: ${descricao}`)
    return corpo
  }

  async function responder(url, metodo, entrada, init) {
    const u = new URL(url)
    const caminho = u.pathname
    if (caminho.startsWith('/auth/v1/')) {
      if (caminho.startsWith('/auth/v1/user')) return resposta(USUARIO)
      if (caminho.startsWith('/auth/v1/token')) return resposta(SESSAO)
      if (caminho.startsWith('/auth/v1/logout')) return resposta(undefined, 204)
      return resposta(naoPrevisto(`${metodo} ${caminho}`, {}))
    }
    if (caminho.startsWith('/rest/v1/rpc/')) {
      const funcao = caminho.slice('/rest/v1/rpc/'.length)
      const corpo = await lerCorpo(entrada, init)
      if (banco.conhece(funcao)) return resposta(banco.chamar(funcao, corpo))
      // ⚠️ FUNÇÃO QUE A DEMONSTRAÇÃO NÃO CONHECE RESPONDE COMO O POSTGREST
      // RESPONDE A FUNÇÃO QUE NÃO EXISTE: 404 com o erro dele. Antes voltava
      // 200 com um objeto `{ ok: false }` — e a tela que espera LISTA (a das
      // Beauty Sessions) guardava o objeto, quebrava ao filtrar e a Central
      // ficava branca. Com o 404, cada tela mostra a faixa de erro dela.
      naoPrevisto(`RPC ${funcao}`)
      return resposta({ code: 'PGRST202', details: null, hint: null,
        message: `Could not find the function public.${funcao} in the schema cache` }, 404)
    }
    if (caminho.startsWith('/rest/v1/')) {
      const tabela = caminho.slice('/rest/v1/'.length)
      if (metodo === 'GET' || metodo === 'HEAD') {
        const linhas = tabela === 'profiles' ? PERFIL
          : banco.conheceTabela(tabela) ? banco.ler(tabela, u.search)
            : naoPrevisto(`GET ${tabela}`, [])
        return resposta(linhas, 200, { 'Content-Range': `0-${Math.max(linhas.length - 1, 0)}/${linhas.length}` })
      }
      return resposta(naoPrevisto(`${metodo} ${tabela}`, []))
    }
    return resposta(naoPrevisto(`${metodo} ${caminho}`, { ok: false, situacao: 'demonstracao' }))
  }

  const fetchDeVerdade = window.fetch.bind(window)
  window.fetch = async function fetchDaDemonstracao(entrada, init) {
    const url = typeof entrada === 'string' ? entrada : (entrada instanceof URL ? entrada.href : entrada?.url)
    if (url && DO_SUPABASE.test(url)) {
      const metodo = String(init?.method || (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase()
      chamadas.push(`${metodo} ${new URL(url).pathname}`)
      return responder(url, metodo, entrada, init)
    }
    return fetchDeVerdade(entrada, init)
  }

  // O tempo real do Supabase (WebSocket) não é usado por estas telas; se algo
  // tentar, não sai daqui.
  const WebSocketDeVerdade = window.WebSocket
  window.WebSocket = function WebSocketDaDemonstracao(url, ...resto) {
    if (DO_SUPABASE.test(String(url).replace(/^ws/, 'http'))) {
      naoPrevisto(`WebSocket ${url}`)
      throw new Error('[demonstração] sem tempo real')
    }
    return new WebSocketDeVerdade(url, ...resto)
  }
  window.WebSocket.prototype = WebSocketDeVerdade.prototype

  neutralizarPushENotificacao()
  window.__demonstracao = { marca: MARCA_DO_BANCO_DE_MENTIRA, chamadas, naoPrevistos, banco }
  avisar('pronta', {})
  return banco
}

/* ⚠️ NADA DE PUSH, SERVICE WORKER NEM PEDIDO DE NOTIFICAÇÃO. A moldura só
 * registra o SW e oferece o push quando `pushSuportado()` diz sim — e ele
 * pergunta por `'PushManager' in window`. Sem ele, a moldura fica quieta, sem
 * mexer em uma linha do código da Central. */
function neutralizarPushENotificacao() {
  try { delete window.PushManager } catch { /* navegador que não deixa */ }
  try {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('[demonstração] sem service worker'))
    }
  } catch { /* segue */ }
  try {
    if (window.Notification) window.Notification.requestPermission = () => Promise.resolve('denied')
  } catch { /* segue */ }
}
