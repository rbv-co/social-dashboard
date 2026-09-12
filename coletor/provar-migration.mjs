// CONFERE SE A MIGRATION COMPILA — dentro de uma transação que SEMPRE se desfaz.
// Não aplica nada: o `rollback` está no `finally`, e não há caminho que faça commit.
import { readFileSync, existsSync } from 'node:fs'
import pg from 'pg'

const env = '/Users/erickmartins/iamundi/coletor/.env'
if (existsSync(env)) for (const raw of readFileSync(env, 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue
  const i = l.indexOf('='); if (i === -1) continue
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (!(k in process.env)) process.env[k] = v
}

const arquivos = process.argv.slice(2)
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
try {
  await c.query('begin')
  for (const f of arquivos) {
    process.stdout.write(`\n=== ${f.split('/').pop()} ===\n`)
    const r = await c.query(readFileSync(f, 'utf8'))
    const linhas = Array.isArray(r) ? r : [r]
    for (const bloco of linhas) {
      if (!bloco?.rows?.length) continue
      for (const linha of bloco.rows) console.log(JSON.stringify(linha))
    }
  }
  console.log('\nCOMPILOU SEM ERRO')
} catch (e) {
  console.log('\nERRO:', e.message)
  if (e.position) console.log('posição:', e.position)
  if (e.hint) console.log('dica:', e.hint)
  process.exitCode = 1
} finally {
  await c.query('rollback')       // SEMPRE desfaz
  await c.end()
  console.log('rollback feito — nada ficou no banco')
}
