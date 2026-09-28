import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* O WHATSAPP DO "CADASTRAR LEAD NESTA SESSÃO" CABE INTEIRO (28/09/2026).
 *
 * ⚠️ O ESTRAGO: a 375px a linha "WhatsApp com DDD" tinha país e DDD com 4,2rem
 * e 3,8rem FIXOS (67 + 61px) e a caixa do número ficava com 119px —
 * "98877-6655" aparecia "98877-665". A 320px sobravam 38px para o texto.
 *
 * Este teste não abre navegador (o `npm test` roda sem um): ele lê o CSS de
 * verdade da tela e refaz a conta da linha com as medidas tiradas num Chrome
 * de verdade. Se alguém devolver largura fixa em rem ao país/DDD, engordar o
 * respiro ou afastar as caixas, a conta estoura e o teste reprova. A prova de
 * tela continua sendo medir a 320/375/390/430px (ver o PR desta correção).
 */

const raiz = new URL('../../../', import.meta.url)
const vue = readFileSync(new URL('src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue', raiz), 'utf8')
const globais = readFileSync(new URL('src/estilos/estilos-globais.css', raiz), 'utf8')

// ── MEDIDO no Chrome, fonte Sora a 16px (--texto-campo), demonstração, 28/09/2026 ──
const LINHA_A_320 = 225      // largura de .bs-fone a 320px (cartão + caixa do formulário)
const CH = 11.89             // 1ch = o "0", o dígito MAIS LARGO desta fonte
const MAIS = 9.44            // o "+" antes do país
const PIOR_NUMERO = 113.7    // "90000-0000": o celular mais largo que existe
const BORDA = 2              // 1px de cada lado

const sp = Object.fromEntries([...globais.matchAll(/--sp-(\d):(\d+)px/g)].map(([, n, v]) => [`--sp-${n}`, Number(v)]))
const px = (valor) => {
  const v = valor.trim().replace(/var\((--sp-\d)\)/g, (_, t) => sp[t])
  return Number(v.replace('px', ''))
}

/** Os corpos de TODAS as regras `… seletor { … }` do trecho (também a agrupada, `seletor, outro { … }`), juntos e em ordem
 * (a última declaração vence, como no navegador — `propriedade` lê a última). */
function regra(trecho, seletor) {
  const esc = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...trecho.matchAll(new RegExp(`(?:^|[\\s,}])${esc}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';')
}
function propriedade(corpo, nome) {
  const ms = [...corpo.matchAll(new RegExp(`(?:^|[;\\s])${nome}\\s*:\\s*([^;]+)`, 'g'))]
  return ms.length ? ms[ms.length - 1][1].trim() : null
}
/** O trecho de dentro de um `@media (...) { … }`, casando as chaves. */
function dentroDaMedia(cabeca) {
  const i = vue.indexOf(cabeca)
  assert.ok(i >= 0, `falta o bloco ${cabeca}`)
  let n = 0
  for (let j = vue.indexOf('{', i); j < vue.length; j++) {
    if (vue[j] === '{') n++
    else if (vue[j] === '}' && --n === 0) return vue.slice(vue.indexOf('{', i) + 1, j)
  }
  throw new Error(`bloco ${cabeca} sem fechar`)
}
/** `calc(3ch + 2 * var(--sp-1) + 2px)` → em px, com o ch medido. */
function larguraEmPx(valor) {
  const m = valor.match(/^calc\((\d)ch \+ 2 \* var\((--sp-\d)\) \+ 2px\)$/)
  assert.ok(m, `a largura "${valor}" tem de ser "calc(Nch + 2 * var(--sp-X) + 2px)": os dígitos + o respiro + a borda`)
  return Number(m[1]) * CH + 2 * sp[m[2]] + BORDA
}

test('país e DDD têm a largura dos DÍGITOS (3ch e 2ch), não um rem fixo', () => {
  for (const [classe, digitos] of [['.bs-fone-pais', 3], ['.bs-fone-ddd', 2]]) {
    // TODAS as larguras declaradas (a do computador E a do celular), não só a última.
    const larguras = [...regra(vue, `.bs-campo ${classe}`).matchAll(/(?:^|[;\s])width\s*:\s*([^;]+)/g)].map((m) => m[1].trim())
    assert.ok(larguras.length >= 2, `${classe} precisa de width no computador e no celular`)
    for (const w of larguras) {
      assert.ok(w.startsWith(`calc(${digitos}ch`), `${classe} tem de medir ${digitos}ch + respiro (achei: ${w})`)
    }
  }
})

test('o número fica com TODO o resto da linha e pode encolher sem empurrar a página', () => {
  const corpo = regra(vue, '.bs-campo .bs-fone-numero')
  assert.match(propriedade(corpo, 'flex') || '', /^1 1 /, 'o número cresce e encolhe (flex: 1 1 0)')
  assert.equal(propriedade(corpo, 'min-width'), '0', 'sem min-width:0 o input empurra a linha para fora da tela')
})

test('⚠️ a 320px o número MAIS LARGO de celular cabe inteiro na caixa', () => {
  const cel = dentroDaMedia('@media (max-width: 640px)')
  const estreito = dentroDaMedia('@media (max-width: 22.5rem)')
  const gap = px(propriedade(regra(cel, '.bs-fone'), 'gap'))
  const pais = larguraEmPx(propriedade(regra(cel, '.bs-campo .bs-fone-pais'), 'width'))
  const ddd = larguraEmPx(propriedade(regra(cel, '.bs-campo .bs-fone-ddd'), 'width'))
  const respiro = px(propriedade(regra(estreito, '.bs-campo .bs-fone-numero'), 'padding-inline'))
  // O "+" cola no país (.bs-fone-ddi, sem gap): a linha tem 3 peças e 2 vãos.
  assert.equal(propriedade(regra(vue, '.bs-fone-ddi'), 'gap'), null, 'o "+" cola no país: .bs-fone-ddi sem gap')
  const caixa = LINHA_A_320 - MAIS - pais - ddd - 2 * gap
  const livre = caixa - 2 * respiro - BORDA
  assert.ok(livre >= PIOR_NUMERO,
    `a 320px sobram ${livre.toFixed(1)}px para o texto e "90000-0000" mede ${PIOR_NUMERO}px — o último dígito corta`)
})

test('país e DDD cabem os próprios dígitos (3 e 2 zeros) com o respiro do celular', () => {
  const cel = dentroDaMedia('@media (max-width: 640px)')
  for (const [classe, digitos] of [['.bs-fone-pais', 3], ['.bs-fone-ddd', 2]]) {
    const corpo = regra(cel, `.bs-campo ${classe}`)
    const w = larguraEmPx(propriedade(corpo, 'width'))
    const respiro = px(propriedade(corpo, 'padding-inline'))
    assert.ok(w - 2 * respiro - BORDA >= digitos * CH, `${classe}: ${digitos} zeros não cabem`)
  }
})
