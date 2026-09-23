/* A PÁGINA DO ROTEIRO (`demonstracao/index.html`) — o celular e os passos.
 *
 * ⚠️ O ROTEIRO SÓ OUVE O CELULAR DELE: aviso que não veio do iframe desta
 * página, ou de outra origem, é jogado fora. Senão qualquer aba podia marcar
 * passo. As regras de quando cada passo conta moram em `roteiro.js`, testadas.
 */
import '../estilos/estilos-globais.css'
import './pagina-do-roteiro.css'
import { PASSOS, ORIGEM_DOS_AVISOS, roteiroVazio, aplicarAviso, resumoDoRoteiro } from './roteiro.js'

const CHAVE_DO_MODO = 'iamundi-demo-modo-aparelho'
const mqCelularDeVerdade = window.matchMedia('(max-width: 900px)')
const QUEM = { Ionara: 'selo-info', Gerente: 'selo-neutro', Sistema: 'selo-robo' }
function marcaDeFeito() {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  for (const [k, v] of Object.entries({ width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v)
  const caminho = document.createElementNS(ns, 'path')
  caminho.setAttribute('d', 'M20 6 9 17l-5-5')
  svg.append(caminho)
  return svg
}

const $ = (id) => document.getElementById(id)
const iframe = $('central')
let roteiro = roteiroVazio()

// ── tema: o do aparelho, e a Central de dentro segue o mesmo ─────────────────
const escuro = window.matchMedia('(prefers-color-scheme: dark)')
const aplicarTema = () => { document.documentElement.dataset.theme = escuro.matches ? 'dark' : 'light' }
aplicarTema()
escuro.addEventListener?.('change', aplicarTema)

// ── os passos ─────────────────────────────────────────────────────────────────
function elemento(tag, classe, texto) {
  const el = document.createElement(tag)
  if (classe) el.className = classe
  if (texto != null) el.textContent = texto
  return el
}

function desenhar() {
  const lista = $('passos')
  const proximo = PASSOS.find((p) => !roteiro.feitos.includes(p.id))
  lista.replaceChildren(...PASSOS.map((p) => {
    const feito = roteiro.feitos.includes(p.id)
    const li = elemento('li', `demo-passo${feito ? ' feito' : ''}${p === proximo ? ' agora' : ''}`)
    const marca = elemento('span', 'demo-passo-marca')
    marca.setAttribute('aria-hidden', 'true')
    marca.append(feito ? marcaDeFeito() : String(p.id))
    const texto = elemento('div', 'demo-passo-texto')
    const titulo = elemento('p', 'demo-passo-titulo')
    titulo.append(elemento('span', `selo ${QUEM[p.quem] || 'selo-neutro'}`, p.quem), ' ', p.titulo)
    texto.append(titulo, elemento('p', 'demo-passo-onde', p.onde))
    const estado = elemento('span', 'demo-passo-estado', feito ? 'Feito' : (p === proximo ? 'Agora' : ''))
    li.append(marca, texto, estado)
    return li
  }))
  const resumo = resumoDoRoteiro(roteiro)
  $('resumo').textContent = resumo
  $('resumo-curto').textContent = resumo
}

window.addEventListener('message', (e) => {
  if (e.source !== iframe.contentWindow || e.origin !== location.origin) return
  const m = e.data
  if (!m || m.origem !== ORIGEM_DOS_AVISOS || typeof m.evento !== 'string') return
  roteiro = aplicarAviso(roteiro, m.evento, m.dados || {})
  desenhar()
})

// ── celular ou notebook ───────────────────────────────────────────────────────
// ⚠️ TROCAR O MODO NUNCA MEXE NO IFRAME: ele é um só, sempre no mesmo lugar do
// DOM. Só o `data-modo` do aparelho muda (a moldura e o tamanho da tela vêm do
// CSS a partir dele) — senão o banco de mentira reiniciava e o roteiro
// marcado se perdia a cada clique no alternador.
function lerModoGuardado() {
  try { return localStorage.getItem(CHAVE_DO_MODO) === 'notebook' ? 'notebook' : 'celular' } catch { return 'celular' }
}
function guardarModo(modo) {
  try { localStorage.setItem(CHAVE_DO_MODO, modo) } catch { /* modo privado */ }
}
let modoEscolhido = lerModoGuardado()
// No aparelho de verdade a escolha não existe: sempre celular, mesmo com
// "notebook" guardado de uma sessão de computador anterior.
const modoEmUso = () => (mqCelularDeVerdade.matches ? 'celular' : modoEscolhido)

function aplicarModo() {
  const modo = modoEmUso()
  $('aparelho').dataset.modo = modo
  $('modo-celular').setAttribute('aria-pressed', String(modo === 'celular'))
  $('modo-notebook').setAttribute('aria-pressed', String(modo === 'notebook'))
  escalar()
}
$('modo-celular').addEventListener('click', () => {
  modoEscolhido = 'celular'
  guardarModo(modoEscolhido)
  aplicarModo()
})
$('modo-notebook').addEventListener('click', () => {
  modoEscolhido = 'notebook'
  guardarModo(modoEscolhido)
  aplicarModo()
})
mqCelularDeVerdade.addEventListener?.('change', aplicarModo)

// ── recomeçar ────────────────────────────────────────────────────────────────
$('recomecar').addEventListener('click', () => {
  roteiro = roteiroVazio()
  desenhar()
  // Volta ao Comercial Vessel e RECARREGA: só trocar o `#` não recarregaria, e
  // o banco de mentira (que mora na memória da página) seguiria como estava.
  try {
    iframe.contentWindow.location.hash = '#/comercial-vessel'
    iframe.contentWindow.location.reload()
  } catch {
    iframe.src = 'central.html#/comercial-vessel'
  }
})

// ── o roteiro recolhível do celular ──────────────────────────────────────────
$('alternar').addEventListener('click', () => {
  const aberto = $('roteiro').classList.toggle('aberto')
  $('alternar').setAttribute('aria-expanded', String(aberto))
})

// ── o aparelho cabe na altura (e na largura, o notebook é bem mais largo) da
// janela ──────────────────────────────────────────────────────────────────────
// `offsetWidth`/`offsetHeight` do aparelho são o tamanho NATURAL (o `transform:
// scale` é só visual, não mexe no layout) — por isso dá para medir sem
// desfazer a escala anterior primeiro.
function escalar() {
  const lugar = $('lugar-do-aparelho')
  const aparelho = $('aparelho')
  if (mqCelularDeVerdade.matches) {
    aparelho.style.transform = ''
    lugar.style.width = ''
    lugar.style.height = ''
    return
  }
  const largura = aparelho.offsetWidth
  const altura = aparelho.offsetHeight
  if (!largura || !altura) return
  const topo = lugar.getBoundingClientRect().top + window.scrollY
  const disponivel = window.innerHeight - Math.min(topo, window.innerHeight * 0.3) - 24
  // A largura livre é a caixa de CONTEÚDO do palco (sem o padding dele) menos
  // a coluna do roteiro (medida de verdade, não um chute) e o vão entre as
  // duas colunas (`--sp-6`, 32px).
  const palco = lugar.parentElement
  const estiloPalco = getComputedStyle(palco)
  const paddingPalco = parseFloat(estiloPalco.paddingLeft) + parseFloat(estiloPalco.paddingRight)
  const colunaDoRoteiro = $('roteiro').getBoundingClientRect().width
  const larguraLivre = palco.clientWidth - paddingPalco - colunaDoRoteiro - 32
  const escala = Math.max(0.4, Math.min(1, disponivel / altura, larguraLivre / largura))
  aparelho.style.transform = `scale(${escala})`
  lugar.style.width = `${Math.round(largura * escala)}px`
  lugar.style.height = `${Math.round(altura * escala)}px`
}
window.addEventListener('resize', escalar)

desenhar()
aplicarModo()
