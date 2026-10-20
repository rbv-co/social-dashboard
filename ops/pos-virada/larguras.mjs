// POS-VIRADA plano 05, item C2: telas de dinheiro a 375/768/1440 em produção (conta de prova superadmin):
// rolagem lateral, texto cortado sem reticências deliberadas, erro de console, 4xx/5xx da /api, e o inventário de hosts chamados
// (qualquer *.supabase.co é achado). Capturas só a 375.
//   TOK=tokens.json PLAYWRIGHT=… CAP=pasta node ops/pos-virada/larguras.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const BASE = (process.env.BASE || 'https://central.rbvcompany.com').replace(/\/$/, '')
const tokens = JSON.parse(readFileSync(process.env.TOK, 'utf8'))
const rotas = (process.env.ROTAS || '/vendas,/gestao-vista,/analise-vendas,/analise-vendas-marca,/gestao-comercial,/patrimonio,/meta-ads,/gestao-trafego,/frota,/gestao-interna,/banco,/noticias').split(',')
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
const nav = await chromium.launch()
const hosts = {}
let falhas = 0
console.log('rota,largura,lateral_px,cortado,console,api_4xx_5xx,supabase,detalhe')
for (const w of [375, 768, 1440]) {
  const ctx = await nav.newContext({ viewport: { width: w, height: 900 } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('central_sessao_api', t) } catch { /* sem storage */ } }, tokens.super)
  for (const rota of rotas) {
    const pg = await ctx.newPage(); const cons = []; const api = []; let supa = 0
    pg.on('console', (m) => { if (m.type() === 'error' && !/fbcdn|cdninstagram|status of 403/.test(m.text() + (m.location().url || ''))) cons.push(m.text().slice(0, 70)) })
    pg.on('pageerror', (e) => cons.push('pageerror ' + String(e.message).slice(0, 60)))
    pg.on('request', (r) => { const h = new URL(r.url()).hostname; hosts[h] = (hosts[h] || 0) + 1; if (/supabase\.co$/.test(h)) supa++ })
    pg.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && (r.status() >= 400)) api.push(`${r.status()} ${r.request().method()} ${u.pathname.slice(0, 40)}`) })
    await pg.goto(BASE + rota, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {}); await pg.waitForTimeout(1200)
    const m = await pg.evaluate(() => {
      const lateral = document.documentElement.scrollWidth - document.documentElement.clientWidth
      // texto cortado: elemento com overflow hidden/clip cujo conteúdo é maior que a caixa e SEM text-overflow: ellipsis (corte mudo)
      const cortados = []
      for (const e of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(e)
        if (!e.offsetParent && cs.position !== 'fixed') continue
        if (!(/hidden|clip/.test(cs.overflowX)) || cs.textOverflow === 'ellipsis') continue
        if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && (e.textContent || '').trim().length > 3 && !e.matches('table,tbody,thead,svg,canvas,img,video') && e.children.length < 6) cortados.push((e.className?.toString() || e.tagName).slice(0, 30) + ':' + (e.textContent || '').trim().slice(0, 25))
      }
      return { lateral, cortados: [...new Set(cortados)].slice(0, 3) }
    }).catch(() => ({ lateral: -1, cortados: [] }))
    const det = []
    if (m.lateral > 1) det.push('rolagem lateral'); if (m.cortados.length) det.push('corte mudo: ' + m.cortados.join(' | ')); if (cons.length) det.push('console: ' + [...new Set(cons)].slice(0, 2).join(' | ')); if (api.length) det.push('api: ' + [...new Set(api)].slice(0, 2).join(' | ')); if (supa) det.push('supabase ' + supa)
    if (det.length) falhas++
    console.log([rota, w, m.lateral, m.cortados.length, cons.length, api.length, supa, '"' + det.join(' ; ').replace(/"/g, "'") + '"'].join(','))
    if (w === 375 && process.env.CAP) await pg.screenshot({ path: join(process.env.CAP, `375-${rota.replace(/\//g, '_') || 'inicio'}.png`) }).catch(() => {})
    await pg.close()
  }
  await ctx.close()
}
console.log('# hosts chamados: ' + JSON.stringify(Object.fromEntries(Object.entries(hosts).sort((a, b) => b[1] - a[1]))))
console.log(`# linhas com achado: ${falhas}`)
await nav.close()
