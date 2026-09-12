import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolverNovaOpcao, normalizarNome } from './nova-opcao.js'

test('nome vazio ou só espaço não cria, e diz o que fazer', () => {
  assert.equal(resolverNovaOpcao('', []).ok, false)
  assert.equal(resolverNovaOpcao('   ', []).ok, false)
  assert.equal(resolverNovaOpcao(undefined, []).ok, false)
  assert.match(resolverNovaOpcao('', []).mensagem, /nome/i)
})

test('nome inédito pode ser criado, já aparado', () => {
  const r = resolverNovaOpcao('  BMW  ', [{ id: '1', nome: 'Fiat' }])
  assert.equal(r.ok, true)
  assert.equal(r.jaExistia, false)
  assert.equal(r.nome, 'BMW')
})

test('nome repetido (mesma caixa) usa o que já existe', () => {
  const r = resolverNovaOpcao('Fiat', [{ id: '1', nome: 'Fiat' }])
  assert.equal(r.ok, true)
  assert.equal(r.jaExistia, true)
  assert.equal(r.item.id, '1')
})

test('nome repetido ignorando maiúsculas e espaços nas pontas', () => {
  // Caso real: "Fiat" e "FORD" já convivem com grafias diferentes na base.
  const lista = [{ id: '1', nome: 'Fiat' }, { id: '2', nome: 'FORD' }]
  assert.equal(resolverNovaOpcao('fiat', lista).jaExistia, true)
  assert.equal(resolverNovaOpcao('  FIAT  ', lista).item.id, '1')
  assert.equal(resolverNovaOpcao('ford', lista).item.id, '2')
  assert.equal(resolverNovaOpcao('  ford  ', lista).jaExistia, true)
})

test('lista vazia ou ausente nunca acha duplicata', () => {
  assert.equal(resolverNovaOpcao('BMW', []).jaExistia, false)
  assert.equal(resolverNovaOpcao('BMW', undefined).jaExistia, false)
  assert.equal(resolverNovaOpcao('BMW', null).jaExistia, false)
})

test('normalizarNome: caixa e espaço não importam', () => {
  assert.equal(normalizarNome('  Volvo '), 'volvo')
  assert.equal(normalizarNome('VOLVO'), 'volvo')
  assert.equal(normalizarNome(''), '')
  assert.equal(normalizarNome(undefined), '')
})
