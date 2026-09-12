import test from 'node:test'
import assert from 'node:assert/strict'
import { casaComOSku, achatar, MINIMO_PARA_COMPARAR } from './casar-sku-do-bling.js'

test('acha a compra quando o codigo do item TRAZ o SKU e mais coisa', () => {
  // A forma REAL medida na API em 03/09/2026: o item vem com sufixo.
  assert.equal(casaComOSku('LV102-peça unica', 'LV102'), true)
  assert.equal(casaComOSku('SS1025-F', 'SS1025-F'), true)
  assert.equal(casaComOSku('SS1025-F-PRETO', 'SS1025-F'), true)
})

test('aguenta mascara, acento, espaco e caixa diferentes', () => {
  assert.equal(casaComOSku('ss 1025 f', 'SS1025-F'), true)
  assert.equal(casaComOSku('SS-1162-Ç', 'ss1162c'), true)
  assert.equal(achatar('peça única'), 'PECAUNICA')
})

test('o SKU do lote pode ser o mais CURTO dos dois', () => {
  // acontece quando o lote guarda a familia e o pedido guarda a variacao
  assert.equal(casaComOSku('H0015S', 'H0015'), true)
})

test('NAO casa produto diferente — que e o erro caro', () => {
  // dar a garantia de uma bolsa a quem comprou outra
  assert.equal(casaComOSku('SS1025-F', 'SS1162-P'), false)
  assert.equal(casaComOSku('LV102', 'H0015S'), false)
  assert.equal(casaComOSku('H0012S', 'H0015S'), false)
})

test('prefixo CURTO nao casa com meio catalogo', () => {
  // sem o minimo, `SS1` casaria com SS1025, SS1162 e todo produto que comece
  // com SS1 — a cliente levaria a garantia de outra bolsa
  assert.equal(MINIMO_PARA_COMPARAR, 4)
  assert.equal(casaComOSku('SS1025-F', 'SS1'), false)
  assert.equal(casaComOSku('SS1', 'SS1025-F'), false)
  assert.equal(casaComOSku('ABC', 'ABC'), false, 'tres caracteres iguais ainda e curto demais')
})

test('vazio, nulo e lixo nunca casam', () => {
  // pedido sem item, item sem codigo, lote sem SKU: nada disso pode virar "sim"
  for (const [a, b] of [[null, 'SS1025-F'], ['SS1025-F', null], ['', ''], [undefined, undefined],
                        ['---', 'SS1025-F'], ['SS1025-F', '   ']]) {
    assert.equal(casaComOSku(a, b), false, `${JSON.stringify(a)} x ${JSON.stringify(b)} casou`)
  }
})

test('a comparacao vale nos DOIS sentidos, e e a mesma resposta', () => {
  const pares = [['LV102-peça unica', 'LV102'], ['SS1025-F', 'SS1162-P'], ['H0015S', 'H0015']]
  for (const [a, b] of pares) {
    assert.equal(casaComOSku(a, b), casaComOSku(b, a), `${a} x ${b} respondeu diferente invertido`)
  }
})
