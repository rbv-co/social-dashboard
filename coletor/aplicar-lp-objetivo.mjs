// APLICA a migration de objetivo/loja. Diferente de `provar-lp-objetivo.mjs`,
// este COMMITA. Roda uma vez e só.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'
const sql = readFileSync(new URL('../db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql', import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query('commit')
  console.log('APLICADA e commitada.')
} catch (e) {
  await cli.query('rollback')
  console.error('FALHOU, nada foi aplicado:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
