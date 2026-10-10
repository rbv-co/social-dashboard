// Limpa um dump `pg_dump --schema-only` do Supabase para o Postgres próprio:
// tira policies, RLS, grants para os papéis do Supabase, publicações e extensões que não levamos.
// Divide o texto em COMANDOS respeitando '...', "...", $tag$...$tag$ e comentários, porque
// um corpo de função (`$$ ... $$`) pode ter ';' e até a frase "create policy" dentro.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fimDeAspas(s, i, q) {
  const escapa = q === "'" && /[eE]/.test(s[i - 1] || '') && !/\w/.test(s[i - 2] || ' ')
  for (let j = i + 1; j < s.length; j++) {
    if (escapa && s[j] === '\\') { j++; continue }
    if (s[j] === q) {
      if (s[j + 1] === q) { j++; continue } // aspas dobradas
      return j + 1
    }
  }
  return s.length
}

export function dividir(sql) {
  const itens = []
  let ini = 0
  let i = 0
  const n = sql.length
  // só espaço e comentários desde o início do comando (pg_dump 17.6 põe \restrict depois do cabeçalho em comentário)
  const soEspacoDesde = (de, ate) => semComentarios(sql.slice(de, ate)) === ''
  while (i < n) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') { const f = sql.indexOf('\n', i); i = f < 0 ? n : f + 1; continue }
    if (c === '/' && sql[i + 1] === '*') { const f = sql.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; continue }
    if (c === "'" || c === '"') { i = fimDeAspas(sql, i, c); continue }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80))
      if (m) { const f = sql.indexOf(m[0], i + m[0].length); i = f < 0 ? n : f + m[0].length; continue }
    }
    if (c === '\\' && (i === 0 || sql[i - 1] === '\n') && soEspacoDesde(ini, i)) {
      // comando do psql (\restrict, \unrestrict...): uma linha inteira
      const f = sql.indexOf('\n', i)
      const fim = f < 0 ? n : f + 1
      itens.push(sql.slice(ini, fim)); ini = fim; i = fim; continue
    }
    if (c === ';') { itens.push(sql.slice(ini, i + 1)); ini = i + 1 }
    i++
  }
  if (ini < n) itens.push(sql.slice(ini))
  return itens
}

const semComentarios = (c) => c.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').trim()

const REGRAS = [
  ['policies', /^(create|comment\s+on)\s+policy\b/i],
  ['schemas', /^create\s+schema\s+(if\s+not\s+exists\s+)?"?public"?\s*;$/i],
  ['schemas', /^alter\s+schema\s+"?public"?\s+owner\s+to\b/i],
  ['schemas', /^comment\s+on\s+schema\s+"?public"?\s+is\b/i],
  ['rls', /^alter\s+table\b[\s\S]*\b(enable|force|disable|no\s+force)\s+row\s+level\s+security\s*;$/i],
  ['grants', /^(grant|revoke)\b/i],
  ['grants', /^alter\s+default\s+privileges\b/i],
  ['extensoes', /^create\s+extension\b[\s\S]*\b(pg_cron|pg_net|supabase_vault|pg_stat_statements)\b/i],
  ['extensoes', /^comment\s+on\s+extension\b/i],
  ['publicacoes', /^(create|alter|drop)\s+publication\b/i],
]

// 21 FKs de 16 tabelas apontam para auth.users(id); no banco novo a identidade é public.usuarios.
// Só em alter table / create table: texto dentro de função ou de comentário não é tocado.
const FK_AUTH = /\breferences\s+auth\.users\s*\(\s*id\s*\)/gi

export function limpar(sql) {
  const removidos = { policies: 0, rls: 0, grants: 0, extensoes: 0, publicacoes: 0, schemas: 0 }
  const reescritos = { fks_usuarios: 0 }
  const mantidos = []
  for (const cmd of dividir(sql)) {
    const corpo = semComentarios(cmd)
    const regra = REGRAS.find(([, re]) => re.test(corpo))
    if (regra) { removidos[regra[0]]++; continue }
    if (/^(alter\s+table|create\s+table)\b/i.test(corpo) && corpo.search(FK_AUTH) >= 0) {
      // troca só no corpo do comando (não nos comentários que o antecedem); só conta se o texto mudou
      // (com comentário no meio do comando o corpo sem comentários não aparece em cmd e nada muda)
      const novo = cmd.replace(corpo, () => corpo.replace(FK_AUTH, 'REFERENCES public.usuarios(id)'))
      if (novo !== cmd) reescritos.fks_usuarios += (corpo.match(FK_AUTH) || []).length
      mantidos.push(novo)
    } else mantidos.push(cmd)
  }
  return { sql: mantidos.join(''), removidos, reescritos }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [entrada, saida] = process.argv.slice(2)
  if (!entrada || !saida) { console.error('uso: node limpar-dump.mjs ENTRADA.sql SAIDA.sql'); process.exit(2) }
  const r = limpar(readFileSync(entrada, 'utf8'))
  writeFileSync(saida, r.sql, { mode: 0o600 })
  console.log(JSON.stringify({ removidos: r.removidos, reescritos: r.reescritos }))
}
