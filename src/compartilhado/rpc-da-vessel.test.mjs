import { test } from 'node:test'
import assert from 'node:assert/strict'

function guarda() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } }
globalThis.window = { localStorage: guarda(), sessionStorage: guarda(), location: { search: '' } }
const { okFalsoDoPortao, fetchRpcNaArea } = await import('./api.js')

const resp = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

test('403 sem frase vira `200 {ok:false, situacao:"sem_permissao"}` (o que a tela lê)', async () => {
  const r = await okFalsoDoPortao(resp(403, { error: 'sem_permissao' }))
  assert.equal(r.status, 200)
  const c = await r.json()
  assert.equal(c.ok, false)
  assert.equal(c.situacao, 'sem_permissao')
  assert.match(c.erro, /permissão/)
})

test('403 COM frase ("entrar como") segue 403 e a frase fica no corpo', async () => {
  const r = await okFalsoDoPortao(resp(403, { error: 'sem_permissao', mensagem: 'Quem entrou como outra pessoa só consulta.' }))
  assert.equal(r.status, 403)
  assert.equal((await r.json()).mensagem, 'Quem entrou como outra pessoa só consulta.')
})

test('sucesso e outros erros passam intactos', async () => {
  for (const [st, corpo] of [[200, { ok: true }], [400, { error: 'pedido_invalido' }], [500, { error: 'erro_interno' }]]) {
    const original = resp(st, corpo)
    assert.equal(await okFalsoDoPortao(original), original)
  }
})

test('com a área desligada é o `fetch` do Supabase, com a URL e o init de sempre', async () => {
  let visto
  globalThis.fetch = async (url, init) => { visto = [url, init]; return resp(200, []) }
  const init = { method: 'POST', body: '{}' }
  await fetchRpcNaArea('vessel', 'https://x.supabase.co/rest/v1/rpc/vessel_conta_das_private_edits', 'vessel_conta_das_private_edits', init)
  assert.deepEqual(visto, ['https://x.supabase.co/rest/v1/rpc/vessel_conta_das_private_edits', init])
})
