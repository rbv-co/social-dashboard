// POS-VIRADA plano 05, item A (o resíduo humano do V10): o "Entrar como" DE VERDADE. O superadmin abre /admin, acha a conta de prova, clica
// "Entrar como" (a API gera uma sessão de 1 h, aba nova em modo entrar-como, token no sessionStorage) e, nessa aba, cada rota estática do
// mapa abre ou cai no Início conforme o perfil. A aba do superadmin continua com a sessão dele. Só lê (navega) e deixa 1 linha de auditoria
// por entrada em entradas_como_outro_usuario (apagada na limpeza das contas).
//   TOK=tokens.json PLAYWRIGHT=… [PERFIS=gestor,loja] node ops/pos-virada/entrar-como.mjs > entrar-como.csv
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { podeAbrirRota } from '../../src/compartilhado/catalogo-de-ferramentas.js'

const aqui = dirname(fileURLToPath(import.meta.url))
const BASE = (process.env.BASE || 'https://central.rbvcompany.com').replace(/\/$/, '')
const tokens = JSON.parse(readFileSync(process.env.TOK, 'utf8'))
const PERMISSOES = JSON.parse(readFileSync(join(aqui, 'perfis.json'), 'utf8'))
const perfis = (process.env.PERFIS || 'gestor,loja,frota,comercial').split(',')
const mapa = readFileSync(join(aqui, '..', '..', 'src', 'mapa-de-enderecos.js'), 'utf8')
const nomeDaRota = {}
for (const m of mapa.matchAll(/path:\s*'(\/[^':*]*)',\s*name:\s*'([^']+)'/g)) nomeDaRota[m[1]] = m[2]
const rotas = Object.keys(nomeDaRota).filter((r) => r !== '/login' && r !== '/oauth/consentimento')
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
const nav = await chromium.launch()
const csv = (a) => a.map((v) => `"${String(v ?? '').replace(/"/g, "'").replace(/\s+/g, ' ').slice(0, 160)}"`).join(',')
console.log('perfil,rota,esperado,caminho_final,resultado,detalhe')
let ruim = 0
for (const perfil of perfis) {
  const { permissions = {}, superadmin = false } = PERMISSOES[perfil]
  const pode = (rec, acao = 'ver') => superadmin || (permissions[rec] || []).includes(acao)
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript((t) => { try { if (!sessionStorage.getItem('modo_entrar_como') && !location.search.includes('modo=entrar-como')) localStorage.setItem('central_sessao_api', t) } catch { /* sem storage */ } }, tokens.super)
  const adm = await ctx.newPage(); adm.on('dialog', (d) => d.accept())
  await adm.goto(BASE + '/admin', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {}); await adm.getByRole('button', { name: /^pular$/i }).click({ timeout: 800 }).catch(() => {})
  await adm.getByPlaceholder(/Buscar por nome/).fill(`zz-prova-05-${perfil}@`); await adm.waitForTimeout(800)
  const linha = adm.locator('*', { hasText: `zz-prova-05-${perfil}@` }).filter({ has: adm.getByRole('button', { name: 'Entrar como' }) }).last()
  let aba
  try {
    ;[aba] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), linha.getByRole('button', { name: 'Entrar como' }).first().click({ timeout: 8000 })])
  } catch (e) { console.log(csv([perfil, '(entrar-como)', 'abre', '', 'FALHA', 'não abriu a aba de entrar-como: ' + String(e.message).split('\n')[0].slice(0, 90)])); ruim++; await ctx.close(); continue }
  await aba.waitForLoadState('networkidle').catch(() => {}); await aba.waitForTimeout(1500)
  const modo = await aba.evaluate(() => ({ so: sessionStorage.getItem('modo_entrar_como'), tem: !!sessionStorage.getItem('central_sessao_api'), hash: location.hash })).catch(() => ({}))
  const tokSuper = await adm.evaluate(() => localStorage.getItem('central_sessao_api'))
  console.log(csv([perfil, '(abertura)', 'abre', new URL(aba.url()).pathname, modo.so === '1' && modo.tem && !modo.hash ? 'OK' : 'FALHA', `modo=${modo.so} token_na_aba=${modo.tem} hash_limpo=${!modo.hash}; aba do super mantém o token próprio=${tokSuper === tokens.super}`]))
  if (!(modo.so === '1' && modo.tem && !modo.hash && tokSuper === tokens.super)) ruim++
  for (const rota of rotas) {
    const esperado = podeAbrirRota(nomeDaRota[rota], pode, superadmin) ? 'abre' : 'bloqueia'
    const api = []; const det = []
    // 403 em POST .../pedidos-vendedor/gravar é ESPERADO: a escrita do cache de pedidos exige sessão própria (`soSessaoPropria`), a de "entrar como" não grava
    const on = (r) => { const u = new URL(r.url()); const esperado403 = r.status() === 403 && r.request().method() === 'POST' && u.pathname === '/api/comercial/pedidos-vendedor/gravar'; if (u.pathname.startsWith('/api/') && !esperado403 && ([401, 403].includes(r.status()) || r.status() >= 500)) api.push(`${r.status()} ${u.pathname.slice(0, 40)}`); if (/supabase\.co/.test(u.hostname)) det.push('supabase') }
    aba.on('response', on)
    await aba.goto(BASE + rota + '?modo=entrar-como', { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => det.push('não abriu ' + String(e.message).split('\n')[0].slice(0, 40))); await aba.waitForTimeout(700)
    aba.off('response', on)
    const final = new URL(aba.url()).pathname
    const texto = await aba.evaluate(() => (document.body?.innerText || '').trim()).catch(() => '')
    if (texto.length < 10) det.push('tela em branco'); if (/sua sess[ãa]o expirou/i.test(texto)) det.push('sessão expirada'); if (final === '/login') det.push('caiu no login')
    if (esperado === 'abre' && final !== rota) det.push(`foi para ${final}`); if (esperado === 'bloqueia' && final !== '/') det.push(`ficou em ${final}`)
    if (api.length) det.push('api: ' + [...new Set(api)].slice(0, 3).join('; '))
    if (det.length) ruim++
    console.log(csv([perfil, rota, esperado, final, det.length ? 'FALHA' : 'OK', det.join(' | ')]))
  }
  await ctx.close()
}
await nav.close()
process.exit(ruim ? 1 : 0)
