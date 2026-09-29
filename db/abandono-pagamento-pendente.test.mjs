import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-30-abandono-de-checkout-pagamento-pendente.sql'), 'utf8')

test('os quatro status da fila, com pagamento_pendente entre eles', () => {
  assert.match(SQL, /check \(status in \('aguardando', 'fila_envio', 'pagamento_pendente', 'comprou'\)\)/)
})

test('pagamento pendente só sai de aguardando ou fila_envio (orders/paid que chegou antes não é rebaixado)', () => {
  const fn = SQL.slice(SQL.indexOf('function public.marcar_checkout_pagamento_pendente'),
                       SQL.indexOf('function public.marcar_checkout_comprou'))
  assert.match(fn, /status in \('aguardando', 'fila_envio'\)/)
  assert.match(fn, /comprou_depois\s+= comprou_depois or \(status = 'fila_envio'\)/)
})

test('⚠️ comprar preserva a marca "comprou depois" em vez de sobrescrevê-la', () => {
  const fn = SQL.slice(SQL.indexOf('function public.marcar_checkout_comprou'),
                       SQL.indexOf('function public.reabrir_checkout_abandono'))
  assert.match(fn, /comprou_depois = comprou_depois or \(status = 'fila_envio'\)/)
  assert.match(fn, /and status <> 'comprou'/)
})

test('Pix expirado só reabre quem estava pendente; quem já foi para a fila volta para ela sem zerar fila_envio_em', () => {
  const fn = SQL.slice(SQL.indexOf('function public.reabrir_checkout_abandono'))
  assert.match(fn, /and status = 'pagamento_pendente'/)
  assert.match(fn, /case when comprou_depois then 'fila_envio' else 'aguardando' end/)
  assert.ok(!/fila_envio_em\s*=/.test(fn), 'não deve mexer em fila_envio_em')
})

test('⚠️ as três funções: security definer, search_path fixo, fechadas para anon/authenticated', () => {
  assert.equal((SQL.match(/security definer/g) || []).length, 3)
  assert.equal((SQL.match(/set search_path = public/g) || []).length, 3)
  assert.equal((SQL.match(/from public, anon, authenticated;/g) || []).length, 3)
  assert.equal((SQL.match(/to service_role;/g) || []).length, 3)
})
