/* O QR CODE DA CENTRAL — matriz, SVG, PNG transparente e o nome do arquivo.
 *
 * ⚠️ DE ONDE VEIO: o codificador (`matrizDoQr` e tudo que ele usa) é uma CÓPIA
 * do `qr.mjs` do repositório do site (`rbv-co/vessel-brasil`, arquivo `qr.mjs`,
 * commit d7b0948 de 23/09/2026). Só mudaram o nome da função pública
 * (`desenharQR` → `matrizDoQr`) e o ponto e vírgula. A Central não importa
 * arquivo do site (repositórios separados), então a cópia é o único caminho —
 * e a trava contra as duas divergirem é o teste do "desenho congelado" em
 * `qr.test.mjs`: a MESMA impressão digital que o site grava para o mesmo
 * endereço. Se um dos dois mudar, o teste cai.
 *
 * ⚠️ TESTE DE CONTA NÃO PROVA QUE A CÂMERA LÊ (regra do site, aprendida no
 * primeiro QR que ele gerou: passava em tudo e nenhum leitor abria). Por isso
 * `qr.test.mjs` DECODIFICA de volta cada QR com o `@zxing/library`, um leitor
 * que não tem nada a ver com este código, e o texto tem de sair igual.
 *
 * O QUE COBRE: modo byte (UTF-8), correção M (~15%), versões 1 a 10 — até 213
 * caracteres. Os três links do Material Gráfico têm entre 34 e 45.
 *
 * AS SAÍDAS:
 *   matrizDoQr(texto)          matriz de verdadeiro (escuro) / falso (claro)
 *   svgDoQr(texto, opções)     SVG com UM <path>, sem fundo, viewBox em módulos
 *   rasterDoQr(matriz, opções) os pixels RGBA (fundo com alfa 0)
 *   pngDoQr(texto, opções)     os bytes do PNG transparente (Promise<Uint8Array>)
 *   nomeDoArquivoDoQr(...)     VESSEL_[programa]_[praca]_[data]_qr_v01.<ext>
 */

/* A TINTA DOS QR IMPRESSOS — cor de marca do material impresso (a mesma do
 * Appointment Card), NÃO cor de tela: ela vai para o papel e não muda com o
 * tema. Por isso é constante aqui, e não token em estilos-globais.css. */
export const COR_DA_TINTA = '#29211C'

/* A zona de silêncio que a norma pede: 4 módulos claros em volta. Sem ela a
 * câmera confunde o QR com o que estiver impresso ao lado. */
export const MODULOS_DE_BORDA = 4

// ── Aritmética de Galois (GF 256) ────────────────────────────────────────────
// A correção de erro do QR usa Reed-Solomon, que trabalha num corpo de 256
// elementos onde somar é o mesmo que fazer XOR.
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d      // polinômio primitivo do QR
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}
const vezes = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/** O polinômio gerador para `n` bytes de correção: (x+α⁰)(x+α¹)…(x+αⁿ⁻¹). */
function gerador(n) {
  let g = [1]
  for (let i = 0; i < n; i++) {
    const nova = new Array(g.length + 1).fill(0)
    for (let j = 0; j < g.length; j++) {
      nova[j] ^= g[j]
      nova[j + 1] ^= vezes(g[j], EXP[i])
    }
    g = nova
  }
  return g
}

/** Os `n` bytes de correção de um bloco de dados (resto da divisão). */
function correcao(dados, n) {
  const g = gerador(n)
  const resto = new Uint8Array(dados.length + n)
  resto.set(dados)
  for (let i = 0; i < dados.length; i++) {
    const coef = resto[i]
    if (coef === 0) continue
    for (let j = 0; j < g.length; j++) resto[i + j] ^= vezes(g[j], coef)
  }
  return resto.slice(dados.length)
}

// ── Tabelas da norma, versões 1 a 10, correção M ─────────────────────────────
// [bytes de correção por bloco, blocos do grupo 1, bytes de dados de cada um,
//  blocos do grupo 2, bytes de dados de cada um]
const BLOCOS_M = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
}

// O centro dos quadradinhos de alinhamento (vale para linha e coluna).
const ALINHAMENTO = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}

/** Quantos bytes de dados cabem numa versão (já descontado o cabeçalho). */
export function capacidade(versao) {
  const [, b1, d1, b2, d2] = BLOCOS_M[versao]
  const bytesDeDados = b1 * d1 + b2 * d2
  const cabecalho = 4 + (versao >= 10 ? 16 : 8)
  return Math.floor((bytesDeDados * 8 - cabecalho) / 8)
}

/** A menor versão que comporta este texto. */
export function versaoPara(bytes) {
  for (let v = 1; v <= 10; v++) if (bytes <= capacidade(v)) return v
  throw new Error(
    `texto grande demais para QR versão 10 (${bytes} bytes, cabem ${capacidade(10)})`)
}

// ── Correção de erro dos blocos de informação (BCH) ──────────────────────────
function bch(valor, grau, gerador_) {
  let v = valor << grau
  for (let i = 14; i >= grau; i--) {
    if (v & (1 << i)) v ^= gerador_ << (i - grau)
  }
  return (valor << grau) | v
}
/** Os 15 bits de formato: correção M (00) + número da máscara. */
export function bitsDeFormato(mascara) {
  return bch((0b00 << 3) | mascara, 10, 0b10100110111) ^ 0b101010000010010
}
/** Os 18 bits de versão. Só existem da versão 7 em diante. */
export function bitsDeVersao(versao) {
  let v = versao << 12
  for (let i = 17; i >= 12; i--) {
    if (v & (1 << i)) v ^= 0b1111100100101 << (i - 12)
  }
  return (versao << 12) | v
}

// ── Montagem dos dados ───────────────────────────────────────────────────────
function bytesFinais(texto, versao) {
  const conteudo = new TextEncoder().encode(texto)
  const [bytesCorrecao, b1, d1, b2, d2] = BLOCOS_M[versao]

  const bits = []
  const pusha = (valor, quantos) => {
    for (let i = quantos - 1; i >= 0; i--) bits.push((valor >> i) & 1)
  }
  pusha(0b0100, 4)                                   // modo byte
  pusha(conteudo.length, versao >= 10 ? 16 : 8)
  for (const b of conteudo) pusha(b, 8)

  const totalDados = b1 * d1 + b2 * d2
  const cabem = totalDados * 8
  for (let i = 0; i < 4 && bits.length < cabem; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)
  const enchimento = [0xec, 0x11]
  for (let i = 0; bits.length < cabem; i++) pusha(enchimento[i % 2], 8)

  const bytes = new Uint8Array(totalDados)
  for (let i = 0; i < totalDados; i++) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j]
    bytes[i] = b
  }

  const blocos = []
  let pos = 0
  for (const [quantos, tamanho] of [[b1, d1], [b2, d2]]) {
    for (let i = 0; i < quantos; i++) {
      const dados = bytes.slice(pos, pos + tamanho)
      pos += tamanho
      blocos.push({ dados, correcao: correcao(dados, bytesCorrecao) })
    }
  }

  // Intercala: um borrão num canto tira um byte de cada bloco, não um bloco.
  const saida = []
  const maiorDado = Math.max(...blocos.map((b) => b.dados.length))
  for (let i = 0; i < maiorDado; i++) {
    for (const b of blocos) if (i < b.dados.length) saida.push(b.dados[i])
  }
  for (let i = 0; i < bytesCorrecao; i++) {
    for (const b of blocos) saida.push(b.correcao[i])
  }
  return saida
}

// ── Desenho da grade ─────────────────────────────────────────────────────────
function grade(versao) {
  const lado = versao * 4 + 17
  const cor = Array.from({ length: lado }, () => new Array(lado).fill(false))
  const fixo = Array.from({ length: lado }, () => new Array(lado).fill(false))
  const marcar = (l, c, valor) => { cor[l][c] = valor; fixo[l][c] = true }

  for (const [l0, c0] of [[0, 0], [0, lado - 7], [lado - 7, 0]]) {
    for (let l = -1; l <= 7; l++) {
      for (let c = -1; c <= 7; c++) {
        const L = l0 + l, C = c0 + c
        if (L < 0 || C < 0 || L >= lado || C >= lado) continue
        const borda = l === 0 || l === 6 || c === 0 || c === 6
        const miolo = l >= 2 && l <= 4 && c >= 2 && c <= 4
        marcar(L, C, (borda || miolo) && l >= 0 && l <= 6 && c >= 0 && c <= 6)
      }
    }
  }

  const posicoes = ALINHAMENTO[versao]
  for (const l0 of posicoes) {
    for (const c0 of posicoes) {
      const cantoDeOlhoGrande =
        (l0 === 6 && c0 === 6) ||
        (l0 === 6 && c0 === lado - 7) ||
        (l0 === lado - 7 && c0 === 6)
      if (cantoDeOlhoGrande) continue
      for (let l = -2; l <= 2; l++) {
        for (let c = -2; c <= 2; c++) {
          marcar(l0 + l, c0 + c, Math.max(Math.abs(l), Math.abs(c)) !== 1)
        }
      }
    }
  }

  for (let i = 8; i < lado - 8; i++) {
    marcar(6, i, i % 2 === 0)
    marcar(i, 6, i % 2 === 0)
  }

  marcar(lado - 8, 8, true)
  for (let i = 0; i < 9; i++) {
    if (!fixo[8][i]) marcar(8, i, false)
    if (!fixo[i][8]) marcar(i, 8, false)
  }
  for (let i = 0; i < 8; i++) {
    if (!fixo[8][lado - 1 - i]) marcar(8, lado - 1 - i, false)
    if (!fixo[lado - 1 - i][8]) marcar(lado - 1 - i, 8, false)
  }
  if (versao >= 7) {
    for (let i = 0; i < 18; i++) {
      const l = Math.floor(i / 3), c = i % 3
      if (!fixo[l][lado - 11 + c]) marcar(l, lado - 11 + c, false)
      if (!fixo[lado - 11 + c][l]) marcar(lado - 11 + c, l, false)
    }
  }
  return { cor, fixo, lado }
}

function escreverDados(cor, fixo, lado, bytes) {
  let bit = 0
  const proximo = () => {
    const i = bit >> 3
    const valor = i < bytes.length ? (bytes[i] >> (7 - (bit & 7))) & 1 : 0
    bit++
    return valor === 1
  }
  let subindo = true
  for (let c = lado - 1; c > 0; c -= 2) {
    if (c === 6) c--
    for (let n = 0; n < lado; n++) {
      const l = subindo ? lado - 1 - n : n
      for (const cc of [c, c - 1]) {
        if (!fixo[l][cc]) cor[l][cc] = proximo()
      }
    }
    subindo = !subindo
  }
}

const MASCARAS = [
  (l, c) => (l + c) % 2 === 0,
  (l) => l % 2 === 0,
  (_, c) => c % 3 === 0,
  (l, c) => (l + c) % 3 === 0,
  (l, c) => (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0,
  (l, c) => ((l * c) % 2) + ((l * c) % 3) === 0,
  (l, c) => (((l * c) % 2) + ((l * c) % 3)) % 2 === 0,
  (l, c) => (((l + c) % 2) + ((l * c) % 3)) % 2 === 0,
]

function penalidade(cor, lado) {
  let nota = 0
  const linha = (i) => cor[i]
  const coluna = (i) => cor.map((l) => l[i])

  for (const pegar of [linha, coluna]) {
    for (let i = 0; i < lado; i++) {
      const v = pegar(i)
      let corrida = 1
      for (let j = 1; j < lado; j++) {
        if (v[j] === v[j - 1]) corrida++
        else { if (corrida >= 5) nota += 3 + (corrida - 5); corrida = 1 }
      }
      if (corrida >= 5) nota += 3 + (corrida - 5)
    }
  }
  for (let l = 0; l < lado - 1; l++) {
    for (let c = 0; c < lado - 1; c++) {
      const a = cor[l][c]
      if (a === cor[l][c + 1] && a === cor[l + 1][c] && a === cor[l + 1][c + 1]) nota += 3
    }
  }
  const A = [true, false, true, true, true, false, true, false, false, false, false]
  const B = [false, false, false, false, true, false, true, true, true, false, true]
  const bate = (v, i, p) => p.every((x, k) => v[i + k] === x)
  for (const pegar of [linha, coluna]) {
    for (let i = 0; i < lado; i++) {
      const v = pegar(i)
      for (let j = 0; j + 11 <= lado; j++) {
        if (bate(v, j, A) || bate(v, j, B)) nota += 40
      }
    }
  }
  let escuras = 0
  for (const l of cor) for (const v of l) if (v) escuras++
  const porcento = (escuras * 100) / (lado * lado)
  nota += 10 * Math.floor(Math.abs(porcento - 50) / 5)
  return nota
}

function gravarFormato(cor, lado, mascara) {
  const bits = bitsDeFormato(mascara)
  const ler = (i) => ((bits >> i) & 1) === 1
  // ⚠️ LINHA E COLUNA SE PARECEM E NÃO SÃO A MESMA COISA — a primeira versão
  // do site escreveu isto transposto, e nenhum leitor abria (ver o cabeçalho).
  for (let i = 0; i <= 5; i++) cor[i][8] = ler(i)
  cor[7][8] = ler(6)
  cor[8][8] = ler(7)
  cor[8][7] = ler(8)
  for (let i = 9; i <= 14; i++) cor[8][14 - i] = ler(i)

  for (let i = 0; i <= 7; i++) cor[8][lado - 1 - i] = ler(i)
  for (let i = 8; i <= 14; i++) cor[lado - 15 + i][8] = ler(i)
  cor[lado - 8][8] = true
}

function gravarVersao(cor, lado, versao) {
  if (versao < 7) return
  const bits = bitsDeVersao(versao)
  for (let i = 0; i < 18; i++) {
    const valor = ((bits >> i) & 1) === 1
    const l = Math.floor(i / 3), c = i % 3
    cor[l][lado - 11 + c] = valor
    cor[lado - 11 + c][l] = valor
  }
}

/**
 * O QR de um texto, como matriz de verdadeiro (escuro) e falso (claro).
 * Não inclui a zona de silêncio em volta — quem desenha é que a deixa.
 */
export function matrizDoQr(texto) {
  const bytes = new TextEncoder().encode(texto).length
  const versao = versaoPara(bytes)
  const dados = bytesFinais(texto, versao)

  let melhor = null
  for (let m = 0; m < 8; m++) {
    const { cor, fixo, lado } = grade(versao)
    escreverDados(cor, fixo, lado, dados)
    for (let l = 0; l < lado; l++) {
      for (let c = 0; c < lado; c++) {
        if (!fixo[l][c] && MASCARAS[m](l, c)) cor[l][c] = !cor[l][c]
      }
    }
    gravarFormato(cor, lado, m)
    gravarVersao(cor, lado, versao)
    const nota = penalidade(cor, lado)
    if (melhor === null || nota < melhor.nota) melhor = { nota, cor }
  }
  return melhor.cor
}

// ═════════════════════════════════════════════════════════════════════════════
// DAQUI PARA BAIXO É DA CENTRAL (não existe no site).
// ═════════════════════════════════════════════════════════════════════════════

const escaparXml = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/**
 * O QR como SVG vetorial: UM `<path>`, sem retângulo de fundo (transparente),
 * `viewBox` em MÓDULOS (a zona de silêncio incluída) e `crispEdges`, para o
 * programa de arte não borrar a borda de cada quadradinho.
 *
 * Cada linha da matriz vira retângulos de corridas horizontais
 * (`M x y h n v1 h-n z`) — um por sequência de módulos escuros, não um por
 * módulo: o arquivo fica pequeno e o desenho é o mesmo.
 */
export function svgDoQr(texto, { cor = COR_DA_TINTA, modulosDeBorda = MODULOS_DE_BORDA } = {}) {
  const matriz = matrizDoQr(texto)
  const n = matriz.length
  const total = n + modulosDeBorda * 2
  let d = ''
  for (let l = 0; l < n; l++) {
    let c = 0
    while (c < n) {
      if (!matriz[l][c]) { c++; continue }
      let fim = c
      while (fim < n && matriz[l][fim]) fim++
      d += `M${c + modulosDeBorda} ${l + modulosDeBorda}h${fim - c}v1h-${fim - c}z`
      c = fim
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" `
    + `width="1024" height="1024" shape-rendering="crispEdges">`
    + `<title>${escaparXml(texto)}</title>`
    + `<path fill="${escaparXml(cor)}" d="${d}"/></svg>`
}

/** '#29211C' → [41, 33, 28]. Só aceita #rgb e #rrggbb. */
export function corEmRgb(hex) {
  const h = String(hex || '').replace('#', '')
  const cheio = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(cheio)) throw new Error(`cor inválida: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(cheio.slice(i, i + 2), 16))
}

/**
 * Os pixels RGBA de um QR num quadrado de `lado` px, com fundo TRANSPARENTE.
 *
 * ⚠️ O MÓDULO TEM NÚMERO INTEIRO DE PIXELS. 2048 não divide por 41 (o lado de
 * um QR versão 4 com a borda); módulo de 49,95 px borraria cada aresta. O
 * módulo é o maior inteiro que cabe, e a sobra vira margem transparente a
 * mais — a zona de silêncio só cresce, nunca encolhe.
 *
 * ⚠️ O CLARO É BRANCO COM ALFA 0, não preto com alfa 0: um programa que
 * ignore a transparência mostra fundo BRANCO (QR legível) em vez de preto
 * (QR escuro sobre escuro, ilegível).
 */
export function rasterDoQr(matriz, { lado = 2048, modulosDeBorda = MODULOS_DE_BORDA, cor = COR_DA_TINTA } = {}) {
  const n = matriz.length
  const total = n + modulosDeBorda * 2
  const modulo = Math.floor(lado / total)
  if (modulo < 1) throw new Error(`${lado} px não cabem ${total} módulos`)
  const deslocamento = Math.floor((lado - modulo * total) / 2) + modulosDeBorda * modulo
  const [r, g, b] = corEmRgb(cor)
  const dados = new Uint8Array(lado * lado * 4)
  for (let i = 0; i < lado * lado; i++) { dados[i * 4] = 255; dados[i * 4 + 1] = 255; dados[i * 4 + 2] = 255 }
  for (let l = 0; l < n; l++) {
    for (let c = 0; c < n; c++) {
      if (!matriz[l][c]) continue
      for (let y = 0; y < modulo; y++) {
        let p = ((deslocamento + l * modulo + y) * lado + deslocamento + c * modulo) * 4
        for (let x = 0; x < modulo; x++, p += 4) {
          dados[p] = r; dados[p + 1] = g; dados[p + 2] = b; dados[p + 3] = 255
        }
      }
    }
  }
  return { lado, modulo, deslocamento, dados }
}

// ── PNG sem biblioteca ───────────────────────────────────────────────────────
let TABELA_CRC = null
function crc32(bytes) {
  if (!TABELA_CRC) {
    TABELA_CRC = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      TABELA_CRC[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pedacoPng(tipo, dados) {
  const saida = new Uint8Array(12 + dados.length)
  const v = new DataView(saida.buffer)
  v.setUint32(0, dados.length)
  for (let i = 0; i < 4; i++) saida[4 + i] = tipo.charCodeAt(i)
  saida.set(dados, 8)
  v.setUint32(8 + dados.length, crc32(saida.subarray(4, 8 + dados.length)))
  return saida
}

/* `CompressionStream('deflate')` é o zlib (RFC 1950) — exatamente o que o
 * pedaço IDAT do PNG pede. Existe no navegador e no node ≥ 18, então o MESMO
 * código gera o arquivo baixado e o arquivo do teste. */
async function comprimir(bytes) {
  const fluxo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(fluxo).arrayBuffer())
}

/**
 * Os bytes do PNG transparente (RGBA 8 bits) de um QR.
 *
 * ⚠️ POR QUE NÃO `canvas.toBlob()`: o canvas guarda a cor multiplicada pelo
 * alfa, e o claro sairia PRETO com alfa 0 (o defeito descrito em
 * `rasterDoQr`). Montar o PNG à mão deixa cada byte sob controle, e deixa o
 * teste conferir o arquivo inteiro sem navegador.
 */
export async function pngDoQr(texto, opcoes = {}) {
  const { lado, dados } = rasterDoQr(matrizDoQr(texto), opcoes)
  const linha = lado * 4
  const cru = new Uint8Array((linha + 1) * lado)
  for (let y = 0; y < lado; y++) {
    cru[y * (linha + 1)] = 0           // filtro "nenhum"
    cru.set(dados.subarray(y * linha, (y + 1) * linha), y * (linha + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, lado); v.setUint32(4, lado)
  ihdr[8] = 8          // 8 bits por canal
  ihdr[9] = 6          // RGBA: é o canal alfa que deixa o fundo transparente
  const partes = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pedacoPng('IHDR', ihdr),
    pedacoPng('IDAT', await comprimir(cru)),
    pedacoPng('IEND', new Uint8Array(0)),
  ]
  const saida = new Uint8Array(partes.reduce((s, p) => s + p.length, 0))
  let pos = 0
  for (const p of partes) { saida.set(p, pos); pos += p.length }
  return saida
}

/**
 * O nome do arquivo pela regra do Growth Plan (módulo 09):
 *   VESSEL_[programa]_[praca]_[data]_[formato]_v01
 *
 *   VESSEL_beauty-session_CPS_2026-09-27_qr_v01.png
 *   VESSEL_private-edit_CPS_2026-10-10_qr_v01.svg
 *   VESSEL_stylist-circle_STY-0001_qr_v01.png   (stylist não tem data: vai o código)
 *
 * `formato` é a EXTENSÃO ('png' ou 'svg'); o "[formato]" do plano é sempre `qr`.
 *
 * ⚠️ `sequencia`: duas sessões no MESMO dia e na MESMA praça (BS-…-CPS-01 e
 * BS-…-CPS-02) dariam o MESMO nome, e o segundo download viraria "(1)" ou
 * sobrescreveria o primeiro — o QR errado iria para a gráfica. A sequência só
 * entra quando NÃO é a 01, colada à data: o caso comum fica igual ao plano.
 */
export function nomeDoArquivoDoQr({ programa, praca, data, codigo, sequencia, formato = 'png' } = {}) {
  const limpar = (s) => String(s || '').trim().replace(/[^A-Za-z0-9-]/g, '')
  const partes = ['VESSEL', limpar(programa)]
  if (praca) partes.push(limpar(praca).toUpperCase())
  if (data) {
    const seq = limpar(sequencia).toUpperCase()
    partes.push(seq && seq !== '01' ? `${limpar(data)}-${seq}` : limpar(data))
  } else if (codigo) {
    partes.push(limpar(codigo).toUpperCase())
  }
  partes.push('qr', 'v01')
  return `${partes.filter(Boolean).join('_')}.${limpar(formato).toLowerCase() || 'png'}`
}
