#!/usr/bin/env node
// CONFERE SE AS MIGRATIONS "PENDENTES" JA ESTAO APLICADAS NO BANCO.
//
//   node coletor/conferir-migrations-pendentes.mjs            # so olha e conta
//   node coletor/conferir-migrations-pendentes.mjs --registrar # registra as que passaram
//
// ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// `run-migrations.mjs` aplica o que ainda nao rodou, olhando a tabela
// `public.schema_migrations`. Quando alguem aplica um .sql pelo painel do
// Supabase, pelo MCP ou na mao, o efeito entra no banco e o REGISTRO nao. O
// arquivo fica "pendente" para sempre.
//
// Isso ja aconteceu duas vezes neste projeto, e a segunda tinha QUINZE
// arquivos. A dívida nao e cosmetica, e o motivo e contra-intuitivo:
//
//   ⚠️ MANDAR O RUNNER "ARRUMAR A LISTA" E A COISA PERIGOSA A FAZER. Ele
//   aplicaria os quinze em ordem alfabetica, e varios deles recriam funcoes que
//   migrations MAIS NOVAS ja substituiram. Em 03/09/2026, rodar o runner teria
//   sobrescrito `vessel_renumerar_lote` pela versao de 30/08 — apagando, sem
//   erro nenhum, a trava que impede o numero de serie de uma bolsa vendida de
//   mudar. Outros dois arquivos fazem `insert` e `update` em dados reais.
//
// O caminho certo e o contrario: CONFERIR que o efeito ja esta la e registrar
// sem reaplicar. E isso que este arquivo faz.
//
// ── COMO ELE CONFERE ───────────────────────────────────────────────────────
//
// Le o .sql, extrai os OBJETOS que ele cria — tabela, funcao, view, trigger,
// policy, indice, coluna nova — e pergunta ao banco se cada um existe.
//
// ⚠️ ELE NAO PROVA COMPORTAMENTO, so existencia. Uma migration que so faz
// `insert`/`update` de dados, ou que so muda o CORPO de uma funcao que ja
// existia, sai como INCONCLUSIVA de proposito, e `--registrar` a deixa de fora:
// melhor uma pendencia que sobra do que um registro que mente.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { objetosDe } from './objetos-de-uma-migration.mjs'

const aqui = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(aqui, '..', 'db', 'migrations')
const REGISTRAR = process.argv.includes('--registrar')

// `--fingir <arquivo.sql>` trata uma migration JA REGISTRADA como se estivesse
// pendente, so para ver o conferidor trabalhar. Nao escreve nada e nao combina
// com `--registrar`. Existe porque a unica forma de provar este arquivo de
// ponta a ponta seria desregistrar algo em producao — e a prova nao pode ser
// mais perigosa que o defeito.
const FINGIR = (() => {
  const i = process.argv.indexOf('--fingir')
  return i === -1 ? [] : process.argv.slice(i + 1).filter((a) => a.endsWith('.sql'))
})()
if (FINGIR.length && REGISTRAR) {
  console.error('--fingir nao anda com --registrar: registraria pelo motivo errado.')
  process.exit(1)
}

const envPath = join(aqui, '.env')
if (existsSync(envPath)) for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue
  const i = l.indexOf('='); if (i === -1) continue
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (!(k in process.env)) process.env[k] = v
}

const CONSULTA = {
  tabela: [`select count(*)::int n from pg_tables where schemaname='public' and tablename=$1`, (o) => [o.alvo]],
  view: [`select count(*)::int n from pg_views where schemaname='public' and viewname=$1`, (o) => [o.alvo]],
  funcao: [`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace
              where s.nspname='public' and p.proname=$1`, (o) => [o.alvo]],
  trigger: [`select count(*)::int n from pg_trigger where tgname=$1 and not tgisinternal`, (o) => [o.alvo]],
  indice: [`select count(*)::int n from pg_indexes where schemaname='public' and indexname=$1`, (o) => [o.alvo]],
  policy: [`select count(*)::int n from pg_policies where schemaname='public' and policyname=$1 and tablename=$2`,
           (o) => [o.alvo, o.dono]],
  coluna: [`select count(*)::int n from information_schema.columns
              where table_schema='public' and table_name=$1 and column_name=$2`, (o) => [o.dono, o.alvo]],
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
try {
  const reg = await c.query('select name from public.schema_migrations')
  const jaRegistradas = new Set(reg.rows.map((r) => r.name))
  const pendentes = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => !jaRegistradas.has(f) || FINGIR.includes(f))

  if (FINGIR.length) console.log(`(fingindo pendentes: ${FINGIR.join(', ')} — nada sera escrito)\n`)

  if (!pendentes.length) {
    console.log('✓ Nenhuma migration pendente de registro.')
    process.exit(0)
  }

  const prontas = []
  for (const arquivo of pendentes) {
    const objetos = objetosDe(readFileSync(join(DIR, arquivo), 'utf8'))
    if (!objetos.length) {
      console.log(`? INCONCLUSIVA   ${arquivo}`)
      console.log('      (nao cria objeto nenhum — so dados ou corpo de funcao. Confira na mao.)')
      continue
    }
    let todas = true
    const linhas = []
    for (const o of objetos) {
      const [sql, args] = CONSULTA[o.tipo]
      const r = await c.query(sql, args(o))
      const ok = Number(r.rows[0]?.n) > 0
      if (!ok) todas = false
      linhas.push(`      ${ok ? '✔' : '✗'} ${o.tipo} ${o.dono ? `${o.dono}.` : ''}${o.alvo}`)
    }
    if (todas) prontas.push(arquivo)
    console.log(`${todas ? '✔ JA APLICADA  ' : '✗ FALTA ALGO   '} ${arquivo}`)
    linhas.forEach((l) => console.log(l))
  }

  console.log(`\n── ${prontas.length} de ${pendentes.length} ja estao no banco ──`)
  if (!REGISTRAR) {
    console.log('Nada foi mudado. Para registrar as que passaram: --registrar')
  } else if (prontas.length) {
    // TUDO NUMA TRANSACAO SO: registro pela metade e a divida de volta, menor.
    await c.query('begin')
    const r = await c.query(
      `insert into public.schema_migrations (name, applied_at, observacao)
       select unnest($1::text[]), now(), $2 on conflict (name) do nothing returning name`,
      [prontas, 'ja estava aplicada; registrada por conferir-migrations-pendentes.mjs, '
        + 'sem reaplicar — reaplicar sobrescreveria funcoes por versoes mais velhas'])
    await c.query('commit')
    console.log('REGISTRADAS:', r.rows.length)
  }
} finally { await c.end() }
