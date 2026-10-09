import test from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDoCartao, nomeDoArquivo, diasEmOrdem, pastaDoSku, ehPastaDosCartoes, diaDaPasta, diasComDicaPrimeiro } from './cartao-no-zoho.js'

// Nomes REAIS conferidos no Zoho em 07/10/2026 (Cartões com EAN/2026-10-06/…).
test('o nome do arquivo é o que o robô entregou', () => {
  assert.equal(nomeDoArquivo('SS0001HB.S1', 4, 'frente', 'png'), 'SS0001HB.S1_cartao_04_frente.png')
  assert.equal(nomeDoArquivo('SS0003SB.B2', 10, 'verso', 'pdf'), 'SS0003SB.B2_cartao_10_verso.pdf')
  assert.equal(rotuloDoCartao('SS0002HB.B2', 2), 'SS0002HB.B2_cartao_02')
})

test('face, formato ou peça sem sentido não viram nome de arquivo', () => {
  assert.equal(nomeDoArquivo('SS0001HB.S1', 4, 'lado', 'png'), null)
  assert.equal(nomeDoArquivo('SS0001HB.S1', 4, 'frente', 'exe'), null)
  assert.equal(nomeDoArquivo('SS0001HB.S1', 0, 'frente', 'png'), null)
  assert.equal(nomeDoArquivo('SS0001HB.S1', 'x', 'frente', 'png'), null)
  assert.equal(nomeDoArquivo('', 4, 'frente', 'png'), null)
  // O que vem do pedido NUNCA entra no caminho: ../ não passa, porque face/formato só aceitam a lista fechada.
  assert.equal(nomeDoArquivo('SS0001HB.S1', 4, '../../x', 'png'), null)
})

test('só pasta de dia vale, e a mais nova vem primeiro', () => {
  const dias = diasEmOrdem([
    { id: 'a', name: '2026-09-07' }, { id: 'b', name: '2026-10-07' }, { id: 'c', name: '2026-10-06' },
    { id: 'd', name: 'Cartões com EAN - BKP 07-09-2026' },
  ])
  assert.deepEqual(dias.map((d) => d.id), ['b', 'c', 'a'])
  assert.deepEqual(diasEmOrdem(null), [])
})

test('a pasta do SKU é achada pelo prefixo "SKU - ", sem confundir SKUs parecidos', () => {
  const sub = [
    { id: '1', name: 'SS0001HB.S1 - Linear Caramelo Pequena' },
    { id: '2', name: 'SS0001HB.S10 - Outra' },
    { id: '3', name: 'SS0001HB.M2 - Linear Vermelha Média'.normalize('NFD') },
  ]
  assert.equal(pastaDoSku(sub, 'SS0001HB.S1').id, '1')
  assert.equal(pastaDoSku(sub, 'SS0001HB.M2').id, '3', 'acento solto não pode esconder a pasta')
  assert.equal(pastaDoSku(sub, 'SS9999XX.Z9'), null)
  assert.equal(pastaDoSku([], 'SS0001HB.S1'), null)
})

test('"Cartões com EAN" é achada com ou sem acento solto, e a cópia de segurança não conta', () => {
  assert.equal(ehPastaDosCartoes('Cartões com EAN'), true)
  assert.equal(ehPastaDosCartoes('Cartões com EAN'.normalize('NFD')), true)
  assert.equal(ehPastaDosCartoes('Cartões com EAN - BKP 06-09-2026'), false)
})

test('o dia do pedido vira dica; o que não é um dia não vira dica', () => {
  assert.equal(diaDaPasta('Cartões com EAN/2026-10-09'), '2026-10-09')
  assert.equal(diaDaPasta(' Cartões com EAN/2026-10-09 '), '2026-10-09')
  assert.equal(diaDaPasta('Cartões com EAN/2026-10-09 - BKP'), null)
  assert.equal(diaDaPasta('Cartões com EAN'), null)
  assert.equal(diaDaPasta(null), null)
  assert.equal(diaDaPasta(''), null)
})

test('o dia-dica vai para a frente e os outros seguem na ordem de antes', () => {
  const dias = [{ name: '2026-10-09' }, { name: '2026-10-07' }, { name: '2026-10-06' }]
  assert.deepEqual(diasComDicaPrimeiro(dias, '2026-10-06').map((d) => d.name), ['2026-10-06', '2026-10-09', '2026-10-07'])
  assert.deepEqual(diasComDicaPrimeiro(dias, '2026-10-09').map((d) => d.name), ['2026-10-09', '2026-10-07', '2026-10-06'])
  // Dica de um dia que não existe na lista, ou sem dica: a lista como veio (nada some).
  assert.deepEqual(diasComDicaPrimeiro(dias, '2026-01-01').map((d) => d.name), ['2026-10-09', '2026-10-07', '2026-10-06'])
  assert.deepEqual(diasComDicaPrimeiro(dias, null), dias)
})
