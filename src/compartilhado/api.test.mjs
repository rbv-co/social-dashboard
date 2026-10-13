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

test('invocar: formato do functions.invoke, com o motivo do não-2xx em error.context.json()', async () => {
  responder(200, { serie: [1, 2] })
  assert.deepEqual(await api.invocar('serie-novos-dia', { dias: 7 }), { data: { serie: [1, 2] }, error: null })

  responder(404, { meta_erro: 'conta nao encontrada' })
  const r = await api.invocar('insights-ao-vivo', {})
  assert.equal(r.data, null)
  assert.equal(r.error.status, 404)
  assert.deepEqual(await r.error.context.json(), { meta_erro: 'conta nao encontrada' })
})

test('fetchDaApi: mesmo Response, endereço /api, token da API e sem apikey do Supabase', async () => {
  api.guardarToken('tok-9')
  const pedidos = responder(200, { ok: true })
  const r = await api.fetchDaApi('/meta-proxy', { method: 'POST', headers: { apikey: 'anon', Authorization: 'Bearer jwt-supabase', 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(r.ok, true)
  assert.equal(pedidos[0].url, '/api/meta-proxy')
  assert.equal(pedidos[0].headers.Authorization, 'Bearer tok-9')
  assert.equal(pedidos[0].headers.apikey, undefined)
  assert.equal(pedidos[0].headers['Content-Type'], 'application/json')
})

test('invocarNaArea: com a área desligada, a chamada do Supabase é a mesma', async () => {
  const chamadas = []
  const sb = { functions: { invoke: async (n, o) => { chamadas.push([n, o]); return { data: 'do-supabase', error: null } } } }
  const r = await api.invocarNaArea('edges-core', sb, 'bling-proxy', { body: { endpoint: 'produtos' } })
  assert.equal(r.data, 'do-supabase')
  assert.deepEqual(chamadas, [['bling-proxy', { body: { endpoint: 'produtos' } }]])
})

test('invocar: recusa com corpo mostra a frase do corpo, não "o servidor não respondeu"', async () => {
  responder(400, { error: { message: 'Invalid parameter', error_user_msg: 'x' } })
  assert.equal((await api.invocar('meta-proxy', {})).error.message, 'Invalid parameter')
  responder(400, { error: 'conta sem token' })
  assert.equal((await api.invocar('meta-proxy', {})).error.message, 'conta sem token')
  responder(403, { error: 'sem_permissao' })
  assert.match((await api.invocar('meta-proxy', {})).error.message, /permiss[ãa]o/)
})

test('trocarCodigoPorFrase: código do portão vira frase; frase e erro da Meta ficam', () => {
  assert.match(api.trocarCodigoPorFrase(403, { error: 'sem_permissao' }).error, /permiss[ãa]o/)
  assert.match(api.trocarCodigoPorFrase(401, { error: 'nao_autenticado' }).error, /sess[ãa]o/)
  assert.deepEqual(api.trocarCodigoPorFrase(400, { error: 'conta nao encontrada' }), { error: 'conta nao encontrada' })
  const meta = { error: { message: 'x', code: 100 } }
  assert.equal(api.trocarCodigoPorFrase(400, meta), meta)
})

test('fraseDoCorpo: código das rotas novas vira frase (inclusive com maiúscula, campanhaId_invalido)', async () => {
  const { fraseDoCorpo } = await import('./api.js')
  assert.equal(fraseDoCorpo({ error: 'campanhaId_invalido' }), 'Não achei esta campanha.')
  assert.match(fraseDoCorpo({ error: 'github_nao_configurado' }), /não está configurado/)
  assert.equal(fraseDoCorpo({ error: 'dispatch_falhou', detail: 'O GitHub recusou o disparo.' }), 'O GitHub recusou o disparo.')
  assert.equal(fraseDoCorpo({ error: 'algum_codigo' }), null)
})
