// ESCREVE UM ARQUIVO .XLSX DE VERDADE, sem biblioteca nenhuma.
//
// POR QUE ISTO EXISTE: a casa exportava CSV. CSV é texto, e texto não carrega
// tipo — o Excel abre "00011001" como número e come os zeros da frente, decide
// sozinho que "19999071702" é notação científica, e em máquina configurada em
// português separa coluna por vírgula quando o arquivo usa ponto-e-vírgula. O
// dono resumiu em 07/09/2026: "o CSV está dando muito problema, se conseguir em
// arquivo para excel ou qualquer outro leitor de planilhas melhor".
//
// Um .xlsx é um ZIP com alguns XML dentro. Não há mágica aqui: monta-se o ZIP
// à mão, com os arquivos GUARDADOS (sem compressão), que é um modo legal do
// formato e dispensa implementar deflate. Abre no Excel, no Google Sheets, no
// Zoho Sheet e no Numbers.
//
// ⚠️ TEXTO É DECLARADO COMO TEXTO (`t="inlineStr"`). É isto que impede o Excel
// de comer o zero da frente de um número de série. Só entra como número a
// célula que for `typeof === 'number'` — e aí ela soma e ordena de verdade.

const CRC = (() => {
  // Tabela do CRC-32, que o ZIP exige em cada arquivo. Montada uma vez.
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const utf8 = (s) => new TextEncoder().encode(s)

// ESCAPAR PARA XML NÃO É ENFEITE: um "&" ou um "<" num nome de cliente
// ("Alves & Cia") quebra o arquivo inteiro, e o Excel se recusa a abrir
// dizendo apenas "conteúdo ilegível" — sem apontar onde.
function xml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // Caracteres de controle são proibidos no XML 1.0. Vêm de colagem de PDF e
    // de campo de banco antigo; passam despercebidos e estragam o arquivo.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/** A1, B1 … Z1, AA1 — o endereço da célula. */
export function enderecoDaCelula(coluna, linha) {
  let n = coluna + 1
  let letras = ''
  while (n > 0) {
    const resto = (n - 1) % 26
    letras = String.fromCharCode(65 + resto) + letras
    n = Math.floor((n - 1) / 26)
  }
  return letras + linha
}

function celula(valor, coluna, linha) {
  const ref = enderecoDaCelula(coluna, linha)
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return `<c r="${ref}"><v>${valor}</v></c>`
  }
  const texto = valor == null ? '' : String(valor)
  if (!texto) return `<c r="${ref}"/>`
  // `xml:space="preserve"` guarda o espaço do começo e do fim, que às vezes é
  // o que diferencia dois registros vindos de digitação.
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(texto)}</t></is></c>`
}

function folha(linhas, { congelarCabecalho = true } = {}) {
  const corpo = linhas.map((cols, i) =>
    `<row r="${i + 1}">${cols.map((v, c) => celula(v, c, i + 1)).join('')}</row>`).join('')
  // A LINHA DE TÍTULO FICA PRESA no topo: uma lista de 400 peças rolada até o
  // meio, sem cabeçalho à vista, é uma tabela de números sem nome.
  const painel = congelarCabecalho && linhas.length > 1
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2"'
      + ' activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : ''
  // Largura das colunas medida pelo conteúdo — sem isto tudo nasce com 8
  // caracteres e a pessoa abre o arquivo em "#####".
  const larguras = (linhas[0] || []).map((_, c) => {
    const maior = linhas.reduce((m, l) => Math.max(m, String(l[c] ?? '').length), 0)
    return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(10, maior + 3))}" customWidth="1"/>`
  }).join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + painel
    + (larguras ? `<cols>${larguras}</cols>` : '')
    + `<sheetData>${corpo}</sheetData></worksheet>`
}

/**
 * Monta o .xlsx.
 *
 * @param {Array<Array<string|number>>} linhas  a primeira é o cabeçalho
 * @param {object} opcoes  { nomeDaAba }
 * @returns {Uint8Array} os bytes do arquivo
 */
export function planilhaXlsx(linhas, { nomeDaAba = 'Planilha' } = {}) {
  const dados = Array.isArray(linhas) ? linhas : []
  // ⚠️ O NOME DA ABA TEM REGRAS DO EXCEL, e ele não avisa: no máximo 31
  // caracteres e nada de : \ / ? * [ ]. Nome inválido faz o arquivo abrir
  // vazio, sem erro.
  const aba = String(nomeDaAba).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Planilha'

  const arquivos = [
    ['[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>'],
    ['_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'],
    ['xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets><sheet name="${xml(aba)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '</Relationships>'],
    ['xl/worksheets/sheet1.xml', folha(dados)],
  ]

  return zipGuardado(arquivos.map(([nome, texto]) => [nome, utf8(texto)]))
}

// ── O ZIP ────────────────────────────────────────────────────────────────────
// Só o necessário: entradas GUARDADAS (método 0), sem descritor, sem Zip64.
// Uma planilha de peças não chega perto dos limites (65 535 arquivos, 4 GB).
//
// ⚠️ A DATA DENTRO DO ZIP É FIXA, e isso é decisão. Com a hora corrente, dois
// arquivos com o MESMO conteúdo saem com bytes diferentes — e o robô que
// espelha a lista compara o arquivo com o que ele deveria ser para decidir se
// regrava. Data variável faria ele regravar a cada rodada, para sempre.
const DATA_FIXA = 0x2c21 // 2002-01-01
const HORA_FIXA = 0x0000

function zipGuardado(arquivos) {
  const pedacos = []
  const entradas = []
  let deslocamento = 0

  for (const [nome, dados] of arquivos) {
    const nomeBytes = utf8(nome)
    const crc = crc32(dados)
    const cabecalho = new Uint8Array(30 + nomeBytes.length)
    const v = new DataView(cabecalho.buffer)
    v.setUint32(0, 0x04034b50, true)   // assinatura
    v.setUint16(4, 20, true)           // versão necessária
    v.setUint16(6, 0x0800, true)       // nomes em UTF-8
    v.setUint16(8, 0, true)            // método 0 = guardado
    v.setUint16(10, HORA_FIXA, true)
    v.setUint16(12, DATA_FIXA, true)
    v.setUint32(14, crc, true)
    v.setUint32(18, dados.length, true)
    v.setUint32(22, dados.length, true)
    v.setUint16(26, nomeBytes.length, true)
    cabecalho.set(nomeBytes, 30)
    pedacos.push(cabecalho, dados)
    entradas.push({ nomeBytes, crc, tamanho: dados.length, deslocamento })
    deslocamento += cabecalho.length + dados.length
  }

  const centrais = []
  let tamanhoCentral = 0
  for (const e of entradas) {
    const c = new Uint8Array(46 + e.nomeBytes.length)
    const v = new DataView(c.buffer)
    v.setUint32(0, 0x02014b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 20, true)
    v.setUint16(8, 0x0800, true)
    v.setUint16(10, 0, true)
    v.setUint16(12, HORA_FIXA, true)
    v.setUint16(14, DATA_FIXA, true)
    v.setUint32(16, e.crc, true)
    v.setUint32(20, e.tamanho, true)
    v.setUint32(24, e.tamanho, true)
    v.setUint16(28, e.nomeBytes.length, true)
    v.setUint32(42, e.deslocamento, true)
    c.set(e.nomeBytes, 46)
    centrais.push(c)
    tamanhoCentral += c.length
  }

  const fim = new Uint8Array(22)
  const vf = new DataView(fim.buffer)
  vf.setUint32(0, 0x06054b50, true)
  vf.setUint16(8, entradas.length, true)
  vf.setUint16(10, entradas.length, true)
  vf.setUint32(12, tamanhoCentral, true)
  vf.setUint32(16, deslocamento, true)

  const todos = [...pedacos, ...centrais, fim]
  const total = todos.reduce((s, p) => s + p.length, 0)
  const saida = new Uint8Array(total)
  let i = 0
  for (const p of todos) { saida.set(p, i); i += p.length }
  return saida
}
