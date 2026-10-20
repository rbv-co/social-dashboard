// POS-VIRADA plano 05, item A: "entrar como" automático por perfil, no front real e na API de produção.
// Para cada conta de prova (JSON perfil->token de sessão) abre cada rota estática do `mapa-de-enderecos.js` e confere:
//   - o que o catálogo diz que o perfil pode abrir ABRE (mesmo caminho no fim, sem 401/403/5xx na /api, sem tela em branco,
//     sem "sessão expirou", sem erro fatal de console);
//   - o que o perfil não pode abrir cai no Início ('/'), sem tela quebrada;
//   - nenhum pedido a *.supabase.co.
// Só lê (navega); as contas e tokens vêm de ferramentas/prova05-contas.sh.
//
//   TOK=tokens.json PLAYWRIGHT=/…/playwright/index.mjs node ops/pos-virada/front-por-perfil.mjs > perfis.csv
//   BASE (padrão https://central.rbvcompany.com), LARGURA (padrão 1440), PERFIS=a,b, ROTAS=/a,/b
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { podeAbrirRota } from '../../src/compartilhado/catalogo-de-ferramentas.js'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = (process.env.BASE || 'https://central.rbvcompany.com').replace(/\/$/, '')
const LARGURA = Number(process.env.LARGURA || 1440)
const tokens = JSON.parse(readFileSync(process.env.TOK, 'utf8'))
const PERMISSOES = JSON.parse(readFileSync(process.env.PERMISSOES || join(dirname(fileURLToPath(import.meta.url)), 'perfis.json'), 'utf8'))
const perfis = (process.env.PERFIS ? process.env.PERFIS.split(',') : Object.keys(PERMISSOES))

const mapa = readFileSync(join(raiz, 'src', 'mapa-de-enderecos.js'), 'utf8')
const nomeDaRota = {}
for (const m of mapa.matchAll(/path:\s*'(\/[^':*]*)',\s*name:\s*'([^']+)'/g)) nomeDaRota[m[1]] = m[2]
const todas = Object.keys(nomeDaRota).filter((r) => r !== '/login' && r !== '/oauth/consentimento')
const rotas = process.env.ROTAS ? process.env.ROTAS.split(',') : todas

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
const navegador = await chromium.launch()
const csv = (a) => a.map((v) => `"${String(v ?? '').replace(/"/g, "'").replace(/\s+/g, ' ').slice(0, 160)}"`).join(',')
console.log('perfil,rota,esperado,caminho_final,resultado,api_401_403_5xx,console,supabase,detalhe')

async function perfil(nome) {
  const { permissions = {}, superadmin = false } = PERMISSOES[nome]
  const pode = (rec, acao = 'ver') => superadmin || (permissions[rec] || []).includes(acao)
  const abre = (rota) => podeAbrirRota(nomeDaRota[rota], pode, superadmin)
  const ctx = await navegador.newContext({ viewport: { width: LARGURA, height: 900 } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('central_sessao_api', t) } catch { /* sem storage */ } }, tokens[nome])
  const linhas = []
  for (const rota of rotas) {
    const esperado = abre(rota) ? 'abre' : 'bloqueia'
    const pg = await ctx.newPage()
    const api = []; const cons = []; const supa = []; const detalhe = []
    pg.on('response', (r) => {
      const u = new URL(r.url()); const st = r.status()
      if (/supabase\.co$/.test(u.hostname)) supa.push(u.hostname)
      if (u.pathname.startsWith('/api/') && (st === 401 || st === 403 || st >= 500)) api.push(`${st} ${r.request().method()} ${u.pathname.slice(0, 50)}`)
    })
    pg.on('request', (r) => { try { if (/supabase\.co$/.test(new URL(r.url()).hostname)) supa.push(new URL(r.url()).hostname) } catch { /* url estranha */ } })
    pg.on('pageerror', (e) => cons.push(`pageerror: ${String(e.message).slice(0, 80)}`))
    pg.on('console', (m) => { if (m.type() === 'error') cons.push(m.text().slice(0, 80)) })
    let falhaAbrir = ''
    await pg.goto(BASE + rota, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => { falhaAbrir = String(e.message).split('\n')[0].slice(0, 60) })
    await pg.waitForTimeout(800)
    const final = new URL(pg.url()).pathname
    const texto = await pg.evaluate(() => (document.body?.innerText || '').trim()).catch(() => '')
    if (falhaAbrir) detalhe.push(`não abriu: ${falhaAbrir}`)
    if (/sua sess[ãa]o expirou/i.test(texto)) detalhe.push('sessão expirada')
    if (texto.length < 10) detalhe.push('tela em branco')
    if (final === '/login') detalhe.push('caiu no login')
    if (esperado === 'abre' && final !== rota) detalhe.push(`esperava ${rota} e foi para ${final}`)
    if (esperado === 'bloqueia' && final !== '/') detalhe.push(`devia cair no Início e ficou em ${final}`)
    if (api.length) detalhe.push(`api: ${[...new Set(api)].slice(0, 3).join('; ')}`)
    const consFatal = cons.filter((c) => c.startsWith('pageerror'))
    if (consFatal.length) detalhe.push(consFatal[0])
    if (supa.length) detalhe.push(`supabase: ${supa.length}`)
    const res = detalhe.length ? 'FALHA' : 'OK'
    linhas.push(csv([nome, rota, esperado, final, res, api.length, cons.length, supa.length, detalhe.join(' | ')]))
    await pg.close()
  }
  await ctx.close()
  return linhas
}

// 3 perfis por vez: o limitador por IP da API é real
const fila = [...perfis]
await Promise.all(Array.from({ length: 3 }, async () => { while (fila.length) { for (const l of await perfil(fila.shift())) console.log(l) } }))
await navegador.close()
