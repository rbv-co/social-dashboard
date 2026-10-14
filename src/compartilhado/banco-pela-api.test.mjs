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

/* ── 5.8 — Fábrica ─────────────────────────────────────────────────────────── */

test('5.8: is.null/not.is.null viram os booleanos da rota; in de status vira lista', async () => {
  const pedidos = api({ 'GET /fabrica/campanhas': [200, [], { 'X-Total-Count': '0' }] })
  await b.fetchPostgrest('fabrica_campanhas?select=id,nome,status,created_at&fechada_em=is.null&purgado_em=is.null&status=in.(gerando,pronta,erro)&order=created_at.desc')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[0].busca)), { aberta: 'true', purgada: 'false', status: 'gerando,pronta,erro', ordem: 'created_at.desc', contar: '1' })
  await b.fetchPostgrest('fabrica_campanhas?select=id,nome,fechada_em&fechada_em=not.is.null&order=fechada_em.desc&limit=8')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[1].busca)), { aberta: 'false', ordem: 'fechada_em.desc', limite: '8' })
  assert.equal((await b.fetchPostgrest('fabrica_campanhas?fechada_em=is.true')).ok, false)
})

test('5.8: o caminho JSON params->>campanhaId vira campanha_id', async () => {
  const pedidos = api({ 'GET /fabrica/jobs': [200, []], 'GET /fabrica/meta-jobs': [200, []] })
  await b.fetchPostgrest('fabrica_jobs?select=id,status,resultado&tipo=eq.subir&params->>campanhaId=eq.c1&order=created_at.desc&limit=1')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[0].busca)), { tipo: 'subir', campanha_id: 'c1', ordem: 'created_at.desc', limite: '1' })
  await b.fetchPostgrest('fabrica_meta_jobs?select=meta_campaign_id,payload&meta_campaign_id=not.is.null&payload->>campanhaId=in.(c1,c2)')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[1].busca)), { com_campanha_meta: 'true', campanha_id: 'c1,c2', contar: '1' })
})

test('configurarApi (robôs): endereço e token explícitos', async () => {
  const api_ = await import('./api.js')
  const pedidos = api({ 'GET /fabrica/looks': [200, []] })
  api_.configurarApi({ base: 'http://api:8080/', token: 'srv_x' })
  try {
    await api_.pedir('GET', '/fabrica/looks')
    assert.equal(pedidos[0].chave, 'GET /fabrica/looks')
  } finally { api_.configurarApi({ base: '/api', token: null }) }
})

test('head: true só conta: pede uma linha e devolve o X-Total-Count', async () => {
  const pedidos = api({ 'GET /fabrica/criativos': [200, [{ id: 'c1' }], { 'X-Total-Count': '2500' }] })
  const r = await b.consultaPelaApi('fabrica_criativos').select('id', { count: 'exact', head: true })
  assert.equal(r.count, 2500)
  assert.equal(pedidos.length, 1)
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[0].busca)), { limite: '1', contar: '1' })
})

test('5.2: bens com os 3 embutidos fixos passam; outro embutido ou coluna do embutido, recusa', async () => {
  const bem = { id: 'b1', nome: 'Notebook', marca: 'X', patrimonio_categorias: { nome: 'TI' }, patrimonio_locais: null, patrimonio_comodos: null }
  const pedidos = api({ 'GET /patrimonio/bens': [200, [bem], { 'X-Total-Count': '1' }] })
  const r = await b.consultaPelaApi('patrimonio_bens')
    .select('id,nome,marca,patrimonio_categorias(nome),patrimonio_locais(nome),patrimonio_comodos(nome)').eq('pessoa_id', 'p1').order('nome')
  assert.equal(r.error, null)
  assert.deepEqual(r.data, [bem])
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[0].busca)), { pessoa_id: 'p1', ordem: 'nome.asc', contar: '1' })
  const outro = await b.consultaPelaApi('patrimonio_bens').select('id,acessos_pessoas(nome)')
  assert.match(outro.error.message, /recurso embutido/)
  const col = await b.consultaPelaApi('patrimonio_bens').select('id,patrimonio_locais(nome,empresa_id)')
  assert.match(col.error.message, /só devolve \{nome\}/)
})

test('5.2: categoria por ILIKE manda o PADRÃO como valor (nome_como), curinga e tudo', async () => {
  const pedidos = api({ 'GET /patrimonio/categorias': [200, [{ id: 'c1', nome: 'Veículos' }]] })
  const r = await b.consultaPelaApi('patrimonio_categorias').select('id,nome').ilike('nome', '%ve%cul%').limit(1)
  assert.deepEqual(r.data, [{ id: 'c1', nome: 'Veículos' }])
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[0].busca)), { nome_como: '%ve%cul%', limite: '1' })
})

test('5.2: posses abertas (is null) e por faixa de data', async () => {
  const pedidos = api({ 'GET /patrimonio/posses': [200, [], { 'X-Total-Count': '0' }] })
  await b.consultaPelaApi('patrimonio_posse').select('*').is('ate', null).order('de', { ascending: false })
  await b.consultaPelaApi('patrimonio_posse').select('*').gte('de', '2026-10-01').lte('de', '2026-10-31').order('de', { ascending: false })
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[0].busca)), { aberta: 'true', ordem: 'de.desc', contar: '1' })
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedidos[1].busca)), { de_desde: '2026-10-01', de_ate: '2026-10-31', ordem: 'de.desc', contar: '1' })
})

test('5.2: ordem em duas colunas (ordem, nome) a tela faz; numeração é um PUT por chave sem atualizado_em', async () => {
  const pedidos = api({
    'GET /patrimonio/empresas': [200, [{ id: 'e2', nome: 'B', ordem: 1 }, { id: 'e1', nome: 'A', ordem: 1 }, { id: 'e0', nome: 'Z', ordem: 0 }], { 'X-Total-Count': '3' }],
    'PUT /patrimonio/config/numero_maximo': [200, { chave: 'numero_maximo', valor: '500' }],
  })
  const r = await b.consultaPelaApi('patrimonio_empresas').select('id,nome').order('ordem').order('nome')
  assert.deepEqual(r.data.map((x) => x.id), ['e0', 'e1', 'e2'])
  const u = await b.consultaPelaApi('patrimonio_config').upsert({ chave: 'numero_maximo', valor: '500', atualizado_em: '2026-10-14T00:00:00Z' })
  assert.equal(u.error, null)
  assert.deepEqual(pedidos.at(-1).corpo, { valor: '500' })
})

test('5.2: criar bem devolve o objeto (.select("id").single()); nome repetido volta como 409 com a frase', async () => {
  api({ 'POST /patrimonio/bens': [201, { id: 'b9', nome: 'Mesa' }], 'POST /patrimonio/empresas': [409, { error: 'conflito', mensagem: 'Já existe.' }] })
  const ok = await b.consultaPelaApi('patrimonio_bens').insert({ nome: 'Mesa', criado_em: 'x' }).select('id').single()
  assert.equal(ok.data.id, 'b9')
  const dup = await b.consultaPelaApi('patrimonio_empresas').insert({ nome: 'A', ordem: 1 }).select('id, nome').single()
  assert.equal(dup.error.status, 409)
  assert.equal(dup.error.message, 'Já existe.')
})

// ── 5.3 — Frota ──
const busca = (p) => Object.fromEntries(new URLSearchParams(p.busca))

test('frota_uso: aberta/fechada viram `aberta`, a ordem e o limite vão para a rota', async () => {
  const pedidos = api({ 'GET /frota/usos': [200, [{ id: 'u1' }], { 'X-Total-Count': '1' }] })
  await b.consultaPelaApi('frota_uso').select('*').is('volta_em', null).order('saida_em', { ascending: false })
  await b.consultaPelaApi('frota_uso').select('*').not('volta_em', 'is', null).order('saida_em', { ascending: false }).limit(400)
  assert.equal(busca(pedidos[0]).aberta, 'true')
  assert.equal(busca(pedidos[0]).ordem, 'saida_em.desc')
  assert.deepEqual([busca(pedidos[1]).aberta, busca(pedidos[1]).limite], ['false', '400'])
})

test('frota_checklist: `assinada_em` não nulo vira `assinada=true`; faixa de datas vira feita_de/feita_ate', async () => {
  const pedidos = api({ 'GET /frota/checklists': [200, [{ assinatura_hash: 'h' }]] })
  const r = await b.consultaPelaApi('frota_checklist').select('assinatura_hash').eq('veiculo_id', 'v1')
    .not('assinada_em', 'is', null).order('feita_em', { ascending: false }).limit(1)
  assert.deepEqual(r.data, [{ assinatura_hash: 'h' }])
  assert.deepEqual(busca(pedidos[0]), { veiculo_id: 'v1', assinada: 'true', ordem: 'feita_em.desc', limite: '1' })
  await b.consultaPelaApi('frota_checklist').select('*').gte('feita_em', '2026-07-01').lte('feita_em', '2026-07-31')
  assert.deepEqual([busca(pedidos[1]).feita_de, busca(pedidos[1]).feita_ate], ['2026-07-01', '2026-07-31'])
})

test('frota_checklist_pdf: `neq enviado` = pendente=true; outro valor é recusado', async () => {
  const pedidos = api({ 'GET /frota/checklists/copias': [200, []] })
  const ok = await b.consultaPelaApi('frota_checklist_pdf').select('*').neq('situacao', 'enviado').order('criado_em').limit(200)
  assert.equal(ok.error, null)
  assert.equal(busca(pedidos[0]).pendente, 'true')
  const ruim = await b.consultaPelaApi('frota_checklist_pdf').select('*').neq('situacao', 'erro').limit(1)
  assert.match(ruim.error.message, /sem tradução/)
})

test('frota_checklist_respostas: `in` de ids vira a lista da rota', async () => {
  const pedidos = api({ 'GET /frota/checklists/respostas': [200, []] })
  await b.consultaPelaApi('frota_checklist_respostas').select('*').in('checklist_id', ['a', 'b']).order('ordem')
  assert.equal(busca(pedidos[0]).checklist_id, 'a,b')
})

test('frota_checklist_config: update com `id=true` é PATCH na rota sem id', async () => {
  const pedidos = api({ 'PATCH /frota/checklist-config': [200, { dia_semanal: 1 }] })
  const r = await b.consultaPelaApi('frota_checklist_config').update({ dia_semanal: 1 }).eq('id', true)
  assert.equal(r.error, null)
  assert.equal(pedidos[0].chave, 'PATCH /frota/checklist-config')
})

test('frota_requisicoes e abastecimentos: a autoria sai do corpo (é da sessão)', async () => {
  const pedidos = api({ 'POST /frota/requisicoes': [201, { id: 'r1' }], 'POST /frota/abastecimentos': [201, { id: 'a1' }] })
  await b.consultaPelaApi('frota_requisicoes').insert({ veiculo_id: 'v', criada_por: 'u' })
  await b.consultaPelaApi('frota_abastecimentos').insert({ veiculo_id: 'v', criado_por: 'u' })
  assert.deepEqual(pedidos.map((p) => p.corpo), [{ veiculo_id: 'v' }, { veiculo_id: 'v' }])
})

test('frota_revisoes: apagar por id é DELETE na rota', async () => {
  const pedidos = api({ 'DELETE /frota/revisoes/r9': [204, undefined] })
  const r = await b.consultaPelaApi('frota_revisoes').delete().eq('id', 'r9')
  assert.equal(r.error, null)
  assert.equal(pedidos[0].chave, 'DELETE /frota/revisoes/r9')
})

test('escreverComposto: sucesso devolve o corpo; 409 devolve a frase e o status', async () => {
  const pedidos = api({
    'POST /frota/usos/trocar': [200, { fechado: 'u1', aberto: 'u2' }],
    'POST /frota/checklists': [409, { error: 'conflito', mensagem: 'Já existe ficha deste carro hoje.' }],
  })
  const ok = await b.escreverComposto('/frota/usos/trocar', { veiculo_id: 'v' })
  assert.deepEqual(ok, { data: { fechado: 'u1', aberto: 'u2' }, error: null })
  assert.deepEqual(pedidos[0].corpo, { veiculo_id: 'v' })
  const dup = await b.escreverComposto('/frota/checklists', { ficha: {} })
  assert.equal(dup.data, null)
  assert.equal(dup.error.status, 409)
  assert.equal(dup.error.message, 'Já existe ficha deste carro hoje.')
})

// ── 5.4 — Colaboradores e Acessos ──
test('acessos_pessoas: embutidos fixos passam, status vira filtro e a contagem sai do cabeçalho', async () => {
  const pedidos = api({ 'GET /acessos/pessoas': [200, [{ id: 'p1', nome: 'Ana', profile_id: null, acessos_setores: { nome: 'TI' }, acessos_organizacoes: null, patrimonio_empresas: null }], { 'X-Total-Count': '1' }] })
  const r = await b.consultaPelaApi('acessos_pessoas').select('id,nome,acessos_setores(nome),patrimonio_empresas(nome)').eq('status', 'ativo')
  assert.deepEqual(r.data, [{ id: 'p1', nome: 'Ana', acessos_setores: { nome: 'TI' }, patrimonio_empresas: null }])
  assert.equal(busca(pedidos[0]).status, 'ativo')
  api({ 'GET /acessos/pessoas': [200, [{ id: 'p1' }], { 'X-Total-Count': '7' }] })
  const c = await b.consultaPelaApi('acessos_pessoas').select('*', { count: 'exact', head: true }).eq('status', 'desligado')
  assert.equal(c.count, 7)
})

test('acessos_vinculos: o embutido acessos_recursos só com as colunas que a rota devolve', async () => {
  api({ 'GET /acessos/vinculos': [200, [{ pessoa_id: 'p', acessos_recursos: { nome: 'Pasta', tipo: 'icloud', arquivado_em: null } }]] })
  const ok = await b.consultaPelaApi('acessos_vinculos').select('acessos_recursos(nome,tipo,arquivado_em)').eq('pessoa_id', 'p')
  assert.equal(ok.data[0].acessos_recursos.nome, 'Pasta')
  const ruim = await b.consultaPelaApi('acessos_vinculos').select('acessos_recursos(nome,caminho)').eq('pessoa_id', 'p')
  assert.match(ruim.error.message, /só devolve/)
})

test('acessos_recursos: arquivado_em nulo = arquivado=false; ordens duplas ficam na tela', async () => {
  const pedidos = api({ 'GET /acessos/recursos': [200, [{ id: 'b', nome: 'B', caminho: 'x' }, { id: 'a', nome: 'A', caminho: 'x' }]] })
  const r = await b.consultaPelaApi('acessos_recursos').select('*').eq('tipo', 'workdrive').is('arquivado_em', null).order('caminho').order('nome')
  assert.deepEqual([busca(pedidos[0]).tipo, busca(pedidos[0]).arquivado, busca(pedidos[0]).ordem], ['workdrive', 'false', undefined])
  assert.deepEqual(r.data.map((x) => x.id), ['a', 'b'])
})

test('acessos_log: `quem` sai do corpo; pessoa: delete por id e update sem profile_id', async () => {
  const pedidos = api({ 'POST /acessos/log': [201, { id: 'l' }], 'DELETE /acessos/pessoas/p9': [204, undefined], 'PATCH /acessos/pessoas/p1': [200, { id: 'p1' }] })
  await b.consultaPelaApi('acessos_log').insert({ quem: 'u', acao: 'x', resultado: 'ok' })
  await b.consultaPelaApi('acessos_pessoas').delete().eq('id', 'p9')
  await b.consultaPelaApi('acessos_pessoas').update({ nome: 'N' }).eq('id', 'p1')
  assert.deepEqual(pedidos[0].corpo, { acao: 'x', resultado: 'ok' })
  assert.deepEqual(pedidos.map((p) => p.chave), ['POST /acessos/log', 'DELETE /acessos/pessoas/p9', 'PATCH /acessos/pessoas/p1'])
})

test('ligarCadastroPelaApi: POST /ligar; ficha de outro login = 409 com a frase', async () => {
  const pedidos = api({ 'POST /acessos/pessoas/p1/ligar': [409, { error: 'conflito', mensagem: 'Esta ficha já está ligada a outro login.' }] })
  const r = await b.ligarCadastroPelaApi('p1', 'u2')
  assert.deepEqual(pedidos[0].corpo, { profile_id: 'u2' })
  assert.equal(r.error.status, 409)
})

// ── 5.10 — Autenticidade ──
test('vessel_baixas: `desfeita_em is null` é implícito na rota (sem parâmetro e sem filtrar na tela)', async () => {
  const pedidos = api({ 'GET /autenticidade/baixas': [200, [{ codigo: 'A', motivo: 'x', baixada_em: 't' }]] })
  const r = await b.consultaPelaApi('vessel_baixas').select('codigo,motivo,baixada_em').is('desfeita_em', null)
  assert.deepEqual(r.data, [{ codigo: 'A', motivo: 'x', baixada_em: 't' }])
  assert.equal(busca(pedidos[0]).desfeita_em, undefined)
  const ruim = await b.consultaPelaApi('vessel_baixas').select('*').eq('motivo', 'x').limit(5)
  assert.match(ruim.error.message, /não filtra/)
})

test('vessel_cartao_pedidos: a ordem fixa da rota (criado_em desc) satisfaz o `.order().limit(20)` da tela', async () => {
  const pedidos = api({ 'GET /autenticidade/cartao-pedidos': [200, [{ id: 'b' }, { id: 'a' }]] })
  const r = await b.consultaPelaApi('vessel_cartao_pedidos').select('*').order('criado_em', { ascending: false }).limit(20)
  assert.equal(r.error, null)
  assert.deepEqual(r.data.map((x) => x.id), ['b', 'a']) // sem reordenar na tela
  assert.deepEqual(busca(pedidos[0]), { limite: '20' })
  const outra = await b.consultaPelaApi('vessel_cartao_pedidos').select('*').order('criado_em').limit(20)
  assert.match(outra.error.message, /não ordena/)
})

test('vessel_pecas: `in` de códigos vira a lista da rota', async () => {
  const pedidos = api({ 'GET /autenticidade/pecas': [200, []] })
  await b.consultaPelaApi('vessel_pecas').select('codigo').in('codigo', ['A1', 'B2'])
  assert.equal(busca(pedidos[0]).codigo, 'A1,B2')
})

// ── 5.5 — Comercial ──
test('bling_pedido_nota: o `.or(and,and)` da janela vira `janela=[A,B]`; outro `or` é recusado', async () => {
  const pedidos = api({ 'GET /comercial/notas': [200, [{ pedido_id: 1 }]] })
  const a = '2026-10-01', z = '2026-10-31'
  const r = await b.consultaPelaApi('bling_pedido_nota').select('pedido_id')
    .or(`and(data_da_venda.gte.${a},data_da_venda.lte.${z}),and(data_pedido.gte.${a},data_pedido.lte.${z})`).range(0, 999)
  assert.equal(r.error, null)
  assert.deepEqual(busca(pedidos[0]), { janela: '[2026-10-01,2026-10-31]', limite: '1000' })
  const ruim = await b.consultaPelaApi('bling_pedido_nota').select('pedido_id').or('total.gt.5,total.lt.1').range(0, 9)
  assert.match(ruim.error.message, /or sem tradução/)
})

test('`.range(de, ate)` vira limite + deslocamento (a 2ª página da tela é a 2ª da rota)', async () => {
  const pedidos = api({ 'GET /comercial/ajustes-de-valor': [200, [{ pedido_id: 9, total_corrigido: 1 }]] })
  await b.consultaPelaApi('bling_pedido_ajuste_valor').select('pedido_id,total_corrigido').range(1000, 1999)
  assert.deepEqual(busca(pedidos[0]), { limite: '1000', deslocamento: '1000' })
})

test('shopify_pedidos: gte/lt viram criado_de/criado_ate; `in` de status vira lista', async () => {
  const pedidos = api({ 'GET /comercial/pedidos-shopify': [200, []] })
  await b.consultaPelaApi('shopify_pedidos').select('id,total').gte('criado_em_shopify', '2026-10-01T03:00:00.000Z')
    .lt('criado_em_shopify', '2026-11-01T03:00:00.000Z').in('status_financeiro', ['paid', 'partially_paid']).range(0, 999)
  assert.deepEqual(busca(pedidos[0]), { criado_de: '2026-10-01T03:00:00.000Z', criado_ate: '2026-11-01T03:00:00.000Z', status_financeiro: 'paid,partially_paid', limite: '1000' })
})

test('metas: year/month viram ano/mes; bling_lojas: PATCH pelo loja_id', async () => {
  const pedidos = api({ 'GET /comercial/metas-lojas': [200, []], 'PATCH /comercial/lojas/42': [200, { loja_id: 42, fechado_em: '2026-10-01' }] })
  await b.consultaPelaApi('bling_metas').select('loja_id,meta_valor').eq('year', 2026).eq('month', 10)
  assert.deepEqual([busca(pedidos[0]).ano, busca(pedidos[0]).mes], ['2026', '10'])
  const r = await b.fetchPostgrest('bling_lojas?loja_id=eq.42', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ fechado_em: '2026-10-01' }) })
  assert.equal(r.ok, true)
  assert.equal(pedidos[1].chave, 'PATCH /comercial/lojas/42')
})

test('bling_pedido_vendedor: upsert em lotes de 1000 e `.limit(5000)` lê em páginas até o limite', async () => {
  const pedidos = api({ 'POST /comercial/pedidos-vendedor/gravar': [200, { gravadas: 1 }] })
  await b.consultaPelaApi('bling_pedido_vendedor').upsert(Array.from({ length: 2500 }, (_, i) => ({ pedido_id: i + 1, vendor_id: 1 })))
  assert.deepEqual(pedidos.map((p) => p.corpo.linhas.length), [1000, 1000, 500])
  let n = 0
  globalThis.fetch = async (url) => {
    const u = new URL(url, 'http://x'); const desl = Number(u.searchParams.get('deslocamento') || 0)
    n++
    const linhas = Array.from({ length: Math.min(1000, 2300 - desl) }, (_, i) => ({ vendor_id: 1, loja_id: 2, pedido_data: '2026-10-01', i: desl + i }))
    return { status: 200, ok: true, text: async () => JSON.stringify(linhas), headers: { get: (k) => (k === 'X-Total-Count' ? '2300' : null) } }
  }
  const r = await b.consultaPelaApi('bling_pedido_vendedor').select('vendor_id,loja_id,pedido_data').order('pedido_data', { ascending: false }).limit(5000)
  assert.equal(r.data.length, 2300)
  assert.equal(n, 3)
  const recusa = await b.consultaPelaApi('bling_lojas').select('*').limit(5000)
  assert.match(recusa.error.message, /acima do teto/)
})
