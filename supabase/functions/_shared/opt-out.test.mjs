import test from 'node:test'
import assert from 'node:assert/strict'
import { extrairOptOut } from './opt-out.js'

const msg = (extra = {}) => ({
  event: 'message_created', message_type: 'incoming', content: 'Não quero receber',
  sender: { phone_number: '+55 19 98262-1828' }, ...extra,
})

test('reconhece o botão "Não quero receber" e normaliza o telefone', () => {
  assert.deepEqual(extrairOptOut(msg()), { telefone: '5519982621828', motivo: 'resposta: nao quero receber' })
})

test('reconhece variações de acento, caixa e pontuação, e as palavras PARAR/SAIR sozinhas', () => {
  for (const c of ['NAO QUERO RECEBER!', 'não quero receber mais', 'Parar', 'sair.', ' pare ']) {
    assert.ok(extrairOptOut(msg({ content: c })), `deveria reconhecer "${c}"`)
  }
})

test('⚠️ não bloqueia conversa normal nem palavra solta dentro de frase', () => {
  for (const c of ['quero comprar', 'posso parar na loja hoje?', 'oi', '', null]) {
    assert.equal(extrairOptOut(msg({ content: c })), null, `não deveria bloquear "${c}"`)
  }
})

test('só mensagem RECEBIDA do cliente conta (a enviada por nós não), e só o evento certo', () => {
  assert.equal(extrairOptOut(msg({ message_type: 'outgoing' })), null)
  assert.equal(extrairOptOut(msg({ event: 'conversation_updated' })), null)
  assert.equal(extrairOptOut(null), null)
})

test('sem telefone utilizável não bloqueia nada; usa o telefone da conversa se o sender não tiver', () => {
  assert.equal(extrairOptOut(msg({ sender: {} })), null)
  assert.equal(extrairOptOut(msg({ sender: { phone_number: 'abc' } })), null)
  assert.equal(
    extrairOptOut(msg({ sender: {}, conversation: { meta: { sender: { phone_number: '19982621828' } } } })).telefone,
    '5519982621828')
})
