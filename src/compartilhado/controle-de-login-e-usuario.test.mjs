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

  // Os dois rótulos podem mudar de texto livremente, mas têm de continuar
  // IGUAIS entre si — é o card e a linha da MESMA ferramenta na tela de
  // permissões (ver o comentário em PERMISSION_TREE).
  assert.equal(recurso.label, naArvore.label)
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
