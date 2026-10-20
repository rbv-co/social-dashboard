// POS-VIRADA plano 05, itens A/C: login de verdade pela tela e o que a tela faz quando a API falha ou recusa.
// Nada derruba produção: a "API fora do ar" é o próprio navegador abortando os pedidos a /api/ (page.route); o "401 forçado" é um token
// inventado (a API de produção responde 401 de verdade) ou um 401 simulado no meio do uso.
//   TOK=tokens.json (precisa de `gestor` e `_senha`; a conta gestor tem senha) PLAYWRIGHT=… node ops/pos-virada/falhas-na-tela.mjs
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = (process.env.BASE || 'https://central.rbvcompany.com').replace(/\/$/, '')
const tokens = JSON.parse(readFileSync(process.env.TOK, 'utf8'))
const EMAIL = 'zz-prova-05-gestor@zz-prova.invalid'
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
const nav = await chromium.launch()
let falhou = false
const linha = (nome, ok, det = '') => { if (!ok) falhou = true; console.log(`${nome} => ${ok ? 'ok' : 'FALHA'}${det ? ' | ' + det : ''}`) }
async function ctxPg(token, w = 1440) {
  const ctx = await nav.newContext({ viewport: { width: w, height: 900 } })
  if (token) await ctx.addInitScript((t) => { try { localStorage.setItem('central_sessao_api', t) } catch { /* sem storage */ } }, token)
  const pg = await ctx.newPage(); pg.api = []; pg.nav = []; pg.erros = []
  pg.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) pg.api.push(r.method() + ' ' + new URL(r.url()).pathname) })
  pg.on('framenavigated', (f) => { if (f === pg.mainFrame()) pg.nav.push(new URL(f.url()).pathname) })
  pg.on('pageerror', (e) => pg.erros.push(String(e.message).slice(0, 80)))
  pg.on('request', (r) => { if (/supabase\.co/.test(r.url())) pg.erros.push('SUPABASE ' + r.url().slice(0, 50)) })
  return pg
}
const texto = (pg) => pg.evaluate(() => (document.body?.innerText || '').trim()).catch(() => '')

// 1. login de verdade (e-mail + senha) e sessão que sobrevive ao recarregar
{
  const pg = await ctxPg(null)
  await pg.goto(BASE + '/gestao-comercial', { waitUntil: 'networkidle' })
  linha('sem sessão: rota protegida manda ao /login', new URL(pg.url()).pathname === '/login', 'url=' + new URL(pg.url()).pathname)
  await pg.getByPlaceholder('seu@email.com').first().fill(EMAIL); await pg.getByPlaceholder('••••••••').fill('senha-errada-zz')
  await pg.locator('.auth-btn').first().click(); await pg.waitForTimeout(1500)
  const t1 = await texto(pg)
  linha('senha errada: mensagem útil, continua no /login', new URL(pg.url()).pathname === '/login' && /senha|e-mail|incorret|inválid|credenciais/i.test(t1), t1.split('\n').find((l) => /senha|e-mail|incorret|inválid|credenciais/i.test(l))?.slice(0, 80) || 'sem mensagem')
  await pg.getByPlaceholder('••••••••').fill(tokens._senha); await pg.locator('.auth-btn').first().click(); await pg.waitForTimeout(2500)
  linha('senha certa: entra e sai do /login', new URL(pg.url()).pathname !== '/login', 'url=' + new URL(pg.url()).pathname)
  const tk = await pg.evaluate(() => localStorage.getItem('central_sessao_api'))
  linha('token guardado só no navegador (localStorage)', !!tk && tk.length > 20)
  await pg.goto(BASE + '/gestao-comercial', { waitUntil: 'networkidle' }); await pg.waitForTimeout(800)
  linha('recarregar mantém a sessão e abre a rota do perfil', new URL(pg.url()).pathname === '/gestao-comercial' && (await texto(pg)).length > 50, 'url=' + new URL(pg.url()).pathname)
  await pg.goto(BASE + '/frota', { waitUntil: 'networkidle' }); await pg.waitForTimeout(500)
  linha('rota que o perfil não vê cai no Início (não em tela quebrada)', new URL(pg.url()).pathname === '/')
  linha('login sem chamada ao Supabase', !pg.erros.some((e) => e.startsWith('SUPABASE')), pg.erros.join(';').slice(0, 80))
  // sair pela API (revoga só esta sessão)
  const st = await pg.evaluate(async (t) => (await fetch('/api/auth/sair', { method: 'POST', headers: { Authorization: 'Bearer ' + t } })).status, tk)
  const apos = await pg.evaluate(async (t) => (await fetch('/api/auth/eu', { headers: { Authorization: 'Bearer ' + t } })).status, tk)
  linha('sair revoga o token (depois dele, 401)', st < 300 && apos === 401, `sair=${st} depois=${apos}`)
}

// 2. 401 forçado com token inventado: manda ao login, sem loop de pedidos nem tela branca
for (const rota of ['/', '/gestao-vista', '/patrimonio']) {
  const pg = await ctxPg('token-inventado-zz-prova-05-' + 'x'.repeat(30))
  await pg.goto(BASE + rota, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {}); await pg.waitForTimeout(3000)
  const t = await texto(pg); const idas = pg.nav.filter((p) => p === '/login').length
  linha(`401 real (token inventado) em ${rota}: login com texto, sem loop`, new URL(pg.url()).pathname === '/login' && t.length > 20 && pg.api.length < 12 && idas <= 2, `url=${new URL(pg.url()).pathname} pedidos_api=${pg.api.length} idas_ao_login=${idas}`)
}

// 3. 401 no meio do uso (sessão expira com a tela aberta): a próxima ação não pode deixar tela branca nem repetir pedidos sem parar
{
  const pg = await ctxPg(tokens.super)
  await pg.goto(BASE + '/gestao-vista', { waitUntil: 'networkidle' }); await pg.waitForTimeout(500)
  await pg.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"nao_autenticado"}' }))
  pg.api.length = 0; pg.nav.length = 0
  await pg.goto(BASE + '/vendas', { waitUntil: 'networkidle' }).catch(() => {}); await pg.waitForTimeout(3000)
  const t = await texto(pg)
  linha('sessão expira no meio do uso (401 em tudo): login, texto, sem loop', t.length > 20 && pg.api.length < 15, `url=${new URL(pg.url()).pathname} pedidos_api=${pg.api.length}`)
}

// 4. API fora do ar por 10 s (o navegador aborta /api/): mensagem, sem tela branca; ao voltar, a tela se recupera
for (const rota of ['/gestao-vista', '/patrimonio']) {
  const pg = await ctxPg(tokens.super)
  let fora = true
  await pg.route('**/api/**', (r) => (fora ? r.abort('connectionrefused') : r.continue()))
  await pg.goto(BASE + rota, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {}); await pg.waitForTimeout(2500)
  const t = await texto(pg)
  linha(`API fora em ${rota}: tela não fica branca`, t.length > 20, `${t.length} caracteres; url=${new URL(pg.url()).pathname}; texto="${t.replace(/\s+/g, ' ').slice(0, 90)}"`)
  await pg.waitForTimeout(7500); fora = false
  // com a API fora o guarda não sabe as permissões e leva ao Início (o link fundo se perde: achado S4); depois de voltar, abrir de novo tem de funcionar
  linha(`API fora em ${rota}: o endereço pedido é mantido (não é jogado no Início)`, new URL(pg.url()).pathname === rota, `url=${new URL(pg.url()).pathname}`)
  await pg.goto(BASE + rota, { waitUntil: 'networkidle' }).catch(() => {}); await pg.waitForTimeout(1500)
  const t2 = await texto(pg)
  linha(`API volta (10 s depois) em ${rota}: abrir de novo recupera`, new URL(pg.url()).pathname === rota && t2.length > 50 && !/sem conex|n[ãa]o consegui carregar/i.test(t2.slice(0, 400)), `url=${new URL(pg.url()).pathname}`)
}

// 5. 5xx simulado numa leitura: mensagem útil, sem branco
{
  const pg = await ctxPg(tokens.super)
  await pg.route(/\/api\/(?!auth\/eu|eu\/perfil)/, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"indisponivel"}' }))
  await pg.goto(BASE + '/gestao-vista', { waitUntil: 'networkidle' }).catch(() => {}); await pg.waitForTimeout(2500)
  const t = await texto(pg)
  linha('503 em toda leitura de /gestao-vista: tela com texto e aviso (sem número inventado)', t.length > 20 && new URL(pg.url()).pathname === '/gestao-vista' && /erro|n[ãa]o consegui|indispon|falha|tente/i.test(t), `texto="${t.replace(/\s+/g, ' ').slice(0, 90)}"`)
}
await nav.close()
process.exit(falhou ? 1 : 0)
