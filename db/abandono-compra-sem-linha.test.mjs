import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 04-M1: a compra grava a linha quando o checkouts/update ainda não chegou. A prova de comportamento está em
// api/internal/banco/abandono_compra_sem_linha_test.go (Postgres); aqui só se garante que a migration do Supabase e
// a da API em Go têm o mesmo corpo e que a função continua fechada.
const sup = readFileSync(new URL('./migrations/2026-10-19-abandono-compra-sem-linha.sql', import.meta.url), 'utf8')
const go = readFileSync(new URL('../api/internal/banco/migracoes/00011_abandono_compra_sem_linha.sql', import.meta.url), 'utf8')
const corpo = (s) => s.slice(s.indexOf('declare'), s.indexOf('end;')).replace(/\s+/g, ' ')

test('a compra com token insere a linha já como comprou, sem sobrescrever uma existente', () => {
  assert.match(sup, /insert into public\.checkout_abandono \(token, email, telefone, status, comprou_em\)/)
  assert.match(sup, /on conflict \(token\) do nothing/)
  assert.match(sup, /if p_token is not null then/)
})

test('Supabase e API Go têm o mesmo corpo', () => {
  assert.equal(corpo(go.split('-- +goose Down')[0]), corpo(sup))
})

test('⚠️ a função segue security definer e fechada ao service_role', () => {
  assert.match(sup, /security definer/)
  assert.match(sup, /revoke execute on function public\.marcar_checkout_comprou\(text, text, text\)\s+from public, anon, authenticated;/)
  assert.match(sup, /grant execute on function public\.marcar_checkout_comprou\(text, text, text\) to service_role;/)
})
