// POS-VIRADA plano 05 (20/10/2026): a 768px os menus Meta Ads (5 cartões) e Gestão Interna (4) punham todos os cartões em UMA linha
// (flex-wrap: nowrap, cada um com ~128–165px) e o título saía cortado ("RELATÓRI", "CRIATIVO") — texto nunca corta (PADRAO-DA-CENTRAL).
// Regra: de 768px para cima o menu QUEBRA linha e cada cartão tem base mínima de 200px.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const menus = [
  ['meta-ads/tela-de-menu-meta-ads.vue', 'smenu'],
  ['gestao-interna/tela-de-menu-gestao-interna.vue', 'gimenu'],
]

for (const [arquivo, p] of menus) {
  test(`${arquivo}: a partir de 768px o menu quebra linha e o cartão tem base de 200px`, () => {
    const css = readFileSync(join(aqui, arquivo), 'utf8')
    const bloco = css.match(/@media\(min-width:768px\)\{([\s\S]*?)\n\}/)
    assert.ok(bloco, 'bloco @media(min-width:768px) não achado')
    const regras = bloco[1]
    assert.match(regras, new RegExp(`\\.${p}-cards\\{[^}]*flex-wrap:wrap`), 'a linha de cartões tem de quebrar (flex-wrap:wrap)')
    assert.doesNotMatch(regras, /flex-wrap:nowrap/, 'nowrap esmaga os cartões e corta o título')
    const card = regras.match(new RegExp(`\\.${p}-card\\{([^}]*)\\}`))
    assert.ok(card, 'regra do cartão não achada')
    const base = card[1].match(/flex:\s*1 1 (\d+)px/)
    assert.ok(base && Number(base[1]) >= 200, `base do cartão deve ser >= 200px (achou ${base && base[1]})`)
  })
  test(`${arquivo}: o título do cartão quebra a palavra em vez de ser cortado (overflow-wrap:anywhere)`, () => {
    const css = readFileSync(join(aqui, arquivo), 'utf8')
    const titulo = css.match(new RegExp(`\\.${p}-card-title\\{([^}]*)\\}`))
    assert.ok(titulo, 'regra do título não achada')
    assert.match(titulo[1], /overflow-wrap:anywhere/)
  })
}
