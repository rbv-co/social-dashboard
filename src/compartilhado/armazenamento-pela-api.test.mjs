import { test } from 'node:test'
import assert from 'node:assert/strict'

function guarda() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } }
globalThis.window = { localStorage: guarda(), sessionStorage: guarda(), location: { search: '', origin: 'https://central.exemplo' } }
globalThis.location = { origin: 'https://central.exemplo' }
const { storagePelaApi, storageNaArea } = await import('./armazenamento-pela-api.js')

function api(rotas) {
  const pedidos = []
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://x')
    const chave = `${init.method || 'GET'} ${u.pathname.replace(/^\/api/, '')}`
    pedidos.push({ chave, busca: Object.fromEntries(u.searchParams), headers: init.headers, corpo: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
    const [status, corpo] = rotas[chave] || [404, { error: 'nao_encontrado' }]
    return { status, ok: status < 300, text: async () => JSON.stringify(corpo), json: async () => corpo, headers: { get: () => null } }
  }
  return pedidos
}

test('sem a área ligada, storageNaArea devolve o MESMO sbClient.storage', () => {
  const sb = { storage: { eraDoSupabase: true } }
  assert.equal(storageNaArea('conteudo', sb), sb.storage)
})

test('list: prefixo, limite e ordem viram a busca da rota', async () => {
  const pedidos = api({ 'GET /arquivos/arquivos': [200, [{ name: 'a.pdf' }]] })
  const r = await storagePelaApi().from('arquivos').list('', { limit: 500, sortBy: { column: 'name', order: 'asc' } })
  assert.deepEqual(r, { data: [{ name: 'a.pdf' }], error: null })
  assert.deepEqual(pedidos[0].busca, { limite: '500', ordem: 'asc' })
  await assert.rejects(() => storagePelaApi().from('arquivos').list('', { sortBy: { column: 'created_at' } }), /só ordena por nome/)
})

test('upload: PUT cru com o tipo e `x-upsert`; o caminho vai com cada trecho codificado', async () => {
  const pedidos = api({ 'PUT /arquivos/conteudo/c1/p%201/0-arte.png': [200, { Key: 'conteudo/c1/p 1/0-arte.png' }] })
  const arq = { type: 'image/png', size: 3 }
  const r = await storagePelaApi().from('conteudo').upload('c1/p 1/0-arte.png', arq, { upsert: true })
  assert.deepEqual(r, { data: { path: 'c1/p 1/0-arte.png', fullPath: 'conteudo/c1/p 1/0-arte.png' }, error: null })
  assert.equal(pedidos[0].headers['x-upsert'], 'true')
  assert.equal(pedidos[0].headers['Content-Type'], 'image/png')
  assert.equal(pedidos[0].corpo, arq)
})

test('upload recusado vira `error` com a FRASE da API e o status', async () => {
  api({ 'PUT /arquivos/arquivos/x.exe': [415, { error: 'tipo_nao_aceito', mensagem: 'Este tipo de arquivo não é aceito.' }] })
  const r = await storagePelaApi().from('arquivos').upload('x.exe', { type: 'application/x-msdownload' })
  assert.equal(r.data, null)
  assert.equal(r.error.message, 'Este tipo de arquivo não é aceito.')
  assert.equal(r.error.status, 415)
})

test('remove e copy: corpo da rota; copy devolve o caminho novo', async () => {
  const pedidos = api({ 'DELETE /arquivos/conteudo': [200, [{ name: 'a' }]], 'POST /arquivos/conteudo/copiar': [200, {}] })
  assert.deepEqual((await storagePelaApi().from('conteudo').remove(['a', 'b'])).data, [{ name: 'a' }])
  assert.deepEqual(pedidos[0].corpo, { caminhos: ['a', 'b'] })
  const c = await storagePelaApi().from('conteudo').copy('a/1.png', 'b/1.png')
  assert.deepEqual(c.data, { path: 'b/1.png' })
  assert.deepEqual(pedidos[1].corpo, { de: 'a/1.png', para: 'b/1.png' })
})

test('createSignedUrl(s): a URL relativa da API ganha a base; `download` vira `baixar`', async () => {
  const pedidos = api({ 'POST /arquivos/conteudo/assinar': [200, [{ caminho: 'a/1.png', url: '/storage/v1/object/sign/conteudo/a/1.png?exp=1&sig=2', erro: null }, { caminho: 'a/2.png', url: null, erro: 'nao_encontrado' }]] })
  const um = await storagePelaApi().from('conteudo').createSignedUrl('a/1.png', 120, { download: 'arte.png' })
  assert.equal(um.data.signedUrl, 'https://central.exemplo/api/storage/v1/object/sign/conteudo/a/1.png?exp=1&sig=2')
  assert.deepEqual(pedidos[0].corpo, { caminhos: ['a/1.png'], segundos: 120, baixar: 'arte.png' })
  const varios = await storagePelaApi().from('conteudo').createSignedUrls(['a/1.png', 'a/2.png'], 3600)
  assert.deepEqual(varios.data.map((d) => [d.path, !!d.signedUrl, d.error]), [['a/1.png', true, null], ['a/2.png', false, 'nao_encontrado']])
  assert.equal('baixar' in pedidos[1].corpo, false)
})

test('getPublicUrl é síncrono e aponta para a rota pública da API', () => {
  const { data } = storagePelaApi().from('avatars').getPublicUrl('u 1')
  assert.equal(data.publicUrl, 'https://central.exemplo/api/storage/v1/object/public/avatars/u%201')
})

test('sem resposta (rede) vira `Failed to fetch`, que as telas já reconhecem', async () => {
  globalThis.fetch = async () => { throw new TypeError('x') }
  const r = await storagePelaApi().from('arquivos').remove(['a'])
  assert.equal(r.error.message, 'Failed to fetch')
})
