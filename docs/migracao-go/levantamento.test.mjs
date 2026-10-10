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

test('levantar.sh força transação somente leitura e confere em tempo de execução', () => {
  const sh = readFileSync(new URL('./levantar.sh', import.meta.url), 'utf8')
  assert.match(sh, /^export PGOPTIONS=.*default_transaction_read_only=on/m)
  assert.match(sh, /ON_ERROR_STOP/)
  // a garantia é `begin read only` em volta de cada consulta (pooler em modo transação ignora PGOPTIONS)
  assert.match(sh, /begin read only; show transaction_read_only; commit;/)
  assert.match(sh, /echo 'begin read only;'; .*cat "\$f"; echo 'commit;'/)
})

test('levantar.sh não deixa a URL vazar', () => {
  const sh = readFileSync(new URL('./levantar.sh', import.meta.url), 'utf8')
  assert.doesNotMatch(sh, /set\s+-\w*x/)
  const linhas = sh.split('\n').filter((l) => !l.trim().startsWith('#') && l.includes('DATABASE_URL'))
  assert.ok(linhas.length > 0)
  for (const l of linhas) {
    assert.ok(l.includes('[ -n "${DATABASE_URL:-}" ]') || /psql "\$DATABASE_URL"/.test(l), `uso suspeito de DATABASE_URL: ${l}`)
  }
})
