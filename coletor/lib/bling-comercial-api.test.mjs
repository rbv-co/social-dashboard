import { test } from 'node:test'
import assert from 'node:assert/strict'

// O ambiente é lido NA CARGA do módulo: cada cenário carrega uma cópia nova.
async function carregar(env) {
  const antes = { ...process.env }
  Object.assign(process.env, env)
  try { return await import('./bling-comercial.mjs?' + Math.random()) } finally {
    for (const k of Object.keys(env)) if (!(k in antes)) delete process.env[k]; else process.env[k] = antes[k]
  }
}
const semRede = async (fn) => {
  const antes = globalThis.fetch
  let chamou = false
  globalThis.fetch = async () => { chamou = true; throw new Error('sem rede no teste') }
  try { return { r: await fn().catch((e) => e), chamou } } finally { globalThis.fetch = antes }
}

test('QUEM ESCOLHE O CAMINHO É O TOKEN: srv_ → API sem apikey; JWT → edge do Supabase com apikey', async () => {
  const m = await carregar({ CENTRAL_API_URL: ' http://api:8080/ ', CENTRAL_API_TOKEN: ' srv_abc\n' })
  assert.equal(m.urlDaEdge('meta-proxy', 'srv_abc'), 'http://api:8080/meta-proxy')
  assert.deepEqual(m.cabecalhosDaEdge('srv_abc'), { Authorization: 'Bearer srv_abc', 'Content-Type': 'application/json' })
  assert.match(m.urlDaEdge('meta-proxy', 'eyJ.jwt'), /\/functions\/v1\/meta-proxy$/)
  assert.ok(!/^eyJ/.test(m.cabecalhosDaEdge('eyJ.jwt').apikey || ''), 'sem anon key embutida no código')
})

test('o srv_ só sai para quem PEDE: robô não migrado faz o login de sempre, mesmo com a variável global', async () => {
  const m = await carregar({ CENTRAL_API_URL: 'http://api:8080', CENTRAL_API_TOKEN: 'srv_abc' })
  const migrado = await semRede(() => m.loginServico({ naApi: true }))
  assert.equal(migrado.r, 'srv_abc'); assert.equal(migrado.chamou, false)
  const antigo = await semRede(() => m.loginServico())
  assert.equal(antigo.chamou, true, 'robô não migrado tem de fazer o login no Supabase')
})

test('sem as duas variáveis (ou só uma), nem quem pede recebe o srv_', async () => {
  for (const env of [{ CENTRAL_API_URL: '', CENTRAL_API_TOKEN: '' }, { CENTRAL_API_URL: 'http://api:8080', CENTRAL_API_TOKEN: '' }]) {
    const m = await carregar(env)
    assert.equal(m.robosNaApi(), false)
    const r = await semRede(() => m.loginServico({ naApi: true }))
    assert.equal(r.chamou, true)
  }
})
