import { test } from 'node:test'
import assert from 'node:assert/strict'

// window mínimo: armazenamento da aba e endereço. O fetch é trocado por teste.
function guardaDeMentira() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
globalThis.window = { localStorage: guardaDeMentira(), sessionStorage: guardaDeMentira(), location: { search: '' } }
const api = await import('./api.js')
const { CONTA_DESATIVADA } = await import('./classificar-erro.js')

function responder(status, corpo, cabecalhos = {}) {
  const pedidos = []
  globalThis.fetch = async (url, init) => {
    pedidos.push({ url, ...init })
    const texto = corpo === undefined ? '' : JSON.stringify(corpo)
    return {
      status, ok: status >= 200 && status < 300,
      text: async () => texto,
      headers: { get: k => cabecalhos[k] ?? null },
    }
  }
  return pedidos
}

test('sem VITE_API_AREAS nenhuma área liga (é o build de produção)', () => {
  assert.equal(api.lerAreas(undefined).size, 0)
  assert.equal(api.lerAreas('').size, 0)
  for (const a of api.AREAS) assert.equal(api.areaNaApi(a), false)
})

test('lista de áreas: conta é obrigatória, nome errado falha alto, * liga todas', () => {
  assert.deepEqual([...api.lerAreas(' conta , admin ')], ['conta', 'admin'])
  assert.throws(() => api.lerAreas('admin'), /inclua "conta"/)
  assert.throws(() => api.lerAreas('conta,admni'), /desconhecida "admni"/)
  assert.equal(api.lerAreas('*').size, api.AREAS.length)
})

test('pedir manda o token, o corpo em JSON e devolve data', async () => {
  api.guardarToken('tok-1')
  const pedidos = responder(200, [{ id: 1 }], { 'X-Total-Count': '7' })
  const r = await api.pedir('GET', '/admin/usuarios', { params: { ordem: 'nome.asc', contar: 1 } })
  assert.equal(pedidos[0].url, '/api/admin/usuarios?ordem=nome.asc&contar=1')
  assert.equal(pedidos[0].headers.Authorization, 'Bearer tok-1')
  assert.equal(pedidos[0].body, undefined)
  assert.deepEqual(r.data, [{ id: 1 }])
  assert.equal(r.error, null)
  assert.equal(r.total, 7)
})

test('semSessao não manda o token (login, esqueci a senha)', async () => {
  api.guardarToken('tok-1')
  const pedidos = responder(200, { token: 'novo' })
  await api.pedir('POST', '/auth/entrar', { corpo: { email: 'a@b', senha: 'x' }, semSessao: true })
  assert.equal(pedidos[0].headers.Authorization, undefined)
  assert.equal(pedidos[0].headers['Content-Type'], 'application/json')
  assert.equal(pedidos[0].body, '{"email":"a@b","senha":"x"}')
})

test('204 devolve data null sem erro', async () => {
  responder(204)
  const r = await api.pedir('POST', '/auth/sair')
  assert.equal(r.data, null)
  assert.equal(r.error, null)
})

test('erro: classificação da casa + código e frase da API', async () => {
  responder(400, { error: 'regra_de_negocio', mensagem: 'Lote já baixado.' })
  const r = await api.rpc('vessel_baixar_peca', { p_id: 'x' })
  assert.equal(r.error.status, 400)
  assert.equal(r.error.codigo, 'regra_de_negocio')
  assert.equal(r.error.message, 'Lote já baixado.')
  assert.equal(r.error.tipo, 'servidor')

  responder(401, { error: 'nao_autenticado' })
  const s = await api.pedir('GET', '/auth/eu')
  assert.equal(s.error.tipo, 'sessao')
  assert.match(s.error.message, /sess[ãa]o expirou/)

  responder(403, { error: 'conta_desativada' })
  const d = await api.pedir('POST', '/auth/entrar', { corpo: {}, semSessao: true })
  assert.equal(d.error.tipo, CONTA_DESATIVADA.tipo)
})

test('rede caída não lança: vira ERRO_DE_REDE com status 0', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  const r = await api.edge('conferir-senha', { senha: 'x' })
  assert.equal(r.status, 0)
  assert.equal(r.error.tipo, 'rede')
})

test('rpc e edge: caminho e corpo do contrato', async () => {
  const pedidos = responder(200, null)
  await api.rpc('etiqueta_quem_e')
  await api.edge('invite-user', { email: 'a@b' })
  assert.equal(pedidos[0].url, '/api/rpc/etiqueta_quem_e')
  assert.equal(pedidos[0].method, 'POST')
  assert.equal(pedidos[0].body, '{}')
  assert.equal(pedidos[1].url, '/api/invite-user')
  assert.equal(pedidos[1].body, '{"email":"a@b"}')
})

test('na aba de "entrar como" o token mora no sessionStorage', () => {
  window.localStorage.removeItem(api.CHAVE_DO_TOKEN)
  window.sessionStorage.setItem('modo_entrar_como', '1')
  api.guardarToken('do-alvo')
  assert.equal(window.sessionStorage.getItem(api.CHAVE_DO_TOKEN), 'do-alvo')
  assert.equal(window.localStorage.getItem(api.CHAVE_DO_TOKEN), null)
  api.apagarToken()
  assert.equal(api.lerToken(), null)
  window.sessionStorage.removeItem('modo_entrar_como')
})

test('corpoDaEdge: sucesso devolve o corpo; erro da edge e do núcleo viram frase', async () => {
  responder(200, { success: true })
  assert.deepEqual(await api.corpoDaEdge('invite-user', {}), { success: true })

  responder(400, { error: 'Apenas administradores podem realizar esta ação' })
  assert.equal((await api.corpoDaEdge('invite-user', {})).error, 'Apenas administradores podem realizar esta ação')

  responder(403, { error: 'sem_permissao', mensagem: 'Quem entrou como outra pessoa não administra contas.' })
  assert.equal((await api.corpoDaEdge('invite-user', {})).error, 'Quem entrou como outra pessoa não administra contas.')

  responder(500, { error: 'erro_interno' })
  assert.match((await api.corpoDaEdge('invite-user', {})).error, /servidor não respondeu/)

  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  assert.match((await api.corpoDaEdge('invite-user', {})).error, /Sem conexão/)
})

test('conferirSenhaPelaApi: os códigos da edge chegam iguais, inclusive no 4xx', async () => {
  responder(200, { ok: true })
  assert.deepEqual(await api.conferirSenhaPelaApi('x'), { ok: true })
  responder(200, { ok: false, erro: 'senha_incorreta', restam: 2 })
  assert.deepEqual(await api.conferirSenhaPelaApi('x'), { ok: false, erro: 'senha_incorreta' })
  responder(429, { ok: false, erro: 'bloqueado' })
  assert.deepEqual(await api.conferirSenhaPelaApi('x'), { ok: false, erro: 'bloqueado' })
  responder(401, { error: 'nao_autenticado' })
  assert.deepEqual(await api.conferirSenhaPelaApi('x'), { ok: false, erro: 'sem_sessao' })
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  assert.deepEqual(await api.conferirSenhaPelaApi('x'), { ok: false, erro: 'falha_interna' })
})

test('erroDaApi: 403 conta_desativada e 429 têm frase própria (só na API)', () => {
  assert.equal(api.erroDaApi(403, { error: 'conta_desativada' }).tipo, CONTA_DESATIVADA.tipo)
  assert.equal(api.erroDaApi(403, { error: 'sem_permissao' }).tipo, 'permissao')
  const l = api.erroDaApi(429, { error: 'muitas_tentativas' })
  assert.equal(l.tipo, 'limite')
  assert.equal(l.acao, null)
})

test('2xx que não é JSON (rewrite devolvendo HTML) é erro, não sucesso vazio', async () => {
  globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => '<!doctype html><html>', headers: { get: () => null } })
  const r = await api.pedir('GET', '/auth/eu')
  assert.equal(r.data, null)
  assert.equal(r.error.tipo, 'servidor')
})

test('conferirSenhaPelaApi: aba de "entrar como" tem código próprio', async () => {
  responder(403, { error: 'sem_permissao', mensagem: 'Quem entrou como outra pessoa não confere senha por ela.' })
  assert.deepEqual(await api.conferirSenhaPelaApi('x'), { ok: false, erro: 'entrou_como_outra_pessoa' })
})
