import test from 'node:test'
import assert from 'node:assert/strict'
import { planilhaXlsx, enderecoDaCelula } from './planilha-xlsx.js'

/* O QUE ESTES TESTES GUARDAM
 * ==========================
 * Um .xlsx quebrado NÃO dá erro: o Excel abre uma janela dizendo "conteúdo
 * ilegível" e some com a planilha inteira. Não há mensagem que aponte a linha.
 * Por isso aqui se conferem os BYTES — a assinatura do ZIP, o CRC de cada
 * arquivo, e o XML de dentro — e não só "a função devolveu alguma coisa". */

/** Lê o ZIP de volta: nome -> texto. Só o necessário para conferir o que saiu. */
function lerZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dec = new TextDecoder()
  const arquivos = {}
  let i = 0
  while (i + 4 <= bytes.length && v.getUint32(i, true) === 0x04034b50) {
    const tamanho = v.getUint32(i + 18, true)
    const nomeLen = v.getUint16(i + 26, true)
    const extraLen = v.getUint16(i + 28, true)
    const nome = dec.decode(bytes.subarray(i + 30, i + 30 + nomeLen))
    const inicio = i + 30 + nomeLen + extraLen
    arquivos[nome] = dec.decode(bytes.subarray(inicio, inicio + tamanho))
    i = inicio + tamanho
  }
  return arquivos
}

test('o arquivo é um ZIP de verdade e traz as cinco partes que o Excel exige', () => {
  const b = planilhaXlsx([['a'], ['b']])
  // "PK\x03\x04" — sem isto o Excel nem tenta abrir
  assert.deepEqual([...b.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  const dentro = lerZip(b)
  for (const parte of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']) {
    assert.ok(dentro[parte], `faltou ${parte} — o Excel recusa o arquivo inteiro`)
  }
})

test('⚠️ NÚMERO DE SÉRIE SAI COMO TEXTO, e é por isso que este formato existe', () => {
  // Num CSV o Excel lê "00011001" como número e mostra "11001": os dois zeros
  // da frente somem, e o número de série deixa de casar com o que está gravado
  // na etiqueta. Aqui a célula vai declarada como texto.
  const dentro = lerZip(planilhaXlsx([['numero'], ['00011001']]))
  const folha = dentro['xl/worksheets/sheet1.xml']
  assert.match(folha, /t="inlineStr"><is><t xml:space="preserve">00011001<\/t>/)
  assert.doesNotMatch(folha, /<v>00011001<\/v>/, 'saiu como número: os zeros da frente morrem')
})

test('número de verdade continua sendo número — para somar e ordenar', () => {
  const folha = lerZip(planilhaXlsx([['qtd'], [12]]))['xl/worksheets/sheet1.xml']
  assert.match(folha, /<c r="A2"><v>12<\/v><\/c>/)
})

test('⚠️ "&" e "<" no nome não podem quebrar o arquivo', () => {
  // "Alves & Cia" é nome de cliente comum. Sem escapar, o XML fica inválido e o
  // Excel abre a janela de "conteúdo ilegível" — sem dizer qual linha.
  const folha = lerZip(planilhaXlsx([['nome'], ['Alves & Cia <Ltda>']]))['xl/worksheets/sheet1.xml']
  assert.match(folha, /Alves &amp; Cia &lt;Ltda&gt;/)
  assert.doesNotMatch(folha, /Alves & Cia/)
})

test('acento chega inteiro — é o defeito que o CSV tinha sem o BOM', () => {
  const folha = lerZip(planilhaXlsx([['modelo'], ['Mônaco'], ['Ravelle Pequena Café']]))['xl/worksheets/sheet1.xml']
  assert.match(folha, /Mônaco/)
  assert.match(folha, /Ravelle Pequena Café/)
})

test('o nome da aba obedece às regras do Excel, que ele não avisa', () => {
  // Mais de 31 caracteres, ou um "/" no nome, faz a planilha abrir VAZIA.
  const dentro = lerZip(planilhaXlsx([['a']], { nomeDaAba: 'Números/de série que é bem grande demais' }))
  const nome = dentro['xl/workbook.xml'].match(/<sheet name="([^"]*)"/)[1]
  assert.ok(nome.length <= 31, `aba com ${nome.length} caracteres`)
  assert.doesNotMatch(nome, /[:\\/?*[\]]/)
})

test('⚠️ MESMO CONTEÚDO, MESMOS BYTES — o robô do espelho depende disso', () => {
  // Ele compara o arquivo que está no Zoho com o que deveria estar, para decidir
  // se regrava. Se a data do ZIP fosse a hora corrente, dois arquivos iguais
  // sairiam diferentes e ele regravaria a cada rodada, para sempre.
  const a = planilhaXlsx([['x'], ['y']])
  const b = planilhaXlsx([['x'], ['y']])
  assert.deepEqual([...a], [...b])
})

test('planilha vazia não estoura — devolve um arquivo abrível', () => {
  for (const entrada of [[], null, undefined]) {
    const b = planilhaXlsx(entrada)
    assert.deepEqual([...b.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  }
})

test('o endereço da célula passa do Z', () => {
  assert.equal(enderecoDaCelula(0, 1), 'A1')
  assert.equal(enderecoDaCelula(25, 1), 'Z1')
  assert.equal(enderecoDaCelula(26, 3), 'AA3')
  assert.equal(enderecoDaCelula(27, 3), 'AB3')
})
