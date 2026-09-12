/* A JANELA: uma casca fina que empresta o leitor para a tela que já existe.
 *
 * O Electron entra por INJEÇÃO — `node --test` não abre janela nenhuma. O que
 * este arquivo prova é o que NÃO dá para ver olhando a janela aberta: que a
 * página não tem poder de sistema, e que o leitor não viaja com ela para fora.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirAJanela } from './abrir-a-janela.js'
import { ENDERECO_DA_CENTRAL } from './enderecos-permitidos.js'

function electronDeMentira() {
  const registro = { opcoes: null, carregou: [], ouvintes: new Map(), aberturas: [], externos: [] }
  class JanelaFalsa {
    constructor(opcoes) {
      registro.opcoes = opcoes
      this.webContents = {
        on: (nome, ouvinte) => { registro.ouvintes.set(nome, ouvinte) },
        setWindowOpenHandler: (fn) => { registro.abrirOutraJanela = fn },
      }
    }
    loadURL(url) { registro.carregou.push(url) }
    once(nome, fn) { registro.ouvintes.set(`once:${nome}`, fn) }
    show() { registro.mostrou = true }
  }
  const shell = { openExternal: (url) => { registro.externos.push(url) } }
  return { BrowserWindow: JanelaFalsa, shell, registro }
}

const abrir = (extra = {}) => {
  const { BrowserWindow, shell, registro } = electronDeMentira()
  const janela = abrirAJanela({ BrowserWindow, shell, caminhoDoPreload: '/x/preload.cjs', ...extra })
  return { janela, registro }
}

/* ── A TELA VEM DA INTERNET: NADA DE PODER DE SISTEMA ─────────────────────── */

test('a página roda isolada, sem Node, e em caixa de areia', () => {
  const { registro } = abrir()
  const w = registro.opcoes.webPreferences
  assert.equal(w.contextIsolation, true, 'sem isolamento, a página alcança o preload por dentro')
  assert.equal(w.nodeIntegration, false, 'com Node, a página lê e escreve o computador inteiro')
  assert.equal(w.sandbox, true)
  assert.equal(w.webviewTag, false, '`<webview>` é uma janela dentro da janela, sem estas travas')
  assert.equal(w.preload, '/x/preload.cjs')
  assert.notEqual(w.webSecurity, false, 'desligar a segurança da web derruba tudo o que está acima')
})

test('a janela abre no endereço da Central, e em nenhum outro', () => {
  const { registro } = abrir()
  assert.deepEqual(registro.carregou, [ENDERECO_DA_CENTRAL])
})

/* ── O LEITOR NÃO VIAJA JUNTO ─────────────────────────────────────────────── */

function navegarPara(registro, url, evento = 'will-navigate') {
  const acontecido = { impedido: false, preventDefault() { this.impedido = true } }
  registro.ouvintes.get(evento)(acontecido, url)
  return acontecido.impedido
}

test('navegar dentro da Central é permitido: o login é o do painel', () => {
  // quem grava entra na Central dentro da janela, como sempre. O programa não
  // guarda senha nem chave nenhuma — `auth.uid()` sai da sessão dela, e é assim
  // que fica registrado quem gravou cada peça.
  const { registro } = abrir()
  assert.equal(navegarPara(registro, 'https://central.rbvcompany.com/entrar'), false)
  assert.equal(navegarPara(registro, ENDERECO_DA_CENTRAL), false)
})

test('navegar para fora é impedido — o leitor ficaria emprestado a quem estiver lá', () => {
  const { registro } = abrir()
  for (const fora of [
    'https://outracoisa.com/',
    'http://central.rbvcompany.com/',
    'https://central.rbvcompany.com.outracoisa.com/',
    'file:///etc/passwd',
  ]) {
    assert.equal(navegarPara(registro, fora), true, `${fora} passou`)
  }
})

test('REDIRECIONAMENTO também é impedido: um 302 não passa por `will-navigate`', () => {
  // a armadilha do Electron: `will-navigate` cobre o clique, e `will-redirect`
  // cobre o desvio que o servidor manda no meio do caminho. Só o primeiro
  // deixaria a porta aberta por onde ninguém olha.
  const { registro } = abrir()
  assert.ok(registro.ouvintes.has('will-redirect'), 'faltou o ouvinte de redirecionamento')
  assert.equal(navegarPara(registro, 'https://outracoisa.com/', 'will-redirect'), true)
  assert.equal(navegarPara(registro, ENDERECO_DA_CENTRAL, 'will-redirect'), false)
})

test('link de fora abre no navegador do computador, e não dentro da janela', () => {
  const { registro } = abrir()
  navegarPara(registro, 'https://outracoisa.com/nota-fiscal')
  assert.deepEqual(registro.externos, ['https://outracoisa.com/nota-fiscal'])
})

test('`file:` e `javascript:` NÃO são entregues ao computador', () => {
  // `openExternal` de um `file:` abre um arquivo do computador; de um
  // `javascript:` ou de um `.bat`, pior ainda. Só endereço da web sai daqui.
  const { registro } = abrir()
  for (const veneno of ['file:///Users/alguem/coisa.bat', 'javascript:alert(1)', 'data:text/html,x']) {
    navegarPara(registro, veneno)
  }
  assert.deepEqual(registro.externos, [])
})

/* ── `window.open` NÃO ABRE JANELA NENHUMA ────────────────────────────────── */

test('`window.open` é sempre negado — inclusive para a nossa própria casa', () => {
  // uma segunda janela nasceria sem estas travas e com o mesmo preload: seria a
  // porta dos fundos do leitor
  const { registro } = abrir()
  for (const url of [ENDERECO_DA_CENTRAL, 'https://outracoisa.com/', 'about:blank']) {
    assert.deepEqual(registro.abrirOutraJanela({ url }), { action: 'deny' }, `${url} abriu janela`)
  }
})

test('`window.open` de endereço da web ainda abre no navegador do computador', () => {
  const { registro } = abrir()
  registro.abrirOutraJanela({ url: 'https://vesselbrasil.com.br/verify/AAA111' })
  assert.deepEqual(registro.externos, ['https://vesselbrasil.com.br/verify/AAA111'])
  registro.abrirOutraJanela({ url: 'file:///coisa.bat' })
  assert.deepEqual(registro.externos, ['https://vesselbrasil.com.br/verify/AAA111'])
})
