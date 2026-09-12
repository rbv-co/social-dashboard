import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  nomesDeclarados,
  nomesExportados,
  nomesImportados,
  pastasDeExportacao,
  scriptDoVue,
  semComentarios,
  usosSemImport,
} from './guarda-de-imports.mjs'

// O guarda guardando a si mesmo.
//
// Estes testes moravam repetidos dentro de cada `imports.test.mjs` — nove
// cópias, já divergentes. Agora vivem aqui, uma vez, porque o motor é um só.
//
// O mais importante da lista é o primeiro: um guarda que passa SEMPRE não
// protege nada, e foi exatamente nesse estado que o defeito passou nas quatro
// vezes em que derrubou tela.

const AQUI = dirname(fileURLToPath(import.meta.url))

function exportadosDeMentira(pares) {
  return new Map(pares)
}

test('o guarda enxerga um import faltando', () => {
  const script = 'import { alfa } from "./x.js"\n beta(1)'
  const importados = nomesImportados(script)
  assert.ok(importados.has('alfa'))
  assert.ok(!importados.has('beta'))
  assert.deepEqual(
    usosSemImport(script, exportadosDeMentira([['beta', 'vizinho.js']])),
    ['beta (exportado por vizinho.js)'],
  )
})

test('pega CONSTANTE usada como objeto, e não só chamada de função', () => {
  // `ALVOS[o]` passou batido na primeira versão do teste e quebrou a aba da
  // Gestão de Tráfego pela TERCEIRA vez no mesmo dia (29/07/2026).
  const script = 'import { alfa } from "./x.js"\n const x = SITUACOES[0]'
  assert.deepEqual(
    usosSemImport(script, exportadosDeMentira([['SITUACOES', 'situacoes.js']])),
    ['SITUACOES (exportado por situacoes.js)'],
  )
})

test('o guarda não lê TEXTO DE TELA como se fosse código', () => {
  // A tela da Gestão de Tráfego tem a frase `'<b>Nada mudou.</b>'` e um módulo
  // exporta `mudou`. Sem apagar o conteúdo das aspas, o guarda acusava um import
  // que não faltava — e teste que acusa o que não existe ensina a ignorá-lo.
  const script = semComentarios("const aviso = 'confira o normalizarNome(agora)'")
  assert.deepEqual(usosSemImport(script, exportadosDeMentira([['normalizarNome', 'nomes.js']])), [])
})

test('comentário que MENCIONA o nome também não é uso', () => {
  const script = semComentarios('// ver formatarDataBR(x) para o formato\nconst a = 1')
  assert.deepEqual(usosSemImport(script, exportadosDeMentira([['formatarDataBR', 'datas.js']])), [])
})

test('a crase sobrevive: `${...}` dentro dela é código de verdade', () => {
  const script = semComentarios('const t = `total ${formatarValor(n)}`')
  assert.deepEqual(
    usosSemImport(script, exportadosDeMentira([['formatarValor', 'dinheiro.js']])),
    ['formatarValor (exportado por dinheiro.js)'],
  )
})

test('nome declarado no próprio arquivo não vira acusação falsa', () => {
  const script = 'function formatarValor(c) { return c }\n formatarValor(1)'
  assert.ok(nomesDeclarados(script).has('formatarValor'))
  assert.deepEqual(usosSemImport(script, exportadosDeMentira([['formatarValor', 'dinheiro.js']])), [])
})

test('nome que vem de desmontagem também é declaração', () => {
  // `const { formatarDataBR } = props` cria o nome aqui dentro. Sem isto o
  // guarda acusaria um import que não falta.
  const script = 'const { formatarDataBR, outro } = props\n formatarDataBR(1)'
  const declarados = nomesDeclarados(script)
  assert.ok(declarados.has('formatarDataBR'))
  assert.ok(declarados.has('outro'))
  assert.deepEqual(usosSemImport(script, exportadosDeMentira([['formatarDataBR', 'datas.js']])), [])
})

test('import com apelido conta pelo nome que a tela usa', () => {
  const script = 'import { alfa as beta } from "./x.js"\n beta(1)'
  assert.ok(nomesImportados(script).has('beta'))
  assert.deepEqual(usosSemImport(script, exportadosDeMentira([['beta', 'x.js']])), [])
})

test('o guarda lê TODOS os blocos <script>, não só o primeiro', () => {
  // Um `.vue` pode ter `<script>` e `<script setup>` lado a lado. Recortar do
  // primeiro `<script` até o primeiro `</script>` deixava o segundo sem guarda.
  const vue = '<template><b>oi</b></template>\n<script>export default {}</script>\n<script setup>\nfaltante(1)\n</script>'
  const script = scriptDoVue(vue)
  assert.ok(script.includes('faltante(1)'), 'o segundo bloco de script ficou de fora')
  assert.deepEqual(
    usosSemImport(script, exportadosDeMentira([['faltante', 'vizinho.js']])),
    ['faltante (exportado por vizinho.js)'],
  )
})

test('a partir de uma subpasta, o miolo compartilhado continua na conta', () => {
  // `compartilhado/relatorios/` fica um nível mais fundo. Se a conta dos `..`
  // fosse feita à mão em cada pasta, esta erraria calada — e o guarda de lá
  // ficaria sem enxergar o miolo.
  const pastas = pastasDeExportacao(join(AQUI, 'relatorios'))
  assert.ok(pastas.some((p) => p.endsWith('/compartilhado')), `não achei o compartilhado em ${pastas}`)
  assert.ok(pastas.some((p) => p.endsWith('/relatorios')))
})

test('dentro do próprio compartilhado a pasta não entra duas vezes', () => {
  assert.deepEqual(pastasDeExportacao(AQUI), [AQUI])
})

test('o motor .mjs não entra na varredura de exports', () => {
  // Se ele entrasse, `usosSemImport` e `semComentarios` — nomes deste arquivo —
  // virariam acusação em qualquer tela que usasse palavra parecida.
  const mapa = nomesExportados([AQUI])
  assert.ok(!mapa.has('guardarImports'), 'o motor entrou na conta dos exports')
  assert.ok(mapa.size > 0, 'a varredura do compartilhado veio vazia')
})

test('o guarda vê de verdade os nomes do compartilhado', () => {
  // Sem isto, mover um arquivo desligaria a cobertura em silêncio.
  const mapa = nomesExportados([AQUI])
  assert.equal(mapa.get('resolverNovaOpcao'), 'nova-opcao.js')
  assert.ok(mapa.has('mesclarPessoas'), 'pessoas-para-escolher.js precisa entrar na conta')
})
