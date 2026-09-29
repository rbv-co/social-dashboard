import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const TS = readFileSync(join(aqui, 'index.ts'), 'utf8')
const CRON = readFileSync(join(aqui, '../../../db/migrations/2026-09-30-zzz-enviar-mensagem-abandono-cron.sql'), 'utf8')

test('⚠️ nasce desligado: sem ENVIO_MODO o robô não faz nada, e a checagem do cron vem primeiro', () => {
  assert.match(TS, /Deno\.env\.get\('ENVIO_MODO'\) \|\| 'desligado'/)
  assert.ok(TS.indexOf('exigirSegredoDeCron') < TS.indexOf("MODO === 'desligado'"))
  assert.match(TS, /if \(MODO === 'desligado'\) return responder\(\{ ok: true, modo: MODO \}\)/)
})

test('modo desconhecido falha fechado (500), e lista sem números também', () => {
  assert.match(TS, /modo_invalido/)
  assert.match(TS, /lista_vazia/)
})

test('⚠️ modo seco não reserva nem chama o Chatwoot', () => {
  assert.match(TS, /p_reservar: MODO !== 'seco'/)
  assert.match(TS, /MODO === 'seco'[\s\S]{0,400}continue/)
})

test('⚠️ 401/403 para a rodada sem marcar o lead como falha: devolve sem contar tentativa', () => {
  assert.match(TS, /tipo === 'parar'/)
  assert.match(TS, /p_contar: false/)
})

test('só o primeiro nome vai no template e o token do Chatwoot nunca é logado', () => {
  assert.ok(!/console\.(log|error)\([^)]*CHATWOOT_API_TOKEN/.test(TS))
  assert.ok(!/console\.(log|error)\([^)]*token\b/i.test(TS.replace(/linha\.token/g, '')))
})

test('cron: 1/min, com segredo próprio e no vigia (robos_esperados)', () => {
  assert.match(CRON, /cron\.schedule\('enviar-mensagem-abandono', '\* \* \* \* \*'/)
  assert.match(CRON, /disparar_robo\('enviar-mensagem-abandono', 'enviar-mensagem-abandono', 'enviar-mensagem-abandono'/)
  assert.match(CRON, /insert into public\.segredos_de_cron/)
  assert.match(CRON, /insert into public\.robos_esperados/)
})
