// V10 AUTOMÁTICO (plano 12, VIRADA-2026-10): depois da virada, cada tela da central, no front real, abre sem 401/403/5xx nas chamadas a
// `/api`, sem "sua sessão expirou", sem tela em branco e sem erro fatal de console. Cria uma conta de serviço descartável com TODOS os
// módulos (na VPS: `vps-b1.sh v10-criar`, por ssh; o token só existe em memória e vai ao navegador, nunca à saída), visita cada rota do
// `mapa-de-enderecos.js` a 1440 px e, no fim (inclusive se falhar), revoga a conta.
// "Entrar como" gestor, loja ou frota exige sessão humana (`soSessaoPropria`): fica como resíduo documentado, não bloqueia.
// Conta viewer: /admin e /acessos são só de admin, então 403 nelas é esperado e vira AVISO (as outras rotas reprovam com 403).
//
//   PLAYWRIGHT=/caminho/playwright/index.mjs node ops/virada/janela/v10-telas.mjs
//   BASE (padrão https://central.rbvcompany.com), VPS (padrão op), SSH (padrão ssh), ROTAS=/a,/b (só estas), SO_ADMIN=/admin,/acessos
// Saída: `V10 OK (...)` (código 0) ou `V10 FALHOU (<rota>: <causa>; ...)` (código 1).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = join(aqui, '..', '..', '..')
const BASE = (process.env.BASE || 'https://central.rbvcompany.com').replace(/\/$/, '')
const VPS = process.env.VPS || 'op'
const SSH = (process.env.SSH || 'ssh -o BatchMode=yes -o ConnectTimeout=15').split(' ')
const SO_ADMIN = (process.env.SO_ADMIN || '/admin,/acessos').split(',')
const vpsB1 = readFileSync(join(aqui, 'vps-b1.sh'), 'utf8')

const noVps = (...args) => execFileSync(SSH[0], [...SSH.slice(1), VPS, 'bash', '-s', '--', ...args], { input: vpsB1, stdio: ['pipe', 'pipe', 'ignore'], timeout: 90000 }).toString()
const falhar = (msg) => { console.log(`V10 FALHOU (${msg})`); process.exitCode = 1 }

// todos os módulos que o código conhece: lidos da fonte do Go, para não envelhecer
const fonteModulos = readFileSync(join(raiz, 'api', 'internal', 'auth', 'servico.go'), 'utf8')
const bloco = fonteModulos.match(/ModulosConhecidos = \[\]string\{([^}]*)\}/)
const modulos = bloco ? [...bloco[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : []
if (!modulos.length) { falhar('não achei ModulosConhecidos em api/internal/auth/servico.go'); process.exit() }

const mapa = readFileSync(join(raiz, 'src', 'mapa-de-enderecos.js'), 'utf8')
const todas = [...mapa.matchAll(/path:\s*'(\/[^':*]*)'/g)].map((m) => m[1]).filter((r) => r !== '/login' && r !== '/oauth/consentimento')
const rotas = process.env.ROTAS ? process.env.ROTAS.split(',') : todas

let token = ''
try { token = noVps('v10-criar', modulos.join(',')).trim().split('\n').pop() } catch { /* tratado abaixo */ }
if (!token) { falhar('não consegui criar a conta de serviço virada-v10 na VPS (v10-criar)'); process.exit() }

const problemas = []
const avisos = []
let navegador
try {
  const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
  navegador = await chromium.launch()
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript((t) => { localStorage.setItem('central_sessao_api', t) }, token)
  for (const rota of rotas) {
    const pg = await ctx.newPage()
    pg.on('response', (r) => {
      const u = new URL(r.url())
      const st = r.status()
      if (!u.pathname.startsWith('/api/') || !(st === 401 || st === 403 || st >= 500)) return
      const achado = `${st} ${r.request().method()} ${u.pathname.slice(0, 60)}`
      if (st === 403 && SO_ADMIN.includes(rota)) avisos.push(`${rota}: ${achado} (esperado: conta não é admin)`)
      else problemas.push(`${rota}: ${achado}`)
    })
    pg.on('pageerror', (e) => problemas.push(`${rota}: erro de console fatal: ${String(e.message).slice(0, 80)}`))
    await pg.goto(BASE + rota, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => problemas.push(`${rota}: não abriu (${String(e.message).split('\n')[0].slice(0, 60)})`))
    await pg.waitForTimeout(800)
    const texto = await pg.evaluate(() => (document.body?.innerText || '').trim()).catch(() => '')
    if (/sua sess[ãa]o expirou/i.test(texto)) problemas.push(`${rota}: "sua sessão expirou"`)
    else if (texto.length < 10) problemas.push(`${rota}: tela em branco`)
    await pg.close()
  }
} catch (e) {
  problemas.push(`navegador: ${String(e.message).split('\n')[0].slice(0, 80)}`)
} finally {
  await navegador?.close().catch(() => {})
  try { noVps('v10-revogar') } catch { avisos.push('NÃO consegui revogar virada-v10: o t+25-fim repete a revogação') }
}

for (const a of avisos) console.log(`   AVISO ${a}`)
if (problemas.length) { for (const p of problemas) console.log(`   ${p}`); falhar(`${new Set(problemas.map((p) => p.split(':')[0])).size} rota(s): ${problemas.slice(0, 3).join('; ')}`) }
else console.log(`V10 OK (${rotas.length} rotas a 1440 px sem 401/403/5xx, sessão expirada, tela em branco ou erro fatal; resíduo humano: "entrar como" gestor/loja/frota)`)
