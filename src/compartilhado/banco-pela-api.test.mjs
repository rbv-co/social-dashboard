import { test } from 'node:test'
import assert from 'node:assert/strict'

function guarda() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } }
globalThis.window = { localStorage: guarda(), sessionStorage: guarda(), location: { search: '' } }
const b = await import('./banco-pela-api.js')

// API de mentira: responde por "MÉTODO caminho" e guarda os pedidos.
function api(rotas) {
  const pedidos = []
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://x')
    const chave = `${init.method || 'GET'} ${u.pathname.replace(/^\/api/, '')}`
    pedidos.push({ chave, busca: u.search, corpo: init.body ? JSON.parse(init.body) : undefined })
    const [status, corpo, cab = {}] = rotas[chave] || [404, { error: 'nao_encontrado' }]
    return { status, ok: status < 300, text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)), headers: { get: (k) => cab[k] ?? null } }
  }
  return pedidos
}

test('sem a área ligada, deOnde devolve o MESMO sbClient.from', () => {
  const sb = { from: (t) => ({ eraDoSupabase: t }) }
  assert.deepEqual(b.deOnde(sb).from('profiles'), { eraDoSupabase: 'profiles' })
  assert.equal(b.tabelaNaApi('profiles'), false)
})

test('lerCaminhoPostgrest: filtros, select, ordem e limite', () => {
  const p = b.lerCaminhoPostgrest('profiles?select=id,name&email=eq.a%40b.c&order=name.desc,email&limit=1')
  assert.equal(p.tabela, 'profiles')
  assert.deepEqual(p.filtros, [{ col: 'email', op: 'eq', val: 'a@b.c' }])
  assert.equal(p.select, 'id,name')
  assert.deepEqual(p.ordem, [{ col: 'name', asc: false }, { col: 'email', asc: true }])
  assert.equal(p.limite, 1)
})

test('leitura: filtro vira parâmetro nomeado, ordem declarada vai para a rota, select projeta', async () => {
  const pedidos = api({ 'GET /acesso/usuarios': [200, [{ id: 'u1', email: 'a@b.c', name: 'Ana', role: 'viewer' }]] })
  const r = await b.fetchPostgrest('profiles?select=id,name&email=eq.a%40b.c&order=name&limit=1')
  assert.equal(r.ok, true)
  assert.deepEqual(await r.json(), [{ id: 'u1', name: 'Ana' }])
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[0].busca)), { email: 'a@b.c', ordem: 'name.asc', limite: '1' })
})

test('ilike de e-mail (paraIlike) vira o filtro de igualdade; curinga de verdade é recusado', async () => {
  const pedidos = api({ 'GET /acesso/usuarios': [200, []] })
  await b.fetchPostgrest('profiles?select=id&email=ilike.' + encodeURIComponent('a\\_b@x.com'))
  assert.equal(new URLSearchParams(pedidos[0].busca).get('email'), 'a_b@x.com')
  const r = await b.fetchPostgrest('profiles?select=id&email=ilike.' + encodeURIComponent('a%'))
  assert.equal(r.ok, false)
})

test('eq com aspas (paraEq) e in com lista', async () => {
  const pedidos = api({ 'GET /acesso/perfis': [200, []], 'GET /equipes/membros': [200, []] })
  await b.fetchPostgrest('acessos_perfis?select=id,nome&nome=eq.' + encodeURIComponent('"Loja \\"A\\""'))
  assert.equal(new URLSearchParams(pedidos[0].busca).get('nome'), 'Loja "A"')
  await b.consultaPelaApi('equipes_membros').select('papel').eq('profile_id', 'p1').in('papel', ['gestor', 'supervisora']).limit(1)
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[1].busca)), { profile_id: 'p1', papel: 'gestor,supervisora', limite: '1' })
})

test('O QUE A ROTA NÃO SABE, A TRADUÇÃO RECUSA: filtro não declarado, embutido, ordem fora com limite', async () => {
  const pedidos = api({ 'GET /acesso/usuarios': [200, []] })
  for (const c of ['profiles?name=eq.x&limit=5', 'profiles?name=gte.x', 'profiles?select=id,equipes(nome)', 'profiles?order=disabled&limit=5', 'profiles?id=gte.x']) {
    const r = await b.fetchPostgrest(c)
    assert.equal(r.ok, false, c)
  }
  assert.equal(pedidos.length, 0, 'nenhum pedido sai quando a tradução recusa')
})

test('ordem que a rota não declara, sem limite: a tela ordena', async () => {
  api({ 'GET /equipes/times': [200, [{ id: 1, canal_loja_id: 9 }, { id: 2, canal_loja_id: 3 }]] })
  const r = await b.consultaPelaApi('equipes').select('id').order('canal_loja_id')
  assert.deepEqual(r.data, [{ id: 2 }, { id: 1 }])
})

test('single e maybeSingle como o supabase-js', async () => {
  api({ 'GET /acesso/usuarios': [200, [{ id: 'u1' }]] })
  assert.deepEqual((await b.consultaPelaApi('profiles').select('id').eq('email', 'x').maybeSingle()).data, { id: 'u1' })
  api({ 'GET /acesso/usuarios': [200, []] })
  assert.equal((await b.consultaPelaApi('profiles').select('id').eq('email', 'x').maybeSingle()).data, null)
  assert.equal((await b.consultaPelaApi('profiles').select('id').eq('email', 'x').single()).error.code, 'PGRST116')
})

test('editar por id: PATCH /rota/{id}; .select() devolve [linha]; sem select, data null', async () => {
  const pedidos = api({ 'PATCH /acesso/usuarios/u1': [200, { id: 'u1', role: 'admin' }] })
  const r = await b.consultaPelaApi('profiles').update({ role: 'admin' }).eq('id', 'u1').select('id')
  assert.deepEqual(r.data, [{ id: 'u1', role: 'admin' }])
  assert.deepEqual(pedidos[0].corpo, { role: 'admin' })
  const s = await b.consultaPelaApi('profiles').update({ role: 'admin' }).eq('id', 'u1')
  assert.equal(s.data, null); assert.equal(s.error, null)
})

test('editar por outra coluna é recusado (a API edita por id)', async () => {
  const pedidos = api({})
  const r = await b.consultaPelaApi('profiles').update({ role: 'admin' }).eq('email', 'a@b')
  assert.equal(r.error.code, 'traducao')
  assert.equal(pedidos.length, 0)
})

test('inserir tira a autoria (a sessão preenche); Prefer return=representation devolve o array', async () => {
  const pedidos = api({ 'POST /equipes/membros': [201, { id: 'm1', equipe_id: 'e', profile_id: 'p', papel: 'vendedora' }] })
  const r = await b.fetchPostgrest('equipes_membros', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ equipe_id: 'e', profile_id: 'p', papel: 'vendedora', criado_por: 'quem' }) })
  assert.equal(r.status, 201)
  assert.deepEqual(await r.json(), [{ id: 'm1', equipe_id: 'e', profile_id: 'p', papel: 'vendedora' }])
  assert.deepEqual(pedidos[0].corpo, { equipe_id: 'e', profile_id: 'p', papel: 'vendedora' })
  const s = await b.fetchPostgrest('equipes_membros', { method: 'POST', body: '{"equipe_id":"e"}' })
  assert.equal(s.status, 201); assert.equal(await s.text(), '')
})

test('apagar por id e por chave natural (equipes_permissoes): as mesmas linhas, uma a uma por id', async () => {
  const pedidos = api({
    'DELETE /equipes/membros/m1': [204],
    'GET /equipes/permissoes': [200, [{ id: 'x1', equipe_id: 'e', profile_id: 'p', chave: 'estoque' }, { id: 'x2', equipe_id: 'e', profile_id: 'p', chave: 'outra' }]],
    'DELETE /equipes/permissoes/x1': [204],
  })
  assert.equal((await b.fetchPostgrest('equipes_membros?id=eq.m1', { method: 'DELETE' })).status, 204)
  const r = await b.consultaPelaApi('equipes_permissoes').delete().eq('equipe_id', 'e').eq('profile_id', 'p').eq('chave', 'estoque')
  assert.equal(r.error, null)
  assert.deepEqual(pedidos.map((p) => p.chave), ['DELETE /equipes/membros/m1', 'GET /equipes/permissoes', 'DELETE /equipes/permissoes/x1'])
})

test('upserts especiais: preferências em lote e push do próprio aparelho', async () => {
  const pedidos = api({ 'POST /avisos/preferencias': [200, [{ user_id: 'u', tipo: 'venda', ativo: true }]], 'POST /eu/push/inscrever': [201, { id: 's' }], 'POST /eu/push/desinscrever': [204] })
  const r = await b.fetchPostgrest('push_preferencias?on_conflict=user_id,tipo', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([{ user_id: 'u', tipo: 'venda', ativo: true, alterado_por: 'eu' }]) })
  assert.equal(r.ok, true)
  assert.deepEqual(pedidos[0].corpo, [{ user_id: 'u', tipo: 'venda', ativo: true }])
  await b.consultaPelaApi('push_subs').upsert({ user_id: 'u', endpoint: 'https://e', p256dh: 'k', auth: 'a', criado_em: 'x' })
  assert.deepEqual(pedidos[1].corpo, { endpoint: 'https://e', p256dh: 'k', auth: 'a' })
  await b.consultaPelaApi('push_subs').delete().eq('endpoint', 'https://e')
  assert.deepEqual([pedidos[2].chave, pedidos[2].corpo], ['POST /eu/push/desinscrever', { endpoint: 'https://e' }])
})

test('erro da API chega no formato do supabase-js (message legível, nunca o código cru)', async () => {
  api({ 'PATCH /acesso/usuarios/u1': [403, { error: 'sem_permissao', mensagem: 'Quem entrou como outra pessoa não edita.' }] })
  const r = await b.consultaPelaApi('profiles').update({ role: 'admin' }).eq('id', 'u1')
  assert.equal(r.error.message, 'Quem entrou como outra pessoa não edita.')
  api({ 'PATCH /acesso/usuarios/u1': [404, { error: 'nao_encontrado' }] })
  const s = await b.fetchPostgrest('profiles?id=eq.u1', { method: 'PATCH', body: '{"role":"admin"}' })
  assert.equal(s.ok, false); assert.equal(s.status, 404)
  assert.doesNotMatch((await s.json()).message, /^nao_encontrado$/)
})

test('apagar com return=representation devolve as linhas apagadas (a tela conta)', async () => {
  api({ 'DELETE /equipes/grupos/g1': [204] })
  const r = await b.fetchPostgrest('canais_grupos?id=eq.g1', { method: 'DELETE', headers: { Prefer: 'return=representation' } })
  assert.deepEqual(await r.json(), [{ id: 'g1' }])
  api({ 'DELETE /equipes/grupos/g1': [204] })
  const s = await b.fetchPostgrest('canais_grupos?id=eq.g1', { method: 'DELETE' })
  assert.equal(s.status, 204)
})

test('Prefer: count=exact pede contar=1 e devolve Content-Range "0-0/N"', async () => {
  const pedidos = api({ 'GET /acesso/usuarios': [200, [{ id: 'u1' }], { 'X-Total-Count': '2' }] })
  const r = await b.fetchPostgrest('profiles?select=id&email=ilike.a%40b.c&limit=1', { headers: { Prefer: 'count=exact' } })
  assert.equal(new URLSearchParams(pedidos[0].busca).get('contar'), '1')
  assert.equal(r.headers.get('content-range'), '0-0/2')
  assert.equal(Number(r.headers.get('content-range').split('/')[1]), 2)
})

test('erro: text() devolve a frase, json() o objeto', async () => {
  api({ 'POST /equipes/grupos': [403, { error: 'sem_permissao', mensagem: 'Sem permissão para isso.' }] })
  const r = await b.fetchPostgrest('canais_grupos', { method: 'POST', body: '{"nome":"x"}' })
  assert.equal(await r.text(), 'Sem permissão para isso.')
})

test('ordem: várias colunas sem limite ordena na tela; nulls explícito e várias com limite recusam; nulos como o PostgREST', async () => {
  api({ 'GET /equipes/times': [200, [{ id: 1, nome: 'b', ordem: 1 }, { id: 2, nome: 'a', ordem: 1 }, { id: 3, nome: null, ordem: 0 }]] })
  const r = await b.consultaPelaApi('equipes').select('id').order('ordem').order('nome')
  assert.deepEqual(r.data.map((x) => x.id), [3, 2, 1])
  api({ 'GET /equipes/times': [200, [{ id: 1, canal_loja_id: 9 }, { id: 3, canal_loja_id: null }, { id: 2, canal_loja_id: 5 }]] })
  const d = await b.consultaPelaApi('equipes').select('id').order('canal_loja_id', { ascending: false })
  assert.deepEqual(d.data.map((x) => x.id), [3, 1, 2], 'nulo primeiro no desc, como o PostgREST')
  assert.equal((await b.fetchPostgrest('equipes?order=nome.asc.nullsfirst')).ok, false)
  assert.equal((await b.fetchPostgrest('equipes?order=ordem,nome&limit=5')).ok, false)
})

test('in com aspas é recusado', async () => {
  const pedidos = api({})
  assert.equal((await b.fetchPostgrest('equipes_membros?papel=in.(' + encodeURIComponent('"a,b",c') + ')')).ok, false)
  assert.equal(pedidos.length, 0)
})
/* ── 5.6 — Meta e redes ─────────────────────────────────────────────────── */

test('5.6: faixa de datas vira _de/_ate; period_days lte vira period_days_ate', async () => {
  const pedidos = api({ 'GET /redes/seguidores': [200, []], 'GET /redes/conteudo': [200, []] })
  await b.fetchPostgrest('daily_snapshots?account_id=eq.c1&captured_at=gte.2026-09-01&captured_at=lte.2026-10-01&order=captured_at.asc&select=followers_count,captured_at')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[0].busca)), { account_id: 'c1', captured_at_de: '2026-09-01', captured_at_ate: '2026-10-01', ordem: 'captured_at.asc', contar: '1' })
  await b.fetchPostgrest('content_snapshots?captured_at=eq.2026-10-12&period_days=lte.1&select=account_id,stories_count&order=period_days.asc')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[1].busca)), { captured_at: '2026-10-12', period_days_ate: '1', ordem: 'period_days.asc', contar: '1' })
})

test('5.6: lido_em gte com data pura vira instante RFC 3339 (meia-noite UTC, como o PostgREST)', async () => {
  const pedidos = api({ 'GET /redes/leituras-de-seguidores': [200, []] })
  await b.fetchPostgrest('followers_leituras?select=followers_count,lido_em&account_id=eq.c1&lido_em=gte.2026-10-01&order=lido_em.asc')
  assert.equal(new URLSearchParams(pedidos[0].busca).get('lido_em_de'), '2026-10-01T00:00:00Z')
  await b.fetchPostgrest('followers_leituras?account_id=eq.c1&lido_em=gte.' + encodeURIComponent('2026-10-01T03:00:00.000Z'))
  assert.equal(new URLSearchParams(pedidos[1].busca).get('lido_em_de'), '2026-10-01T03:00:00.000Z')
})

test('5.6: limite acima do teto da API é recusado (cortar calado daria número menor)', async () => {
  const pedidos = api({ 'GET /redes/campanhas': [200, []] })
  const r = await b.fetchPostgrest('campaigns?account_id=eq.c1&limit=5000&select=campaign_id')
  assert.equal(r.ok, false)
  assert.equal(pedidos.length, 0)
})

test('5.6: contarPelaApi lê o X-Total-Count com limite=1', async () => {
  const pedidos = api({ 'GET /redes/seguidores': [200, [{ account_id: 'c1' }], { 'X-Total-Count': '1213' }] })
  assert.equal(await b.contarPelaApi('daily_snapshots'), 1213)
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[0].busca)), { limite: '1', contar: '1' })
  api({ 'GET /redes/seguidores': [500, { error: 'erro_interno' }] })
  assert.equal(await b.contarPelaApi('daily_snapshots'), null)
})

test('5.6: metas em lote (PUT {metas}) e filtro de campanha por conta (PUT, sem updated_at)', async () => {
  const pedidos = api({ 'PUT /redes/metas': [200, [{ account_id: 'c1' }]], 'PUT /redes/filtros-de-campanha/c1': [200, { account_id: 'c1', selected_ids: [] }] })
  await b.consultaPelaApi('social_metas').upsert([{ account_id: 'c1', periodo: 'mes', indicador: 'seguidores', valor: 10 }], { onConflict: 'account_id,periodo,indicador' })
  assert.deepEqual(pedidos[0].corpo, { metas: [{ account_id: 'c1', periodo: 'mes', indicador: 'seguidores', valor: 10 }] })
  const r = await b.fetchPostgrest('campaign_filters', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ account_id: 'c1', selected_ids: [], updated_at: '2026-10-12T00:00:00Z' }) })
  assert.equal(r.ok, true)
  assert.deepEqual([pedidos[1].chave, pedidos[1].corpo], ['PUT /redes/filtros-de-campanha/c1', { selected_ids: [] }])
})

test('5.6: conta editada por id vai para PATCH /redes/contas/{id}', async () => {
  const pedidos = api({ 'PATCH /redes/contas/c1': [200, { id: 'c1', persona: 'x' }] })
  const r = await b.fetchPostgrest('accounts?id=eq.c1&select=id,persona', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: '{"persona":"x"}' })
  assert.deepEqual(await r.json(), [{ id: 'c1', persona: 'x' }])
  assert.equal(pedidos[0].chave, 'PATCH /redes/contas/c1')
})

test('o encadeado devolve status como o supabase-js (200, ou o do erro)', async () => {
  api({ 'GET /redes/contas': [200, [{ id: 'c1', name: 'A' }]] })
  assert.equal((await b.consultaPelaApi('accounts').select('id,name')).status, 200)
  api({ 'GET /redes/contas': [401, { error: 'nao_autenticado' }] })
  assert.equal((await b.consultaPelaApi('accounts').select('id,name')).status, 401)
})

test('sem limite, a leitura vem INTEIRA: pagina por deslocamento até o X-Total-Count', async () => {
  const pedidos = []
  globalThis.fetch = async (url) => {
    const q = new URL(url, 'http://x').searchParams
    pedidos.push(Object.fromEntries(q))
    const d = Number(q.get('deslocamento') || 0)
    const pag = d === 0 ? Array.from({ length: 1000 }, (_, i) => ({ dia: 'x', hora: i })) : Array.from({ length: 300 }, (_, i) => ({ dia: 'y', hora: i }))
    return { status: 200, ok: true, text: async () => JSON.stringify(pag), headers: { get: (k) => (k === 'X-Total-Count' ? '1300' : null) } }
  }
  const r = await b.fetchPostgrest('campaign_insights_hora?select=dia,hora&dia=gte.2026-10-01&account_id=eq.c1')
  assert.equal((await r.json()).length, 1300)
  assert.deepEqual(pedidos.map((p) => p.deslocamento || '0'), ['0', '1000'])
  assert.equal(pedidos[0].contar, '1')
})

test('com limite explícito, uma página só (o limite é o que a tela quis)', async () => {
  const pedidos = api({ 'GET /redes/seguidores': [200, [{ account_id: 'c1', followers_count: 1 }], { 'X-Total-Count': '50' }] })
  await b.fetchPostgrest('daily_snapshots?account_id=eq.c1&order=captured_at.desc&limit=1&select=followers_count')
  assert.equal(pedidos.length, 1)
})

test('filtro que a rota não declara (eq/in, sem limite) vira filtro na tela; com limite, recusa', async () => {
  api({ 'GET /redes/contas': [200, [{ id: 'a', instagram_id: '1', profile_picture_url: 'u1' }, { id: 'b', instagram_id: '2', profile_picture_url: 'u2' }, { id: 'c', instagram_id: '3', profile_picture_url: 'u3' }], { 'X-Total-Count': '3' }] })
  const r = await b.consultaPelaApi('accounts').select('instagram_id,profile_picture_url').in('instagram_id', ['1', '3'])
  assert.deepEqual(r.data, [{ instagram_id: '1', profile_picture_url: 'u1' }, { instagram_id: '3', profile_picture_url: 'u3' }])
  const s = await b.consultaPelaApi('accounts').select('id').eq('instagram_id', '1').limit(1)
  assert.equal(s.error.code, 'traducao')
  const t = await b.consultaPelaApi('accounts').select('id').eq('nao_existe', '1')
  assert.equal(t.error.code, 'traducao')
})
