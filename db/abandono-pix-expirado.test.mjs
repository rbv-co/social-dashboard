import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-30-zz-abandono-pix-expirado.sql'), 'utf8')

test('⚠️ a função antiga (só p_minutos) sai, para o cron chamar (10) sem ambiguidade de sobrecarga', () => {
  assert.match(SQL, /drop function if exists public\.mover_abandonados_para_fila\(int\)/)
  assert.match(SQL, /p_minutos int default 10,\s+p_pix_minutos int default 35/)
})

test('a regra dos 10 minutos continua igual: só quem aguarda, sem evento há p_minutos', () => {
  assert.match(SQL, /where status = 'aguardando'\s+and ultimo_evento_em < now\(\) - make_interval\(mins => p_minutos\)/)
})

test('Pix passou da validade (35 min): pagamento_pendente reabre, sem depender de webhook', () => {
  assert.match(SQL, /where status = 'pagamento_pendente'\s+and pedido_criado_em < now\(\) - make_interval\(mins => p_pix_minutos\)/)
})

test('reabrir segue a regra do orders/cancelled: quem já foi para a fila volta para ela, os demais recomeçam', () => {
  assert.match(SQL, /case when comprou_depois then 'fila_envio' else 'aguardando' end/)
  assert.match(SQL, /pedido_criado_em = null/)
  const reabre = SQL.slice(SQL.indexOf("-- 2) pagamento pendente"))
  assert.ok(!/fila_envio_em\s*=/.test(reabre), 'reabrir não deve mexer em fila_envio_em')
})

test('⚠️ função de escrita: security definer, search_path fixo, só o service_role executa', () => {
  assert.match(SQL, /security definer\s+set search_path = public/)
  assert.match(SQL, /revoke execute on function public\.mover_abandonados_para_fila\(int, int\) from public, anon, authenticated/)
  assert.match(SQL, /grant execute on function public\.mover_abandonados_para_fila\(int, int\) to service_role/)
})
