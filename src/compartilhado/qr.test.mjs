import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import {
  BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource, DecodeHintType,
} from '@zxing/library'
import {
  matrizDoQr, capacidade, versaoPara, bitsDeFormato, bitsDeVersao,
  svgDoQr, rasterDoQr, pngDoQr, nomeDoArquivoDoQr, corEmRgb, COR_DA_TINTA,
} from './qr.js'

/* ⚠️ O QUE ESTE ARQUIVO PROVA
 *
 * As contas (os mesmos testes do `qr.test.mjs` do site, de onde o codificador
 * veio) E — o que as contas não provam — que um LEITOR DE VERDADE abre o QR:
 * cada link é desenhado em pixels por `rasterDoQr` (a mesma rotina do PNG
 * baixado) e decodificado pelo `@zxing/library`, que é código de outra gente,
 * sem nada em comum com o nosso. O texto lido tem de ser IGUAL ao link.
 *
 * Regra do site: "teste de conta não prova que a câmera lê". O primeiro QR do
 * site passava em todas as contas e nenhum leitor abria. */

// ── as contas (portadas do site) ─────────────────────────────────────────────
test('os bits de formato batem com a tabela da norma', () => {
  const norma = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]
  norma.forEach((esperado, mascara) => assert.equal(bitsDeFormato(mascara), esperado, `máscara ${mascara}`))
})

test('os bits de versão batem com a tabela da norma', () => {
  for (const [versao, esperado] of Object.entries({ 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 })) {
    assert.equal(bitsDeVersao(Number(versao)), esperado, `versão ${versao}`)
  }
})

test('as capacidades batem com a norma (correção M, modo byte)', () => {
  const norma = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 }
  for (const [v, esperado] of Object.entries(norma)) assert.equal(capacidade(Number(v)), esperado, `versão ${v}`)
})

test('escolhe a MENOR versão, e recusa (não trunca) o que não cabe na 10', () => {
  assert.equal(versaoPara(14), 1)
  assert.equal(versaoPara(15), 2)
  assert.equal(versaoPara(107), 7)
  assert.doesNotThrow(() => versaoPara(213))
  assert.throws(() => versaoPara(214), /grande demais/)
})

test('a grade tem os três olhos nos cantos e a casa sempre escura', () => {
  const g = matrizDoQr('https://vesselbrasil.com.br/bs/BS-20260925-CPS-01')
  const lado = g.length
  assert.equal((lado - 17) % 4, 0)
  for (const [l0, c0] of [[0, 0], [0, lado - 7], [lado - 7, 0]]) {
    for (let i = 0; i < 7; i++) {
      assert.equal(g[l0][c0 + i], true); assert.equal(g[l0 + 6][c0 + i], true)
      assert.equal(g[l0 + i][c0], true); assert.equal(g[l0 + i][c0 + 6], true)
    }
    assert.equal(g[l0 + 1][c0 + 1], false)
    assert.equal(g[l0 + 3][c0 + 3], true)
  }
  assert.equal(g[lado - 8][8], true)
})

test('⚠️ O DESENHO É O MESMO DO SITE — a impressão digital que o site congelou', () => {
  /* O site grava esta digital (qr.test.mjs de lá) para este endereço, DEPOIS
   * de o leitor do macOS ler o QR de volta. Bater aqui prova que a cópia é
   * byte a byte o mesmo codificador. Se cair, a cópia divergiu do site: não
   * atualize o número de cabeça — descubra o que mudou. */
  const g = matrizDoQr('https://vesselbrasil.com.br/c/cps/03/K7M4X9')
  const digital = createHash('sha256')
    .update(g.map((l) => l.map((v) => (v ? '1' : '0')).join('')).join('\n'))
    .digest('hex').slice(0, 16)
  assert.equal(digital, 'c60cdf535ee29fde')
})

// ── A PROVA DE LEITURA ───────────────────────────────────────────────────────
/** Pixels RGBA (com alfa) → luminância sobre PAPEL BRANCO, como sai impresso. */
function luminanciaSobreBranco({ lado, dados }) {
  const lum = new Uint8ClampedArray(lado * lado)
  for (let i = 0; i < lado * lado; i++) {
    const a = dados[i * 4 + 3] / 255
    const r = dados[i * 4] * a + 255 * (1 - a)
    const g = dados[i * 4 + 1] * a + 255 * (1 - a)
    const b = dados[i * 4 + 2] * a + 255 * (1 - a)
    lum[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }
  return lum
}

function lerComZxing(raster) {
  const fonte = new RGBLuminanceSource(luminanciaSobreBranco(raster), raster.lado, raster.lado)
  const dicas = new Map([[DecodeHintType.TRY_HARDER, true]])
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(fonte)), dicas).getText()
}

// Os três tipos de link do Material Gráfico, o maior possível de cada um, e o
// do cartão antigo da Beauty (130+ caracteres, versão 7: cobre os bits de versão).
const LINKS = {
  'beauty session (mesa)': 'https://vesselbrasil.com.br/bs/BS-20260925-CPS-01',
  'beauty session com apelido': 'https://vesselbrasil.com.br/bs/BS-20261016-CPS-AME',
  'private edit (chave de 8 letras)': 'https://vesselbrasil.com.br/pe/K7Q2M9TX',
  'private edit, o alfabeto inteiro da chave': 'https://vesselbrasil.com.br/pe/ZZZZ9999',
  'stylist circle': 'https://vesselbrasil.com.br/s/STY-0001',
  'versão 7 (link comprido)': 'https://vesselbrasil.com.br/private-appointment/?canal=beauty_session&event_id=BS-20260925-CPS-01&utm_source=beauty_session&utm_medium=offline_qr&utm_campaign=bs_20260925_cps_01',
}

for (const [nome, link] of Object.entries(LINKS)) {
  test(`⚠️ o leitor zxing LÊ DE VOLTA o QR — ${nome}`, () => {
    const raster = rasterDoQr(matrizDoQr(link), { lado: 480 })
    assert.equal(lerComZxing(raster), link)
  })
}

test('⚠️ e lê o QR no tamanho que é baixado (2048 px), não só no pequeno', () => {
  const link = LINKS['private edit (chave de 8 letras)']
  assert.equal(lerComZxing(rasterDoQr(matrizDoQr(link), { lado: 2048 })), link)
})

test('⚠️ a prova de leitura REPROVA um QR estragado (senão ela não guarda nada)', () => {
  const link = LINKS['stylist circle']
  const m = matrizDoQr(link).map((l) => l.slice())
  // Apaga um terço da grade: além do que a correção M (~15%) recupera.
  for (let l = 0; l < m.length; l++) for (let c = 0; c < Math.floor(m.length / 3); c++) m[l][c + 9] = false
  assert.throws(() => lerComZxing(rasterDoQr(m, { lado: 480 })))
})

// ── o raster e o PNG ─────────────────────────────────────────────────────────
test('o raster tem módulo INTEIRO e zona de silêncio de pelo menos 4 módulos', () => {
  const m = matrizDoQr(LINKS['beauty session (mesa)'])
  const r = rasterDoQr(m, { lado: 2048 })
  assert.equal(r.modulo, Math.floor(2048 / (m.length + 8)))
  assert.ok(r.deslocamento >= 4 * r.modulo)
  assert.ok(2048 - (r.deslocamento + m.length * r.modulo) >= 4 * r.modulo, 'a borda de baixo/direita encolheu')
})

test('⚠️ o claro é TRANSPARENTE (alfa 0) e BRANCO por baixo; o escuro é a tinta, opaca', () => {
  const m = matrizDoQr(LINKS['stylist circle'])
  const r = rasterDoQr(m, { lado: 400 })
  const px = (x, y) => Array.from(r.dados.subarray((y * r.lado + x) * 4, (y * r.lado + x) * 4 + 4))
  assert.deepEqual(px(0, 0), [255, 255, 255, 0], 'o canto (zona de silêncio) tem de ser transparente')
  const meio = r.deslocamento + Math.floor(r.modulo / 2)       // o miolo do olho de cima
  assert.deepEqual(px(meio, meio), [...corEmRgb(COR_DA_TINTA), 255])
})

/** Lê um PNG RGBA 8 bits sem filtro (o que `pngDoQr` escreve). */
function lerPng(bytes) {
  const b = Buffer.from(bytes)
  assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'assinatura de PNG')
  let pos = 8
  let ihdr = null
  const idat = []
  while (pos < b.length) {
    const tam = b.readUInt32BE(pos)
    const tipo = b.toString('ascii', pos + 4, pos + 8)
    const dados = b.subarray(pos + 8, pos + 8 + tam)
    if (tipo === 'IHDR') ihdr = dados
    if (tipo === 'IDAT') idat.push(dados)
    pos += 12 + tam
  }
  const lado = ihdr.readUInt32BE(0)
  const cru = inflateSync(Buffer.concat(idat))
  const dados = new Uint8Array(lado * lado * 4)
  for (let y = 0; y < lado; y++) {
    assert.equal(cru[y * (lado * 4 + 1)], 0, 'filtro de linha')
    dados.set(cru.subarray(y * (lado * 4 + 1) + 1, (y + 1) * (lado * 4 + 1)), y * lado * 4)
  }
  return { lado, altura: ihdr.readUInt32BE(4), profundidade: ihdr[8], tipoDeCor: ihdr[9], dados }
}

test('⚠️ o PNG baixado é RGBA 2048×2048, abre, tem fundo transparente e o zxing o lê', async () => {
  const link = LINKS['beauty session (mesa)']
  const png = lerPng(await pngDoQr(link))
  assert.equal(png.lado, 2048); assert.equal(png.altura, 2048)
  assert.equal(png.profundidade, 8)
  assert.equal(png.tipoDeCor, 6, 'tipo 6 = RGBA, o único com canal alfa em cor')
  assert.equal(png.dados[3], 0, 'o canto tem de ser transparente')
  assert.equal(lerComZxing(png), link)
})

// ── o SVG ────────────────────────────────────────────────────────────────────
/** Refaz a matriz a partir do `<path>` do SVG: prova que o desenho vetorial é o QR. */
function matrizDoSvg(svg, borda = 4) {
  const total = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)[1])
  const n = total - borda * 2
  const m = Array.from({ length: n }, () => new Array(n).fill(false))
  const d = /<path[^>]* d="([^"]*)"/.exec(svg)[1]
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let i = 0; i < Number(w); i++) m[Number(y) - borda][Number(x) - borda + i] = true
  }
  return m
}

test('⚠️ o SVG é UM path, sem fundo, viewBox em módulos, crispEdges, na tinta da marca', () => {
  const link = LINKS['private edit (chave de 8 letras)']
  const svg = svgDoQr(link)
  const n = matrizDoQr(link).length
  assert.match(svg, new RegExp(`viewBox="0 0 ${n + 8} ${n + 8}"`))
  assert.equal((svg.match(/<path/g) || []).length, 1, 'um path só')
  assert.doesNotMatch(svg, /<rect/, 'retângulo de fundo tiraria a transparência')
  assert.match(svg, /shape-rendering="crispEdges"/)
  assert.match(svg, /fill="#29211C"/)
})

test('⚠️ o desenho do SVG é EXATAMENTE a matriz — e o zxing lê o SVG redesenhado', () => {
  for (const link of Object.values(LINKS)) {
    const doSvg = matrizDoSvg(svgDoQr(link))
    assert.deepEqual(doSvg, matrizDoQr(link), link)
    assert.equal(lerComZxing(rasterDoQr(doSvg, { lado: 480 })), link)
  }
})

test('o SVG escapa o & do link (senão o arquivo nem abre)', () => {
  const svg = svgDoQr('https://x.test/?a=1&b=2')
  assert.match(svg, /<title>https:\/\/x\.test\/\?a=1&amp;b=2<\/title>/)
})

// ── o nome do arquivo ────────────────────────────────────────────────────────
test('o nome do arquivo segue a regra do plano (módulo 09)', () => {
  assert.equal(nomeDoArquivoDoQr({ programa: 'beauty-session', praca: 'CPS', data: '2026-09-27', formato: 'png' }),
    'VESSEL_beauty-session_CPS_2026-09-27_qr_v01.png')
  assert.equal(nomeDoArquivoDoQr({ programa: 'beauty-session', praca: 'CPS', data: '2026-09-27', formato: 'svg' }),
    'VESSEL_beauty-session_CPS_2026-09-27_qr_v01.svg')
  assert.equal(nomeDoArquivoDoQr({ programa: 'private-edit', praca: 'cps', data: '2026-10-10', formato: 'png' }),
    'VESSEL_private-edit_CPS_2026-10-10_qr_v01.png')
  assert.equal(nomeDoArquivoDoQr({ programa: 'stylist-circle', codigo: 'STY-0001', formato: 'png' }),
    'VESSEL_stylist-circle_STY-0001_qr_v01.png')
})

test('⚠️ duas sessões no mesmo dia e praça NÃO dão o mesmo nome', () => {
  const um = nomeDoArquivoDoQr({ programa: 'beauty-session', praca: 'CPS', data: '2026-09-25', sequencia: '01' })
  const dois = nomeDoArquivoDoQr({ programa: 'beauty-session', praca: 'CPS', data: '2026-09-25', sequencia: '02' })
  assert.equal(um, 'VESSEL_beauty-session_CPS_2026-09-25_qr_v01.png')
  assert.equal(dois, 'VESSEL_beauty-session_CPS_2026-09-25-02_qr_v01.png')
  assert.notEqual(um, dois)
})

test('o nome não aceita barra nem espaço (não vira pasta nem nome quebrado)', () => {
  assert.equal(nomeDoArquivoDoQr({ programa: 'stylist circle', codigo: '../STY-0001', formato: 'svg' }),
    'VESSEL_stylistcircle_STY-0001_qr_v01.svg')
})
