import { test } from 'node:test'
import assert from 'node:assert/strict'

// O caminho da API (Plano 7 + 5.13) depende do ambiente NA CARGA do módulo: cada
// cenário carrega uma cópia nova (query string diferente).
async function carregar(env) {
  const antes = { ...process.env }
  Object.assign(process.env, env)
  try { return await import('./bling-comercial.mjs?' + Math.random()) } finally {
    for (const k of Object.keys(env)) if (!(k in antes)) delete process.env[k]; else process.env[k] = antes[k]
  }
}

test('sem CENTRAL_API_*: o caminho do Supabase de sempre (edge + apikey)', async () => {
  const m = await carregar({ CENTRAL_API_URL: '', CENTRAL_API_TOKEN: '' })
  assert.equal(m.robosNaApi(), false)
  assert.match(m.urlDaEdge('bling-proxy'), /\/functions\/v1\/bling-proxy$/)
  assert.ok(m.cabecalhosDaEdge('t').apikey)
})

test('com CENTRAL_API_*: a rota na API, o token de serviço e nada de apikey nem login', async () => {
  const m = await carregar({ CENTRAL_API_URL: 'http://api:8080/', CENTRAL_API_TOKEN: 'srv_abc' })
  assert.equal(m.robosNaApi(), true)
  assert.equal(m.urlDaEdge('meta-proxy'), 'http://api:8080/meta-proxy')
  assert.deepEqual(m.cabecalhosDaEdge('srv_abc'), { Authorization: 'Bearer srv_abc', 'Content-Type': 'application/json' })
  let chamou = false
  const fetchAntes = globalThis.fetch
  globalThis.fetch = async () => { chamou = true; throw new Error('não devia chamar') }
  try { assert.equal(await m.loginServico(), 'srv_abc') } finally { globalThis.fetch = fetchAntes }
  assert.equal(chamou, false)
})

test('só uma das duas variáveis não liga o caminho da API (meio ligado é erro de configuração)', async () => {
  const m = await carregar({ CENTRAL_API_URL: 'http://api:8080', CENTRAL_API_TOKEN: '' })
  assert.equal(m.robosNaApi(), false)
})
