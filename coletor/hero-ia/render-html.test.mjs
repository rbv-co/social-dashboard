// coletor/hero-ia/render-html.test.mjs
//
// A pílula "2 anos de garantia" da arte deixou de ser texto cravado — agora
// vem de `d.garantiaTexto` (resolvido por `texto-da-garantia.mjs`, pelo
// material do lote do SKU). Sem `garantiaTexto`, a arte sai SEM pílula
// nenhuma — nunca chuta "2 anos" fixo (decisão do dono, 18/09/2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildHtml } from './render-html.mjs'

const DADOS_BASE = {
  name: 'BOLSA TESTE', camp: 'NOVA COLEÇÃO', precoDe: '1.000,00', precoPor: '800,00',
  parcelado: '80,00', parcelas: 10, pct: 20,
}
// PNG 1x1 mínimo, só para heroDataUrl não quebrar o parse do template
const HERO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test('com garantiaTexto (canvas), a pílula aparece com o texto certo', () => {
  const html = buildHtml('feed_1x1', 'desconto', HERO, { ...DADOS_BASE, garantiaTexto: '2 anos de garantia' })
  assert.match(html, />2 anos de garantia</)
})

test('com garantiaTexto (couro), a pílula mostra "6 meses de garantia"', () => {
  const html = buildHtml('feed_1x1', 'desconto', HERO, { ...DADOS_BASE, garantiaTexto: '6 meses de garantia' })
  assert.match(html, />6 meses de garantia</)
})

test('⚠️ sem garantiaTexto (sku sem material, ou busca falhou), NENHUMA pílula de garantia entra na arte', () => {
  const html = buildHtml('feed_1x1', 'desconto', HERO, { ...DADOS_BASE })
  assert.doesNotMatch(html, /anos de garantia/)
  assert.doesNotMatch(html, /meses de garantia/)
  assert.doesNotMatch(html, /\b2 anos\b/)
})

test('garantiaTexto null (mesmo formato que a busca falhada devolve) também não mostra pílula', () => {
  const html = buildHtml('feed_1x1', 'desconto', HERO, { ...DADOS_BASE, garantiaTexto: null })
  assert.doesNotMatch(html, /anos de garantia/)
  assert.doesNotMatch(html, /meses de garantia/)
})

test('branding (sem preço) nunca teve pílula de garantia — continua sem, mesmo com garantiaTexto', () => {
  const html = buildHtml('feed_1x1', 'branding', HERO, { ...DADOS_BASE, garantiaTexto: '2 anos de garantia' })
  assert.doesNotMatch(html, /anos de garantia/)
})

test('⚠️ nada de "2 anos" cravado sobrou no código-fonte do módulo', () => {
  const fonte = readFileSync(new URL('./render-html.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(fonte, />2 anos de garantia</, 'a pílula não pode mais vir escrita fixa')
})
