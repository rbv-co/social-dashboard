import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-18-carrinho-eventos-sessao.sql'), 'utf8')

test('cart_token deixa de ser obrigatório (não existe carrinho na entrada da sessão)', () => {
  assert.match(SQL, /alter column cart_token drop not null/)
})

test('session_id é a nova coluna que liga tudo', () => {
  assert.match(SQL, /add column if not exists session_id text/)
  assert.match(SQL, /create index if not exists carrinho_eventos_session_id_criado_em_idx/)
})

test('sessao_iniciada entra na lista de tipos aceitos', () => {
  assert.match(SQL, /check \(tipo in \(\s*'produto_adicionado', 'produto_removido', 'checkout_iniciado', 'sessao_iniciada'/)
})

test('⚠️ sessao_encerrada NÃO existe — não há evento de saída confiável (pagehide dispara em toda navegação)', () => {
  assert.ok(!SQL.includes('sessao_encerrada'))
})
