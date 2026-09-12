/* A JANELA SÓ CARREGA O NOSSO ENDEREÇO.
 *
 * Este arquivo guarda a trava que impede o leitor de mesa de ir junto com a
 * tela para qualquer outro lugar. A janela empresta o ACR122U para a página que
 * está dentro dela: se essa página for redirecionada para fora, quem estiver do
 * outro lado ganharia o poder de ler e escrever nas etiquetas da bancada.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ENDERECO_DA_CENTRAL, CASAS_PERMITIDAS, podeNavegar } from './enderecos-permitidos.js'

test('o endereço de partida é a tela de autenticidade da Central, em https', () => {
  assert.equal(ENDERECO_DA_CENTRAL, 'https://central.rbvcompany.com/autenticidade')
  assert.equal(podeNavegar(ENDERECO_DA_CENTRAL), true)
})

test('a própria casa passa, em qualquer página dela', () => {
  assert.equal(podeNavegar('https://central.rbvcompany.com/'), true)
  assert.equal(podeNavegar('https://central.rbvcompany.com/entrar?voltar=/autenticidade'), true)
  assert.equal(podeNavegar('https://central.rbvcompany.com/autenticidade#gravar'), true)
})

test('CASA PARECIDA NÃO É A CASA. O nome tem de bater inteiro', () => {
  // `endsWith` aqui é o defeito clássico: `central.rbvcompany.com.qualquercoisa.com`
  // termina com o nosso nome e não é nosso.
  assert.equal(podeNavegar('https://central.rbvcompany.com.outracoisa.com/'), false)
  assert.equal(podeNavegar('https://falsocentral.rbvcompany.com/'), false)
  assert.equal(podeNavegar('https://central.rbvcompany.com@outracoisa.com/'), false)
})

test('sem https não passa: o leitor não viaja por cima de conexão aberta', () => {
  assert.equal(podeNavegar('http://central.rbvcompany.com/autenticidade'), false)
})

test('arquivo local, javascript: e about: não passam', () => {
  for (const endereco of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'about:blank',
    'data:text/html,<script>1</script>',
    'chrome://settings',
  ]) {
    assert.equal(podeNavegar(endereco), false, `${endereco} não podia passar`)
  }
})

test('lixo e vazio não passam, e não estouram', () => {
  for (const endereco of ['', null, undefined, 'nao é endereço', 42, {}]) {
    assert.equal(podeNavegar(endereco), false)
  }
})

test('a lista de casas é curta e escrita à mão — nada de padrão com curinga', () => {
  assert.ok(Array.isArray(CASAS_PERMITIDAS))
  assert.ok(CASAS_PERMITIDAS.length >= 1 && CASAS_PERMITIDAS.length <= 3,
    'lista que cresce sozinha deixa de ser trava')
  for (const casa of CASAS_PERMITIDAS) {
    assert.doesNotMatch(casa, /[*?]/, 'curinga na lista de casas abre a porta sem ninguém ver')
  }
})
