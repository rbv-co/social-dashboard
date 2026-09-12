import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planoDeApagamento, planoDeGravacao, enderecoNaEtiqueta,
  PRIMEIRA_PAGINA, ULTIMA_PAGINA,
} from './ndef-para-ntag213.js'

// A memória como uma NTAG213 sai de fábrica: Lock Control + mensagem vazia.
const DE_FABRICA = [0x01, 0x03, 0xa0, 0x0c, 0x34, 0x03, 0x00, 0xfe]

// A memória de uma etiqueta JÁ GRAVADA, montada pelo próprio gravador — assim o
// teste não inventa bytes que a etiqueta real não teria.
function memoriaGravada(endereco) {
  const memoria = new Array((ULTIMA_PAGINA - PRIMEIRA_PAGINA + 1) * 4).fill(0)
  DE_FABRICA.forEach((b, i) => { memoria[i] = b })
  for (const { pagina, bytes } of planoDeGravacao(endereco, memoria)) {
    bytes.forEach((b, i) => { memoria[(pagina - PRIMEIRA_PAGINA) * 4 + i] = b })
  }
  return memoria
}

function aplicar(memoria, escritas) {
  const copia = memoria.slice()
  for (const { pagina, bytes } of escritas) {
    bytes.forEach((b, i) => { copia[(pagina - PRIMEIRA_PAGINA) * 4 + i] = b })
  }
  return copia
}

test('depois de apagar, a etiqueta nao devolve endereco nenhum', () => {
  const antes = memoriaGravada('https://vesselbrasil.com.br/verify/PX9FWMYJET')
  assert.equal(enderecoNaEtiqueta(antes), 'https://vesselbrasil.com.br/verify/PX9FWMYJET')

  const depois = aplicar(antes, planoDeApagamento(antes))
  assert.ok(!enderecoNaEtiqueta(depois), 'a etiqueta ainda devolve endereco depois de apagada')
})

test('⚠️ O LOCK CONTROL DA ETIQUETA E PRESERVADO', () => {
  const antes = memoriaGravada('https://vesselbrasil.com.br/verify/PX9FWMYJET')
  const depois = aplicar(antes, planoDeApagamento(antes))
  assert.deepEqual(depois.slice(0, 5), [0x01, 0x03, 0xa0, 0x0c, 0x34],
    'escrever por cima do Lock Control estraga a estrutura que a etiqueta espera ter')
})

test('o resultado e EXATAMENTE o estado de fabrica', () => {
  const antes = memoriaGravada('https://vesselbrasil.com.br/verify/PX9FWMYJET')
  const depois = aplicar(antes, planoDeApagamento(antes))
  assert.deepEqual(depois.slice(0, 8), DE_FABRICA,
    'apagar e restaurar o que o fabricante documenta, nao inventar estado novo')
})

test('⚠️ A MENSAGEM VAZIA E A PRIMEIRA ESCRITA — interrupcao deixa a etiqueta VALIDA', () => {
  const antes = memoriaGravada('https://vesselbrasil.com.br/verify/PX9FWMYJET')
  const escritas = planoDeApagamento(antes)

  // só a primeira escrita acontece, e a etiqueta sai do leitor
  const soAPrimeira = aplicar(antes, escritas.slice(0, 1))
  assert.ok(!enderecoNaEtiqueta(soAPrimeira),
    'limpar antes e escrever a mensagem por ultimo deixaria a etiqueta em meio-termo')
})

test('o codigo antigo nao fica legivel na memoria crua', () => {
  const antes = memoriaGravada('https://vesselbrasil.com.br/verify/PX9FWMYJET')
  const depois = aplicar(antes, planoDeApagamento(antes))
  const texto = String.fromCharCode(...depois.filter((b) => b >= 32 && b < 127))
  assert.ok(!texto.includes('PX9FWMYJET'), 'o codigo da bolsa anterior continua legivel na memoria')
})

test('nao escreve alem da pagina 39 — passar dali estraga a etiqueta de vez', () => {
  const escritas = planoDeApagamento(memoriaGravada('https://vesselbrasil.com.br/verify/AAA111'))
  const maior = Math.max(...escritas.map((e) => e.pagina))
  const menor = Math.min(...escritas.map((e) => e.pagina))
  assert.ok(maior <= ULTIMA_PAGINA, `escreveu na pagina ${maior}, e as travas e a senha moram acima da ${ULTIMA_PAGINA}`)
  assert.ok(menor >= PRIMEIRA_PAGINA, `escreveu na pagina ${menor}, abaixo da memoria do usuario`)
})

test('apagar uma etiqueta JA vazia nao estraga nada', () => {
  const memoria = new Array(144).fill(0)
  DE_FABRICA.forEach((b, i) => { memoria[i] = b })
  const depois = aplicar(memoria, planoDeApagamento(memoria))
  assert.deepEqual(depois.slice(0, 8), DE_FABRICA)
})

test('⚠️ A GRAVACAO CONTINUA RECUSANDO endereco vazio', () => {
  // a porta de apagar existir NAO pode ter afrouxado a porta de gravar
  for (const nada of ['', '   ', null, undefined]) {
    assert.throws(() => planoDeGravacao(nada, DE_FABRICA), /ficaria em branco/,
      'se a gravacao aceitar endereco vazio, qualquer caminho passa a poder apagar por acidente')
  }
})
