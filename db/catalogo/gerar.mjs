// Uso: node db/catalogo/gerar.mjs  -> docs/migracao-go/catalogo-policies.json
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { catalogo } from './policies.mjs'

const RAIZ = new URL('../..', import.meta.url).pathname
const sqls = (dir) => readdirSync(dir, { recursive: true })
  .map(String).filter((f) => f.endsWith('.sql')).map((f) => join(dir, f))
  .filter((f) => statSync(f).isFile())

const arquivos = [...sqls(join(RAIZ, 'db/migrations')), ...sqls(join(RAIZ, 'supabase/migrations'))]
  .sort((a, b) => relative(RAIZ, a).localeCompare(relative(RAIZ, b)))
  .map((f) => ({ nome: relative(RAIZ, f), sql: readFileSync(f, 'utf8') }))

const lista = catalogo(arquivos)
mkdirSync(join(RAIZ, 'docs/migracao-go'), { recursive: true })
writeFileSync(join(RAIZ, 'docs/migracao-go/catalogo-policies.json'), JSON.stringify(lista, null, 2) + '\n')
console.log(`${lista.length} policies em ${new Set(lista.map((p) => p.tabela)).size} tabelas`)
