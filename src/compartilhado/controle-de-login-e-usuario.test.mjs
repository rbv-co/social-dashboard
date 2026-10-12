import { test } from 'node:test'
import assert from 'node:assert/strict'

// Este módulo puxa, na cadeia de imports, o conectar-no-banco-de-dados.js, que
// chama window.supabase.createClient() assim que carrega. No navegador o window
// existe; aqui no node, não. Então fingimos um window mínimo ANTES de importar —
// por isso o import é dinâmico e não estático, senão ele rodaria primeiro.
globalThis.window = { supabase: { createClient: () => ({}) } }
const { estado, limparEstado, carregarPerfil, RECURSOS, PERMISSION_TREE } = await import('./controle-de-login-e-usuario.js')

const SESSAO = { access_token: 'tok', user: { id: 'u1' } }

// Deixa o estado como o de um super-admin já carregado, para provar que uma
// falha depois disso NÃO rebaixa ninguém.
function estadoDeSuperAdmin() {
  estado.role = 'admin'
  estado.is_superadmin = true
  estado.permissions = { 'meta.gestor': ['ver', 'editar'] }
  estado.features = ['meta']
  estado.allowed_accounts = ['conta-a']
  estado.userId = 'u1'
  estado.avatarUrl = 'http://x/y.png'
  estado.erroPerfil = null
}

test('limparEstado zera TUDO, nao so a sessao', () => {
  estado.currentSession = { access_token: 'x' }
  estado.user = { id: 'u1' }
  estadoDeSuperAdmin()

  limparEstado()

  assert.equal(estado.currentSession, null)
  assert.equal(estado.user, null)
  assert.equal(estado.role, 'viewer')
  assert.equal(estado.is_superadmin, false)
  assert.deepEqual(estado.permissions, {})
  assert.equal(estado.allowed_accounts, null)
  assert.equal(estado.userId, null)
  assert.equal(estado.avatarUrl, null)
  assert.equal(estado.erroPerfil, null)
})

test('estado nasce com erroPerfil nulo', () => {
  limparEstado()
  assert.equal(estado.erroPerfil, null)
})

test('perfil carregado com sucesso preenche papel e permissoes', async () => {
  limparEstado()
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => [{ role: 'admin', features: ['meta'], permissions: { social: ['ver'] }, allowed_accounts: null, is_superadmin: true, avatar_url: 'http://x/y.png' }],
  })

  const r = await carregarPerfil(SESSAO)

  assert.deepEqual(r, { ok: true, erro: null })
  assert.equal(estado.role, 'admin')
  assert.equal(estado.is_superadmin, true)
  assert.deepEqual(estado.permissions, { social: ['ver'] })
  assert.equal(estado.erroPerfil, null)
})

// O coração da task: a rede cai e o super-admin CONTINUA super-admin.
// Antes, o catch escrevia role='viewer' e permissions={} — a Central abria vazia.
test('falha de rede nao rebaixa o super-admin', async () => {
  estadoDeSuperAdmin()
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }

  const r = await carregarPerfil(SESSAO)

  assert.equal(r.ok, false)
  assert.equal(r.erro.tipo, 'rede')
  assert.equal(estado.erroPerfil.tipo, 'rede')
  // Nada de rebaixar: as flags de antes continuam de pé.
  assert.equal(estado.role, 'admin')
  assert.equal(estado.is_superadmin, true)
  assert.deepEqual(estado.permissions, { 'meta.gestor': ['ver', 'editar'] })
})

test('resposta 401 vira erro de sessao e tambem nao rebaixa', async () => {
  estadoDeSuperAdmin()
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ code: 'PGRST301' }) })

  const r = await carregarPerfil(SESSAO)

  assert.equal(r.ok, false)
  assert.equal(r.erro.tipo, 'sessao')
  assert.equal(estado.erroPerfil.tipo, 'sessao')
  assert.equal(estado.is_superadmin, true)
  assert.equal(estado.role, 'admin')
})

// Um 200 com corpo que não é lista (ex.: erro em JSON) também é falha, não "perfil vazio".
test('corpo que nao e lista conta como falha, nao como perfil vazio', async () => {
  estadoDeSuperAdmin()
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ message: 'boom' }) })

  const r = await carregarPerfil(SESSAO)

  assert.equal(r.ok, false)
  assert.equal(estado.is_superadmin, true)
})

// Lista vazia é sucesso de verdade: o usuário existe e não tem nada liberado.
test('lista vazia e viewer de verdade, sem erro', async () => {
  estadoDeSuperAdmin()
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [] })

  const r = await carregarPerfil(SESSAO)

  assert.equal(r.ok, true)
  assert.equal(estado.erroPerfil, null)
  assert.equal(estado.role, 'viewer')
  assert.equal(estado.is_superadmin, false)
  assert.deepEqual(estado.permissions, {})
})

// ⚠️ O RÓTULO PODE MUDAR, A CHAVE NÃO — 'atendimentos' é lida em TRÊS lugares
// além daqui (a árvore logo abaixo dela mesma, `derivar-features.js` e a
// função `is_vessel_atendimentos()` do banco). Trocar a chave tiraria o acesso
// de quem já usa o módulo hoje, em silêncio. Este teste é a trava contra isso.
test('a chave do módulo Vessel continua "atendimentos", e as duas ações continuam oferecidas', () => {
  const recurso = RECURSOS.find((r) => r.key === 'atendimentos')
  assert.ok(recurso, 'a chave "atendimentos" sumiu de RECURSOS — isso tira o acesso de todo mundo de uma vez')
  assert.deepEqual(recurso.acoes, ['ver', 'editar'])

  const naArvore = PERMISSION_TREE.find((n) => n.key === 'atendimentos')
  assert.ok(naArvore, 'a chave "atendimentos" sumiu de PERMISSION_TREE')

  // 24/09/2026: o cartão do editor deixou de ser só o Private Appointment —
  // virou o "Comercial Vessel", com uma linha por tela da família. A linha
  // 'atendimentos' continua sendo o Private Appointment.
  assert.equal(naArvore.label, 'Comercial Vessel')
  assert.equal(recurso.label, 'Private Appointment')
  const filhos = naArvore.children.map((c) => c.key)
  for (const k of ['atendimentos.beauty-sessions', 'atendimentos.private-edit', 'atendimentos.stylist-circle',
    'atendimentos.material-grafico', 'atendimentos.appointment-card', 'atendimentos.private-edit-card']) {
    assert.ok(filhos.includes(k), `${k} tem de morar no cartão do Comercial Vessel`)
  }
})

// Uma tentativa nova tem que apagar o erro da tentativa anterior.
test('carregar de novo com sucesso limpa o erroPerfil antigo', async () => {
  limparEstado()
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  await carregarPerfil(SESSAO)
  assert.ok(estado.erroPerfil)

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [{ role: 'admin' }] })
  await carregarPerfil(SESSAO)

  assert.equal(estado.erroPerfil, null)
  assert.equal(estado.role, 'admin')
})

/* ── Sessão pela API em Go (chave `conta`, Plano 7) ─────────────────────────── */
const { carregarPerfilDaApi } = await import('./controle-de-login-e-usuario.js')
const { CHAVE_DO_TOKEN } = await import('./api.js')

function guardaDeMentira() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
// Responde por caminho: { '/auth/eu': [status, corpo], '/eu/perfil': [...] }
function api(rotas) {
  globalThis.fetch = async (url) => {
    const [status, corpo] = rotas[new URL(url, 'http://x').pathname.replace(/^\/api/, '')]
    return { status, ok: status < 300, text: async () => JSON.stringify(corpo), headers: { get: () => null } }
  }
}

test('API: /auth/eu + /eu/perfil preenchem a pessoa e o perfil', async () => {
  window.localStorage = guardaDeMentira(); window.sessionStorage = guardaDeMentira(); window.location = { search: '' }
  window.localStorage.setItem(CHAVE_DO_TOKEN, 'tok-api')
  limparEstado()
  estado.currentSession = { access_token: 'tok-api', user: null }
  api({
    '/auth/eu': [200, { id: 'u9', email: 'ana@x.com', nome: 'Ana' }],
    '/eu/perfil': [200, [{ role: 'admin', is_superadmin: true, permissions: { social: ['ver'] }, features: ['social'] }]],
  })
  const r = await carregarPerfilDaApi()
  assert.deepEqual(r, { ok: true, erro: null })
  assert.equal(estado.user.email, 'ana@x.com')
  assert.equal(estado.user.user_metadata.name, 'Ana')
  assert.equal(estado.currentSession.user.id, 'u9')
  assert.equal(estado.is_superadmin, true)
})

test('API: 401 no /auth/eu apaga o token e zera (a guarda leva ao login)', async () => {
  window.localStorage.setItem(CHAVE_DO_TOKEN, 'tok-morto')
  estado.currentSession = { access_token: 'tok-morto', user: null }
  api({ '/auth/eu': [401, { error: 'nao_autenticado' }] })
  const r = await carregarPerfilDaApi()
  assert.equal(r.ok, false)
  assert.equal(window.localStorage.getItem(CHAVE_DO_TOKEN), null)
  assert.equal(estado.currentSession, null)
  assert.equal(estado.erroPerfil.tipo, 'sessao')
})

test('API: queda de rede NÃO rebaixa nem desloga — preserva o perfil anterior', async () => {
  window.localStorage.setItem(CHAVE_DO_TOKEN, 'tok-vivo')
  estado.currentSession = { access_token: 'tok-vivo', user: { id: 'u1' } }
  estadoDeSuperAdmin()
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  const r = await carregarPerfilDaApi()
  assert.equal(r.ok, false)
  assert.equal(estado.erroPerfil.tipo, 'rede')
  assert.equal(estado.is_superadmin, true)
  assert.equal(window.localStorage.getItem(CHAVE_DO_TOKEN), 'tok-vivo')
  assert.notEqual(estado.currentSession, null)
})

test('API: 401 de um token velho NÃO apaga o token novo que outra aba gravou', async () => {
  window.localStorage.setItem(CHAVE_DO_TOKEN, 'tok-velho')
  globalThis.fetch = async () => {
    window.localStorage.setItem(CHAVE_DO_TOKEN, 'tok-novo-da-outra-aba') // a outra aba entrou durante o pedido
    return { status: 401, ok: false, text: async () => '{"error":"nao_autenticado"}', headers: { get: () => null } }
  }
  await carregarPerfilDaApi()
  assert.equal(window.localStorage.getItem(CHAVE_DO_TOKEN), 'tok-novo-da-outra-aba')
})
