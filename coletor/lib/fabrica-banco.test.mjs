import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

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

test('fabrica_* e gc_* vão para a API; o resto não é da Fábrica', () => {
  assert.equal(fb.vaiParaApi('/fabrica_jobs?id=eq.1'), true)
  assert.equal(fb.vaiParaApi('/gc_vendas_item?select=sku'), true)
  assert.equal(fb.vaiParaApi('/bling_pedidos?select=id'), false)
})

test('exigirApi: sem CENTRAL_API_* a Fábrica falha alto (não há Supabase para cair)', () => {
  // processo novo: bling-comercial.mjs lê CENTRAL_API_* uma vez, no import
  const roda = (env) => spawnSync(process.execPath, ['--input-type=module', '-e',
    "const fb = await import(process.argv[1]); try { fb.exigirApi(); console.log('ok') } catch (e) { console.log(e.message) }",
    new URL('./fabrica-banco.mjs', import.meta.url).href], { env: { PATH: process.env.PATH, COLETOR_ENV: '/nao-existe', ...env }, encoding: 'utf8' }).stdout
  assert.match(roda({}), /CENTRAL_API_URL \+ CENTRAL_API_TOKEN.*Supabase foi desligado/)
  assert.match(roda({ CENTRAL_API_URL: 'http://api:8080' }), /Supabase foi desligado/)
  assert.equal(roda({ CENTRAL_API_URL: 'http://api:8080', CENTRAL_API_TOKEN: 'srv_x' }).trim(), 'ok')
  fb.exigirApi()
})

test('vendas por SKU: a rota só filtra por mês, o canal é filtrado aqui; estoque filtra o depósito na rota', async () => {
  const pedidos = api({
    'GET /comercial/vendas-por-item': [200, [
      { canal_loja_id: 7, sku: 'A', produto: 'Bolsa A', faturamento: 10 },
      { canal_loja_id: 8, sku: 'B', produto: 'Bolsa B', faturamento: 20 },
    ], { 'X-Total-Count': '2' }],
    'GET /comercial/estoque': [200, [{ sku: 'A', saldo: 3 }], { 'X-Total-Count': '1' }],
  })
  assert.deepEqual(await fb.lerVendasPorSku('7'), [{ canal_loja_id: 7, sku: 'A', produto: 'Bolsa A', faturamento: 10 }])
  assert.deepEqual([...(await fb.lerNomesPorSku()).entries()], [['A', 'Bolsa A'], ['B', 'Bolsa B']])
  assert.deepEqual(await fb.lerEstoquePorSku(99), [{ sku: 'A', saldo: 3 }])
  assert.equal(new URLSearchParams(pedidos.at(-1).busca).get('deposito_id'), '99')
  for (const p of pedidos) assert.equal(p.auth, 'Bearer srv_robo')
})

test('subirCriativo: PUT na API com o token do robô, devolve a URL pública', async () => {
  const pedidos = []
  globalThis.fetch = async (url, init) => { pedidos.push({ url, init }); return { ok: true, status: 200 } }
  const u = await fb.subirCriativo('camp/a.png', Buffer.from('x'))
  assert.equal(pedidos[0].url, 'http://api:8080/arquivos/fabrica-criativos/camp/a.png')
  assert.equal(pedidos[0].init.headers.Authorization, 'Bearer srv_robo')
  assert.match(u, /\/storage\/v1\/object\/public\/fabrica-criativos\/camp\/a\.png$/)
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

test('tetos da rota: erro longo é cortado (o resultado não se perde); look sem linha segue como no PostgREST', async () => {
  const pedidos = api({ 'PATCH /fabrica/robo/jobs/j1': [204], 'POST /fabrica/robo/execucoes': [201, { id: 'e1' }] })
  await fb.patchJob('j1', { status: 'erro', resultado: { adIds: ['a1'] }, erro: 'x'.repeat(5000) })
  assert.equal(pedidos[0].corpo.erro.length, 2000)
  assert.deepEqual(pedidos[0].corpo.resultado, { adIds: ['a1'] })
  await fb.registrarExecucaoNaApi({ robo: 'fabrica-subir', acao: 'subir', detalhe: 'y'.repeat(900) })
  assert.equal(pedidos[1].corpo.detalhe.length, 500)
  await fb.escreverFabrica('PATCH', '/fabrica_looks?chave=eq.sumiu', { preview_url: 'https://x/y.png' }) // 404 não lança
})
