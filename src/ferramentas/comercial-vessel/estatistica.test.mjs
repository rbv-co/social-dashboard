import test from 'node:test'
import assert from 'node:assert/strict'
import {
  intervaloDeWilson, proporcao, emPorcento, taxaEscrita, margemEscrita,
  proporcaoDoConjunto, emReais, janelaEscrita, LARGURA_MAXIMA_UTIL,
} from './estatistica.js'

/* ── O INTERVALO ────────────────────────────────────────────────────────── */

test('⚠️ com ZERO sucessos a margem NÃO é zero — é aí que a fórmula de livro-texto mente', () => {
  /* Wald daria `0 ± 1.96·√(0·1/4)` = 0: "0% de conversão, sem margem de erro",
   * sobre 4 pessoas. Falso e convincente, a pior combinação. */
  const i = intervaloDeWilson(0, 4)
  assert.equal(i.de, 0)
  assert.ok(i.ate > 0.3, `com 0 de 4 o teto tem de ser alto; veio ${i.ate}`)
})

test('⚠️ com TODOS os sucessos a margem também não é zero', () => {
  const i = intervaloDeWilson(4, 4)
  assert.equal(i.ate, 1)
  assert.ok(i.de < 0.7, `com 4 de 4 o piso tem de ser baixo; veio ${i.de}`)
})

test('⚠️ o intervalo NUNCA sai de 0..100% — Wald sairia', () => {
  for (const [x, n] of [[0, 3], [1, 3], [3, 3], [1, 100], [99, 100], [0, 1], [1, 1]]) {
    const i = intervaloDeWilson(x, n)
    assert.ok(i.de >= 0 && i.de <= 1, `piso fora da faixa em ${x}/${n}: ${i.de}`)
    assert.ok(i.ate >= 0 && i.ate <= 1, `teto fora da faixa em ${x}/${n}: ${i.ate}`)
    assert.ok(i.de <= i.ate, `intervalo invertido em ${x}/${n}`)
  }
})

test('o intervalo ENCOLHE quando a base cresce, com a mesma proporção', () => {
  const largura = (x, n) => { const i = intervaloDeWilson(x, n); return i.ate - i.de }
  assert.ok(largura(5, 10) > largura(50, 100), 'base 10x maior tem de dar margem menor')
  assert.ok(largura(50, 100) > largura(500, 1000))
})

test('Wilson bate com o valor conhecido de 50% em 100 (≈ 40,4% a 59,6%)', () => {
  /* Âncora numérica: se alguém trocar a fórmula, isto reprova. */
  const i = intervaloDeWilson(50, 100)
  assert.ok(Math.abs(i.de - 0.404) < 0.005, `piso veio ${i.de}`)
  assert.ok(Math.abs(i.ate - 0.596) < 0.005, `teto veio ${i.ate}`)
})

test('sem base não existe intervalo', () => {
  assert.equal(intervaloDeWilson(0, 0), null)
  assert.equal(intervaloDeWilson(3, 0), null)
})

/* ── A PROPORÇÃO PRONTA PARA A TELA ─────────────────────────────────────── */

test('⚠️ base ZERO não vira 0% — vira "sem base"', () => {
  /* "0%" faz uma sessão que ninguém abriu parecer uma que fracassou. */
  const p = proporcao(0, 0)
  assert.equal(p.temBase, false)
  assert.equal(p.valor, null)
  assert.equal(taxaEscrita(p), 'sem base ainda')
})

test('⚠️ a taxa SEMPRE viaja com o denominador', () => {
  assert.equal(taxaEscrita(proporcao(9, 46)), '20% (9 de 46)')
  assert.equal(taxaEscrita(proporcao(1, 3)), '33% (1 de 3)')
})

test('⚠️ base pequena é DENUNCIADA na tela, com a faixa', () => {
  /* 1 de 3 é uma pessoa, não uma taxa. A tela tem de dizer isso. */
  const p = proporcao(1, 3)
  assert.equal(p.confiavel, false)
  assert.match(margemEscrita(p), /base pequena/)
  assert.match(margemEscrita(p), /entre .*% e .*%/)
})

test('base grande não fica repetindo a margem — aviso que aparece sempre vira paisagem', () => {
  const p = proporcao(500, 1000)
  assert.equal(p.confiavel, true)
  assert.equal(margemEscrita(p), '')
})

test('o corte de utilidade é o declarado, e num lugar só', () => {
  assert.equal(LARGURA_MAXIMA_UTIL, 0.20)
  const p = proporcao(50, 100)
  assert.equal(p.confiavel, (p.intervalo.ate - p.intervalo.de) <= LARGURA_MAXIMA_UTIL)
})

test('proporcao aguenta entrada torta sem quebrar a tela', () => {
  for (const [x, n] of [[null, null], [undefined, 10], ['a', 'b'], [-1, 5]]) {
    const p = proporcao(x, n)
    assert.ok(typeof p.temBase === 'boolean')
  }
})

/* ── O CONJUNTO ─────────────────────────────────────────────────────────── */

test('⚠️ a taxa do conjunto NÃO é a média das taxas', () => {
  /* Três sessões: 1/2 (50%), 1/2 (50%) e 20/200 (10%). A média das taxas dá
   * 36,7% — e estaria dando a uma sessão de 2 leituras o mesmo peso de uma com
   * 200. A conta certa é 22 de 204 = 11%. */
  const linhas = [
    { pessoas: 1, leituras: 2 },
    { pessoas: 1, leituras: 2 },
    { pessoas: 20, leituras: 200 },
  ]
  const p = proporcaoDoConjunto(linhas, 'pessoas', 'leituras')
  assert.equal(p.x, 22)
  assert.equal(p.n, 204)
  assert.equal(emPorcento(p.valor), '11%')
  const mediaDasTaxas = (0.5 + 0.5 + 0.1) / 3
  assert.ok(Math.abs(p.valor - mediaDasTaxas) > 0.2, 'a conta caiu na média das taxas')
})

test('conjunto vazio não vira zero por cento', () => {
  assert.equal(proporcaoDoConjunto([], 'a', 'b').temBase, false)
  assert.equal(proporcaoDoConjunto(null, 'a', 'b').temBase, false)
})

/* ── AS FRASES ──────────────────────────────────────────────────────────── */

test('emPorcento não inventa número para o vazio', () => {
  assert.equal(emPorcento(null), '—')
  assert.equal(emPorcento(undefined), '—')
  assert.equal(emPorcento(NaN), '—')
  assert.equal(emPorcento(0), '0%')
})

test('dinheiro em reais, sem centavos', () => {
  assert.match(emReais(18900), /R\$\s?18\.900/)
  assert.match(emReais(0), /R\$\s?0/)
  assert.match(emReais(null), /R\$\s?0/)
})

test('⚠️ a janela de venda é dita por extenso, e vem do banco', () => {
  /* Não existe no dado campo dizendo "esta compra veio daquele encontro". A
   * régua viaja na resposta para não divergir da conta que a produziu. */
  assert.equal(janelaEscrita(7), 'compra em até 7 dias da visita')
  assert.equal(janelaEscrita(1), 'compra em até 1 dia da visita')
  assert.equal(janelaEscrita(0), 'compra no mesmo dia da visita')
  // ⚠️ `Number(null)` é 0 e é finito: sem guarda, "sem janela" viraria
  // "até 0 dias" — régua inventada com cara de régua real.
  assert.equal(janelaEscrita(null), '')
  assert.equal(janelaEscrita(undefined), '')
  assert.equal(janelaEscrita(''), '')
  assert.equal(janelaEscrita(-2), '')
})

/* ── RAZÃO NÃO É PROPORÇÃO ──────────────────────────────────────────────── */

test('⚠️ razão pode passar de 1 — e por isso não é taxa', async () => {
  const { razao, razaoEscrita } = await import('./estatistica.js')
  /* A mesma cliente pode pedir visita duas vezes: 5 pedidos de 3 clientes. */
  const r = razao(5, 3)
  assert.ok(r.valor > 1, 'razão tem de poder passar de 1')
  assert.match(razaoEscrita(r, 'por cliente'), /1,7 por cliente \(5 em 3\)/)
})

test('⚠️ razão NÃO devolve intervalo — Wilson não se aplica', async () => {
  const { razao } = await import('./estatistica.js')
  /* Wilson pressupõe que cada unidade do denominador dá sim ou não UMA vez.
   * Devolver um intervalo aqui seria dizer errado com cara de rigor. */
  assert.equal(razao(5, 3).intervalo, undefined)
})

test('razão sem base não vira zero', async () => {
  const { razao, razaoEscrita } = await import('./estatistica.js')
  assert.equal(razao(0, 0).temBase, false)
  assert.equal(razaoEscrita(razao(0, 0)), 'sem base ainda')
})
