import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * A escolha do caminho (visita ou loja online) é uma SEGUNDA escrita, feita
 * depois de a pessoa já estar no banco. Sem prova de identidade, a porta
 * pública passaria a aceitar "grave visita na linha 412" — sobre a linha de
 * qualquer cliente.
 *
 * Este teste falha se a senha de uso único sair da migration, se ela passar a
 * ser guardada em texto puro, ou se `loja` nascer presa a uma loja só. */

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql'), 'utf8')

test('as duas colunas do dono entram', () => {
  assert.match(SQL, /add column if not exists objetivo\s+text/i)
  assert.match(SQL, /add column if not exists loja\s+text/i)
})

test('⚠️ a senha é guardada como IMPRESSÃO DIGITAL, nunca em texto puro', () => {
  assert.match(SQL, /add column if not exists senha_hash\s+text/i)
  assert.ok(!/senha\s+text/i.test(SQL.replace(/senha_hash\s+text/gi, '')),
    'nenhuma coluna guarda a senha crua')
  assert.match(SQL, /digest\(/i, 'a senha passa por digest antes de ser gravada')
})

test('⚠️ `loja` nasce aceitando AS DUAS lojas abertas', () => {
  assert.match(SQL, /tivoli/i)
  assert.match(SQL, /iguatemi/i)
})

test('⚠️ a senha EXPIRA — senão vale para sempre', () => {
  assert.match(SQL, /senha_em\s+timestamptz/i)
})
