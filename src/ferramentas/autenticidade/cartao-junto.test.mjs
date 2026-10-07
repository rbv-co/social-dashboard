import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { unzipSync } from 'fflate'
import { pdfComDuasPaginas, zipDosArquivos } from './cartao-junto.js'

// Um PDF de uma página com o tamanho do cartão (86,6 × 54,98 mm em pontos), como o robô entrega.
async function pdfDeUmaPagina(largura, altura) {
  const d = await PDFDocument.create()
  d.addPage([largura, altura])
  return d.save()
}

test('frente e verso viram UM pdf de DUAS páginas, na ordem, cada uma do seu tamanho', async () => {
  const frente = await pdfDeUmaPagina(245.5, 155.9)
  const verso = await pdfDeUmaPagina(300, 200)
  const junto = await PDFDocument.load(await pdfComDuasPaginas(frente, verso))
  assert.equal(junto.getPageCount(), 2, 'duas páginas separadas, e não uma com as duas faces')
  const [p1, p2] = junto.getPages().map((p) => p.getSize())
  assert.deepEqual([Math.round(p1.width), Math.round(p1.height)], [246, 156], 'a 1ª é a frente')
  assert.deepEqual([Math.round(p2.width), Math.round(p2.height)], [300, 200], 'a 2ª é o verso')
})

test('arquivo que não é PDF não vira PDF calado', async () => {
  const frente = await pdfDeUmaPagina(100, 100)
  await assert.rejects(() => pdfComDuasPaginas(frente, new Uint8Array([1, 2, 3])))
})

test('o zip leva os dois arquivos, com os nomes e os bytes intactos', async () => {
  const a = new Uint8Array([137, 80, 78, 71, 1])
  const b = new Uint8Array([137, 80, 78, 71, 2])
  const zip = await zipDosArquivos({ 'SS0001HB.S1_cartao_04_frente.png': a, 'SS0001HB.S1_cartao_04_verso.png': b })
  const aberto = unzipSync(zip)
  assert.deepEqual(Object.keys(aberto).sort(), ['SS0001HB.S1_cartao_04_frente.png', 'SS0001HB.S1_cartao_04_verso.png'])
  assert.deepEqual([...aberto['SS0001HB.S1_cartao_04_frente.png']], [...a])
  assert.deepEqual([...aberto['SS0001HB.S1_cartao_04_verso.png']], [...b])
})
