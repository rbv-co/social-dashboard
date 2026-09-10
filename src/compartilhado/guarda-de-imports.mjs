import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'

// O MOTOR DO GUARDA DE IMPORTS — um só, para todas as pastas.
//
// O DEFEITO QUE ELE PEGA: chamar uma função de um vizinho e esquecer de
// importá-la. O `npm run build` passa — o Vite não resolve identificador livre,
// supõe que é global do navegador — e o erro só nasce quando alguém clica. O Vue
// aborta o desenho no meio e o painel fica EM BRANCO, muitas vezes sem nada no
// console. O `todo-vue-compila.test.mjs` também não pega: compilar não é
// resolver nome.
//
// Já derrubou tela quatro vezes:
//   29/07  Gestão de Tráfego  `card` e `baldeEfetivo`, duas vezes no mesmo dia
//   05/08  Admin              `vendedoras`, `veOEstoque`, `podeLiberarEstoque`
//   10/08  Patrimônio         `formatarDataBR` — Planilha e Resumo em branco
//
// POR QUE VIROU UM ARQUIVO SÓ (14/08/2026): o guarda existia em 9 pastas, como 9
// cópias quase iguais do mesmo código, e faltava em 13. Cada falso positivo
// descoberto tinha de ser consertado em 9 lugares — e não era: as cópias já
// tinham divergido entre si. Quatro delas nem olhavam o miolo compartilhado, e
// sete olhavam UMA tela da pasta em vez de todas. Guarda que precisa ser copiado
// à mão é guarda que a próxima pasta nasce sem.
//
// Uso, na pasta que se quer guardar (`imports.test.mjs`):
//
//     import { guardarImports } from '../../compartilhado/guarda-de-imports.mjs'
//     guardarImports(import.meta.url)
//
// Este arquivo é `.mjs` de propósito: as pastas varrem os `.js` vizinhos atrás
// de exports, e o motor não pode entrar na própria varredura.

// A raiz `src/`, subindo a partir da pasta guardada. Sem isto, cada pasta teria
// de acertar quantos `..` a separam do miolo — e uma subpasta (relatorios/)
// erraria a conta calada, ficando sem a cobertura do compartilhado.
function raizSrc(pasta) {
  let atual = pasta
  while (basename(atual) !== 'src') {
    const acima = dirname(atual)
    if (acima === atual) return null
    atual = acima
  }
  return atual
}

// De onde saem os nomes que a tela pode estar usando sem importar: o miolo
// compartilhado e a própria pasta. A pasta vem por último de propósito — nome
// repetido nos dois lados é o daqui que a tela usa sem caminho, e é ele que o
// recado precisa citar.
export function pastasDeExportacao(aqui) {
  const src = raizSrc(aqui)
  const compartilhado = src && join(src, 'compartilhado')
  const lista = []
  if (compartilhado && existsSync(compartilhado) && compartilhado !== aqui) lista.push(compartilhado)
  lista.push(aqui)
  return lista
}

export function nomesExportados(pastas) {
  const mapa = new Map()
  for (const pasta of pastas) {
    for (const arq of readdirSync(pasta).filter((f) => f.endsWith('.js') && !f.includes('.test.'))) {
      const src = readFileSync(join(pasta, arq), 'utf8')
      // `async function` entra junto: exportar uma função assíncrona e esquecer
      // o import quebra igualzinho.
      for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/g)) {
        mapa.set(m[1], arq)
      }
    }
  }
  return mapa
}

// Comentário que MENCIONA um símbolo não é uso dele, e texto de tela também não
// é código. Sem apagar os dois, nomes que são palavra comum do português
// ("linha", "resumo", "etiqueta") acusariam import faltando que não falta — e um
// teste que acusa o que não existe ensina a ignorá-lo.
//
// A crase fica de propósito: `${...}` dentro dela é código de verdade.
export function semComentarios(codigo) {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')          // bloco
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')       // linha (o [^:] evita cortar "https://")
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")      // texto entre aspas simples
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')      // e entre aspas duplas
}

// TODOS os blocos `<script>` do arquivo, e não só o primeiro. Um `.vue` pode ter
// `<script>` e `<script setup>` lado a lado; recortar do primeiro `<script` até
// o primeiro `</script>` deixava o segundo bloco sem guarda nenhum.
export function scriptDoVue(bruto) {
  const partes = []
  for (const m of bruto.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) partes.push(m[1])
  return semComentarios(partes.join('\n'))
}

export function nomesImportados(script) {
  const s = new Set()
  for (const m of script.matchAll(/import \{([^}]+)\} from/g)) {
    for (const n of m[1].split(',')) s.add(n.trim().split(/\s+as\s+/).pop())
  }
  return s
}

// Nome que o próprio arquivo declara não precisa vir de fora. Sem isto, uma
// `function formatarValor()` local viraria acusação falsa só porque um vizinho
// exporta o mesmo nome.
export function nomesDeclarados(script) {
  const s = new Set()
  for (const m of script.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(\w+)/g)) {
    s.add(m[1])
  }
  // Desmontagem também é declaração: `const { formatarDataBR } = algumaCoisa` e
  // `const [primeiro] = lista` criam o nome aqui dentro. Sem esta parte eles
  // virariam acusação falsa.
  for (const m of script.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s*[{[]([^}\]]+)[}\]]\s*=/g)) {
    for (const bruto of m[1].split(',')) {
      const nome = bruto.trim().split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '')
      if (/^\w+$/.test(nome)) s.add(nome)
    }
  }
  return s
}

export function usosSemImport(script, exportados) {
  const importados = nomesImportados(script)
  const declarados = nomesDeclarados(script)
  const faltando = []
  for (const [nome, arq] of exportados) {
    if (importados.has(nome) || declarados.has(nome)) continue
    // Chamada `nome(`, indexação `NOME[`, acesso `NOME.` ou uso solto. Só
    // `nome(` não basta — constante usada como objeto passa batido, e foi assim
    // que a Gestão de Tráfego quebrou pela terceira vez no mesmo dia.
    const usado = new RegExp(`(^|[^\\w.$'"\`])${nome}\\s*[([.,);\\]}]`, 'm')
    if (usado.test(script)) faltando.push(`${nome} (exportado por ${arq})`)
  }
  return faltando
}

/**
 * Liga o guarda na pasta do arquivo de teste que chamar.
 *
 * @param {string} url            sempre `import.meta.url`
 * @param {object} [opcoes]
 * @param {Record<string,string>} [opcoes.ignorar]  nome → MOTIVO escrito. Exceção
 *        sem motivo não passa: o padrão da Central manda escrever por que, senão
 *        o próximo que passar por aqui não sabe se ainda vale.
 * @param {number} [opcoes.minimoDeTelas]  quantas telas a pasta tem de ter. Sem
 *        isto, apagar ou renomear o `.vue` deixaria o guarda passando por estar
 *        vazio — que é o mesmo que não existir.
 */
export function guardarImports(url, opcoes = {}) {
  const { ignorar = {}, minimoDeTelas = 1 } = opcoes
  const aqui = dirname(fileURLToPath(url))
  const pasta = basename(aqui)
  const telas = readdirSync(aqui).filter((f) => f.endsWith('.vue')).sort()

  test(`${pasta}/ tem tela para guardar — o guarda não pode passar por estar vazio`, () => {
    assert.ok(
      telas.length >= minimoDeTelas,
      `esperava ao menos ${minimoDeTelas} .vue em ${pasta}/, achei ${telas.length}`,
    )
  })

  for (const tela of telas) {
    test(`${pasta}/${tela} não usa função de módulo sem importar`, () => {
      const script = scriptDoVue(readFileSync(join(aqui, tela), 'utf8'))
      const exportados = nomesExportados(pastasDeExportacao(aqui))
      for (const nome of Object.keys(ignorar)) exportados.delete(nome)
      assert.deepEqual(
        usosSemImport(script, exportados), [],
        `${tela} usa estes nomes e não os importa — abre em branco, e o build NÃO pega`,
      )
    })
  }

  test(`${pasta}/ enxerga o miolo compartilhado`, () => {
    // Sem isto, mover um arquivo para o compartilhado desligaria a cobertura em
    // silêncio — foi o que aconteceu com o `nova-opcao.js` em 13/08.
    const mapa = nomesExportados(pastasDeExportacao(aqui))
    assert.ok(mapa.size > 0, `nenhum export visível a partir de ${pasta}/`)
  })
}

// ── SEGUNDO GUARDA: NOME CHAMADO QUE NÃO EXISTE EM LUGAR NENHUM ─────────────
//
// ⚠️ O DE CIMA NÃO PEGA ISTO, e a diferença custou uma noite em 09/09/2026.
// Ele parte dos nomes EXPORTADOS por um vizinho e cobra o import — então só vê
// nome que existe em algum módulo. Nesse dia a tela de redes sociais chamou
// `escHtml(...)`, que não é exportado por ninguém: mora dentro do
// `tela-de-admin.vue`. `ReferenceError` no meio do desenho, a tela parava ali, e
// da seção Meta Ads para baixo TUDO ficava zerado. Build passou, 4592 testes
// passaram, e quem descobriu foi o dono abrindo a tela — pela terceira vez no dia.
//
// Este parte do lado oposto: todo nome CHAMADO como função tem de existir.
//
// ⚠️ ELE TRABALHA COM BASE CONGELADA, E ISSO É DELIBERADO. A leitura é por
// expressão regular, não por analisador de verdade: texto em português dentro de
// crase e aspas desbalanceadas fazem o recorte engolir código, e alguns nomes
// legítimos aparecem como "sem dono" (`_acProvisionar` ESTÁ declarado, na linha
// 1885 do seu arquivo). Acusar esses seria ensinar todo mundo a ignorar o guarda.
// Então a base de hoje é aceita, e o guarda falha em QUALQUER NOME NOVO — que é
// exatamente o caso do `escHtml`, provado antes de ligar.
//
// Quando alguém trocar isto por um analisador de verdade, a base sai junto.

const GLOBAIS_DO_NAVEGADOR = new Set((
  'defineProps defineEmits defineExpose defineOptions defineModel withDefaults '
  + 'window document localStorage sessionStorage console Math JSON Number String Boolean '
  + 'Array Object Date Set Map WeakMap WeakSet Promise parseInt parseFloat isNaN isFinite '
  + 'setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame '
  + 'URLSearchParams URL fetch Intl RegExp Error TypeError RangeError alert confirm prompt '
  + 'navigator location history atob btoa encodeURIComponent decodeURIComponent structuredClone '
  + 'AbortController FormData Blob File FileReader Image CustomEvent Event MouseEvent KeyboardEvent '
  + 'IntersectionObserver ResizeObserver MutationObserver getComputedStyle matchMedia scrollTo print '
  + 'queueMicrotask crypto performance Symbol BigInt Proxy Reflect async '
  + 'Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array '
  + 'ArrayBuffer DataView TextEncoder TextDecoder'
).split(' '))

const PALAVRAS_DA_LINGUAGEM = /^(if|for|while|switch|catch|return|typeof|function|new|await|of|in|do|else|case|delete|void|instanceof|yield|import|super|this|throw|try|finally|class|extends)$/

/** ⚠️ O TEXTO DENTRO DE CRASE SAI; `${...}` FICA, porque ali é código de verdade.
 *  Sem isto, palavra do português virava "função que não existe". */
export function semTextoDeCrase(script) {
  return script.replace(/`(?:[^`\\]|\\.)*`/g, (bloco) => {
    const miolos = [...bloco.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]).join(' ; ')
    return '`' + miolos + '`'
  })
}

/** Nomes que a própria função cria: parâmetros, `catch (e)`, `for (const x`. */
export function nomesDeParametro(script) {
  const s = new Set()
  const juntar = (bruto) => {
    const n = String(bruto).trim().split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '')
    if (/^\w+$/.test(n)) s.add(n)
  }
  for (const m of script.matchAll(/function\s*\w*\s*\(([^)]*)\)/g)) m[1].split(',').forEach(juntar)
  for (const m of script.matchAll(/\(([^()]*)\)\s*=>/g)) m[1].split(',').forEach(juntar)
  for (const m of script.matchAll(/(?:^|[^\w.$])(\w+)\s*=>/g)) s.add(m[1])
  for (const m of script.matchAll(/catch\s*\(\s*(\w+)/g)) s.add(m[1])
  for (const m of script.matchAll(/for\s*\(\s*(?:const|let|var)\s+(\w+)/g)) s.add(m[1])
  for (const m of script.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) m[1].split(',').forEach(juntar)
  return s
}

/** Os nomes chamados como função que não existem no arquivo nem vêm de fora. */
export function chamadasSemDono(bruto) {
  const script = semTextoDeCrase(bruto)
  const conhecidos = new Set([
    ...nomesImportados(script), ...nomesDeclarados(script),
    ...nomesDeParametro(script), ...GLOBAIS_DO_NAVEGADOR,
  ])
  const fora = new Set()
  for (const m of script.matchAll(/(^|[^\w.$'"`])([a-zA-Z_$][\w$]*)\s*\(/gm)) {
    const nome = m[2]
    if (conhecidos.has(nome) || PALAVRAS_DA_LINGUAGEM.test(nome)) continue
    fora.add(nome)
  }
  return [...fora].sort()
}
