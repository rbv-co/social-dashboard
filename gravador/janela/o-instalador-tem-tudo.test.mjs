/* O INSTALADOR SAI COM TUDO O QUE O PROGRAMA IMPORTA — e nada que precise
 * compilar.
 *
 * O defeito que este arquivo existe para pegar: alguém acrescenta um `import`
 * novo no programa e não põe o arquivo na lista do empacotador. `npm test`
 * continua verde, o instalador é gerado, e o programa morre com "Cannot find
 * module" na bancada, na primeira etiqueta, num Windows onde ninguém sabe ler o
 * console. A lista à mão sempre envelhece — então aqui ela se confere contra os
 * `import` de verdade, caminhando o grafo a partir da entrada.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative, sep } from 'node:path'
import configuracao from '../electron-builder.config.cjs'
// A lista saiu de dentro da configuracao: o empacotador VALIDA aquele objeto e
// recusa chave que nao conhece — nem escondida como nao-enumeravel ela passa.
// Ver `modulos-do-programa.cjs`.
import { MODULOS_DO_PROGRAMA, PASTAS_DO_PROGRAMA } from './modulos-do-programa.cjs'
import pacote from '../package.json' with { type: 'json' }

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '..', '..')
const ENTRADAS = ['gravador/janela/principal.cjs', 'gravador/janela/preload.cjs']

// Pega `from '...'`, `import('...')` e `require('...')` — só os caminhos
// relativos: nome de pacote e módulo do Node (`node:path`) não entram no pacote
// por esta porta.
const CAMINHOS_RELATIVOS = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g

function moduloEmDiante(caminhoRelativo, vistos) {
  if (vistos.has(caminhoRelativo)) return
  vistos.add(caminhoRelativo)
  const absoluto = resolve(RAIZ, caminhoRelativo)
  const fonte = readFileSync(absoluto, 'utf8')
  for (const achado of fonte.matchAll(CAMINHOS_RELATIVOS)) {
    const vizinho = relative(RAIZ, resolve(dirname(absoluto), achado[1])).split(sep).join('/')
    moduloEmDiante(vizinho, vistos)
  }
}

function tudoQueOProgramaImporta() {
  const vistos = new Set()
  for (const entrada of ENTRADAS) moduloEmDiante(entrada, vistos)
  return vistos
}

test('a lista do empacotador cobre TODO arquivo que o programa importa', () => {
  const declarados = new Set(MODULOS_DO_PROGRAMA)
  const faltando = [...tudoQueOProgramaImporta()].filter((m) => !declarados.has(m))
  assert.deepEqual(faltando, [],
    'estes arquivos são importados e não entram no instalador — o programa morreria '
    + 'com "Cannot find module" na bancada:\n  ' + faltando.join('\n  '))
})

test('a lista do empacotador não carrega arquivo que ninguém importa', () => {
  // lista que só cresce vira lista que ninguém lê, e um dia esconde o que falta
  const usados = tudoQueOProgramaImporta()
  const sobrando = MODULOS_DO_PROGRAMA.filter((m) => !usados.has(m))
  assert.deepEqual(sobrando, [])
})

test('a entrada do pacote é a que existe de verdade', () => {
  assert.equal(configuracao.extraMetadata.main, 'gravador/janela/principal.cjs')
  assert.ok(MODULOS_DO_PROGRAMA.includes(configuracao.extraMetadata.main))
})

test('o preload entra no pacote — sem ele a tela não acha o leitor', () => {
  // e o defeito seria silencioso: a tela simplesmente não mostraria o modo de
  // mesa, e a bancada acharia que o programa "não funciona"
  assert.ok(MODULOS_DO_PROGRAMA.includes('gravador/janela/preload.cjs'))
})

test('nenhum arquivo de teste entra no instalador', () => {
  for (const modulo of MODULOS_DO_PROGRAMA) {
    assert.doesNotMatch(modulo, /\.test\./, `${modulo} é teste e não vai para a bancada`)
  }
})

/* ── NADA QUE PRECISE DE FERRAMENTA DE COMPILAÇÃO ─────────────────────────── */

test('as dependências são JavaScript puro: nada de compilar na bancada', () => {
  // A cicatriz de 01/09/2026: a primeira ponte usava uma biblioteca que COMPILA
  // no `npm install`, e compilar exige ferramentas de programação num
  // computador que é de bancada. O dono cortou: nada se instala. O PowerShell
  // que já vem no Windows fala com o `winscard.dll` sem instalar nada.
  const QUE_COMPILAM = /^(pcsclite|@pokusew\/pcsclite|nfc-pcsc|node-hid|serialport|usb|ffi-napi|node-gyp|bufferutil|utf-8-validate)$/
  for (const nome of Object.keys(pacote.dependencies || {})) {
    assert.doesNotMatch(nome, QUE_COMPILAM, `\`${nome}\` compila no install: fora da bancada`)
  }
  for (const nome of Object.keys(pacote.devDependencies || {})) {
    assert.doesNotMatch(nome, QUE_COMPILAM, `\`${nome}\` compila no install`)
  }
})

test('o empacotador e o Electron existem, e o comando de gerar o instalador está pronto', () => {
  assert.ok(pacote.devDependencies?.electron, 'sem o Electron não há janela')
  assert.ok(pacote.devDependencies?.['electron-builder'], 'sem o empacotador não há instalador')
  assert.match(pacote.scripts.empacotar, /electron-builder/)
  assert.match(pacote.scripts.empacotar, /--win/, 'o alvo é Windows: é lá que o leitor fala')
  assert.equal(pacote.main, 'janela/principal.cjs')
})

/* ── AS TRAVAS DO PACOTE ──────────────────────────────────────────────────── */

test('o instalador é do Windows, e pede onde instalar em vez de decidir sozinho', () => {
  assert.equal(configuracao.win.target, 'nsis')
  assert.equal(configuracao.nsis.oneClick, false)
  // sem privilégio de administrador: a bancada não tem a senha
  assert.equal(configuracao.nsis.perMachine, false)
})
