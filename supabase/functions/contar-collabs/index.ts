// contar-collabs — conta posts/reels em COLLAB do perfil-alvo (que a API não traz no /media dele).
// Varre a /media dos OUTROS perfis da RBV e conta os posts onde o alvo é colaborador ACEITO
// (o post lista `collaborators`, lido pelo token da conta DONA). Auth (usuário social) + CORS. verify_jwt=false.
// Limitação: só pega collabs ENTRE perfis da RBV (precisa do token do dono); collabs com contas externas não entram.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { metaDoCore } from '../_shared/core-meta.js'

// CORE_META=true: a Graph passa pelo proxy do `core` (token global; não lê accounts.access_token). Ver _shared/core-meta.js.
const META = metaDoCore(Deno.env.toObject())

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
  const r = await META.fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  return await r.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: { user } } = await sb.auth.getUser(jwt)
    if (!user) return json({ erro: 'não autorizado' }, 401)
    const { data: perfil } = await sb.from('profiles').select('role,features').eq('id', user.id).single()
    const pode = !!perfil && (perfil.role === 'admin' || (perfil.features ?? []).includes('social'))
    if (!pode) return json({ erro: 'sem acesso' }, 403)

    const { account_id, since, until } = await req.json() // since/until = 'YYYY-MM-DD'
    if (!since || !until) return json({ posts: 0, reels: 0 })
    const { data: alvo } = await sb.from('accounts').select('instagram_id').eq('id', account_id).single()
    if (!alvo) return json({ erro: 'conta não encontrada' }, 404)
    const alvoIg = String(alvo.instagram_id)
    const { data: outros } = await sb.from('accounts').select(META.colunas('instagram_id,access_token')).neq('id', account_id)

    let posts = 0, reels = 0
    const ids = new Set<string>()
    for (const o of (outros ?? [])) {
      let after = ''
      for (let pag = 0; pag < 5; pag++) {
        const p: Record<string, string> = { fields: 'id,media_product_type,collaborators', since, until, limit: '50' }
        if (after) p.after = after
        const m = await apiGet(`${o.instagram_id}/media`, p, META.token(o))
        if (m.error) break
        for (const x of (m.data ?? [])) {
          const col = x.collaborators?.data ?? []
          if (col.some((c: any) => String(c.id) === alvoIg && c.invite_status === 'Accepted')) {
            if (ids.has(x.id)) continue
            ids.add(x.id)
            if (x.media_product_type === 'REELS') reels++
            else posts++
          }
        }
        after = m.paging?.cursors?.after || ''
        if (!after) break
      }
    }
    return json({ posts, reels })
  } catch (e) {
    console.error('contar-collabs erro:', e)
    return json({ erro: 'erro interno' }, 500)
  }
})
