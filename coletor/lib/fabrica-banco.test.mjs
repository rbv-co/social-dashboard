import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.CENTRAL_API_URL = 'http://api:8080'
process.env.CENTRAL_API_TOKEN = 'srv_robo'
const fb = await import('./fabrica-banco.mjs?' + Math.random())

function api(rotas) {
  const pedidos = []
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    const chave = `${init.method || 'GET'} ${u.pathname}`
    pedidos.push({ chave, busca: u.search, corpo: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization })
    const [status, corpo, cab = {}] = rotas[chave] || [404, { error: 'nao_encontrado' }]
    return { status, ok: status < 300, text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)), headers: { get: (k) => cab[k] ?? null } }
  }
  return pedidos
}

test('só as tabelas fabrica_* vão para a API; gc_* e o resto seguem no Supabase', () => {
  assert.equal(fb.vaiParaApi('/fabrica_jobs?id=eq.1'), true)
  assert.equal(fb.vaiParaApi('/gc_vendas_item?select=sku'), false)
})

test('leitura: o caminho PostgREST do robô vira a rota da Fábrica, com o token do robô', async () => {
  const pedidos = api({ 'GET /fabrica/jobs': [200, [{ id: 'j1', tipo: 'gerar', params: {} }], { 'X-Total-Count': '1' }] })
  const r = await fb.lerFabrica('/fabrica_jobs?select=*&id=eq.j1')
  assert.deepEqual(r, [{ id: 'j1', tipo: 'gerar', params: {} }])
  assert.equal(pedidos[0].auth, 'Bearer srv_robo')
  assert.equal(new URLSearchParams(pedidos[0].busca).get('id'), 'j1')
})

test('escritas: cada uma na rota do robô, sem updated_at; criativos em lotes de 200', async () => {
  const pedidos = api({
    'PATCH /fabrica/robo/jobs/j1': [204], 'PATCH /fabrica/robo/campanhas/c1': [200, { id: 'c1' }],
    'POST /fabrica/robo/criativos': [201, { criados: 200 }], 'PATCH /fabrica/robo/looks/look-a': [204],
    'POST /fabrica/robo/meta-jobs': [201, { id: 'm1' }],
  })
  await fb.escreverFabrica('PATCH', '/fabrica_jobs?id=eq.j1', { status: 'rodando', github_run_id: '9', updated_at: 'x' })
  await fb.escreverFabrica('PATCH', '/fabrica_campanhas?id=eq.c1', { fechada_em: '2026-10-13T00:00:00Z' })
  await fb.escreverFabrica('POST', '/fabrica_criativos', Array.from({ length: 250 }, (_, i) => ({ campanha_id: 'c1', arquetipo: 'p', template: 't', formato: 'f', storage_path: `c1/${i}.png`, url: 'u' })))
  await fb.escreverFabrica('PATCH', '/fabrica_looks?chave=eq.look-a', { preview_url: 'https://x/y.png' })
  await fb.escreverFabrica('POST', '/fabrica_meta_jobs', [{ tipo: 'estudio', payload: { campanhaId: 'c1' } }])
  assert.deepEqual(pedidos.map((p) => p.chave), ['PATCH /fabrica/robo/jobs/j1', 'PATCH /fabrica/robo/campanhas/c1', 'POST /fabrica/robo/criativos', 'POST /fabrica/robo/criativos', 'PATCH /fabrica/robo/looks/look-a', 'POST /fabrica/robo/meta-jobs'])
  assert.deepEqual(pedidos[0].corpo, { status: 'rodando', github_run_id: '9' })
  assert.deepEqual(pedidos[1].corpo, { fechar: true })
  assert.deepEqual([pedidos[2].corpo.length, pedidos[3].corpo.length], [200, 50])
})

test('o que a API não tem para o robô recusa alto (e nada sai)', async () => {
  const pedidos = api({})
  await assert.rejects(fb.escreverFabrica('POST', '/fabrica_campanhas', [{ nome: 'x' }]), /só pelo painel/)
  await assert.rejects(fb.escreverFabrica('PATCH', '/fabrica_campanhas?id=eq.c1', { job_id: 'j2' }), /proximoLote/)
  await assert.rejects(fb.escreverFabrica('PATCH', '/fabrica_jobs?status=eq.x', { status: 'erro' }), /só por id/)
  assert.equal(pedidos.length, 0)
})

test('erro da API vira exceção com a frase, nunca com o token', async () => {
  api({ 'PATCH /fabrica/robo/jobs/j1': [403, { error: 'sem_permissao', mensagem: 'O robô precisa de meta.fabrica.' }] })
  await assert.rejects(fb.patchJob('j1', { status: 'erro' }), (e) => /403/.test(e.message) && /meta\.fabrica/.test(e.message) && !/srv_robo/.test(e.message))
})

test('próximo lote: a rota cria (ou devolve) o job e o id volta', async () => {
  api({ 'POST /fabrica/robo/jobs/j1/proximo-lote': [201, { job_id: 'j2' }] })
  assert.equal(await fb.proximoLote('j1'), 'j2')
})
