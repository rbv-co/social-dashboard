import test from 'node:test'
import assert from 'node:assert/strict'
import { blingSoPeloProxy, ERRO_PROXY_OBRIGATORIO } from './core-bling-proxy.js'

// Defeito nomeado (plano 03 do ESPELHO-BLING-ESCRITAS): sem CORE_BLING_PROXY=true a edge caía
// no fetch direto com token próprio e escrevia no Bling sem o espelho do core saber.

function fetchQueNaoPodeSerChamado() {
  const chamadas = []
  const f = async (...a) => { chamadas.push(a); throw new Error('fetch não devia ser chamado') }
  f.chamadas = chamadas
  return f
}

for (const env of [{}, { CORE_BLING_PROXY: 'false' }, { CORE_BLING_PROXY: '' }, { CORE_BLING_PROXY: 'talvez' }]) {
  test(`sem proxy (${JSON.stringify(env)}): escrita falha com erro claro e nada sai pela rede`, async () => {
    const f = fetchQueNaoPodeSerChamado()
    const b = blingSoPeloProxy(env, { fetchImpl: f, base: 'https://api.bling.com.br/Api/v3' })
    assert.equal(b.ligada, false)
    assert.throws(() => b.exigir(), (e) => e.message === ERRO_PROXY_OBRIGATORIO)
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE', 'GET']) {
      await assert.rejects(b.chamar(metodo, '/contatos', { corpo: { nome: 'x' }, token: 'abc' }),
        (e) => e.message === ERRO_PROXY_OBRIGATORIO)
    }
    assert.equal(f.chamadas.length, 0)
  })
}

test('ERRO_PROXY_OBRIGATORIO diz o que fazer e não vaza token', () => {
  assert.match(ERRO_PROXY_OBRIGATORIO, /CORE_BLING_PROXY=true/)
  assert.doesNotMatch(ERRO_PROXY_OBRIGATORIO, /Bearer|eyJ/)
})

test('com proxy ligado: vai só ao core, com o token do core, nunca ao Bling', async () => {
  const urls = []
  const f = async (url, init) => {
    urls.push([url, init.headers.Authorization])
    return new Response('{"data":{"id":1}}', { status: 201, headers: { 'X-Core-Origem': 'bling' } })
  }
  const b = blingSoPeloProxy({ CORE_BLING_PROXY: 'true', CORE_API_TOKEN: 'tk-core', CORE_URL: 'https://core.exemplo' },
    { fetchImpl: f, base: 'https://api.bling.com.br/Api/v3' })
  assert.equal(b.ligada, true)
  assert.doesNotThrow(() => b.exigir())
  const r = await b.chamar('POST', '/contatos', { corpo: { nome: 'x' }, chave: 'k', token: 'ignorado' })
  assert.equal(r.status, 201)
  assert.deepEqual(urls, [['https://core.exemplo/api/interno/bling/proxy', 'Bearer tk-core']])
})

test('com proxy ligado mas sem CORE_API_TOKEN: falha, não cai no direto', async () => {
  const f = fetchQueNaoPodeSerChamado()
  const b = blingSoPeloProxy({ CORE_BLING_PROXY: 'true' }, { fetchImpl: f, base: 'x' })
  await assert.rejects(b.chamar('POST', '/contatos', { corpo: {} }), /CORE_API_TOKEN/)
  assert.equal(f.chamadas.length, 0)
})
