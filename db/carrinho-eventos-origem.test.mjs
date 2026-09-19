import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-19-carrinho-eventos-origem.sql'), 'utf8')

test('colunas de atribuição multi-canal: utm_source, utm_medium, utm_campaign, gclid, referrer', () => {
  for (const coluna of ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'referrer']) {
    assert.match(SQL, new RegExp(`add column if not exists ${coluna} text`))
  }
})
