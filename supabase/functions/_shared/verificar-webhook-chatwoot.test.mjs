import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenValido, extrairEventoDoChatwoot } from './verificar-webhook-chatwoot.js'

test('tokenValido: aceita quando bate exatamente', () => {
  assert.equal(tokenValido('segredo-123', 'segredo-123'), true)
})

test('tokenValido: rejeita token errado', () => {
  assert.equal(tokenValido('segredo-123', 'segredo-456'), false)
})

test('tokenValido: rejeita tamanho diferente (nunca comparar tamanhos diferentes)', () => {
  assert.equal(tokenValido('segredo-123', 'segredo-12'), false)
  assert.equal(tokenValido('segredo-123', 'segredo-1234'), false)
})

test('tokenValido: rejeita sem segredo configurado (nunca deixar passar por omissão de config)', () => {
  assert.equal(tokenValido('', 'qualquer-coisa'), false)
})

test('tokenValido: rejeita token nulo ou ausente', () => {
  assert.equal(tokenValido('segredo-123', null), false)
  assert.equal(tokenValido('segredo-123', undefined), false)
})

function payloadBase(extra = {}) {
  return {
    tipo: 'lead_novo',
    account_id: 1,
    conversation_id: 4821,
    conversation_display_id: 2887,
    contact_id: 933,
    contact_name: 'Maria Silva',
    contact_phone_number: '+5511999998888',
    loja: 'Loja Shopping XYZ',
    classificacao_ia: null,
    created_at: '2026-09-24T14:32:07-03:00',
    ...extra,
  }
}

test('⚠️ extrai evento lead_novo completo, com dia_br em BRT a partir do created_at', () => {
  const evento = extrairEventoDoChatwoot(payloadBase())
  assert.equal(evento.tipo, 'lead_novo')
  assert.equal(evento.conversation_id, 4821)
  assert.equal(evento.conversation_display_id, 2887)
  assert.equal(evento.contact_id, 933)
  assert.equal(evento.contact_name, 'Maria Silva')
  assert.equal(evento.contact_phone_number, '+5511999998888')
  assert.equal(evento.loja, 'Loja Shopping XYZ')
  assert.equal(evento.classificacao_ia, null)
  assert.equal(evento.criado_em_chatwoot, '2026-09-24T17:32:07.000Z')
  assert.equal(evento.dia_br, '2026-09-24')
})

test('extrai evento lead_quente com classificacao_ia preenchida', () => {
  const evento = extrairEventoDoChatwoot(payloadBase({ tipo: 'lead_quente', classificacao_ia: 'quente' }))
  assert.equal(evento.tipo, 'lead_quente')
  assert.equal(evento.classificacao_ia, 'quente')
})

test('⚠️ created_at perto da meia-noite BRT: dia_br é o dia de São Paulo, não o de UTC', () => {
  // 23:30 em São Paulo (UTC-3) já é 02:30 do dia seguinte em UTC — dia_br
  // tem que bater com o relógio de SP, não virar o dia errado.
  const evento = extrairEventoDoChatwoot(payloadBase({ created_at: '2026-09-23T23:30:00-03:00' }))
  assert.equal(evento.dia_br, '2026-09-23')
})

test('tipo fora de lead_novo/lead_quente vira null (payload que a gente não entende, não trava o webhook)', () => {
  assert.equal(extrairEventoDoChatwoot(payloadBase({ tipo: 'outra_coisa' })), null)
  assert.equal(extrairEventoDoChatwoot(payloadBase({ tipo: '' })), null)
  assert.equal(extrairEventoDoChatwoot(payloadBase({ tipo: undefined })), null)
})

test('sem conversation_id vira null (não dá pra identificar nem deduplicar)', () => {
  assert.equal(extrairEventoDoChatwoot(payloadBase({ conversation_id: undefined })), null)
  assert.equal(extrairEventoDoChatwoot(payloadBase({ conversation_id: null })), null)
})

test('corpo vazio ou ausente vira null, nunca quebra', () => {
  assert.equal(extrairEventoDoChatwoot(null), null)
  assert.equal(extrairEventoDoChatwoot(undefined), null)
  assert.equal(extrairEventoDoChatwoot({}), null)
})

test('campos opcionais ausentes (loja/classificacao_ia/conversation_display_id) viram null, não undefined', () => {
  const evento = extrairEventoDoChatwoot({ tipo: 'lead_novo', conversation_id: 1, created_at: '2026-09-24T10:00:00-03:00' })
  assert.equal(evento.loja, null)
  assert.equal(evento.classificacao_ia, null)
  assert.equal(evento.conversation_display_id, null)
  assert.equal(evento.contact_id, null)
  assert.equal(evento.contact_name, null)
  assert.equal(evento.contact_phone_number, null)
  assert.equal(evento.chatwoot_account_id, null)
})

test('⚠️ sem created_at (não deveria acontecer, mas não pode travar): cai no fallback de `agora`', () => {
  const agora = new Date('2026-09-24T12:00:00-03:00')
  const evento = extrairEventoDoChatwoot({ tipo: 'lead_novo', conversation_id: 1 }, agora)
  assert.equal(evento.criado_em_chatwoot, agora.toISOString())
  assert.equal(evento.dia_br, '2026-09-24')
})

test('created_at inválido (string que não parseia) também cai no fallback de `agora`', () => {
  const agora = new Date('2026-09-24T12:00:00-03:00')
  const evento = extrairEventoDoChatwoot({ tipo: 'lead_novo', conversation_id: 1, created_at: 'isso-nao-e-data' }, agora)
  assert.equal(evento.criado_em_chatwoot, agora.toISOString())
})
