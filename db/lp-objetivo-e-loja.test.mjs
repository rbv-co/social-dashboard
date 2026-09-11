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

test('⚠️ a COLUNA guarda impressão digital, nunca a senha crua', () => {
  assert.match(SQL, /add column if not exists senha_hash\s+text/i)
  // ⚠️ A busca é DENTRO DO `alter table`, e não no arquivo todo. As funções que
  // as Tasks 2 e 3 acrescentam a este mesmo arquivo declaram `p_senha text` —
  // uma varredura solta casaria com o parâmetro delas e acusaria coluna crua
  // onde não há nenhuma, duas tarefas depois desta passar.
  const alter = SQL.slice(SQL.indexOf('alter table'), SQL.indexOf(';', SQL.indexOf('alter table')))
  assert.ok(!/\bsenha\s+text/i.test(alter.replace(/senha_hash\s+text/gi, '')),
    'nenhuma COLUNA guarda a senha crua')
})

test('⚠️ `loja` nasce aceitando AS DUAS lojas abertas', () => {
  assert.match(SQL, /tivoli/i)
  assert.match(SQL, /iguatemi/i)
})

test('⚠️ a senha EXPIRA — senão vale para sempre', () => {
  assert.match(SQL, /senha_em\s+timestamptz/i)
})
