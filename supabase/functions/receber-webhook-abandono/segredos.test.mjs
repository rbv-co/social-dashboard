import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const TS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')

test('⚠️ aceita a assinatura do segredo do ADMIN e a do segredo do APP (webhook criado por API)', () => {
  assert.match(TS, /Deno\.env\.get\('SHOPIFY_WEBHOOK_SECRET'\)/)
  assert.match(TS, /Deno\.env\.get\('SHOPIFY_CLIENT_SECRET'\)/)
})

test('sem nenhum segredo configurado nada passa (fail-closed: lista vazia => 401)', () => {
  assert.match(TS, /\.filter\(\(s\): s is string => !!s\)/)
  assert.match(TS, /if \(!confere\.some\(Boolean\)\) return responder\(\{ error: 'nao_autorizado' \}, 401\)/)
})
