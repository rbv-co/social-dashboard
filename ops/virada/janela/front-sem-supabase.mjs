// PROVA (E2): com o front construído com `VITE_API_AREAS='*'`, nenhuma tela chama o Supabase ao abrir. Visita cada rota
// do `mapa-de-enderecos.js` a 1440 e a 375px num Chromium, com a API TUBULADA (sessão e perfil de admin falsos, o resto
// `[]`) e QUALQUER pedido a `*.supabase.co` registrado e barrado. Nada sai da máquina. Reprova (saída 1) se algum pedido
// aparecer. NÃO prova o que só acontece depois de clique (isso é a revisão estática: toda chamada ao Supabase no `src/`
// fica atrás de `areaNaApi`/`tabelaNaApi`).
//
//   VITE_API_AREAS='*' npm run dev -- --port 5209 --strictPort    (noutra janela; `VITE_API_ALVO` pode ficar sem API)
//   PLAYWRIGHT=/caminho/playwright/index.mjs BASE=http://localhost:5209 node ops/virada/janela/front-sem-supabase.mjs
// PLAYWRIGHT: o `playwright` não é do repositório; o do esforço fica em REVISAO-TESTES-2026-10/ferramentas/e2e/node_modules.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
const BASE = (process.env.BASE || 'http://localhost:5209').replace(/\/$/, '')
const raiz = join(fileURLToPath(import.meta.url), '..', '..', '..', '..')
const mapa = readFileSync(join(raiz, 'src', 'mapa-de-enderecos.js'), 'utf8')
const rotas = [...mapa.matchAll(/path:\s*'(\/[^':*]*)'/g)].map((m) => m[1]).filter((r) => r !== '/login')

const b = await chromium.launch()
const achados = {}
for (const w of [1440, 375]) for (const rota of rotas) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } })
  await ctx.addInitScript(() => { localStorage.setItem('central_sessao_api', 'tok-falso') })
  await ctx.route('**/*.supabase.co/**', (r) => { (achados[rota] ||= new Set()).add(`${r.request().method()} ${new URL(r.request().url()).pathname.slice(0, 60)}`); r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }) })
  await ctx.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname
    if (p.endsWith('/auth/eu')) return r.fulfill({ json: { id: 'u1', email: 'a@x.com', nome: 'Admin' } })
    if (p.endsWith('/eu/perfil')) return r.fulfill({ json: [{ id: 'u1', role: 'admin', is_superadmin: true, permissions: {}, features: {}, allowed_accounts: [], name: 'Admin', email: 'a@x.com' }] })
    r.fulfill({ json: [] })
  })
  const pg = await ctx.newPage()
  await pg.goto(BASE + rota, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await pg.waitForTimeout(1000)
  await ctx.close()
}
await b.close()
for (const [r, s] of Object.entries(achados)) console.log(r, '=>', [...s].join(' | '))
console.log(`ROTAS COM PEDIDO AO SUPABASE: ${Object.keys(achados).length} de ${rotas.length} (x2 larguras)`)
process.exit(Object.keys(achados).length ? 1 : 0)
