// APLICA, REGISTRA e PROVA as chaves próprias das telas do Comercial Vessel.
//
//   node --env-file=<coletor/.env> coletor/aplicar-permissoes-das-ferramentas-do-comercial-vessel.mjs            → ensaio: prova tudo e DESFAZ
//   node --env-file=<coletor/.env> coletor/aplicar-permissoes-das-ferramentas-do-comercial-vessel.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar em `schema_migrations`, provar
// e só então `commit`. Sem `--gravar` o fim é `rollback` — o ensaio roda o
// arquivo inteiro de verdade e não deixa nada.
//
// ⚠️ O ENSAIO LISTA QUEM RECEBERIA O QUÊ, pessoa por pessoa, comparando cada
// perfil antes e depois DENTRO da transação — e reprova se alguém PERDER
// qualquer coisa (a pré-concessão é aditiva: só pode acrescentar).
//
// ⚠️ A PROVA DA TRAVA FALA COMO GENTE DE VERDADE: perfis de mentira em
// `auth.users`/`profiles` e `request.jwt.claims` com o `sub` deles, dentro de
// `savepoint prova` … `rollback to savepoint prova`.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-24-permissoes-das-ferramentas-do-comercial-vessel.sql'
const GRAVAR = process.argv.includes('--gravar')
const NOVAS = ['atendimentos.beauty-sessions', 'atendimentos.private-edit', 'atendimentos.stylist-circle',
  'atendimentos.material-grafico', 'atendimentos.appointment-card']

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}

const RETRATO = `
  select id, email, name, is_superadmin, disabled,
         coalesce(permissions, '{}'::jsonb) as permissions,
         coalesce(permissions_excecao, '{}'::jsonb) as excecao,
         coalesce(features, '{}'::text[]) as features
    from public.profiles order by email`
const RETRATO_PERFIS = `select id, nome, coalesce(permissions, '{}'::jsonb) as permissions from public.acessos_perfis order by id`

// Tudo que estava em `a` continua igual em `b`? (chave a chave, ação a ação)
function perdeu(a, b) {
  const out = []
  for (const [k, v] of Object.entries(a || {})) {
    const depois = (b || {})[k]
    if (JSON.stringify(depois) !== JSON.stringify(v)) out.push(`${k}: ${JSON.stringify(v)} → ${JSON.stringify(depois)}`)
  }
  return out
}
const acrescentou = (a, b) => Object.fromEntries(Object.entries(b || {}).filter(([k]) => !(k in (a || {}))))

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r

const { ja } = await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ja`, [ARQUIVO])
if (ja) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }

const antes = (await cli.query(RETRATO)).rows
const perfisAntes = (await cli.query(RETRATO_PERFIS)).rows

await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-permissoes-das-ferramentas-do-comercial-vessel.mjs'])

  // ── quem recebe o quê ──
  console.log('\n── a pré-concessão (quem já tinha "atendimentos" recebe as chaves novas)')
  const depois = new Map((await cli.query(RETRATO)).rows.map((p) => [p.id, p]))
  let quantos = 0
  for (const a of antes) {
    const d = depois.get(a.id)
    const tirou = [...perdeu(a.permissions, d.permissions), ...perdeu(a.excecao, d.excecao)]
    const semFeature = a.features.filter((f) => !d.features.includes(f))
    conferir(!tirou.length && !semFeature.length, `${a.email}: ninguém perde nada`, { tirou, semFeature })
    const ganhou = acrescentou(a.permissions, d.permissions)
    const ganhouExc = acrescentou(a.excecao, d.excecao)
    if (Object.keys(ganhou).length || Object.keys(ganhouExc).length) {
      quantos++
      console.log(`    → ${a.name || '(sem nome)'} <${a.email}>`)
      for (const [k, v] of Object.entries(ganhou)) console.log(`        + ${k} ${JSON.stringify(v)}`)
      for (const [k, v] of Object.entries(ganhouExc)) console.log(`        + (exceção) ${k} ${JSON.stringify(v)}`)
      console.log(`        + features: ${d.features.filter((f) => !a.features.includes(f)).join(', ')}`)
      const temAtend = (a.permissions.atendimentos || []).includes('ver')
      conferir(temAtend, `${a.email}: só recebe quem já tinha "atendimentos"`, a.permissions.atendimentos)
      conferir(Object.keys(ganhou).every((k) => NOVAS.includes(k)), `${a.email}: só recebe as chaves novas`, ganhou)
    }
    if (a.is_superadmin || a.disabled) {
      conferir(JSON.stringify(a.permissions) === JSON.stringify(d.permissions),
        `${a.email}: super-admin/desativado não é tocado`, d.permissions)
    }
  }
  console.log(`    ${quantos} pessoa(s) recebem chaves novas; ${antes.length} perfis conferidos.`)
  const perfisDepois = new Map((await cli.query(RETRATO_PERFIS)).rows.map((p) => [p.id, p]))
  for (const a of perfisAntes) {
    const d = perfisDepois.get(a.id)
    conferir(!perdeu(a.permissions, d.permissions).length, `perfil de acesso "${a.nome}": não perde nada`, d.permissions)
    const g = acrescentou(a.permissions, d.permissions)
    if (Object.keys(g).length) console.log(`    → perfil "${a.nome}" + ${Object.keys(g).join(', ')}`)
  }
  console.log(`    ${perfisAntes.length} perfil(is) de acesso conferidos.`)

  // Rodar a concessão de novo não muda nada (é idempotente).
  const antesDeRepetir = (await cli.query(RETRATO)).rows
  await cli.query('savepoint repetir')
  await cli.query(sql.slice(sql.indexOf('-- ── 2. A pré-concessão aditiva')))
  const repetido = (await cli.query(RETRATO)).rows
  conferir(JSON.stringify(repetido) === JSON.stringify(antesDeRepetir), 'rodar a concessão duas vezes não muda nada', null)
  await cli.query('rollback to savepoint repetir')

  // ── a trava, falando como gente ──
  console.log('\n── a trava do banco')
  await cli.query('savepoint prova')
  const perfil = async (features, permissions, disabled = false) => {
    const id = randomUUID()
    const email = `prova-perm-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(
      `insert into public.profiles (id, email, features, permissions, is_superadmin, disabled)
       values ($1, $2, $3, $4::jsonb, false, $5)`, [id, email, features, JSON.stringify(permissions), disabled])
    return id
  }
  const falarComo = async (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])
  const casos = [
    ['só "atendimentos" [ver, editar] (o modelo de hoje)', ['atendimentos'], { atendimentos: ['ver', 'editar'] }, false, true, true],
    ['só "atendimentos" [ver]', ['atendimentos'], { atendimentos: ['ver'] }, false, true, false],
    ['só o Stylist Circle [ver, editar]', ['atendimentos', 'atendimentos.stylist-circle'], { 'atendimentos.stylist-circle': ['ver', 'editar'] }, false, true, true],
    ['só o Material Gráfico [ver]', ['atendimentos', 'atendimentos.material-grafico'], { 'atendimentos.material-grafico': ['ver'] }, false, true, false],
    ['features só com a chave da tela (sem o pai)', ['atendimentos.beauty-sessions'], { 'atendimentos.beauty-sessions': ['ver'] }, false, true, false],
    ['nada do Comercial Vessel', ['banco'], { banco: ['ver'] }, false, false, false],
    ['chave parecida, de outra família ("atendimentosx")', ['atendimentosx'], { atendimentosx: ['ver', 'editar'] }, false, false, false],
    ['conta DESATIVADA com "atendimentos" [ver, editar]', ['atendimentos'], { atendimentos: ['ver', 'editar'] }, true, false, false],
  ]
  for (const [nome, features, permissions, desativada, ver, editar] of casos) {
    const id = await perfil(features, permissions, desativada)
    await falarComo(id)
    const v = await r('public.is_vessel_atendimentos()')
    const e = await r('public.is_vessel_atendimentos_editar()')
    conferir(v === ver && e === editar, `${nome}: ver=${ver} editar=${editar}`, { v, e })
  }
  await falarComo(null)
  conferir((await r('public.is_vessel_atendimentos()')) === false, 'sem sessão: não vê', null)
  await cli.query('rollback to savepoint prova')

  const pr = await uma(`select has_function_privilege('anon', 'public.is_vessel_atendimentos()', 'EXECUTE') as anon1,
                               has_function_privilege('anon', 'public.is_vessel_atendimentos_editar()', 'EXECUTE') as anon2,
                               has_function_privilege('authenticated', 'public.is_vessel_atendimentos_editar()', 'EXECUTE') as aut`)
  conferir(!pr.anon1 && !pr.anon2 && pr.aut, 'a página pública não chama a trava; a Central chama', pr)

  if (falhas.length) throw new Error(`${falhas.length} conferência(s) falharam`)
  if (GRAVAR) {
    await cli.query('commit')
    console.log('\n✅ GRAVADO.')
  } else {
    await cli.query('rollback')
    console.log('\n🧪 ENSAIO — tudo conferido e DESFEITO. Para gravar: --gravar')
  }
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error(`\n❌ ${e.message}\nNada foi gravado.`)
  process.exitCode = 1
} finally {
  if (!GRAVAR) {
    const fim = (await cli.query(RETRATO)).rows
    conferir(JSON.stringify(fim) === JSON.stringify(antes), 'depois do ensaio, os perfis estão exatamente como antes', null)
  }
  await cli.end()
}
