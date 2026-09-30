import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// O comportamento das rodadas é testado de verdade em _shared/rodada-completa.test.mjs (modos, nasce desligado,
// modo inválido, seco sem cliente) e nos testes de cada rodada. Aqui só se garante o que a casca da edge
// (index.ts) e o agendamento têm que manter.
const aqui = dirname(fileURLToPath(import.meta.url))
const TS = readFileSync(join(aqui, 'index.ts'), 'utf8')
const CRON = readFileSync(join(aqui, '../../../db/migrations/2026-09-30-zzz-enviar-mensagem-abandono-cron.sql'), 'utf8')

test('⚠️ a checagem do segredo do cron vem ANTES de qualquer rodada', () => {
  assert.match(TS, /exigirSegredoDeCron\(req, 'enviar-mensagem-abandono'\)/)
  assert.ok(TS.indexOf('exigirSegredoDeCron(req') < TS.indexOf('rodarTudo({'))
})

test('a edge delega tudo ao módulo testado e não decide nada sozinha', () => {
  assert.match(TS, /import \{ rodarTudo \} from '\.\.\/_shared\/rodada-completa\.js'/)
  assert.match(TS, /rodarTudo\(\{ env, sb, criarCliente/)
  assert.ok(!/decidirEnvio|marcar_mensagem|devolver_mensagem|marcar_da_fila|processarRodada|processarFila/.test(TS),
    'a lógica das rodadas não deve voltar para o index.ts')
})

test('a configuração é lida a CADA chamada (não congelada no início da instância)', () => {
  assert.match(TS, /const env = \(nome: string\) => Deno\.env\.get\(nome\) \?\? ''/)
  assert.ok(!/^const [A-Z_]+ = Deno\.env\.get\('ENVIO_/m.test(TS), 'nenhum ENVIO_* pode virar constante de módulo')
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
