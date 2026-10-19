import test from 'node:test'
import assert from 'node:assert/strict'

await import('../../../public/escritorio-3d/acesso.js')
const { pode } = globalThis.acessoDo3d

test('superadmin entra', () => assert.equal(pode({ superadmin: true }), true))
test('módulo escritorio3d entra', () => assert.equal(pode({ modulos: ['banco', 'escritorio3d'] }), true))
test('permissão ver entra', () => assert.equal(pode({ permissoes: { escritorio3d: ['ver'] } }), true))
test('admin comum sem o módulo NÃO entra (sem atalho de papel)', () => {
  assert.equal(pode({ papel: 'admin', superadmin: false, modulos: ['banco'], permissoes: {} }), false)
})
test('superadmin só vale com true exato', () => assert.equal(pode({ superadmin: 'true' }), false))
test('permissão sem "ver" ou formato inesperado nega', () => {
  assert.equal(pode({ permissoes: { escritorio3d: ['editar'] } }), false)
  assert.equal(pode({ permissoes: { escritorio3d: 'ver' }, modulos: 'escritorio3d' }), false)
  assert.equal(pode({}), false)
  assert.equal(pode(null), false)
})
