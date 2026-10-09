import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { semComentario } from '../../coletor/objetos-de-uma-migration.mjs'

const sql = semComentario(readFileSync(new URL('./levantamento.sql', import.meta.url), 'utf8'))

test('levantamento.sql só tem SELECT', () => {
  const proibidas = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do)\b/i
  assert.equal(proibidas.test(sql), false, 'comando que escreve no banco')
  const comandos = sql.split(';').map((c) => c.trim()).filter(Boolean)
  assert.ok(comandos.length >= 10)
  for (const c of comandos) assert.match(c, /^(select|with)\b/i, `não é SELECT: ${c.slice(0, 60)}`)
})

test('levantar.sh força transação somente leitura e não imprime URL', () => {
  const sh = readFileSync(new URL('./levantar.sh', import.meta.url), 'utf8')
  assert.match(sh, /default_transaction_read_only=on/)
  assert.doesNotMatch(sh, /echo\s+"?\$\{?DATABASE_URL/)
})
