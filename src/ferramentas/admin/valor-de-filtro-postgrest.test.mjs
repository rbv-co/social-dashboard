import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paraEq } from './valor-de-filtro-postgrest.js'

// O que sai daqui entra numa URL, então a leitura dos testes é mais fácil
// decodificando: o que importa é o valor com aspas, não o %22.
const cru = (v) => decodeURIComponent(paraEq(v))

test('nome comum vai entre aspas', () => {
  assert.equal(cru('Vendedora'), '"Vendedora"')
})

test('virgula fica DENTRO do valor, nao separa a consulta', () => {
  // Sem as aspas o PostgREST leria a virgula como gramatica do filtro.
  assert.equal(cru('Vendedora, Iguatemi'), '"Vendedora, Iguatemi"')
})

test('ponto e parenteses tambem sao reservados e ficam protegidos', () => {
  assert.equal(cru('Trafego (pago).v2'), '"Trafego (pago).v2"')
})

test('aspas dentro do nome sao escapadas', () => {
  assert.equal(cru('Perfil "novo"'), '"Perfil \\"novo\\""')
})

test('a barra invertida e escapada ANTES das aspas, sem dobrar errado', () => {
  assert.equal(cru('a\\b'), '"a\\\\b"')
  assert.equal(cru('a\\"b'), '"a\\\\\\"b"')
})

test('a saida e segura para URL', () => {
  assert.equal(paraEq('a&b=c'), encodeURIComponent('"a&b=c"'))
  assert.ok(!paraEq('a&b').includes('&'), 'e comercial nao pode vazar pro query string')
})

test('nulo e vazio nao estouram', () => {
  assert.equal(cru(null), '""')
  assert.equal(cru(undefined), '""')
  assert.equal(cru(''), '""')
})
