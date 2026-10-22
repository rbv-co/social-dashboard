import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { anotar, emEspera, limpar, lerEspera, gravarEspera, ESPERA_MS } from './espera-dos-lotes.mjs'

const lote = { id: 7, sku: 'SS0002SB.M6', cor: null, modelo: 'Shoulder Cyrène', fotos: null }

test('lote sem saída espera 6 h; passado o prazo, olha de novo', () => {
  const e = anotar({}, lote, { mudou: false, passageiro: false }, 1000)
  assert.equal(emEspera(e, lote, 1000 + ESPERA_MS - 1), true)
  assert.equal(emEspera(e, lote, 1000 + ESPERA_MS + 1), false)
})

test('lote que mudou no banco sai da espera na hora', () => {
  const e = anotar({}, lote, { mudou: false, passageiro: false }, 1000)
  assert.equal(emEspera(e, { ...lote, cor: 'Canela' }, 2000), false)
  assert.equal(emEspera(e, { ...lote, sku: 'SS0002SB.M7' }, 2000), false)
})

test('falha passageira ou mudança gravada não esperam', () => {
  assert.equal(emEspera(anotar({}, lote, { mudou: false, passageiro: true }, 1000), lote, 2000), false)
  const e = anotar({}, lote, { mudou: false, passageiro: false }, 1000)
  assert.equal(emEspera(anotar(e, lote, { mudou: true, passageiro: false }, 2000), lote, 3000), false)
})

test('limpar tira lote que não existe mais; arquivo ida e volta; arquivo ruim = vazio', () => {
  const e = anotar(anotar({}, lote, { mudou: false, passageiro: false }), { ...lote, id: 8 }, { mudou: false, passageiro: false })
  assert.deepEqual(Object.keys(limpar(e, [{ id: 8 }])), ['8'])
  const arq = join(mkdtempSync(join(tmpdir(), 'espera-')), 'e.json')
  gravarEspera(e, arq)
  assert.deepEqual(lerEspera(arq), e)
  assert.deepEqual(lerEspera(join(arq, 'nao-existe')), {})
})
