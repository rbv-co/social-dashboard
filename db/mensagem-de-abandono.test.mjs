import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-30-zzy-mensagem-de-abandono.sql'), 'utf8')

test('estado da mensagem: os quatro valores e nulo', () => {
  assert.match(SQL, /mensagem_status is null or mensagem_status in \('enviando', 'enviada', 'falhou', 'ignorada'\)/)
})

test('⚠️ reserva sem duplicar: skip locked, só fila_envio ainda sem mensagem', () => {
  const fn = SQL.slice(SQL.indexOf('function public.pegar_para_mensagem'), SQL.indexOf('function public.marcar_mensagem'))
  assert.match(fn, /for update skip locked/)
  assert.match(fn, /status = 'fila_envio' and mensagem_status is null/)
  assert.match(fn, /mensagem_status = 'enviando'/)
})

test('⚠️ quem já recebeu (enviada) nunca é escolhido de novo: o filtro é mensagem_status is null', () => {
  const fn = SQL.slice(SQL.indexOf('function public.pegar_para_mensagem'), SQL.indexOf('function public.marcar_mensagem'))
  assert.equal((fn.match(/mensagem_status is null/g) || []).length, 2) // caminho que reserva e caminho seco
})

test('⚠️ fila velha nunca recebe: só entra quem chegou à fila nas últimas 24 horas (nos dois caminhos)', () => {
  const fn = SQL.slice(SQL.indexOf('function public.pegar_para_mensagem'), SQL.indexOf('function public.marcar_mensagem'))
  assert.equal((fn.match(/fila_envio_em >= now\(\) - interval '24 hours'/g) || []).length, 2)
})

test('finalizar só vale para quem está enviando; devolver conta tentativa e esgota em 3', () => {
  assert.match(SQL, /where token = p_token\s+and mensagem_status = 'enviando'/)
  assert.match(SQL, /mensagem_tentativas \+ 1 >= 3/)
  assert.match(SQL, /'tentativas_esgotadas'/)
})

test('travados: enviando há mais de 10 min volta a ser elegível', () => {
  assert.match(SQL, /mensagem_reservada_em < now\(\) - interval '10 minutes'/)
})

test('⚠️ bloqueados: RLS ligada, sem policy, fechada para anon/authenticated', () => {
  assert.match(SQL, /alter table public\.contatos_sem_mensagem enable row level security/)
  assert.match(SQL, /revoke all on public\.contatos_sem_mensagem from anon, authenticated/)
  assert.ok(!/create policy[^;]*contatos_sem_mensagem/i.test(SQL))
})

test('⚠️ funções de escrita: security definer, search_path fixo, só o service_role executa', () => {
  assert.equal((SQL.match(/security definer/g) || []).length, 4)
  assert.equal((SQL.match(/set search_path = public/g) || []).length, 4)
  assert.equal((SQL.match(/from public, anon, authenticated;/g) || []).length, 4)
  assert.equal((SQL.match(/to service_role;/g) || []).length, 4)
})
