import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ler = (n) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'migrations', n), 'utf8')

test('carrinho_eventos: coluna nula + índice único PARCIAL em evento_shopify_id (eventos sem cabeçalho não colidem)', () => {
  const sql = ler('2026-10-08-carrinho-eventos-evento-shopify-id.sql')
  assert.match(sql, /add column if not exists evento_shopify_id text;/)
  assert.match(sql, /create unique index if not exists \w+\s+on public\.carrinho_eventos \(evento_shopify_id\) where evento_shopify_id is not null;/)
  assert.ok(!/concurrently/i.test(sql), 'o runner roda em transação: concurrently falharia')
})

test('trava cruzada: lê mensagem_fila E checkout_abandono por fone11 numa janela de 20 h, só service_role executa', () => {
  const sql = ler('2026-10-08-trava-cruzada-de-mensagens.sql')
  assert.match(sql, /from public\.mensagem_fila/)
  assert.match(sql, /from public\.checkout_abandono/)
  assert.match(sql, /p_horas int default 20/)
  assert.match(sql, /fone11\(f\.telefone\) = public\.fone11\(p_telefone\)/)
  assert.match(sql, /revoke all on function public\.recebeu_mensagem_automatica[^;]*from public, anon, authenticated;/)
  assert.match(sql, /grant execute on function public\.recebeu_mensagem_automatica[^;]*to service_role;/)
})
