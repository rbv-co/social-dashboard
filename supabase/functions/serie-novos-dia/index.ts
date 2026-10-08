// serie-novos-dia — série DIÁRIA exata de novos seguidores (seguiu/deixou por dia) via BATCH da Meta.
// A Meta exige agregação por janela (follows_and_unfollows só com metric_type=total_value); então fazemos
// 1 chamada por dia, todas num único batch. Auth (usuário social) + CORS iguais a insights-ao-vivo. verify_jwt=false.
import { createClient } from 'jsr:@supabase/supabase-js@2'
// Separa "a Meta publicou zero" de "a Meta não publicou". Aqui era onde os dois
// viravam a mesma coisa: `seguiu = 0, deixou = 0` era empurrado para a série
// mesmo quando a resposta vinha sem número nenhum, e o gráfico desenhava um zero
// que parecia verdade. Foi o que o dono viu de 03 a 06/08/2026.
import { lerBrutoDoDia } from '../_shared/bruto-de-seguidores.js'
import { metaDoCore, emOndas } from '../_shared/core-meta.js'

// CORE_META=true: a Graph passa pelo proxy do `core` (token global; não lê accounts.access_token). Ver _shared/core-meta.js.
const META = metaDoCore(Deno.env.toObject())

const GRAPH = 'https://graph.facebook.com/v21.0'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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

    const { account_id, dias } = await req.json()
    if (!Array.isArray(dias) || !dias.length) return json({ serie: [] })
    const { data: acc } = await sb.from('accounts').select(META.colunas('instagram_id,access_token')).eq('id', account_id).single()
    if (!acc) return json({ erro: 'conta não encontrada' }, 404)
    const ig = acc.instagram_id as string, token = META.token(acc) as string

    const lista = dias.slice(0, 93) // teto de segurança (~3 meses / 2 batches)
    const serie: any[] = []
    for (let off = 0; off < lista.length; off += 50) {
      const chunk = lista.slice(off, off + 50)
      const relativa = (d: any) => `${ig}/insights?metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type&since=${d.since}&until=${d.until}`
      let arr: any[]
      if (META.ligada) {
        // O proxy do core não aceita o batch (POST /): um GET por dia, em ondas de 5, no mesmo formato [{ body }].
        arr = await emOndas(chunk, 5, async (d: any) => {
          try { const r = await META.fetch(`${GRAPH}/${relativa(d)}`); return { code: r.status, body: await r.text() } } catch { return { body: '' } }
        })
      } else {
        const form = new URLSearchParams()
        form.set('access_token', token)
        form.set('batch', JSON.stringify(chunk.map((d: any) => ({ method: 'GET', relative_url: relativa(d) }))))
        const r = await fetch(`${GRAPH}/`, { method: 'POST', body: form })
        arr = await r.json()
      }
      for (let i = 0; i < chunk.length; i++) {
        // `publicado: false` é a informação nova. Quem desenha o gráfico usa isso
        // para trocar o dia pela ESTIMATIVA (variação da contagem total) em vez de
        // desenhar um zero que não é zero. `seguiu`/`deixou` continuam saindo em 0
        // para não quebrar quem já consumia estes campos.
        let lido: any = { publicado: false }
        try { lido = lerBrutoDoDia(JSON.parse(arr[i].body)) } catch (e) { /* corpo ilegível = não publicado */ }
        serie.push({
          label: chunk[i].label,
          seguiu: lido.publicado ? lido.gained : 0,
          deixou: lido.publicado ? lido.lost : 0,
          publicado: !!lido.publicado,
        })
      }
    }
    return json({ serie })
  } catch (e) {
    console.error('serie-novos-dia erro:', e)
    return json({ erro: 'erro interno' }, 500)
  }
})
