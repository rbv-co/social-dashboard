import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarPedido, FRASE_SO_GESTOR } from './pedido-do-supabase.js'

const gestor = (acao) => acao === 'criar'
const motorista = (acao) => acao === 'ver' // tem a Frota, mas não a aba Gestão
const CB = 'https://chatgpt.com/connector_platform_oauth_redirect'

test('gestor da Frota com retorno no ChatGPT pode aprovar', () => {
  assert.deepEqual(avaliarPedido({ pode: gestor, entrarComo: false, redirectUri: CB }), { pode: true, mensagem: '' })
  assert.equal(avaliarPedido({ pode: (a) => a === 'excluir', redirectUri: 'https://chat.openai.com/x' }).pode, true)
})

test('motorista não aprova', () => {
  assert.deepEqual(avaliarPedido({ pode: motorista, redirectUri: CB }), { pode: false, mensagem: FRASE_SO_GESTOR })
})

test('retorno fora do ChatGPT é recusado, mesmo para gestor', () => {
  for (const r of ['https://evil.com/cb', 'https://chatgpt.com.evil.com/cb', 'http://chatgpt.com/cb',
    'https://chatgpt.com:8443/cb', 'chatgpt.com/cb', '', undefined]) {
    assert.equal(avaliarPedido({ pode: gestor, redirectUri: r }).pode, false, String(r))
  }
})

test('entrar como não aprova em nome do outro', () => {
  assert.match(avaliarPedido({ pode: gestor, entrarComo: true, redirectUri: CB }).mensagem, /entrar como/)
})
