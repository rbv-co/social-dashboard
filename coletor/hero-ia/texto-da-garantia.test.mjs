// coletor/hero-ia/texto-da-garantia.test.mjs
//
// A pílula "2 anos de garantia" da arte do Hero-IA passa a depender do
// MATERIAL da peça (decisão do dono, 18/09/2026): canvas 2 anos, couro 6
// meses. O material mora em `vessel_lotes.material`, por SKU, pelo lote mais
// recente COM material (`criado_em` desc, desempate por `id` desc — a mesma
// regra já usada em `vessel_lote_novo_herda_material` no banco).
//
// ⚠️ SEM MATERIAL, SEM PÍLULA. Nunca chutar "2 anos": uma arte com prazo
// errado parece certa; uma arte sem pílula só está incompleta.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { textoDaPilula, materialMaisRecenteDoSku, pilulaDeGarantiaDoSku } from './texto-da-garantia.mjs'

test('canvas -> "2 anos de garantia"', () => {
  assert.equal(textoDaPilula('canvas'), '2 anos de garantia')
})

test('couro -> "6 meses de garantia"', () => {
  assert.equal(textoDaPilula('couro'), '6 meses de garantia')
})

test('⚠️ nulo, desconhecido ou vazio NUNCA chuta 2 anos — sem pílula', () => {
  assert.equal(textoDaPilula(null), null)
  assert.equal(textoDaPilula(undefined), null)
  assert.equal(textoDaPilula(''), null)
  assert.equal(textoDaPilula('seda'), null)
  assert.equal(textoDaPilula('CANVAS'), null) // exato, sem normalizar maiúscula — o banco só grava minúsculo
})

test('materialMaisRecenteDoSku pede o lote mais recente COM material, por criado_em desc/id desc', async () => {
  const chamadas = []
  const sbGet = async (path) => { chamadas.push(path); return [{ material: 'couro' }] }
  const material = await materialMaisRecenteDoSku('SS0003SB.B1', sbGet)
  assert.equal(material, 'couro')
  assert.equal(chamadas.length, 1)
  const path = chamadas[0]
  assert.match(path, /^\/vessel_lotes\?/)
  assert.match(path, /sku=eq\.SS0003SB\.B1/)
  assert.match(path, /material=not\.is\.null/)
  assert.match(path, /order=criado_em\.desc,id\.desc/)
  assert.match(path, /limit=1/)
})

test('materialMaisRecenteDoSku sem linha nenhuma -> null (SKU sem lote com material)', async () => {
  const sbGet = async () => []
  assert.equal(await materialMaisRecenteDoSku('SEM-LOTE', sbGet), null)
})

test('pilulaDeGarantiaDoSku junta a busca + o texto: canvas e couro', async () => {
  const sbGetCanvas = async () => [{ material: 'canvas' }]
  const sbGetCouro = async () => [{ material: 'couro' }]
  assert.equal(await pilulaDeGarantiaDoSku('SS0001HB.B1', sbGetCanvas), '2 anos de garantia')
  assert.equal(await pilulaDeGarantiaDoSku('SS0003SB.B1', sbGetCouro), '6 meses de garantia')
})

test('SKU inexistente (nenhum lote com material) -> sem pílula, sem erro', async () => {
  const sbGet = async () => []
  assert.equal(await pilulaDeGarantiaDoSku('NAO-EXISTE-999', sbGet), null)
})

test('⚠️ busca que falha (erro de rede/banco) -> sem pílula, NUNCA derruba a arte, registra o motivo', async () => {
  const avisos = []
  const sbGet = async () => { throw new Error('fetch failed: ECONNREFUSED') }
  const r = await pilulaDeGarantiaDoSku('SS0001HB.B1', sbGet, { log: (m) => avisos.push(m) })
  assert.equal(r, null)
  assert.equal(avisos.length, 1)
  assert.match(avisos[0], /SS0001HB\.B1/)
  assert.match(avisos[0], /ECONNREFUSED/)
  assert.doesNotMatch(avisos[0].toLowerCase() + r, /2 anos/) // nunca volta a chutar 2 anos no erro
})

test('a busca que falha não lança (a chamadora não precisa de try/catch)', async () => {
  const sbGet = async () => { throw new Error('boom') }
  await assert.doesNotReject(() => pilulaDeGarantiaDoSku('X', sbGet, { log: () => {} }))
})
