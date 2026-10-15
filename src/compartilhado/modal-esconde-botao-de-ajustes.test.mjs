// Defeito medido a 375px (revisão 05, 15/10/2026): o botão flutuante de tema/zoom (.btn-ajustes, z-index 9998)
// ficava na frente de modal com camada baixa (z 50/60 de Patrimônio e Conteúdo) e cobria o "Excluir" da peça e o
// seletor "Situação" da ficha do bem — o toque ia para o botão, não para o modal. Com modal aberto, o fundo está
// travado (travar-rolagem-de-fundo.js): essa mesma trava marca o <body> e o CSS esconde o botão.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { travar, destravar } from './travar-rolagem-de-fundo.js'

function documentoFalso() {
  const attrs = new Set()
  return { attrs, documentElement: { style: {}, clientWidth: 400 }, body: { style: {}, setAttribute: (n) => attrs.add(n), removeAttribute: (n) => attrs.delete(n) } }
}

test('travar marca o body e destravar tira a marca', () => {
  const d = documentoFalso()
  travar(d, { innerWidth: 400, scrollY: 0 })
  assert.ok(d.attrs.has('data-modal-aberto'))
  destravar(d, { scrollTo() {} })
  assert.ok(!d.attrs.has('data-modal-aberto'))
})

test('o CSS da moldura esconde .btn-ajustes com a marca no body', () => {
  const vue = readFileSync(new URL('../moldura-do-aplicativo.vue', import.meta.url), 'utf8')
  assert.match(vue, /body\[data-modal-aberto\]\s+\.btn-ajustes\s*\{[^}]*display:\s*none/)
})
