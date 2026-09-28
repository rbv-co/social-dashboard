import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-29-abandono-de-checkout.sql'), 'utf8')

test('os três status da fila, e só eles', () => {
  assert.match(SQL, /check \(status in \('aguardando', 'fila_envio', 'comprou'\)\)/)
})

test('⚠️ tabela com dado pessoal: RLS ligado e nenhuma policy de escrita (só a chave de serviço grava)', () => {
  assert.match(SQL, /alter table public\.checkout_abandono enable row level security/)
  assert.ok(!/for (insert|update|delete|all)/i.test(SQL), 'não deveria existir policy de escrita')
})

test('leitura só com a permissão própria abandono-carrinho (não pega carona em carrinho)', () => {
  assert.match(SQL, /'abandono-carrinho' = any \(p\.features\)/)
  assert.ok(!/'carrinho' = any/.test(SQL))
})

test('upsert só mexe em quem está aguardando (update tardio não tira da fila de envio)', () => {
  const fn = SQL.slice(SQL.indexOf('function public.registrar_checkout_abandono'),
                       SQL.indexOf('function public.marcar_checkout_comprou'))
  assert.match(fn, /where checkout_abandono\.status = 'aguardando'/)
  assert.match(fn, /ultimo_evento_em\s+= now\(\)/)
})

test('pedido: marca comprou_depois quando já estava na fila de envio', () => {
  assert.match(SQL, /comprou_depois = \(status = 'fila_envio'\)/)
})

test('o relógio: 10 minutos sem evento, só para quem aguarda, e roda a cada minuto', () => {
  assert.match(SQL, /where status = 'aguardando'\s+and ultimo_evento_em < now\(\) - make_interval\(mins => p_minutos\)/)
  assert.match(SQL, /mover_abandonados_para_fila\(p_minutos int default 10\)/)
  assert.match(SQL, /cron\.schedule\('abandono-de-checkout', '\* \* \* \* \*'/)
  assert.match(SQL, /mover_abandonados_para_fila\(10\)/)
})

test('⚠️ as três funções são security definer e fechadas: revoke de public, anon, authenticated; grant só ao service_role', () => {
  assert.equal((SQL.match(/security definer/g) || []).length, 3)
  assert.equal((SQL.match(/from public, anon, authenticated;/g) || []).length, 3)
  assert.equal((SQL.match(/to service_role;/g) || []).length, 3)
  assert.equal((SQL.match(/set search_path = public/g) || []).length, 3)
})
