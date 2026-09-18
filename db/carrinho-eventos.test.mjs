import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-17-carrinho-eventos.sql'), 'utf8')

test('os três tipos de evento do MVP, e só eles', () => {
  assert.match(SQL, /check \(tipo in \(\s*'produto_adicionado', 'produto_removido', 'checkout_iniciado'/)
})

test('⚠️ carrinho_visualizado NÃO entra — cortado no desenho (Shopify não garante o evento)', () => {
  assert.ok(!SQL.includes('carrinho_visualizado'))
})

test('guarda o IP, para o rate limit da edge function', () => {
  assert.match(SQL, /\bip\s+text\b/)
})

test('RLS ligado e sem policy de insert (só a chave de serviço grava)', () => {
  assert.match(SQL, /enable row level security/)
  assert.ok(!/for insert/i.test(SQL), 'não deveria existir policy de insert nesta migration')
})

test('⚠️ view de abandono roda com o invoker, não com o dono (senão passa por cima do RLS)', () => {
  assert.match(SQL, /alter view public\.carrinho_abandonados set \(security_invoker = true\)/)
})

test('abandono = teve produto_adicionado, nunca teve checkout_iniciado, parado há mais de 30 min', () => {
  const view = SQL.slice(SQL.indexOf('create or replace view public.carrinho_abandonados'))
  assert.match(view, /where tipo = 'produto_adicionado'/)
  assert.match(view, /e2\.tipo = 'checkout_iniciado'/)
  assert.match(view, /interval '30 minutes'/)
})
