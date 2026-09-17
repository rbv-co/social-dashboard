import { test } from 'node:test'
import assert from 'node:assert/strict'
import { motivoDeRecusa } from './checagem-de-entrar-como.js'

const SUPERADMIN = { id: 'admin-1', is_superadmin: true }
const ADMIN_COMUM = { id: 'admin-2', is_superadmin: false }
const ALVO = { id: 'alvo-1', email: 'helen@rbvcompany.com', disabled: false }

test('admin comum (nao superadmin) e recusado', () => {
  const m = motivoDeRecusa({ chamador: ADMIN_COMUM, alvoId: ALVO.id, alvo: ALVO })
  assert.match(m, /super-admin/i)
})

test('superadmin DESATIVADO e recusado — o JWT dele ainda vale por ~1h depois de desativar', () => {
  const m = motivoDeRecusa({ chamador: { ...SUPERADMIN, disabled: true }, alvoId: ALVO.id, alvo: ALVO })
  assert.match(m, /sua conta está desativada/i)
})

test('entrar como si mesmo e recusado, mesmo sendo superadmin', () => {
  const m = motivoDeRecusa({ chamador: SUPERADMIN, alvoId: SUPERADMIN.id, alvo: SUPERADMIN })
  assert.match(m, /você já é você/i)
})

test('alvo inexistente e recusado', () => {
  const m = motivoDeRecusa({ chamador: SUPERADMIN, alvoId: 'nao-existe', alvo: null })
  assert.match(m, /não encontrei/i)
})

test('alvo desativado e recusado', () => {
  const m = motivoDeRecusa({ chamador: SUPERADMIN, alvoId: ALVO.id, alvo: { ...ALVO, disabled: true } })
  assert.match(m, /desativada/i)
})

test('superadmin entrando como outra pessoa ativa: libera (null)', () => {
  const m = motivoDeRecusa({ chamador: SUPERADMIN, alvoId: ALVO.id, alvo: ALVO })
  assert.equal(m, null)
})
