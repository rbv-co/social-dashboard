/* O PASSEIO PELAS FERRAMENTAS DO COMERCIAL VESSEL NA DEMONSTRAÇÃO.
 *
 * Pedido do dono em 23/09/2026: "quando fui selecionar local lá deu tela
 * branca. deixe o ambiente todo de ferramentas funcionando na demo". O teste
 * do banco de mentira (Node) prova as REGRAS; ele não prova que a TELA abre.
 * Este passeio abre a demonstração num Chrome de verdade, entra em CADA módulo
 * do Comercial Vessel, mexe em todo <select>, aperta os botões do dia a dia
 * (criar, encerrar, editar, arquivar, apagar, marcar presença, baixar QR…) e
 * REPROVA se acontecer qualquer uma destas:
 *   · erro no console ou promessa rejeitada sem tratamento;
 *   · `#app` vazio (a tela branca);
 *   · qualquer pedido para `*.supabase.co`, ou para fora da máquina que não
 *     seja fonte/biblioteca de CDN (a demonstração nunca fala com API de fora);
 *   · chamada que o banco de mentira não soube responder (`naoPrevistos`).
 *
 * ⚠️ NÃO É `.test.mjs` DE PROPÓSITO: precisa da demonstração no ar e de um
 * Chrome, e o `npm test` roda sem nenhum dos dois.
 *
 * Rodar (com a demonstração montada e servida):
 *   npm run build:demonstracao
 *   npx vite preview --config vite.demonstracao.config.js --port 5265 --strictPort
 *   node src/demonstracao/passeio-pelas-ferramentas.mjs
 * Variáveis: DEMO (endereço, padrão http://localhost:5265), FOTOS (pasta: se
 * vier, fotografa cada módulo a 1440×900 no Celular e no Notebook e a 390px),
 * PLAYWRIGHT (caminho do playwright-core, se não for o de sempre).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = await import(process.env.PLAYWRIGHT
  || '/Users/erickmartins/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs')

const DEMO = (process.env.DEMO || 'http://localhost:5265').replace(/\/$/, '')
const CENTRAL = `${DEMO}/demonstracao/central.html`
const ROTEIRO = `${DEMO}/demonstracao/`
const FOTOS = process.env.FOTOS || ''
if (FOTOS) mkdirSync(FOTOS, { recursive: true })

// O que pode sair da máquina: a fonte e as bibliotecas que o próprio
// `central.html` carrega de CDN (as mesmas da Central de verdade). API, nunca.
const PODE_SAIR = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//
const LOCAL = new URL(DEMO).origin

const falhas = []
const falhar = (onde, o_que) => { falhas.push(`${onde}: ${o_que}`); console.log(`  ✗ ${o_que}`) }
let onde = 'início'
const passo = (nome) => { onde = nome; console.log(`• ${nome}`) }

const navegador = await chromium.launch({ channel: 'chrome' })
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: LOCAL })

let paraSupabase = 0
let paraFora = 0
let saidasDePropósito = 0
// ⚠️ O Appointment Card ABRE O SITE DA VESSEL NOUTRA ABA — é o combinado (é
// uma porta para fora, não uma tela daqui). A aba nova é atendida aqui mesmo,
// sem rede, e contada à parte.
await contexto.route(/^https:\/\/(www\.)?vesselbrasil\.com\.br\//, (r) => {
  saidasDePropósito++
  return r.fulfill({ status: 200, contentType: 'text/html', body: '<p>site da Vessel (fora da demonstração)</p>' })
})
contexto.on('request', (r) => {
  const u = r.url()
  if (/^https?:\/\/[^/]*\.supabase\.co(\/|$)/i.test(u)) { paraSupabase++; falhar(onde, `pedido para o Supabase: ${u}`) }
  else if (!u.startsWith(LOCAL) && !PODE_SAIR.test(u) && !/vesselbrasil\.com\.br/.test(u)
    && !u.startsWith('data:') && !u.startsWith('blob:')) { paraFora++; falhar(onde, `pedido para fora: ${u}`) }
})

function vigiar(pagina, nome) {
  pagina.on('console', (m) => { if (m.type() === 'error') falhar(onde, `[${nome}] console: ${m.text().slice(0, 300)}`) })
  pagina.on('pageerror', (e) => falhar(onde, `[${nome}] erro na página: ${e.message}`))
}

const pagina = await contexto.newPage()
vigiar(pagina, 'central')

const esperar = (ms = 350) => pagina.waitForTimeout(ms)
async function conferirTela(p = pagina) {
  const app = p.locator('#app')
  const texto = (await app.innerText().catch(() => '')).trim()
  if (texto.length < 20) falhar(onde, 'TELA BRANCA: #app sem conteúdo')
  const nao = await p.evaluate(() => window.__demonstracao?.naoPrevistos?.splice(0) || []).catch(() => [])
  for (const n of nao) falhar(onde, `o banco de mentira não soube responder: ${n}`)
  const faixa = await p.locator('.faixa-erro').filter({ hasText: /./ }).count().catch(() => 0)
  if (faixa) falhar(onde, `faixa de erro na tela: ${(await p.locator('.faixa-erro').first().innerText()).slice(0, 160)}`)
  return texto
}
async function clicar(alvo, rotulo) {
  const n = await alvo.count()
  if (!n) { falhar(onde, `não achei: ${rotulo}`); return false }
  await alvo.first().scrollIntoViewIfNeeded().catch(() => {})
  await alvo.first().click()
  await esperar()
  await conferirTela()
  return true
}
const botao = (nome, dentro = pagina) => dentro.getByRole('button', { name: nome })

/** Passa por TODAS as opções de TODO <select> visível e volta à primeira. */
async function mexerEmTodosOsSelects() {
  const selects = pagina.locator('select:visible')
  const n = await selects.count()
  for (let i = 0; i < n; i++) {
    const s = selects.nth(i)
    if (!(await s.isVisible().catch(() => false)) || await s.isDisabled()) continue
    const valores = await s.locator('option').evaluateAll((os) => os.map((o) => o.value))
    const antes = await s.inputValue()
    for (const v of valores) { await s.selectOption(v).catch(() => {}); await esperar(150); await conferirTela() }
    await s.selectOption(antes).catch(() => {})
    await esperar(150)
  }
  return n
}

async function abrirPeloMenu(titulo) {
  await pagina.goto(`${CENTRAL}#/comercial-vessel`)
  await pagina.waitForSelector('.cvmenu-card')
  await esperar(500)
  await conferirTela()
  await clicar(pagina.locator('.cvmenu-card', { hasText: titulo }), `cartão ${titulo}`)
  await esperar(600)
  return conferirTela()
}

// ════════════════════════════════════════════════════════════════════════════
passo('Menu do Comercial Vessel')
await pagina.goto(CENTRAL)
await pagina.waitForSelector('.cvmenu-card')
await esperar(600)
const menu = await conferirTela()
for (const t of ['Private Appointment', 'Beauty Sessions', 'Private Edit', 'Stylist Circle', 'Material Gráfico', 'Appointment Card']) {
  if (!menu.includes(t)) falhar(onde, `o menu não mostra "${t}"`)
}
passo('Appointment Card (abre o site noutra aba, a demonstração continua)')
{
  const [aba] = await Promise.all([
    contexto.waitForEvent('page', { timeout: 5000 }).catch(() => null),
    pagina.locator('a.cvmenu-card', { hasText: 'Appointment Card' }).click(),
  ])
  if (aba) await aba.close()
  await esperar()
  await conferirTela()
}

// ════════════════════════════════════════════════════════════════════════════
passo('Private Appointment')
{
  const t = await abrirPeloMenu('Private Appointment')
  if (!/\(exemplo\)/.test(t)) falhar(onde, 'a agenda abriu sem nenhum atendimento de exemplo')
  await mexerEmTodosOsSelects()
  await pagina.selectOption('#atd-periodo', 'tudo'); await esperar(500); await conferirTela()
  const antes = await pagina.locator('.atd-linha').count()
  if (antes < 5) falhar(onde, `só ${antes} atendimentos em "últimos 30 e próximos 30"`)
  // Marcar "Veio" na primeira linha que oferece, e conferir que a linha mudou.
  const linha = pagina.locator('.atd-linha', { has: pagina.getByRole('button', { name: 'Veio', exact: true }) }).first()
  const nome = await linha.locator('.atd-nome').innerText()
  await clicar(linha.getByRole('button', { name: 'Veio', exact: true }), 'botão Veio')
  const mudou = pagina.locator('.atd-linha', { hasText: nome }).first()
  if (!/Veio/.test(await mudou.locator('.selo').first().innerText())) falhar(onde, 'marcou "Veio" e o selo não mudou')
  await clicar(mudou.getByRole('button', { name: 'Não veio' }), 'botão Não veio')
  await clicar(mudou.locator('.atd-cancelar'), 'Cancelar (a pergunta)')
  await clicar(mudou.getByRole('button', { name: 'Voltar' }), 'Voltar da pergunta')
  await clicar(mudou.getByRole('button', { name: 'Remarcou' }), 'botão Remarcou')
  await pagina.selectOption('#atd-periodo', 'hoje'); await esperar(400); await conferirTela()
}

// ════════════════════════════════════════════════════════════════════════════
passo('Beauty Sessions')
{
  const t = await abrirPeloMenu('Beauty Sessions')
  if (!/Salão Aurora \(exemplo\)/.test(t)) falhar(onde, 'as sessões de exemplo não apareceram')
  // ⚠️ O GESTO DA QUEIXA: escolher a loja (o "local") no bloco de criar.
  await pagina.selectOption('#bs-loja', 'iguatemi'); await esperar(); await conferirTela()
  await pagina.selectOption('#bs-loja', 'tivoli'); await esperar(); await conferirTela()
  await mexerEmTodosOsSelects()
  const daqui10 = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
  await pagina.fill('#bs-quando', daqui10); await pagina.dispatchEvent('#bs-quando', 'change')
  await pagina.selectOption('#bs-loja', 'parkshopping')
  await pagina.fill('#bs-seq', '07'); await pagina.dispatchEvent('#bs-seq', 'input')
  await pagina.fill('#bs-parceiro', 'Salão da Demonstração (exemplo)')
  await esperar()
  const codigo = await pagina.inputValue('#bs-codigo')
  if (!/^BS-\d{8}-BSB-07$/.test(codigo)) falhar(onde, `o código sugerido saiu "${codigo}"`)
  await clicar(botao('Criar sessão'), 'Criar sessão')
  await esperar(500)
  const sessao = () => pagina.locator('.bs-sessao', { hasText: codigo })
  if (!(await sessao().count())) falhar(onde, 'criou a sessão e ela não apareceu na lista')
  else {
    await clicar(botao('Encerrar…', sessao()), 'Encerrar…')
    await clicar(sessao().locator('.btn-perigo', { hasText: 'Encerrar' }), 'Encerrar (confirmar)')
    if (!/Encerrada/i.test(await sessao().innerText())) falhar(onde, 'encerrou e o selo não disse "Encerrada"')
    await clicar(botao('Reabrir', sessao()), 'Reabrir')
    await clicar(botao('Editar…', sessao()), 'Editar…')
    await sessao().locator('select').selectOption('iguatemi')
    await clicar(botao('Salvar', sessao()), 'Salvar edição')
    if (!/Iguatemi Campinas/.test(await sessao().innerText())) falhar(onde, 'editou a loja e a sessão não mudou')
    await clicar(botao('Apagar…', sessao()), 'Apagar…')
    await clicar(botao('Apagar de vez', sessao()), 'Apagar de vez')
    if (await sessao().count()) falhar(onde, 'apagou a sessão sem leitura e ela continuou na lista')
  }
  // Sessão JÁ LIDA não se apaga: vira explicação, não erro vermelho.
  const lida = pagina.locator('.bs-sessao', { hasText: 'Salão Aurora (exemplo)' })
  await clicar(botao('Apagar…', lida), 'Apagar… (sessão lida)')
  await clicar(botao('Apagar de vez', lida), 'Apagar de vez (sessão lida)')
  if (!(await lida.locator('.bs-nota-aviso').count())) falhar(onde, 'apagar sessão lida não explicou o porquê')
  // Arquivar e trazer de volta pelo filtro "Situação".
  const lirio = pagina.locator('.bs-sessao', { hasText: 'Studio Lírio (exemplo)' })
  // ⚠️ CADASTRAR LEAD PELA EQUIPE (24/09/2026): nova, duplicata (aviso) e a lista.
  await clicar(botao('Cadastrar lead', lirio), 'Cadastrar lead')
  await lirio.locator('input[id^="bsl-nome"]').fill('Helena Prado (exemplo)')
  await lirio.locator('input[id^="bsl-ddd"]').fill('19')
  await lirio.locator('input[id^="bsl-numero"]').fill('988776655')
  await lirio.locator('select[id^="bsl-interesse"]').selectOption('rever-uma-peca')
  await clicar(botao(/^Cadastrar$/, lirio), 'Cadastrar')
  await esperar(500)
  if (!/Cadastrada: Helena Prado/.test(await lirio.innerText())) falhar(onde, 'cadastrou a lead e o recado de sucesso não apareceu')
  if (!/pela equipe/.test(await lirio.innerText())) falhar(onde, 'os números não mostraram a porta da equipe')
  await lirio.locator('input[id^="bsl-nome"]').fill('Helena de novo')
  await lirio.locator('input[id^="bsl-ddd"]').fill('19')
  await lirio.locator('input[id^="bsl-numero"]').fill('988776655')
  await clicar(botao(/^Cadastrar$/, lirio), 'Cadastrar (duplicata)')
  if (!/Nada foi duplicado/.test(await lirio.innerText())) falhar(onde, 'a duplicata não avisou')
  await clicar(botao('Leads desta sessão', lirio), 'Leads desta sessão')
  await esperar(400)
  if (!/Helena Prado \(exemplo\)/.test(await lirio.locator('.bs-leads').innerText().catch(() => ''))) {
    falhar(onde, 'a lead cadastrada não apareceu na lista da sessão')
  }
  await clicar(botao('Fechar as leads', lirio), 'Fechar as leads')
  await clicar(botao(/^Arquivar/, lirio), 'Arquivar')
  if (await lirio.count()) falhar(onde, 'arquivou e a sessão continuou na lista padrão')
  await mexerEmTodosOsSelects()
  await pagina.locator('input[type="search"]').first().fill('SBO'); await esperar(); await conferirTela()
  await pagina.locator('input[type="search"]').first().fill(''); await esperar()
  await clicar(pagina.locator('.bs-atalho').first(), 'Ver no Material Gráfico →')
  await esperar(600)
  if (!/Material Gráfico/i.test(await conferirTela())) falhar(onde, 'o atalho não levou ao Material Gráfico')
}

// ════════════════════════════════════════════════════════════════════════════
passo('Material Gráfico')
{
  const t = await abrirPeloMenu('Material Gráfico')
  if (!/BS-\d{8}-[A-Z]{3}-[A-Z0-9]+/.test(t)) falhar(onde, 'o QR da Beauty Session de exemplo não apareceu')
  await pagina.check('#mg-todos'); await esperar(600); await conferirTela()
  await pagina.fill('#mg-busca', 'STY'); await esperar(); await conferirTela()
  await pagina.fill('#mg-busca', ''); await esperar()
  for (const rotulo of [/Baixar PNG/, /Baixar SVG/]) {
    const [baixado] = await Promise.all([
      pagina.waitForEvent('download', { timeout: 8000 }).catch(() => null),
      pagina.getByRole('button', { name: rotulo }).first().click(),
    ])
    if (!baixado) falhar(onde, `"${rotulo.source}" não baixou arquivo`)
    await esperar(); await conferirTela()
  }
  await clicar(pagina.getByRole('button', { name: /Copiar endereço/ }).first(), 'Copiar endereço')
  await pagina.uncheck('#mg-todos'); await esperar(500); await conferirTela()
}

// ════════════════════════════════════════════════════════════════════════════
passo('Private Edit')
{
  const t = await abrirPeloMenu('Private Edit')
  if (!/Marina Castro \(exemplo\)/.test(t)) falhar(onde, 'os encontros de exemplo não apareceram')
  await mexerEmTodosOsSelects()
  await pagina.locator('input[type="search"]').first().fill('CPS'); await esperar(); await conferirTela()
  await pagina.locator('input[type="search"]').first().fill(''); await esperar()
}

// ════════════════════════════════════════════════════════════════════════════
passo('Stylist Circle')
{
  const t = await abrirPeloMenu('Stylist Circle')
  if (!/Paula Reis \(exemplo\)/.test(t)) falhar(onde, 'as parceiras de exemplo não apareceram')
  await mexerEmTodosOsSelects()
  await clicar(pagina.getByText('Paula Reis (exemplo)').first(), 'abrir a ficha da Paula')
  await esperar(500)
  const fechar = pagina.getByRole('button', { name: /✕|Fechar/ })
  if (await fechar.count()) await clicar(fechar.first(), 'fechar a ficha')
  // 24/09: o scorecard, a nota de qualificação e as metas.
  const tela = await conferirTela()
  if (!/Comparecimento/.test(tela) || !/meta: 70% ou mais/.test(tela)) falhar(onde, 'o placar não mostra a meta do comparecimento')
  if (!/faixa de teste: 1 a 3/.test(tela)) falhar(onde, 'o placar não mostra a faixa de vendas por encontro')
  if (!/Sem nota/i.test(tela) || !/Faixa A/i.test(tela)) falhar(onde, 'o quadro não mostra os selos da faixa')
  await clicar(pagina.locator('.cv-quadro-nome', { hasText: 'Marina' }).first(), 'abrir a ficha da Marina')
  await pagina.waitForSelector('.cv-scorecard .cv-numero', { timeout: 5000 }).catch(() => falhar(onde, 'o scorecard não abriu'))
  if (!/Professional Fee estimado/.test(await conferirTela())) falhar(onde, 'o scorecard não mostra o Professional Fee')
  if (!/vale reavaliar/.test(await conferirTela())) falhar(onde, 'a Marina teve encontro depois da nota e a ficha não avisou')
  await pagina.selectOption('.cv-scorecard select', 'mes'); await esperar(400); await conferirTela()
  await pagina.selectOption('.cv-scorecard select', 'tudo'); await esperar(400)
  await clicar(pagina.locator('.cv-qualificacao .cv-botao-avaliar'), 'Reavaliar')
  await clicar(pagina.locator('.cv-modal-avaliar .cv-sugestao .btn:not([disabled])').first(), 'aplicar uma sugestão')
  await clicar(pagina.locator('.cv-modal-avaliar .btn-principal'), 'Salvar avaliação')
  if (!/→.*→/.test(await pagina.locator('.cv-qualificacao-trilha').innerText().catch(() => ''))) falhar(onde, 'reavaliou e o histórico não cresceu')
  await clicar(pagina.locator('.cv-modal-fechar').first(), 'fechar a ficha da Marina')

  // 24/09: O FUNIL CONFIGURÁVEL — as colunas vêm das etapas, a engrenagem abre
  // "Etapas do funil" (adicionar, subir, excluir com destino), e a ficha avança
  // de etapa e mostra o histórico de etapas.
  const noQuadro = await pagina.locator('.cv-quadro-titulo').allInnerTexts()
  if (!/^Identificado · /i.test(noQuadro[0] || '')) falhar(onde, `a primeira coluna do quadro não é Identificado: ${noQuadro[0]}`)
  if (!noQuadro.some((t) => /^Saídas · /i.test(t))) falhar(onde, 'o quadro não junta as saídas no fim')
  // O contato fácil no cartão: só confere o endereço (o toque abriria uma aba de fora).
  const contatos = async (nome) => pagina.locator('.cv-quadro-cartao', { hasText: nome }).first()
    .locator('.cv-contato a').evaluateAll((as) => as.map((a) => `${a.getAttribute('href')}|${a.getAttribute('target')}|${a.getAttribute('aria-label')}`))
  const esperado = {
    'Marina Castro': ['https://wa.me/5519990000001|_blank|Chamar Marina Castro (exemplo) no WhatsApp', 'https://instagram.com/marina.exemplo|_blank|Abrir o Instagram de Marina Castro (exemplo)'],
    'Luiza Amaral': ['https://instagram.com/luiza.exemplo|_blank|Abrir o Instagram de Luiza Amaral (exemplo)'],
    'Carol Bastos': ['https://wa.me/5519990000006|_blank|Chamar Carol Bastos (exemplo) no WhatsApp'],
  }
  for (const [nome, lista] of Object.entries(esperado)) {
    const tem = await contatos(nome)
    if (JSON.stringify(tem) !== JSON.stringify(lista)) falhar(onde, `contato fácil de ${nome}: ${JSON.stringify(tem)}`)
  }
  await clicar(pagina.getByRole('button', { name: 'Etapas do funil' }), 'engrenagem: Etapas do funil')
  const modal = pagina.locator('[role="dialog"][aria-label="Etapas do funil"]')
  if (!/Desclassificado/.test(await modal.innerText().catch(() => ''))) falhar(onde, 'a tela de etapas não abriu com as etapas')
  await modal.locator('#etapa-nova-nome').fill('Qualificada')
  await modal.locator('#etapa-nova-posicao').selectOption('3')
  await clicar(modal.getByRole('button', { name: /Adicionar etapa/ }), 'adicionar a etapa Qualificada')
  if (!/Qualificada/.test(await modal.innerText())) falhar(onde, 'a etapa nova não apareceu na lista')
  await clicar(modal.getByRole('button', { name: 'Subir Qualificada' }), 'subir a Qualificada')
  const classificacao = modal.locator('.cv-etapa', { hasText: 'Classificação' })
  await clicar(classificacao.getByRole('button', { name: /Excluir…/ }), 'excluir Classificação…')
  if (!/escolha para onde elas vão/.test(await classificacao.innerText())) falhar(onde, 'excluir com gente não pediu o destino')
  await classificacao.locator('select').selectOption({ label: 'Identificado' })
  await clicar(classificacao.getByRole('button', { name: /Excluir a etapa/ }), 'excluir movendo para Identificado')
  if (await modal.locator('.cv-etapa', { hasText: 'Classificação' }).count()) falhar(onde, 'a etapa excluída continuou na lista')
  await clicar(modal.locator('.cv-modal-fechar'), 'fechar Etapas do funil')
  if (!(await pagina.locator('.cv-quadro-titulo', { hasText: 'Qualificada' }).count())) falhar(onde, 'a etapa nova não virou coluna do quadro')
  await clicar(pagina.locator('.cv-quadro-nome', { hasText: 'Luiza' }).first(), 'abrir a ficha da Luiza')
  await clicar(pagina.locator('.cv-ficha-etapa .btn-principal'), 'Avançar para a próxima etapa')
  await esperar(400)
  if (!/Identificado → Qualificada/.test(await pagina.locator('.cv-modal-corpo').innerText())) falhar(onde, 'avançou e o histórico de etapas não mostrou')
  await clicar(pagina.locator('.cv-modal-fechar').first(), 'fechar a ficha da Luiza')
}

// ════════════════════════════════════════════════════════════════════════════
passo('Voltar: módulo → Comercial Vessel → Central → Comercial Vessel')
{
  await clicar(pagina.getByRole('button', { name: /Comercial Vessel/ }).first(), 'voltar ao Comercial Vessel')
  await clicar(pagina.getByRole('button', { name: /Central/ }).first(), 'voltar à Central')
  if (!/COMERCIAL\s+VESSEL/i.test(await conferirTela())) falhar(onde, 'a Central não mostra o cartão do Comercial Vessel')
  // O avatar só existe na tela de início, e fica logo abaixo da faixa.
  await clicar(pagina.locator('.perfil-avatar'), 'menu do perfil')
  await clicar(pagina.locator('.perfil-backdrop'), 'fechar o menu do perfil')
  await clicar(pagina.locator('.home-card:visible', { hasText: /Comercial/i }).first(), 'entrar de novo no Comercial Vessel')
  await pagina.waitForSelector('.cvmenu-card')
}

// ════════════════════════════════════════════════════════════════════════════
passo('Página do roteiro: Celular | Notebook')
{
  const roteiro = await contexto.newPage()
  vigiar(roteiro, 'roteiro')
  await roteiro.goto(ROTEIRO)
  await roteiro.waitForTimeout(2500)
  const passos = await roteiro.locator('#passos > li').count()
  if (passos < 11) falhar(onde, `o roteiro mostrou ${passos} passos (eram 11)`)
  for (const modo of ['notebook', 'celular']) {
    await roteiro.click(`#modo-${modo}`)
    await roteiro.waitForTimeout(600)
    if ((await roteiro.getAttribute(`#modo-${modo}`, 'aria-pressed')) !== 'true') falhar(onde, `o botão ${modo} não ficou marcado`)
    const quadro = roteiro.frameLocator('#central')
    const texto = (await quadro.locator('#app').innerText().catch(() => '')).trim()
    if (texto.length < 20) falhar(onde, `TELA BRANCA no iframe (${modo})`)
  }
  await roteiro.close()
}

// ════════════════════════════════════════════════════════════════════════════
if (FOTOS) {
  passo(`Fotos em ${FOTOS}`)
  const MODULOS = [
    ['menu', 'comercial-vessel'], ['private-appointment', 'atendimentos'], ['beauty-sessions', 'beauty-sessions'],
    ['private-edit', 'private-edit'], ['stylist-circle', 'stylist-circle'], ['material-grafico', 'material-grafico'],
  ]
  const roteiro = await contexto.newPage()
  vigiar(roteiro, 'roteiro')
  await roteiro.goto(ROTEIRO)
  await roteiro.waitForTimeout(2000)
  for (const modo of ['celular', 'notebook']) {
    await roteiro.click(`#modo-${modo}`)
    for (const [nome, rota] of MODULOS) {
      await roteiro.evaluate((r) => { document.getElementById('central').contentWindow.location.hash = `#/${r}` }, rota)
      await roteiro.waitForTimeout(1500)
      await roteiro.screenshot({ path: join(FOTOS, `1440-${modo}-${nome}.png`) })
    }
  }
  await roteiro.close()
  const estreita = await navegador.newPage({ viewport: { width: 390, height: 844 } })
  vigiar(estreita, '390px')
  for (const [nome, rota] of MODULOS) {
    await estreita.goto(`${CENTRAL}#/${rota}`)
    await estreita.waitForTimeout(1500)
    await estreita.screenshot({ path: join(FOTOS, `390-${nome}.png`), fullPage: true })
    const larga = await estreita.evaluate(() => document.documentElement.scrollWidth)
    if (larga > 390) falhar(`390px ${nome}`, `a página rola de lado (${larga}px)`)
  }
  await estreita.close()
}

// ── a página do roteiro NUM CELULAR DE VERDADE (sempre, com ou sem fotos) ───
// ⚠️ A queixa do dono (23/09): no celular a tela de dentro ficava presa em
// 390×844 — mais alta que a janela, o fim cortado e sem rolagem até ele. As
// fotos de 390px acima abrem a Central SOZINHA e não viam isso; aqui é a
// página que as pessoas abrem, em janelas de celular com a barra do navegador.
console.log('\n• Página do roteiro no celular (a tela cabe na janela e rola até o fim)')
for (const [w, h] of [[375, 560], [390, 664], [430, 740]]) {
  const cel = await navegador.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true })
  vigiar(cel, `celular ${w}×${h}`)
  await cel.goto(ROTEIRO)
  await cel.waitForTimeout(1500)
  const r = await cel.evaluate(() => {
    const i = document.getElementById('central').getBoundingClientRect()
    return { baixo: i.bottom, direita: i.right, alto: document.documentElement.scrollHeight, janela: innerHeight, largura: innerWidth }
  })
  if (r.baixo > r.janela + 1) falhar(`celular ${w}×${h}`, `a tela passa do fim da janela (${Math.round(r.baixo)} > ${r.janela}) — o fim fica cortado`)
  if (r.direita > r.largura + 1) falhar(`celular ${w}×${h}`, `a tela passa da largura (${Math.round(r.direita)} > ${r.largura})`)
  if (r.alto > r.janela + 1) falhar(`celular ${w}×${h}`, `a página em volta rola (${r.alto} > ${r.janela}) — a rolagem vai para ela, não para a tela`)
  await cel.close()
}

await navegador.close()
console.log('\n──────────────────────────────')
console.log(`pedidos ao Supabase: ${paraSupabase} · pedidos para fora (API): ${paraFora} · aba do site da Vessel (combinado): ${saidasDePropósito}`)
if (falhas.length) {
  console.log(`REPROVADO — ${falhas.length} problema(s):`)
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('APROVADO — todos os módulos do Comercial Vessel abriram e responderam, sem rede.')
