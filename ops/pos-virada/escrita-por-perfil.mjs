// POS-VIRADA plano 05, item B: um fluxo de escrita curto por perfil, pela TELA, em produção, só com dado `zz-prova-05-*`.
//   admin:     Banco de Arquivos (envia, outra sessão vê, baixa e confere o hash, exclui) e Patrimônio (cria, edita, outra sessão vê, exclui)
//   frota:     Frota (cria veículo, edita só o cartão de prova)
//   comercial: Praças (cria, lista, outra sessão vê)
//   admin:     Central de Conteúdo (cria peça)
// A conferência no banco é SELECT por ssh no api-db (só leitura). A limpeza do que sobrar fica no fim (apagar-prova05.sql).
//
//   FLUXO=banco|patrimonio|frota|pracas|conteudo  TOK=tokens.json PLAYWRIGHT=… node ops/pos-virada/escrita-por-perfil.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.env.BASE || 'https://central.rbvcompany.com').replace(/\/$/, '')
const tokens = JSON.parse(readFileSync(process.env.TOK, 'utf8'))
const fluxo = process.env.FLUXO
const U = `zz-prova-05-${Date.now() % 1000000}`
const T = { timeout: 10000 }
const sql = (q) => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'op', 'docker exec -i api-db sh -c \'psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"\''], { input: `begin read only;\n${q};\ncommit;\n` }).toString().split('\n').filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT').join('\n').trim()
// o bucket `arquivos` é um diretório do contêiner da API (ARQUIVOS_DIR): confere o objeto e o hash no disco, só leitura
const noDisco = (nome) => { try { return execFileSync('ssh', ['-o', 'BatchMode=yes', 'op', `docker exec api-api-1 sh -c 'f="/var/lib/api/arquivos/arquivos/${nome}"; [ -f "$f" ] && sha256sum "$f" | cut -d" " -f1 || echo AUSENTE'`]).toString().trim() } catch { return 'ERRO' } }
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
const nav = await chromium.launch()
const log = []
async function sessao(perfil, w = 1440) {
  const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, acceptDownloads: true })
  await ctx.addInitScript((t) => { try { localStorage.setItem('central_sessao_api', t) } catch { /* sem storage */ } }, tokens[perfil])
  const pg = await ctx.newPage()
  pg.erros = []; pg.http = []
  pg.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'zz-prova-05' : undefined))
  pg.on('console', (m) => { if (m.type() === 'error') pg.erros.push(m.text().slice(0, 120)) })
  pg.on('pageerror', (e) => pg.erros.push('pageerror: ' + String(e).slice(0, 120)))
  pg.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) pg.http.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname.slice(0, 60)}`) })
  pg.on('request', (r) => { if (/supabase\.co/.test(r.url())) pg.http.push('SUPABASE ' + r.url().slice(0, 60)) })
  return pg
}
async function passo(pg, nome, fn) {
  pg.erros.length = 0; pg.http.length = 0
  let r = 'ok'
  try { await fn() } catch (e) { r = 'FALHA ' + String(e.message).split('\n')[0].slice(0, 200); await pg.screenshot({ path: join(process.env.CAP || tmpdir(), `falha-${fluxo}-${nome.replace(/\W+/g, '_')}.png`) }).catch(() => {}) }
  const l = `${fluxo} ${nome} => ${r}` + (pg.http.length ? ` | http: ${[...new Set(pg.http)].slice(0, 4).join(' ; ')}` : '') + (pg.erros.length ? ` | console: ${[...new Set(pg.erros)].slice(0, 2).join(' ; ')}` : '')
  console.log(l); log.push(l)
}
const ir = async (pg, rota) => { await pg.goto(BASE + rota, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {}); await pg.getByRole('button', { name: /^pular$/i }).click({ timeout: 800 }).catch(() => {}) }
// passo destrutivo (excluir): só roda se NENHUM passo anterior do fluxo falhou (senão o alvo pode não ser o de prova)
const semFalhaAntes = () => { if (log.some((l) => l.includes('FALHA'))) throw new Error('pulado: um passo anterior falhou') }
// o menor container que tem o NOME de prova e o botão: o botão dessa linha, nunca o de outra
const daLinha = (pg, nome, botao) => { const l = pg.locator('*', { hasText: nome }).filter({ has: pg.getByRole('button', { name: botao }) }).last(); return l.getByRole('button', { name: botao }).first() }
const corpo = (pg) => pg.locator('body').innerText()

const FLUXOS = {
  async banco() {
    const adm = await sessao('admin'); const sup = await sessao('super')
    // .bin/octet-stream é recusado de propósito (415); PNG com assinatura válida e miolo aleatório passa e dá hash útil
    const dados = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200 * 1024)]); const nome = `${U}.png`; const arq = join(tmpdir(), nome); writeFileSync(arq, dados)
    const h0 = createHash('sha256').update(dados).digest('hex')
    await passo(adm, 'abrir', () => ir(adm, '/banco'))
    await passo(adm, 'enviar', async () => { await adm.locator('input[type=file]').setInputFiles(arq); await adm.waitForTimeout(3000); if (!(await corpo(adm)).includes(nome)) throw new Error('arquivo não aparece na lista') })
    await passo(adm, 'objeto no disco da API com o mesmo hash', async () => { const h = noDisco(nome); if (h !== h0) throw new Error('hash no disco=' + h.slice(0, 12)) })
    await passo(sup, 'outra sessão (super) vê', async () => { await ir(sup, '/banco'); await sup.getByPlaceholder('Buscar arquivo…').fill(U); await sup.waitForTimeout(600); if (!(await corpo(sup)).includes(nome)) throw new Error('não aparece para a outra sessão') })
    await passo(adm, 'baixar e conferir hash', async () => {
      await adm.getByPlaceholder('Buscar arquivo…').fill(U); await adm.waitForTimeout(600)
      const [dl] = await Promise.all([adm.waitForEvent('download', { timeout: 15000 }), daLinha(adm, nome, /baixar|download/i).click(T)])
      const p = join(tmpdir(), 'baixado-' + nome); await dl.saveAs(p)
      const h1 = createHash('sha256').update(readFileSync(p)).digest('hex')
      if (h1 !== h0) throw new Error(`hash diferente ${h0.slice(0, 12)} x ${h1.slice(0, 12)}`)
      console.log(`   hash ${h0.slice(0, 16)}… igual (${dados.length} bytes)`)
    })
    await passo(adm, 'excluir', async () => {
      semFalhaAntes()
      await daLinha(adm, nome, /exclu|remov|apagar/i).click(T); await adm.waitForTimeout(600)
      await adm.getByRole('button', { name: /confirm|sim|exclu|apagar/i }).last().click({ timeout: 2000 }).catch(() => {}); await adm.waitForTimeout(2000)
      const h = noDisco(nome); if (h !== 'AUSENTE') throw new Error('objeto continua no disco: ' + h.slice(0, 12))
    })
  },
  async patrimonio() {
    const adm = await sessao('admin'); const sup = await sessao('super'); const nome = `${U} bem`
    await passo(adm, 'abrir', () => ir(adm, '/patrimonio'))
    await passo(adm, 'criar', async () => {
      await adm.locator('button').filter({ hasText: /^\+$/ }).first().click(T); await adm.waitForTimeout(500)
      await adm.getByPlaceholder('Ex.: Macbook Air M4').fill(nome)
      const sel = adm.locator('select'); const n = await sel.count()
      for (let i = 0; i < n; i++) { const s = sel.nth(i); if (!(await s.isVisible())) continue; const v = await s.locator('option').evaluateAll((o) => o.map((x) => [x.value, x.disabled]).filter((x) => x[0] && !x[1]).map((x) => x[0])); if (v.length && !(await s.inputValue())) await s.selectOption(v[0]) }
      await adm.getByRole('button', { name: /^Salvar$/ }).click(T); await adm.waitForTimeout(1500)
      const c = sql(`select count(*) from patrimonio_bens where nome='${nome}'`); if (c !== '1') throw new Error('não gravou (linhas=' + c + ')')
    })
    await passo(sup, 'outra sessão (super) vê', async () => { await ir(sup, '/patrimonio'); await sup.getByPlaceholder(/Buscar por item/).fill(U); await sup.waitForTimeout(700); if (!(await corpo(sup)).includes(nome)) throw new Error('não aparece para a outra sessão') })
    await passo(adm, 'editar', async () => {
      await adm.getByRole('button', { name: /^Limpar$/ }).first().click({ timeout: 1500 }).catch(() => {}); await adm.getByPlaceholder(/Buscar por item/).fill(U); await adm.waitForTimeout(700)
      await adm.locator('tbody tr:visible, .pat-card-nome:visible', { hasText: nome }).first().click(T)
      await adm.getByPlaceholder('Ex.: Macbook Air M4').fill(nome + ' editado'); await adm.getByRole('button', { name: /^Salvar$/ }).click(T); await adm.waitForTimeout(1500)
      if (sql(`select count(*) from patrimonio_bens where nome='${nome} editado'`) !== '1') throw new Error('edição não gravou')
    })
    await passo(adm, 'excluir', async () => {
      await adm.getByRole('button', { name: /^Limpar$/ }).first().click({ timeout: 1500 }).catch(() => {}); await adm.getByPlaceholder(/Buscar por item/).fill(U); await adm.waitForTimeout(700)
      await adm.locator('tbody tr:visible, .pat-card-nome:visible', { hasText: nome }).first().click(T)
      semFalhaAntes()
      const aberto = await adm.getByPlaceholder('Ex.: Macbook Air M4').inputValue(); if (!aberto.startsWith(U)) throw new Error('o bem aberto não é o de prova: ' + aberto.slice(0, 30))
      await adm.getByRole('button', { name: /exclu|remov|apagar/i }).first().click(T); await adm.waitForTimeout(500)
      await adm.getByRole('button', { name: /confirm|sim|exclu|apagar/i }).last().click({ timeout: 2000 }).catch(() => {}); await adm.waitForTimeout(1500)
      if (sql(`select count(*) from patrimonio_bens where nome like '${U}%'`) !== '0') throw new Error('não excluiu')
    })
  },
  async frota() {
    const fr = await sessao('frota'); const sup = await sessao('super'); const placa = 'ZZP' + String(Date.now() % 10000).padStart(4, '0')
    await passo(fr, 'abrir', () => ir(fr, '/frota'))
    await passo(fr, 'criar veículo', async () => {
      await fr.getByText('Acrescentar um veículo').first().click(T); await fr.waitForTimeout(500)
      await fr.getByPlaceholder(/número do adesivo/).fill('9' + String(Date.now() % 100000)); await fr.getByRole('button', { name: /Livre para quem/ }).click(T)
      await fr.locator('label', { hasText: /^\s*NOME/i }).locator('input').first().fill(U)
      await fr.locator('label', { hasText: /^\s*PLACA/i }).locator('input').first().fill(placa)
      await fr.getByRole('button', { name: /^Salvar|Cadastrar|Acrescentar$/ }).last().click(T); await fr.waitForTimeout(1500)
      if (sql(`select count(*) from frota_veiculos where placa='${placa}'`) !== '1') throw new Error('não gravou')
    })
    await passo(sup, 'outra sessão (super) vê', async () => { await ir(sup, '/frota'); if (!(await corpo(sup)).toUpperCase().includes(placa)) { await sup.getByText(/VEÍCULOS DO GRUPO/i).last().click(T).catch(() => {}); await sup.waitForTimeout(600) } if (!(await corpo(sup)).toUpperCase().includes(placa) && !(await corpo(sup)).includes(U)) throw new Error('não aparece para a outra sessão') })
    await passo(fr, 'editar veículo', async () => {
      await fr.getByText(/VEÍCULOS DO GRUPO/i).last().click(T).catch(() => {}); await fr.waitForTimeout(500)
      // ⚠️ SÓ o cartão do veículo de prova: o primeiro "Abrir ficha" da tela é de um veículo real (já custou uma marca sobrescrita)
      const cartao = fr.locator('.fr-carro', { hasText: U }); if ((await cartao.count()) !== 1) throw new Error('cartão do veículo de prova não achado (' + (await cartao.count()) + ')')
      await cartao.getByRole('button', { name: 'Abrir ficha' }).click(T); await fr.waitForTimeout(600)
      await fr.locator('label', { hasText: /^\s*MARCA/i }).locator('input').first().fill('zz-prova-05-marca')
      await fr.getByRole('button', { name: /^Gravar/ }).click(T); await fr.waitForTimeout(1500)
      const m = sql(`select marca from frota_veiculos where placa='${placa}'`); if (m !== 'zz-prova-05-marca') throw new Error('edição não gravou (marca=' + m + ')')
    })
    console.log(`   placa=${placa} (limpeza em apagar-prova05.sql)`)
  },
  async pracas() {
    const co = await sessao('comercial'); const sup = await sessao('super'); const sigla = 'ZZ' + String.fromCharCode(65 + (Date.now() % 26)) // sigla = 3 LETRAS
    if (sql(`select count(*) from vessel_pracas where sigla='${sigla}'`) !== '0') throw new Error('sigla ' + sigla + ' já existe: não vou criar por cima')
    await passo(co, 'abrir', () => ir(co, '/pracas'))
    await passo(co, 'criar praça', async () => {
      await co.getByPlaceholder('LIM').fill(sigla); await co.locator('label', { hasText: /^\s*Nome/ }).locator('input').first().fill(U)
      await co.getByRole('button', { name: 'Criar praça' }).click(T); await co.waitForTimeout(1500)
      if (sql(`select count(*) from vessel_pracas where nome='${U}'`) !== '1') throw new Error('não gravou')
    })
    await passo(sup, 'outra sessão (super) vê', async () => { await ir(sup, '/pracas'); if (!(await corpo(sup)).includes(U)) throw new Error('não aparece') })
    await passo(co, 'recarregar mostra a praça', async () => { await ir(co, '/pracas'); if (!(await corpo(co)).includes(U)) throw new Error('não aparece após recarregar') })
  },
  async conteudo() {
    const adm = await sessao('admin'); const sup = await sessao('super')
    await passo(adm, 'abrir', () => ir(adm, '/conteudo'))
    await passo(adm, 'criar peça', async () => {
      await adm.getByText('+ Nova peça').first().click(T); await adm.waitForTimeout(500)
      await adm.getByPlaceholder(/Bastidor da loja/).fill(U); await adm.getByPlaceholder(/O texto que vai junto/).fill('zz-prova-05')
      await adm.getByRole('button', { name: /^(Salvar|Criar|Criar peça|Guardar)/ }).last().click(T); await adm.waitForTimeout(1800)
      if (sql(`select count(*) from conteudo_pecas where titulo='${U}'`) !== '1') throw new Error('não gravou')
    })
    await passo(sup, 'outra sessão (super) vê', async () => { await ir(sup, '/conteudo'); await sup.getByPlaceholder(/Buscar por título/).fill(U); await sup.waitForTimeout(700); if (!(await corpo(sup)).includes(U)) throw new Error('não aparece') })
  },
}
if (!FLUXOS[fluxo]) { console.log('FLUXO=' + Object.keys(FLUXOS).join('|')); process.exit(2) }
console.log(`# ${fluxo} U=${U} ${new Date().toISOString()}`)
await FLUXOS[fluxo]()
await nav.close()
process.exit(log.some((l) => l.includes('FALHA')) ? 1 : 0)
