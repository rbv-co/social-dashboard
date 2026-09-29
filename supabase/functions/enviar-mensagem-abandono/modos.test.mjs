import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// O comportamento da rodada é testado de verdade em _shared/rodada-de-mensagens.test.mjs.
// Aqui só se garante o que a casca da edge (index.ts) e o agendamento têm que manter.
const aqui = dirname(fileURLToPath(import.meta.url))
const TS = readFileSync(join(aqui, 'index.ts'), 'utf8')
const CRON = readFileSync(join(aqui, '../../../db/migrations/2026-09-30-zzz-enviar-mensagem-abandono-cron.sql'), 'utf8')

test('⚠️ nasce desligado: sem ENVIO_MODO o robô não faz nada, e a checagem do cron vem primeiro', () => {
  assert.match(TS, /Deno\.env\.get\('ENVIO_MODO'\) \|\| 'desligado'/)
  assert.ok(TS.indexOf('exigirSegredoDeCron') < TS.indexOf("MODO === 'desligado'"))
  assert.match(TS, /if \(MODO === 'desligado'\) return responder\(\{ ok: true, modo: MODO \}\)/)
})

test('modo desconhecido falha fechado (500) antes de tocar em qualquer lead', () => {
  assert.match(TS, /modo_invalido/)
  assert.ok(TS.indexOf('modo_invalido') < TS.indexOf('processarRodada({'))
})

test('a edge delega a rodada ao módulo testado e não decide nada sozinha', () => {
  assert.match(TS, /import \{ processarRodada \} from '\.\.\/_shared\/rodada-de-mensagens\.js'/)
  assert.match(TS, /processarRodada\(\{ sb, cliente, config \}\)/)
  assert.ok(!/decidirEnvio|marcar_mensagem|devolver_mensagem/.test(TS), 'a lógica da rodada não deve voltar para o index.ts')
})

test('⚠️ modo seco não recebe cliente do Chatwoot (nem existe conexão para chamar)', () => {
  assert.match(TS, /const cliente = MODO === 'seco' \? null : criarClienteChatwoot/)
})

test('o token do Chatwoot nunca é logado', () => {
  assert.ok(!/console\.(log|error)\([^)]*(token|CHATWOOT_API_TOKEN)/i.test(TS))
})

test('cron: 1/min, com segredo próprio e no vigia (robos_esperados)', () => {
  assert.match(CRON, /cron\.schedule\('enviar-mensagem-abandono', '\* \* \* \* \*'/)
  assert.match(CRON, /disparar_robo\('enviar-mensagem-abandono', 'enviar-mensagem-abandono', 'enviar-mensagem-abandono'/)
  assert.match(CRON, /insert into public\.segredos_de_cron/)
  assert.match(CRON, /insert into public\.robos_esperados/)
})
