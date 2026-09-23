/* DESENHA O CARTÃO DA CONVIDADA num `canvas` — o mesmo método do Appointment
 * Card (`vessel-brasil/geradorappointmentcard/desenhar.mjs`): fontes carregadas
 * ANTES de desenhar (o canvas não espera e não avisa), sem kerning automático,
 * texto centrado pela tinta e linha que vem de fora encolhendo até caber. */
import { LINHAS_DO_CONVITE, DIVISORIAS_DO_CONVITE, textosDoCartao } from './convite-da-convidada-regras.js'

const CAMINHO = '/cartao-private-edit'
const LARGURA = 1080, ALTURA = 1350, CENTRO = 540
const COR = '#29211C' // cor de marca do cartão (PDF de detalhes do Appointment Card)
const LOGO = { x: 422, y: 1174, largura: 236, altura: 59 }
const RECORTE_DO_LOGO = { x: 0, y: 0, largura: 600, altura: 150 }
const VERSAO_DAS_FONTES = 3

let fontesProntas = null
function carregarFontes() {
  if (!fontesProntas) {
    fontesProntas = Promise.all([
      ['VesselVersatile', 'vessel-versatile.woff2'],
      ['VesselVersatileLight', 'vessel-versatile-light.woff2'],
      ['VesselAngeletta', 'vessel-angeletta.woff2'],
    ].map(async ([nome, arquivo]) => {
      const f = new FontFace(nome, `url(${CAMINHO}/fontes/${arquivo}?v=${VERSAO_DAS_FONTES})`)
      await f.load()
      document.fonts.add(f)
    }))
      // ⚠️ SEM ISSO, UMA FALHA DE REDE NA PRIMEIRA TENTATIVA (rede caiu, CDN
      // fora do ar) DEIXAVA A PROMESSA REJEITADA GUARDADA PARA SEMPRE: toda
      // tentativa seguinte de abrir o cartão falharia direto, mesmo com a
      // rede de volta, até recarregar a página inteira.
      .catch((e) => { fontesProntas = null; throw e })
  }
  return fontesProntas
}

function carregarImagem(src) {
  return new Promise((ok, erro) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => erro(new Error(`não carregou: ${src}`))
    img.src = src
  })
}

function medir(ctx, texto, espaco) {
  const letras = [...texto]
  const posicoes = []
  let x = 0
  for (const l of letras) { posicoes.push(x); x += ctx.measureText(l).width + espaco }
  let esquerda = Infinity, direita = -Infinity
  letras.forEach((l, i) => {
    if (l === ' ') return
    const m = ctx.measureText(l)
    esquerda = Math.min(esquerda, posicoes[i] - m.actualBoundingBoxLeft)
    direita = Math.max(direita, posicoes[i] + m.actualBoundingBoxRight)
  })
  return { letras, posicoes, esquerda, tinta: direita - esquerda }
}

function escrever(ctx, texto, linha) {
  if (!texto) return
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = COR
  ctx.fontKerning = 'none'
  let tamanho = linha.tamanho
  ctx.font = `${tamanho}px ${linha.fonte}`
  if (linha.larguraMaxima) {
    for (let n = 0; n < 40; n++) {
      ctx.font = `${tamanho}px ${linha.fonte}`
      const largura = medir(ctx, texto, (linha.tracking || 0) * (tamanho / linha.tamanho)).tinta
      if (largura <= linha.larguraMaxima || tamanho <= linha.tamanhoMinimo) break
      tamanho = Math.max(linha.tamanhoMinimo, Math.floor(tamanho * (linha.larguraMaxima / largura) * 100) / 100)
    }
    ctx.font = `${tamanho}px ${linha.fonte}`
  }
  let espaco = (linha.tracking || 0) * (tamanho / linha.tamanho)
  if (linha.largura) {
    const sem = medir(ctx, texto, 0)
    espaco = (linha.largura - sem.tinta) / Math.max([...texto].length - 1, 1)
  }
  if (espaco === 0) {
    const m = ctx.measureText(texto)
    ctx.fillText(texto, CENTRO - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, linha.base)
    return
  }
  const { letras, posicoes, esquerda, tinta } = medir(ctx, texto, espaco)
  const inicio = CENTRO - tinta / 2 - esquerda
  letras.forEach((l, i) => ctx.fillText(l, inicio + posicoes[i], linha.base))
}

export async function desenharConvite(dados) {
  await carregarFontes()
  const [fundo, logo] = await Promise.all([
    carregarImagem(`${CAMINHO}/fundo.png`), carregarImagem(`${CAMINHO}/logomarca-escura.png`),
  ])
  const tela = document.createElement('canvas')
  tela.width = LARGURA
  tela.height = ALTURA
  const ctx = tela.getContext('2d')
  ctx.drawImage(fundo, 0, 0, LARGURA, ALTURA)
  const t = textosDoCartao(dados)
  for (const linha of LINHAS_DO_CONVITE) escrever(ctx, t[linha.campo], linha)
  ctx.fillStyle = COR
  for (const d of DIVISORIAS_DO_CONVITE) ctx.fillRect(CENTRO - d.largura / 2, d.meio - d.espessura / 2, d.largura, d.espessura)
  const r = RECORTE_DO_LOGO
  ctx.drawImage(logo, r.x, r.y, r.largura, r.altura, LOGO.x, LOGO.y, LOGO.largura, LOGO.altura)
  return tela
}
