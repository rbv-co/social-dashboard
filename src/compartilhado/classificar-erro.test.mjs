import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classificarErro, ERRO_DE_REDE } from './classificar-erro.js'

test('401 vira sessao expirada com botao de entrar', () => {
  const e = classificarErro(401, { message: 'JWT expired' })
  assert.equal(e.tipo, 'sessao')
  assert.equal(e.acao, 'entrar')
  assert.match(e.mensagem, /sess[ãa]o/i)
})

test('PGRST301 vira sessao mesmo com outro status', () => {
  const e = classificarErro(400, { code: 'PGRST301', message: 'JWT expired' })
  assert.equal(e.tipo, 'sessao')
})

test('403 vira sem permissao e nao oferece tentar de novo', () => {
  const e = classificarErro(403, { message: 'permission denied' })
  assert.equal(e.tipo, 'permissao')
  assert.equal(e.acao, null)
  assert.match(e.mensagem, /permiss[ãa]o/i)
})

test('42501 vira sem permissao', () => {
  const e = classificarErro(400, { code: '42501', message: 'permission denied for table x' })
  assert.equal(e.tipo, 'permissao')
})

test('500 vira erro de servidor com tentar de novo', () => {
  const e = classificarErro(500, null)
  assert.equal(e.tipo, 'servidor')
  assert.equal(e.acao, 'tentar')
})

test('503 tambem e servidor', () => {
  assert.equal(classificarErro(503, null).tipo, 'servidor')
})

test('status desconhecido cai em servidor, nunca em undefined', () => {
  const e = classificarErro(418, null)
  assert.equal(e.tipo, 'servidor')
  assert.ok(e.mensagem.length > 0)
})

test('ERRO_DE_REDE e uma constante pronta pro catch do fetch', () => {
  assert.equal(ERRO_DE_REDE.tipo, 'rede')
  assert.equal(ERRO_DE_REDE.acao, 'tentar')
})

test('nenhuma mensagem vaza jargao tecnico pro usuario', () => {
  const casos = [
    classificarErro(401, { code: 'PGRST301' }),
    classificarErro(403, { code: '42501' }),
    classificarErro(500, null),
    ERRO_DE_REDE,
  ]
  for (const c of casos) {
    assert.doesNotMatch(c.mensagem, /PGRST|JWT|42501|null|undefined|Error/i, `vazou jargao: ${c.mensagem}`)
  }
})

test('API em Go: 403 conta_desativada vira CONTA_DESATIVADA, nao sem permissao', async () => {
  const { CONTA_DESATIVADA } = await import('./classificar-erro.js')
  assert.equal(classificarErro(403, { error: 'conta_desativada' }), CONTA_DESATIVADA)
  assert.equal(classificarErro(403, { error: 'sem_permissao' }).tipo, 'permissao')
})

test('API em Go: 429 vira muitas tentativas, sem tentar de novo na hora', () => {
  const e = classificarErro(429, { error: 'muitas_tentativas' })
  assert.equal(e.tipo, 'limite')
  assert.equal(e.acao, null)
})
