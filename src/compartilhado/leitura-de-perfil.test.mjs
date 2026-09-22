import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerPerfil, precisaPerguntarSeDesativou } from './leitura-de-perfil.js'

test('perfil normal é lido como sempre', () => {
  const r = lerPerfil([{ role: 'admin', features: ['frota'] }], false)
  assert.equal(r.tipo, 'perfil')
  assert.equal(r.perfil.role, 'admin')
})

test('lista vazia com conta DESATIVADA é outra coisa que "sem perfil"', () => {
  // É o caso que a 054 criou: quem está desativado não lê nem o próprio perfil.
  assert.equal(lerPerfil([], true).tipo, 'desativada')
})

test('lista vazia SEM desativação continua sendo "sem perfil"', () => {
  // Gabriel Alves e Marcio Franco, medidos em 21/09/2026: entram sem linha em
  // `profiles` e recebem o Banco de Arquivos. Nada muda para eles.
  assert.equal(lerPerfil([], false).tipo, 'sem-perfil')
  assert.equal(lerPerfil(null, false).tipo, 'sem-perfil')
  assert.equal(lerPerfil(undefined).tipo, 'sem-perfil')
})

test('perfil encontrado vence, mesmo se a pergunta voltar estranha', () => {
  // Defesa: se um dia a função do banco responder true com perfil na mão, o
  // perfil é o dado mais forte — ele só chega a quem pode lê-lo.
  assert.equal(lerPerfil([{ role: 'viewer' }], true).tipo, 'perfil')
})

test('só se pergunta ao banco quando veio vazio', () => {
  // A pergunta é uma ida a mais na rede: não se faz em toda entrada.
  assert.equal(precisaPerguntarSeDesativou([{ role: 'viewer' }]), false)
  assert.equal(precisaPerguntarSeDesativou([]), true)
  assert.equal(precisaPerguntarSeDesativou(null), true)
})
