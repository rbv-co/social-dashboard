import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarAtualizacao, tituloDaJanela, TITULO_BASE } from './atualizacao.js'

// Um dublê do autoUpdater: guarda os ouvintes e deixa o teste disparar cada um.
function dubleDoAtualizador({ aoProcurar } = {}) {
  const ouvintes = {}
  return {
    ouvintes,
    autoDownload: null,
    autoInstallOnAppQuit: null,
    on(evento, f) { (ouvintes[evento] ??= []).push(f) },
    disparar(evento, dado) { (ouvintes[evento] ?? []).forEach((f) => f(dado)) },
    async checkForUpdates() { if (aoProcurar) return aoProcurar() },
  }
}

test('o titulo mostra a versao que esta rodando', () => {
  assert.equal(tituloDaJanela('1.2.0'), `${TITULO_BASE} — v1.2.0`)
})

test('sem versao o titulo nao inventa nada', () => {
  assert.equal(tituloDaJanela(''), TITULO_BASE)
})

test('quando a atualizacao esta baixada o titulo DIZ o que fazer', () => {
  const t = tituloDaJanela('1.2.0', 'baixada')
  assert.match(t, /feche o programa para instalar/)
})

test('fora do instalador nao procura nada — e nao estoura', async () => {
  const d = dubleDoAtualizador({ aoProcurar: () => { throw new Error('nao deveria chegar aqui') } })
  const a = criarAtualizacao({ autoUpdater: d, versao: '1.0.0', empacotado: false })
  assert.equal(await a.procurar(), 'nao-procura')
})

test('baixa sozinha, mas instala so ao fechar', () => {
  const d = dubleDoAtualizador()
  criarAtualizacao({ autoUpdater: d, versao: '1.0.0' })
  assert.equal(d.autoDownload, true, 'tem de baixar sozinha')
  assert.equal(d.autoInstallOnAppQuit, true, 'NAO pode instalar no meio do expediente')
})

test('achou versao nova: o titulo avisa que esta baixando', () => {
  const d = dubleDoAtualizador(); let titulo = ''
  const a = criarAtualizacao({ autoUpdater: d, versao: '1.0.0', aoMudarTitulo: (t) => { titulo = t } })
  d.disparar('update-available', { version: '1.1.0' })
  assert.equal(a.estado(), 'baixando')
  assert.match(titulo, /baixando atualização/)
})

test('baixou: o titulo manda fechar para instalar', () => {
  const d = dubleDoAtualizador(); let titulo = ''
  const a = criarAtualizacao({ autoUpdater: d, versao: '1.0.0', aoMudarTitulo: (t) => { titulo = t } })
  d.disparar('update-downloaded', { version: '1.1.0' })
  assert.equal(a.estado(), 'baixada')
  assert.match(titulo, /ATUALIZAÇÃO PRONTA/)
})

test('erro ao procurar NAO derruba o programa e NAO muda o titulo', async () => {
  const d = dubleDoAtualizador({ aoProcurar: () => { throw new Error('sem internet') } })
  let titulo = ''; const recados = []
  const a = criarAtualizacao({
    autoUpdater: d, versao: '1.0.0',
    aoMudarTitulo: (t) => { titulo = t }, registrar: (m) => recados.push(m),
  })
  assert.equal(await a.procurar(), 'falhou')
  assert.equal(a.estado(), 'nada', 'quem grava nao pode ser incomodado por isso')
  assert.equal(titulo, `${TITULO_BASE} — v1.0.0`)
  assert.match(recados.join(' '), /sem internet/)
})

test('erro vindo do proprio atualizador tambem e engolido', () => {
  const d = dubleDoAtualizador(); const recados = []
  const a = criarAtualizacao({ autoUpdater: d, versao: '1.0.0', registrar: (m) => recados.push(m) })
  d.disparar('error', new Error('GitHub fora do ar'))
  assert.equal(a.estado(), 'nada')
  assert.match(recados.join(' '), /GitHub fora do ar/)
})

// ── O CONVITE PARA REINICIAR (07/09/2026) ──────────────────────────────────
/* Ate aqui a versao nova baixava sozinha e so era instalada quando a pessoa
 * FECHAVA o programa — e o unico aviso era o titulo da janela. Quem deixa o
 * programa aberto a semana inteira nunca recebia a atualizacao. */

function atualizadorDeMentira() {
  const ouvintes = {}
  return {
    autoDownload: false, autoInstallOnAppQuit: false,
    on(evento, f) { ouvintes[evento] = f },
    disparar(evento, dados) { return ouvintes[evento]?.(dados) },
    instalou: 0,
    quitAndInstall() { this.instalou += 1 },
    async checkForUpdates() { return true },
  }
}

test('versao baixada CONVIDA a reiniciar, e reinicia se a pessoa aceitar', async () => {
  const up = atualizadorDeMentira()
  let perguntou = null
  criarAtualizacao({
    autoUpdater: up, versao: '1.0.1', empacotado: true,
    perguntarSeReinicia: async (v) => { perguntou = v; return true },
  })
  await up.disparar('update-downloaded', { version: '1.0.2' })
  assert.equal(perguntou, '1.0.2', 'o convite tem de dizer qual versao chegou')
  assert.equal(up.instalou, 1)
})

test('⚠️ recusar e resposta VALIDA — nao instala, e nao insiste', async () => {
  const up = atualizadorDeMentira()
  criarAtualizacao({
    autoUpdater: up, versao: '1.0.1', empacotado: true,
    perguntarSeReinicia: async () => false,
  })
  await up.disparar('update-downloaded', { version: '1.0.2' })
  assert.equal(up.instalou, 0, 'instalou mesmo com a pessoa dizendo nao')
})

test('⚠️ com a bancada OCUPADA o convite nem aparece', async () => {
  /* Interromper alguem com a etiqueta na mao e a fila pela metade e exatamente
   * o que o programa evitou desde o comeco ao nao instalar sozinho. */
  const up = atualizadorDeMentira()
  let perguntou = 0
  criarAtualizacao({
    autoUpdater: up, versao: '1.0.1', empacotado: true,
    estaOcupado: () => true,
    perguntarSeReinicia: async () => { perguntou += 1; return true },
  })
  await up.disparar('update-downloaded', { version: '1.0.2' })
  assert.equal(perguntou, 0, 'perguntou com etiqueta em uso')
  assert.equal(up.instalou, 0)
})

test('sem quem perguntar, tudo segue como antes — instala ao fechar', async () => {
  const up = atualizadorDeMentira()
  criarAtualizacao({ autoUpdater: up, versao: '1.0.1', empacotado: true })
  await up.disparar('update-downloaded', { version: '1.0.2' })
  assert.equal(up.instalou, 0)
  assert.equal(up.autoInstallOnAppQuit, true, 'a instalacao ao fechar nao pode ter sumido')
})

test('a tela consegue saber que ha versao esperando, e pedir o reinicio', async () => {
  const up = atualizadorDeMentira()
  const a = criarAtualizacao({
    autoUpdater: up, versao: '1.0.1', empacotado: true,
    perguntarSeReinicia: async () => true,
  })
  assert.equal(a.temVersaoEsperando(), false)
  await up.disparar('update-downloaded', { version: '1.0.2' })
  assert.equal(a.temVersaoEsperando(), true, 'e isto que faz o botao aparecer')
})

test('⚠️ falha ao reiniciar NAO estoura o programa', async () => {
  const up = atualizadorDeMentira()
  up.quitAndInstall = () => { throw new Error('o Windows recusou') }
  const recados = []
  criarAtualizacao({
    autoUpdater: up, versao: '1.0.1', empacotado: true,
    registrar: (m) => recados.push(m),
    perguntarSeReinicia: async () => true,
  })
  await up.disparar('update-downloaded', { version: '1.0.2' })
  assert.ok(recados.some((m) => /não consegui reiniciar/.test(m)), 'a falha tem de ficar registrada')
})
