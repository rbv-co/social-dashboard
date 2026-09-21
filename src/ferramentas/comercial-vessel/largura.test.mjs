import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const raiz = new URL('../../../', import.meta.url)
const ler = (c) => readFileSync(new URL(c, raiz), 'utf8')

// ⚠️ Só CINCO telas passam por .container-app → .cv-largo. A sexta, o Funil
// de Carrinho, já usava a largura toda (sem max-width, sem margin:auto) —
// para ela a medida certa é outra, guardada no teste seguinte.
const TELAS = [
  'src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue',
  'src/ferramentas/comercial-vessel/tela-de-private-edit.vue',
  'src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue',
  'src/ferramentas/atendimentos/tela-de-atendimentos.vue',
  'src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue',
]

test('nenhuma tela da familia usa o container estreito', () => {
  for (const c of TELAS) {
    assert.ok(!ler(c).includes('container-app'),
      `${c} ainda usa .container-app, que trava em 1280px`)
  }
})

// ⚠️ FALTAVA A METADE POSITIVA DESTA PROVA: o teste acima só afirma que as
// telas PERDERAM `container-app` — nunca que GANHARAM `cv-largo`. Trocar a
// classe por QUALQUER OUTRO NOME passava nele do mesmo jeito, e a largura
// total é o ponto inteiro desta parte da entrega. Só QUATRO das cinco telas
// acima ganham `cv-largo` de verdade: o menu (`tela-de-menu-comercial-vessel.vue`)
// não usa a classe (ver R8/o teste "o menu nao prende os cards em 62rem" —
// o menu resolve a largura de outro jeito, sem folha do Comercial Vessel
// aplicada a um `cv-body`).
const TELAS_COM_CV_LARGO = [
  'src/ferramentas/comercial-vessel/tela-de-private-edit.vue',
  'src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue',
  'src/ferramentas/atendimentos/tela-de-atendimentos.vue',
  'src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue',
]

test('as quatro telas que usam a folha da familia GANHARAM .cv-largo', () => {
  for (const c of TELAS_COM_CV_LARGO) {
    assert.ok(/class="cv-largo\b/.test(ler(c)),
      `${c} precisa ter a classe cv-largo — sem ela a largura total não é garantida`)
  }
})

test('o menu nao prende os cards em 62rem', () => {
  const fonte = ler('src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue')
  assert.ok(!/max-width:\s*62rem/.test(fonte), 'o menu ainda tem a trava de 62rem')
})

test('a folha da familia define .cv-largo com respiro que cresce', () => {
  const css = ler('src/ferramentas/comercial-vessel/estilo-comercial.css')
  assert.ok(css.includes('.cv-largo'), 'falta a classe .cv-largo')
  assert.ok(/padding-inline:\s*clamp\(/.test(css),
    'o respiro lateral tem de crescer com a tela, com clamp')
  assert.ok(/clamp\(\s*16px/.test(css),
    'no celular o respiro tem de descer a 16px, que e o --gutter de hoje')
})

// ⚠️ SO TOKEN, NUNCA HEX — item 2 do PADRAO-DA-CENTRAL.
test('a folha da familia nao ganhou hex novo', () => {
  const css = ler('src/ferramentas/comercial-vessel/estilo-comercial.css')
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'entrou hex na folha do Comercial Vessel')
})

// ⚠️ O Funil de Carrinho JÁ usava a largura toda — não ganha .cv-largo nem o
// import da folha do Comercial Vessel (ele não é dessa família visualmente).
// A única mudança nele é o respiro lateral, para as seis telas respirarem
// igual. Esse teste guarda essa mudança pontual.
test('o funil de carrinho respira igual as outras cinco', () => {
  const fonte = ler('src/ferramentas/funil-carrinho/tela-de-funil-carrinho.vue')
  assert.ok(fonte.includes('clamp(16px, 2.4vw, 40px)'),
    'o funil de carrinho nao ganhou o respiro responsivo da familia')
})
