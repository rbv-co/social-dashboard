import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// TODO CONTROLE DESENHADO PRECISA TER QUEM O LIGUE.
//
// POR QUE ESTE ARQUIVO EXISTE (12/08/2026): `imports.test.mjs` já pega o nome
// usado sem importar. Ele NÃO pega o outro fim do mesmo cano — um botão ou uma
// caixinha que a tela desenha e ninguém escuta. O clique não faz nada, não dá
// erro nenhum no console, e o `npm run build` passa.
//
// A seção de times já teve exatamente isso: a caixinha de liberar estoque
// existia em regra (`veOEstoque`), tinha teste verde, e ficou DOIS MESES sem
// ser desenhada nem ligada. O que faltava era alguém perguntar "quem chama
// isto?" — que é a pergunta que este arquivo faz sozinho, toda vez.
//
// A seção de times e a de puxar vendedoras desenham por string de HTML e ligam
// por `data-...` em `_eqLigar`. Então o par é conferível: todo `data-eq-*` e
// `data-vd-*` que sai no HTML tem de aparecer ou num seletor `[data-...]` ou
// num `getAttribute('data-...')`.

const AQUI = dirname(fileURLToPath(import.meta.url))

// Comentário não é código: este mesmo arquivo cita `data-eq-*` em texto, e a
// tela também explica os controles em comentário. Sem apagá-los, a explicação
// viraria acusação.
function semComentarios(codigo) {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function scriptDaTela() {
  const vue = readFileSync(join(AQUI, 'tela-de-admin.vue'), 'utf8')
  return semComentarios(vue.slice(vue.indexOf('<script'), vue.indexOf('</script>')))
}

// Onde o atributo é ESCRITO no HTML: `data-eq-foo="` ou `data-eq-foo>` ou
// `data-eq-foo ` (atributo sem valor). O que NÃO conta é o `[data-eq-foo]`,
// que é o seletor — é justamente o outro lado da conta.
function desenhados(script) {
  const s = new Set()
  for (const m of script.matchAll(/(^|[^[\w-])(data-(?:eq|vd)-[a-z-]+)/g)) s.add(m[2])
  return s
}

function ligados(script) {
  const s = new Set()
  for (const m of script.matchAll(/\[(data-(?:eq|vd)-[a-z-]+)/g)) s.add(m[1])
  for (const m of script.matchAll(/getAttribute\(['"](data-(?:eq|vd)-[a-z-]+)['"]\)/g)) s.add(m[1])
  return s
}

test('todo controle data-eq/data-vd desenhado tem quem o escute', () => {
  const script = scriptDaTela()
  const soltos = [...desenhados(script)].filter((a) => !ligados(script).has(a)).sort()
  assert.deepEqual(soltos, [],
    'estes controles aparecem na tela e ninguém os liga — o clique não faz nada e o build NÃO pega')
})

test('todo seletor data-eq/data-vd escutado tem quem o desenhe', () => {
  // O contrário também importa, e é mais silencioso ainda: renomear o atributo
  // no HTML e esquecer o seletor deixa a tela sem o controle e o código com um
  // `onclick` que nunca casa com nada.
  const script = scriptDaTela()
  const orfaos = [...ligados(script)].filter((a) => !desenhados(script).has(a)).sort()
  assert.deepEqual(orfaos, [],
    'estes seletores não casam com nenhum atributo desenhado — o controle sumiu da tela')
})

test('os controles que esta rodada acrescentou estao na conta', () => {
  // Sem isto, os dois testes acima passariam iguais se a seção inteira fosse
  // apagada por engano numa substituição de texto — que é exatamente como o
  // import da `agruparVendedores` se perdeu em 05/08/2026.
  const d = desenhados(scriptDaTela())
  for (const alvo of ['data-eq-pessoas', 'data-vd-perfil']) {
    assert.ok(d.has(alvo), alvo + ' sumiu da tela')
  }
})

test('o card da loja tem onde pendurar as pessoas', () => {
  // `data-eq-pessoas` é o lugar vazio que `_eqLigar` preenche com o MESMO
  // cartão da lista de baixo. Se ele sumir do HTML, os times ficam sem gente e
  // nada quebra — o card só aparece vazio, que é o defeito mais silencioso
  // possível numa tela de permissão.
  const script = scriptDaTela()
  assert.match(script, /data-eq-pessoas="/, 'o card da loja não tem o lugar das pessoas')
  assert.match(script, /_eqDesenharPessoas\(cx, t\)/, 'ninguém preenche o lugar das pessoas')
  assert.match(script, /_criarLinhaPessoa\(p, _eqGaveta, _eqMeuEmail\)/,
    'o time parou de usar o MESMO cartão da lista de baixo — dois cartões divergem')
})

test('o proprio guarda enxerga um controle solto', () => {
  // Um teste que não sabe falhar passa sempre — e o defeito que ele deveria
  // pegar já passou por aqui duas vezes.
  const script = 'h += \'<button data-eq-zumbi>Clique</button>\'\n q(\'[data-eq-vivo]\')'
  const soltos = [...desenhados(script)].filter((a) => !ligados(script).has(a))
  assert.deepEqual(soltos, ['data-eq-zumbi'])
  const orfaos = [...ligados(script)].filter((a) => !desenhados(script).has(a))
  assert.deepEqual(orfaos, ['data-eq-vivo'])
})
