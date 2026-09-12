import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/* Os botões da Frota têm TRÊS famílias, e uma medida cada.
 *
 * Este teste existe porque o dono olhou a ferramenta e disse: "os botões estão
 * divergentes, vários tamanhos". Estavam mesmo — os de ação vinham em 44px e
 * 40px conforme o arquivo, e no computador o "?" e o "✕" ficavam lado a lado
 * com 24px e 34px. Cada componente novo nascia escolhendo a própria medida,
 * porque componente com `<style scoped>` não herda o do vizinho e a cópia
 * sempre saía um pouco diferente.
 *
 * A referência é `.fr-btn`, que já era a mais usada e a que dá o alvo com
 * folga. Se um botão novo precisar de outra medida, o lugar de decidir isso é
 * aqui — e quem mudar tem de dizer por quê. */

const pasta = dirname(fileURLToPath(import.meta.url))
const arquivos = readdirSync(pasta).filter((f) => f.endsWith('.vue'))
const fonte = Object.fromEntries(arquivos.map((f) => [f, readFileSync(join(pasta, f), 'utf8')]))

/* Pegar a regra que DEFINE o tamanho, e não a primeira que cita a classe.
 * `.fr-outros li .fr-btn{flex:0 0 auto;}` cita `.fr-btn` e vem antes no
 * arquivo — se este teste lesse aquela, mediria o botão errado e passaria
 * verde sem ter olhado nada. */
function regras(texto, classe) {
  const achadas = []
  for (const m of texto.matchAll(new RegExp(`\\.${classe}\\{([^}]*)\\}`, 'g'))) achadas.push(m[1])
  return achadas
}
const acha = (classe, precisaDe = /(?:min-)?height:\d+px/) => {
  for (const [arq, txt] of Object.entries(fonte)) {
    const corpo = regras(txt, classe).find((c) => precisaDe.test(c))
    if (corpo) return { arq, corpo }
  }
  return null
}

// ── Botão de ação: 44px, o mesmo em toda a ferramenta ──────────────────────

const DE_ACAO = ['fr-btn', 'lm-btn', 'sr-btn']

test('todo botão de ação tem a MESMA altura', () => {
  const alturas = DE_ACAO.map((c) => {
    const r = acha(c)
    assert.ok(r, `.${c} sumiu — se foi renomeado, atualize este teste`)
    const m = r.corpo.match(/min-height:(\d+)px/)
    assert.ok(m, `.${c} não declara min-height, e alvo de toque não se deixa ao acaso`)
    return Number(m[1])
  })
  assert.equal(new Set(alturas).size, 1, `alturas diferentes: ${alturas.join(', ')}`)
  assert.equal(alturas[0], 44)
})

test('todo botão de ação tem o MESMO respiro e a MESMA letra', () => {
  const assinaturas = DE_ACAO.map((c) => {
    const { corpo } = acha(c)
    const pad = (corpo.match(/padding:([^;]+)/) || [])[1]
    const letra = (corpo.match(/font-size:max\(9px, calc\(([\d.]+)px/) || [])[1]
    return `${pad}|${letra}`
  })
  assert.equal(new Set(assinaturas).size, 1, `divergem: ${assinaturas.join('  ×  ')}`)
})

// ── Botão de ícone: o "?" e o "✕" são irmãos na mesma linha ────────────────

test('no celular, todo botão de ícone tem 40px — o alvo que o padrão exige', () => {
  for (const c of ['fr-fechar', 'lm-fechar', 'fr-btn-ajuda']) {
    const { corpo } = acha(c)
    assert.match(corpo, /width:40px/, `.${c} devia ter 40px no celular`)
    assert.match(corpo, /height:40px/, `.${c} devia ter 40px no celular`)
  }
})

test('no computador, o "?" e o "✕" encolhem JUNTOS e para o mesmo tamanho', () => {
  // Eles dividem a linha do topo do modal. Ficavam em 24px e 34px lado a lado,
  // e a diferença saltava à vista.
  const tela = fonte['tela-de-frota.vue']
  const desktop = tela.slice(tela.indexOf('@media(min-width:900px)'))
  const tam = (c) => {
    const m = desktop.match(new RegExp(`\\.${c}\\{[^}]*width:(\\d+)px`))
    return m ? Number(m[1]) : null
  }
  assert.equal(tam('tela-frota .fr-fechar'), tam('tela-frota .fr-btn-ajuda'))
})

// ── No computador, cartão e botão param de variar de tamanho ───────────────
//
// Segunda bronca do dono sobre o mesmo assunto (13/08/2026): "os cards, botões
// no computador estão feios, precisa harmonizar e centralizar melhor os
// tamanhos". A primeira rodada igualou a ALTURA dos botões; o que sobrou foi a
// LARGURA deles e a altura dos cartões.

test('na grade do computador o botão não estica pra preencher o cartão', () => {
  // `.fr-btn` nasce com `flex:1 1 auto` — certo no celular, onde o dedo quer a
  // largura toda. Na grade do computador aquilo dava cartão com um botão de
  // ponta a ponta ao lado de cartão com três botões de larguras diferentes.
  const tela = fonte['tela-de-frota.vue']
  const desktop = tela.slice(tela.indexOf('@media(min-width:900px)'))
  const m = desktop.match(/\.tela-frota \.fr-lista \.fr-acoes \.fr-btn\{([^}]*)\}/)
  assert.ok(m, 'sumiu a regra que impede o botão de esticar no computador')
  assert.match(m[1], /flex:0 /, 'o botão voltou a esticar (flex-grow diferente de 0)')
  assert.match(m[1], /min-width:\d+px/, 'sem largura mínima igual não há harmonia nenhuma')
})

test('a ação cola no rodapé do cartão, e só do cartão', () => {
  const tela = fonte['tela-de-frota.vue']
  // O cartão precisa ser coluna, senão o `auto` não tem eixo pra empurrar.
  const card = regras(tela, 'tela-frota \\.fr-card').find((c) => /background/.test(c))
  assert.ok(card, '.fr-card sumiu — se foi renomeado, atualize este teste')
  assert.match(card, /flex-direction:column/, 'sem coluna, margin-top:auto não empurra nada')
  // FILHO DIRETO: `.fr-acoes` também aparece dentro da caixa da senha do
  // convite, no meio de outros parágrafos. Um `auto` solto empurraria aquela
  // linha de botões — e tudo o que vem depois — pro pé da caixa.
  assert.match(tela, /\.tela-frota \.fr-card > \.fr-acoes\{[^}]*margin-top:auto/,
    'a ação precisa colar no rodapé do cartão, e por filho DIRETO')
})

test('os dois selos da aba Gestão têm a mesma medida', () => {
  // Eles aparecem um embaixo do outro, na mesma aba. Um deles tinha `.8rem`
  // cravado, que além de divergir IGNORA o ajuste de tamanho de letra do app.
  const tela = fonte['tela-de-frota.vue']
  const medida = (classe) => {
    const corpo = regras(tela, classe).find((c) => /font-size/.test(c))
    assert.ok(corpo, `.${classe} sumiu — se foi renomeado, atualize este teste`)
    const letra = (corpo.match(/font-size:max\(9px, calc\(([\d.]+)px/) || [])[1]
    assert.ok(letra, `.${classe} não usa a escala de texto do app`)
    return `${letra}|${(corpo.match(/padding:([^;]+)/) || [])[1]}|${(corpo.match(/border-radius:([^;]+)/) || [])[1]}`
  }
  assert.equal(medida('tela-frota \\.fr-selo'), medida('tela-frota \\.fr-cobranca-selo'))
})

test('os botões rápidos do topo ficam todos da mesma altura no computador', () => {
  // `align-items:start` foi copiado da sanfona de revisões, onde é necessário
  // (cartão que abre). Aqui produzia botão de duas linhas mais alto que o
  // vizinho, e a fila saía desalinhada.
  const brp = fonte['botoes-rapidos.vue']
  const desktop = brp.slice(brp.indexOf('@media(min-width:900px)'))
  const m = desktop.match(/\.brp-grade\{([^}]*)\}/)
  assert.ok(m, '.brp-grade sumiu do trecho de computador')
  assert.doesNotMatch(m[1], /align-items:\s*start/,
    'com align-items:start os botões voltam a ter alturas diferentes')
})

test('nenhum botão da Frota fica abaixo de 34px', () => {
  // 34px é o menor que esta ferramenta usa, e só no computador. Qualquer coisa
  // menor é um alvo que o dedo erra — e um deles APAGA registro do histórico.
  for (const [arq, txt] of Object.entries(fonte)) {
    for (const m of txt.matchAll(/\.((?:fr|lm|sr|brp|gv|ec)-[a-z-]*(?:btn|fechar|mini)[a-z-]*)\{([^}]*)\}/g)) {
      const alt = m[2].match(/(?:min-)?height:(\d+)px/)
      if (!alt) continue
      assert.ok(Number(alt[1]) >= 34, `${arq}: .${m[1]} tem ${alt[1]}px`)
    }
  }
})
