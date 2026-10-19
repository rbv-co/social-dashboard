import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrirRest, modoPg } from './rest-pg.mjs'

// Cliente falso: guarda cada consulta e devolve o que o teste mandar.
function falso(resposta = () => ({ rows: [] })) {
  const consultas = []
  const ouvintes = {}
  class Client {
    constructor(cfg) { this.cfg = cfg }
    on(ev, fn) { ouvintes[ev] = fn }
    async connect() { if (falso.recusa) throw new Error('ECONNREFUSED') }
    async query(sql, valores) { consultas.push({ sql: sql.replace(/\s+/g, ' ').trim(), valores }); return resposta(sql, valores) }
    async end() {}
  }
  return { Client, consultas, ouvintes }
}
const ENV = { REST_VIA_PG: '1', DATABASE_URL: 'postgres://robo_x@api-db:5432/api' }

test('modoPg: só liga com a flag explícita e recusa banco do Supabase', () => {
  assert.equal(modoPg({ DATABASE_URL: ENV.DATABASE_URL }), false)
  assert.equal(modoPg(ENV), true)
  assert.throws(() => modoPg({ REST_VIA_PG: '1', DATABASE_URL: 'postgres://x@aws-0.pooler.supabase.com:6543/postgres' }), /Supabase/)
  assert.throws(() => modoPg({ REST_VIA_PG: '1' }), /DATABASE_URL/)
})

test('sem a flag: REST do Supabase com a chave de serviço (caminho de rollback)', async () => {
  const r = await abrirRest({ SUPABASE_SERVICE_KEY: 'k', SUPABASE_URL: 'https://x.supabase.co' })
  assert.equal(r.via, 'rest')
  assert.equal(r.REST, 'https://x.supabase.co/rest/v1')
  assert.equal(r.sb.apikey, 'k')
  await assert.rejects(abrirRest({}), /SUPABASE_SERVICE_KEY/)
})

test('GET: filtros viram SQL parametrizado e a linha volta como o JSON do PostgREST', async () => {
  const f = falso(() => ({ rows: [{ j: '{"pedido_id":1,"total":"9.5"}' }] }))
  const r = await abrirRest(ENV, { Client: f.Client })
  const res = await r.fetch(`${r.REST}/bling_pedido_nota?select=pedido_id,total&pedido_id=in.(1,2)&mes=gte.2026-10-01&foco=is.true&order=pedido_id.desc&limit=5`)
  assert.equal(res.ok, true)
  assert.deepEqual(await res.json(), [{ pedido_id: 1, total: '9.5' }])
  const c = f.consultas[0]
  assert.match(c.sql, /^select row_to_json\(t\)::text as j from \(select x\."pedido_id", x\."total" from public\."bling_pedido_nota" x where x\."pedido_id" in \(\$1, \$2\) and x\."mes" >= \$3 and x\."foco" is true order by x\."pedido_id" desc limit 5\) t$/)
  assert.deepEqual(c.valores, ['1', '2', '2026-10-01'])
})

test('GET: nome de tabela/coluna fora da lista segura e operador sem tradução são recusados', async () => {
  const r = await abrirRest(ENV, { Client: falso().Client })
  await assert.rejects(r.fetch(`${r.REST}/x;drop?id=eq.1`), /identificador/)
  await assert.rejects(r.fetch(`${r.REST}/t?select=a,b(c)`), /identificador/)
  await assert.rejects(r.fetch(`${r.REST}/t?or=(a.eq.1,b.eq.2)`), /sem tradução/)
  await assert.rejects(r.fetch(`${r.REST}/t?id=cs.{1}`), /sem tradução/)
})

test('POST com on_conflict: upsert em UMA instrução, sem repetir a chave no SET', async () => {
  const f = falso()
  const r = await abrirRest(ENV, { Client: f.Client })
  const res = await r.fetch(`${r.REST}/bling_pedido_nota?on_conflict=pedido_id`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ pedido_id: 1, total: 5 }, { pedido_id: 2, total: 6, obs: 'x' }]),
  })
  assert.equal(res.status, 201) // como o PostgREST: POST criado, sem corpo
  const c = f.consultas[0]
  assert.equal(c.sql, 'insert into public."bling_pedido_nota" ("pedido_id", "total", "obs") select "pedido_id", "total", "obs" from json_populate_recordset(null::public."bling_pedido_nota", $1::json) on conflict ("pedido_id") do update set "total" = excluded."total", "obs" = excluded."obs"')
  assert.equal(c.valores.length, 1)
  assert.equal(JSON.parse(c.valores[0]).length, 2)
})

test('POST sem upsert devolve a linha criada com return=representation; ignore-duplicates faz nothing', async () => {
  const f = falso(() => ({ rows: [{ j: '{"id":7}' }] }))
  const r = await abrirRest(ENV, { Client: f.Client })
  const a = await r.fetch(`${r.REST}/t`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ a: 1 }) })
  assert.equal(a.status, 201)
  assert.deepEqual(await a.json(), [{ id: 7 }])
  assert.match(f.consultas[0].sql, /returning to_json\(t\)::text as j$|returning /)
  await r.fetch(`${r.REST}/t?on_conflict=a`, { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify([{ a: 1 }]) })
  assert.match(f.consultas[1].sql, /on conflict \("a"\) do nothing$/)
})

test('PATCH e DELETE exigem filtro; o PATCH grava só as colunas do corpo', async () => {
  const f = falso(() => ({ rows: [{ j: '{"pedido_id":1}' }], rowCount: 1 }))
  const r = await abrirRest(ENV, { Client: f.Client })
  await assert.rejects(r.fetch(`${r.REST}/t`, { method: 'DELETE' }), /sem filtro/)
  await assert.rejects(r.fetch(`${r.REST}/t`, { method: 'PATCH', body: '{"a":1}' }), /sem filtro/)
  const p = await r.fetch(`${r.REST}/gestao_comercial_briefings?id=eq.5`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ dados_json: { a: [1] } }) })
  assert.equal(p.status, 204)
  assert.equal(f.consultas[0].sql, 'update public."gestao_comercial_briefings" as t set "dados_json" = s."dados_json" from json_populate_record(null::public."gestao_comercial_briefings", $1::json) as s where t."id" = $2')
  assert.deepEqual(f.consultas[0].valores, ['{"dados_json":{"a":[1]}}', '5'])
  const d = await r.fetch(`${r.REST}/bling_pedido_nota?pedido_id=in.(1)`, { method: 'DELETE', headers: { Prefer: 'return=representation' } })
  assert.deepEqual(await d.json(), [{ pedido_id: 1 }])
  assert.match(f.consultas[1].sql, /^delete from public\."bling_pedido_nota" as x where x\."pedido_id" in \(\$1\) returning to_json\(x\)::text as j$/)
})

test('erro do banco vira resposta HTTP-like (403 GRANT, 409 duplicado, 400 resto), sem lançar', async () => {
  for (const [code, status] of [['42501', 403], ['23505', 409], ['22P02', 400]]) {
    const r = await abrirRest(ENV, { Client: falso(() => { throw Object.assign(new Error('boom'), { code }) }).Client })
    const res = await r.fetch(`${r.REST}/t?id=eq.1`)
    assert.equal(res.ok, false)
    assert.equal(res.status, status)
    assert.match(await res.text(), /boom/)
  }
})

test('banco fora: falha ao abrir, antes de qualquer escrita; conexão que cai no meio lança', async () => {
  falso.recusa = true
  await assert.rejects(abrirRest(ENV, { Client: falso().Client }), /ECONNREFUSED/)
  falso.recusa = false
  const f = falso()
  const r = await abrirRest(ENV, { Client: f.Client })
  f.ouvintes.error(new Error('terminated'))
  await assert.rejects(r.fetch(`${r.REST}/t?id=eq.1`), /caiu/)
})
