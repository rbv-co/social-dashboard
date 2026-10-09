import test from 'node:test'
import assert from 'node:assert/strict'
import { colocarContato } from './put-contato-bling.js'
import { blingViaCore, chaveIdempotente } from './core-bling-proxy.js'

const resp = (status, extra = {}) => ({ status, ok: status >= 200 && status < 300, replay: false, incerto: false, reautorizar: false, ...extra })
const proxyDe = (...respostas) => {
  const chamadas = []
  return { chamadas, chamar: async (m, c, o) => { chamadas.push([m, c, o]); return respostas.shift() } }
}
const roda = (proxy, extra = {}) => colocarContato({ proxy, contatoId: 7, corpo: { a: 1 }, token: 't', origem: 'esp:L1:7', chaveIdempotente, agora: 1e12, ...extra })

test('ok / incerto / reautorizar / recusado são classificados', async () => {
  assert.equal((await roda(proxyDe(resp(200)))).tipo, 'ok')
  assert.equal((await roda(proxyDe(resp(504, { incerto: true })))).tipo, 'incerto')
  assert.equal((await roda(proxyDe(resp(409, { reautorizar: true })))).tipo, 'reautorizar')
  assert.equal((await roda(proxyDe(resp(400)))).tipo, 'recusado')
})

test('queda/timeout no PUT (proxy real) vira incerto e NÃO reenvia', async () => {
  const proxy = blingViaCore({ CORE_BLING_PROXY: 'true', CORE_API_TOKEN: 'x' }, { fetchImpl: async () => { throw new Error('timeout') } })
  assert.equal((await roda(proxy)).tipo, 'incerto')
})

test('429/5xx: tentar_depois, sem reenviar; 429 sinaliza limite', async () => {
  const p1 = proxyDe(resp(429))
  const r1 = await roda(p1)
  assert.deepEqual([r1.tipo, r1.limite, p1.chamadas.length], ['tentar_depois', true, 1])
  const p2 = proxyDe(resp(503))
  const r2 = await roda(p2)
  assert.deepEqual([r2.tipo, r2.limite, p2.chamadas.length], ['tentar_depois', false, 1])
})

test('429/5xx REPETIDO pelo core (replay) com a mesma chave: refaz UMA vez com chave nova, sem congelar', async () => {
  const p = proxyDe(resp(503, { replay: true }), resp(200))
  const r = await roda(p)
  assert.equal(r.tipo, 'ok')
  assert.equal(p.chamadas.length, 2)
  assert.notEqual(p.chamadas[0][2].chave, p.chamadas[1][2].chave)
  // dentro da mesma janela de 15 min a chave nova é estável (o core não duplica)
  const a = proxyDe(resp(503, { replay: true }), resp(503, { replay: true }))
  await roda(a, { agora: 1e12 + 1000 })
  const b = proxyDe(resp(503, { replay: true }), resp(503, { replay: true }))
  await roda(b, { agora: 1e12 + 2000 })
  assert.equal(a.chamadas[1][2].chave, b.chamadas[1][2].chave)
  // replay de 4xx comum NÃO refaz; replay incerto NÃO refaz
  const q1 = proxyDe(resp(400, { replay: true }))
  await roda(q1)
  assert.equal(q1.chamadas.length, 1)
  const q2 = proxyDe(resp(504, { replay: true, incerto: true }))
  await roda(q2)
  assert.equal(q2.chamadas.length, 1)
})
