// Junta a FRENTE e o VERSO de um cartão num download só. Roda no navegador, sobre os arquivos que a edge
// `vessel-baixar-cartao` já devolveu — nada aqui fala com o Zoho.
//
// ⚠️ O PDF JUNTO TEM DUAS PÁGINAS SEPARADAS (frente na 1, verso na 2), e não uma página com as duas faces lado a lado:
// é assim que a gráfica imprime frente e verso. As páginas são COPIADAS como o robô as gerou — nada é redesenhado.
// As bibliotecas entram só na hora de usar (`import()`): quem nunca baixa os dois juntos não paga o peso delas.

/** `frente` e `verso` são os bytes (Uint8Array/ArrayBuffer) de dois PDFs. Devolve os bytes do PDF único. */
export async function pdfComDuasPaginas(frente, verso) {
  const { PDFDocument } = await import('pdf-lib')
  const saida = await PDFDocument.create()
  for (const bytes of [frente, verso]) {
    const origem = await PDFDocument.load(bytes)
    for (const pagina of await saida.copyPages(origem, origem.getPageIndices())) saida.addPage(pagina)
  }
  return saida.save()
}

/** `arquivos` = { 'nome.png': Uint8Array, … }. PNG já vem comprimido: guardar sem comprimir de novo é mais rápido e igual em tamanho. */
export async function zipDosArquivos(arquivos) {
  const { zipSync } = await import('fflate')
  return zipSync(arquivos, { level: 0 })
}
