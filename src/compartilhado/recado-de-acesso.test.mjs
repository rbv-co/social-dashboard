import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recadoDeAcesso, ENDERECO_DA_CENTRAL } from './recado-de-acesso.js'

test('a mensagem traz as três coisas que a pessoa precisa', () => {
  // O que se copiava antes era a senha sozinha: quem recebia não sabia onde
  // usar, e o resto do recado ia digitado à mão toda vez.
  const r = recadoDeAcesso({ email: 'fulano@rbvcompany.com', senha: '7yQm-4vTn-2Kd' })
  assert.match(r, /central\.rbvcompany\.com/)
  assert.match(r, /fulano@rbvcompany\.com/)
  assert.match(r, /7yQm-4vTn-2Kd/)
  assert.match(r, /trocar a senha/)
})

test('sem senha, o recado é o do convite por e-mail — e não promete senha nenhuma', () => {
  // Conta criada sem senha recebe link por e-mail. Escrever "Senha:" vazio
  // faria a pessoa procurar uma senha que não existe.
  const r = recadoDeAcesso({ email: 'fulano@rbvcompany.com' })
  assert.doesNotMatch(r, /Senha:/)
  assert.match(r, /link/)
  assert.match(r, /fulano@rbvcompany\.com/)
})

test('espaço sobrando no e-mail ou na senha não vai junto', () => {
  // Senha copiada de um campo costuma vir com espaço na ponta, e espaço colado
  // numa senha é login que não entra — sem nenhuma pista do porquê.
  const r = recadoDeAcesso({ email: '  fulano@rbvcompany.com ', senha: ' abc123 ' })
  assert.match(r, /E-mail: fulano@rbvcompany\.com\n/)
  assert.match(r, /Senha: abc123\n/)
})

test('dá pra apontar outro endereço, e o padrão é a Central', () => {
  assert.match(recadoDeAcesso({ email: 'a@b.c', senha: 'x', endereco: 'outro.exemplo.com' }), /outro\.exemplo\.com/)
  assert.match(recadoDeAcesso({ email: 'a@b.c', senha: 'x' }), new RegExp(ENDERECO_DA_CENTRAL.replace('.', '\\.')))
})

test('sem nada, não quebra nem inventa dado', () => {
  const r = recadoDeAcesso()
  assert.ok(r.includes(ENDERECO_DA_CENTRAL))
  assert.doesNotMatch(r, /undefined|null/)
})
