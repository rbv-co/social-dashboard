// insights-ao-vivo — KPIs EXATOS da Meta. Token da conta lido no servidor, no header (nunca na URL nem retornado).
// Exige USUÁRIO autenticado COM permissão social. Trata CORS. verify_jwt=false (auth feita aqui). Atual + anterior.
// Todas as chamadas à Meta rodam em PARALELO (Promise.all) — latência = a mais lenta, não a soma.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { somarGasto, semRespostaDaMeta, podeBuscarProximaPagina } from '../_shared/gasto-de-campanhas.js'

const GRAPH = 'https://graph.facebook.com/v21.0'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function apiGet(path: string, params: Record<string, string>, token: string): Promise<any> {
  const url = new URL(`${GRAPH}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  return await r.json()
}

// Novos seguidores: follows_and_unfollows na janela de FOLLOWS (o front já decide o -1 dia via folShift).
async function novos(ig: string, fS: string, fU: string, token: string) {
  const fu = await apiGet(`${ig}/insights`, { metric: 'follows_and_unfollows', period: 'day', metric_type: 'total_value', breakdown: 'follow_type', since: String(fS), until: String(fU) }, token)
  let s = 0, d = 0
  for (const r of (fu.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [])) { const dv = (r.dimension_values ?? [null])[0]; if (dv === 'FOLLOWER') s = r.value; else if (dv === 'NON_FOLLOWER') d = r.value }
  return { seguiu: s, deixou: d, total: s - d, erro: fu.error }
}

async function engaj(ig: string, eS: string, eU: string, token: string) {
  const eng = await apiGet(`${ig}/insights`, { metric: 'views,reach,total_interactions,profile_views', period: 'day', metric_type: 'total_value', since: String(eS), until: String(eU) }, token)
  const em: Record<string, number> = {}
  for (const it of (eng.data ?? [])) em[it.name] = it.total_value?.value ?? 0
  return { obj: { views: em.views ?? 0, reach: em.reach ?? 0, interacoes: em.total_interactions ?? 0, visitas: em.profile_views ?? 0 }, erro: eng.error }
}

// Interações por TIPO DE CONTEÚDO (abas). geral = TUDO (post+reel+story+ad). org = orgânico (referência).
async function interacoes(ig: string, eS: string, eU: string, token: string) {
  const bd = await apiGet(`${ig}/insights`, { metric: 'likes,comments,saves,shares', period: 'day', metric_type: 'total_value', breakdown: 'media_product_type', since: String(eS), until: String(eU) }, token)
  const mapa: Record<string, string> = { likes: 'curtidas', comments: 'comentarios', saves: 'salvamentos', shares: 'compartilhamentos' }
  const z = () => ({ post: 0, reel: 0, story: 0, ad: 0, geral: 0, org: 0 })
  const inter: Record<string, any> = { curtidas: z(), comentarios: z(), salvamentos: z(), compartilhamentos: z() }
  for (const it of (bd.data ?? [])) {
    const dest = inter[mapa[it.name]]; if (!dest) continue
    for (const r of (it.total_value?.breakdowns?.[0]?.results ?? [])) {
      const t = (r.dimension_values ?? ['?'])[0], v = r.value ?? 0
      if (t === 'POST') dest.post += v; else if (t === 'REEL') dest.reel += v; else if (t === 'STORY') dest.story += v; else if (t === 'AD') dest.ad += v
      dest.geral += v; if (t !== 'AD') dest.org += v
    }
  }
  return inter
}

// GASTO do período. Sem `campanhas`, continua exatamente como sempre foi:
// level=account, uma linha, o número exato da conta. COM `campanhas`, desce para
// level=campaign e soma só as escolhidas — é assim que o cartão de investimento
// passa a obedecer ao balde e ao filtro manual.
// TETO DE PÁGINAS. 126 campanhas na maior conta com `limit=500` cabem numa
// página só — vinte é folga de 80x. O teto existe para o caso em que a Graph
// devolve `paging.next` para sempre: sem ele, esta função ficaria girando dentro
// de uma Edge Function até o tempo acabar, queimando o limite de taxa que já
// derrubou esta tela uma vez.
const MAX_PAGINAS = 20

// NULO É "NÃO SEI", ZERO É "NÃO GASTOU" — quem sabe a diferença é
// `semRespostaDaMeta`, no módulo puro ao lado do `somarGasto`, com teste.
async function gasto(adAccountId: string, eS: string, eU: string, token: string, campanhas?: string[]) {
  const dstr = (u: number) => new Date(u * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const janela = JSON.stringify({ since: dstr(Number(eS)), until: dstr(Number(eU) - 1) })
  if (!campanhas || campanhas.length === 0) {
    const ads = await apiGet(`act_${adAccountId}/insights`, { fields: 'spend', level: 'account', time_range: janela }, token)
    if (semRespostaDaMeta(ads)) return null
    return parseFloat(ads.data?.[0]?.spend ?? '0') || 0
  }
  // level=campaign pode passar de 500 linhas numa conta grande — segue
  // `paging.next` até acabar (mesmo padrão de `apiGetAll` em coletar-dados/index.ts),
  // senão as campanhas depois do corte contribuem zero e o cartão mostra menos
  // dinheiro do que o real, calado.
  let pagina = await apiGet(`act_${adAccountId}/insights`, { fields: 'campaign_id,spend', level: 'campaign', time_range: janela, limit: '500' }, token)
  if (semRespostaDaMeta(pagina)) return null
  const linhas: any[] = [...pagina.data]
  let paginas = 1
  // Quando parar é decisão pura e testada (`podeBuscarProximaPagina`): sem
  // `paging.next`, com página vazia — a Graph manda `next` em página vazia, e o
  // laço giraria para sempre — ou no teto de páginas.
  while (podeBuscarProximaPagina(pagina, paginas, MAX_PAGINAS)) {
    const r = await fetch(pagina.paging.next)
    if (!r.ok) return null           // meia soma sob rótulo de "ao vivo" é pior que cair no coletado
    pagina = await r.json()
    if (semRespostaDaMeta(pagina)) return null
    linhas.push(...pagina.data)
    paginas++
  }
  return somarGasto({ data: linhas }, campanhas)
}

// Respostas (replies) de stories — métrica de conta agregada (validado: 7D = 7).
async function respostas(ig: string, eS: string, eU: string, token: string) {
  const r = await apiGet(`${ig}/insights`, { metric: 'replies', period: 'day', metric_type: 'total_value', since: String(eS), until: String(eU) }, token)
  return r.data?.[0]?.total_value?.value ?? 0
}

// Interações de ANÚNCIO pelo Ads Manager (act/insights actions) — fonte correta (validado 7D: coment 72, salv 185, compart 338).
async function adAcoes(adAccountId: string, eS: string, eU: string, token: string) {
  const dstr = (u: number) => new Date(u * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const ins = await apiGet(`act_${adAccountId}/insights`, { fields: 'actions', level: 'account', time_range: JSON.stringify({ since: dstr(Number(eS)), until: dstr(Number(eU) - 1) }) }, token)
  const a: Record<string, number> = {}
  for (const x of (ins.data?.[0]?.actions ?? [])) a[x.action_type] = Number(x.value) || 0
  return { curtidas: a['post_reaction'] || 0, comentarios: a['comment'] || 0, salvamentos: a['onsite_conversion.post_save'] || 0, compartilhamentos: a['post'] || 0 }
}
// Sobrepõe o .ad (Ads Manager) e recalcula geral = orgânico + anúncio.
function fundirAd(inter: any, aa: any) {
  for (const m of ['curtidas', 'comentarios', 'salvamentos', 'compartilhamentos']) { inter[m].ad = aa[m]; inter[m].geral = inter[m].org + aa[m] }
  return inter
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: { user } } = await sb.auth.getUser(jwt)
    if (!user) return json({ meta_erro: 'não autorizado' }, 401)
    const { data: perfil } = await sb.from('profiles').select('role,features').eq('id', user.id).single()
    const podeSocial = !!perfil && (perfil.role === 'admin' || (perfil.features ?? []).includes('social'))
    if (!podeSocial) return json({ meta_erro: 'sem acesso' }, 403)

    const body = await req.json()
    const { account_id, engSince, engUntil, folSince, folUntil, prevEngSince, prevEngUntil, prevFolSince, prevFolUntil } = body
    const campanhas: string[] = Array.isArray(body?.campanhas) ? body.campanhas.map(String) : []
    const { data: acc } = await sb.from('accounts').select('instagram_id,access_token,ad_account_id').eq('id', account_id).single()
    if (!acc) return json({ meta_erro: 'conta não encontrada' }, 404)
    const ig = acc.instagram_id as string, token = acc.access_token as string, adAcc = acc.ad_account_id as string | null
    const wantPrev = !!(prevEngSince && prevEngUntil && prevFolSince && prevFolUntil)

    // TUDO EM PARALELO (atual + anterior) — a latência vira a da chamada mais lenta.
    const [f, e, interAtual, nv, invAtual, respAtual, adAtual, pe, interPrev, pnv, invPrev, respPrev, adPrev] = await Promise.all([
      apiGet(`${ig}`, { fields: 'followers_count' }, token),
      engaj(ig, engSince, engUntil, token),
      interacoes(ig, engSince, engUntil, token),
      novos(ig, folSince, folUntil, token),
      adAcc ? gasto(adAcc, engSince, engUntil, token, campanhas) : Promise.resolve(null),
      respostas(ig, engSince, engUntil, token),
      adAcc ? adAcoes(adAcc, engSince, engUntil, token) : Promise.resolve(null),
      wantPrev ? engaj(ig, prevEngSince, prevEngUntil, token) : Promise.resolve(null),
      wantPrev ? interacoes(ig, prevEngSince, prevEngUntil, token) : Promise.resolve(null),
      wantPrev ? novos(ig, prevFolSince, prevFolUntil, token) : Promise.resolve(null),
      (wantPrev && adAcc) ? gasto(adAcc, prevEngSince, prevEngUntil, token, campanhas) : Promise.resolve(null),
      wantPrev ? respostas(ig, prevEngSince, prevEngUntil, token) : Promise.resolve(null),
      (wantPrev && adAcc) ? adAcoes(adAcc, prevEngSince, prevEngUntil, token) : Promise.resolve(null),
    ])
    // Interações de anúncio = Ads Manager (sobrepõe o breakdown do IG, que difere).
    if (adAtual) fundirAd(interAtual, adAtual)
    if (adPrev && interPrev) fundirAd(interPrev, adPrev)

    const out: any = {
      followers_count: f.followers_count ?? null,
      engajamento: e.obj,
      interacoes: interAtual,
      novos: { seguiu: nv.seguiu, deixou: nv.deixou, total: nv.total },
      investimento: invAtual,
      respostas: respAtual,
    }
    if (wantPrev) out.anterior = { engajamento: pe.obj, interacoes: interPrev, novos: { seguiu: pnv.seguiu, deixou: pnv.deixou, total: pnv.total }, investimento: invPrev, respostas: respPrev }
    if (e.erro || nv.erro) out.meta_erro = 'meta_incompleto'
    return json(out)
  } catch (e) {
    console.error('insights-ao-vivo erro:', e)
    return json({ meta_erro: 'erro interno' }, 500)
  }
})
