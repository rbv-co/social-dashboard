import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// NOME DE MÓDULO USADO NA TELA PRECISA ESTAR IMPORTADO.
//
// Mesmo guarda já criado em frota/, gestao-trafego/, patrimonio/ e admin/,
// depois de três telas quebrarem em produção por função de módulo chamada
// sem import (`npm run build` passa — o Vite não resolve identificador
// livre, o erro só nasce em runtime). meta-ads/ ganhou uma tela nova
// (tela-de-relatorio-por-hora.vue, que importa de relatorio-por-hora.js) e
// ainda não tinha o guarda.

const AQUI = dirname(fileURLToPath(import.meta.url))

function nomesExportados() {
  const mapa = new Map()
  for (const arq of readdirSync(AQUI).filter((f) => f.endsWith('.js') && !f.includes('.test.'))) {
    const src = readFileSync(join(AQUI, arq), 'utf8')
    for (const m of src.matchAll(/export (?:function|const|let) (\w+)/g)) mapa.set(m[1], arq)
  }
  return mapa
}

function semComentarios(codigo) {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
}

function nomesImportados(script) {
  const s = new Set()
  for (const m of script.matchAll(/import \{([^}]+)\} from/g)) {
    for (const n of m[1].split(',')) s.add(n.trim().split(/\s+as\s+/).pop())
  }
  return s
}

function nomesDeclarados(script) {
  const s = new Set()
  for (const m of script.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:function|const|let|var)\s+(\w+)/g)) s.add(m[1])
  return s
}

const TELAS = readdirSync(AQUI).filter((f) => f.endsWith('.vue'))

for (const tela of TELAS) {
  test(`${tela} não usa função de módulo sem importar`, () => {
    const bruto = readFileSync(join(AQUI, tela), 'utf8')
    const script = semComentarios(bruto.slice(bruto.indexOf('<script'), bruto.indexOf('</script>')))
    const importados = nomesImportados(script)
    const declarados = nomesDeclarados(script)
    const faltando = []
    for (const [nome, arq] of nomesExportados()) {
      if (importados.has(nome) || declarados.has(nome)) continue
      const usado = new RegExp(`(^|[^\\w.$'"\`])${nome}\\s*[([.,);\\]}]`, 'm')
      if (usado.test(script)) faltando.push(`${nome} (exportado por ${arq})`)
    }
    assert.deepEqual(faltando, [], `${tela} usa estes nomes e não os importa — quebra ao clicar, e o build NÃO pega`)
  })
}

test('o guarda olha TODAS as telas da pasta, e não só a principal', () => {
  assert.ok(TELAS.includes('tela-de-menu-meta-ads.vue'))
  assert.ok(TELAS.length >= 2, 'a pasta tem mais de uma tela; o guarda precisa ver todas')
})

test('o proprio teste enxerga um import faltando', () => {
  const script = 'import { alfa } from "./x.js"\n beta(1)'
  const importados = nomesImportados(script)
  assert.ok(importados.has('alfa'))
  assert.ok(!importados.has('beta'))
})
