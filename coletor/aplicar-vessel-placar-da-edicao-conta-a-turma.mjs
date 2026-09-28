// APLICA, PROVA e REGISTRA: o placar da edição conta os Private Edits das
// stylists da TURMA, em qualquer data e praça (decisão do dono, 28/09/2026).
//   node coletor/aplicar-vessel-placar-da-edicao-conta-a-turma.mjs           → ensaio (desfaz)
//   node coletor/aplicar-vessel-placar-da-edicao-conta-a-turma.mjs --gravar  → grava
// Tudo numa transação. A prova mora num savepoint DESFEITO: uma edição, duas
// stylists e três encontros de mentira (nomes "Prova …"), lidos pelo placar
// como o usuário do dono. Nada disso chega ao COMMIT (conferido no fim).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-28-vessel-placar-da-edicao-conta-a-turma.sql'
const GRAVAR = process.argv.includes('--gravar')
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const falhas = []
const conferir = (ok, frase, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : '  → ' + JSON.stringify(d)}`); if (!ok) falhas.push(frase) }
const IMPRESSAO = `select (select count(*) from public.vessel_stylists)::int s, (select count(*) from public.vessel_private_edits)::int pe,
  (select count(*) from public.vessel_stylist_circle_edicoes)::int ed, (select count(*) from public.vessel_stylist_na_edicao)::int ne,
  (select count(*) from public.vessel_atendimentos)::int at`

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
try {
  const antes = await uma(IMPRESSAO)
  await cli.query('begin')
  if ((await cli.query('select 1 from public.schema_migrations where name = $1', [ARQUIVO])).rowCount) throw new Error('já registrada')
  await cli.query(sql)
  await cli.query('insert into public.schema_migrations (name, observacao) values ($1, $2)',
    [ARQUIVO, 'placar da edição conta os Private Edits da turma, em qualquer data e praça'])

  const src = (await uma(`select prosrc from pg_proc where proname = 'vessel_placar_da_edicao'`)).prosrc
  conferir(!/comeca_em and/.test(src) && /stylist_id in \(select stylist_id from turma_ids\)/.test(src), 'ev recorta pela turma, sem janela de data', null)
  const acl = (await uma(`select proacl::text a from pg_proc where proname = 'vessel_placar_da_edicao'`)).a
  conferir(/authenticated=X/.test(acl) && !/anon=/.test(acl), 'grants iguais (authenticated sim, anon não)', acl)

  await cli.query('savepoint prova')
  const dono = (await uma(`select id from public.profiles where email ilike 'erick@%' limit 1`)).id
  const cps = (await uma(`select id from public.vessel_pracas where sigla = 'CPS'`)).id
  const lim = (await uma(`select id from public.vessel_pracas where sigla = 'LIM'`)).id
  const ed = (await uma(`insert into public.vessel_stylist_circle_edicoes (praca_id, numero, nome, comeca_em, termina_em, situacao)
     values ($1, 900, 'Prova turma', current_date + 10, current_date + 20, 'encerrada') returning id`, [cps])).id
  const da = (await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, cidade, praca_id) values ('STY-PROVA-T1', 'Prova Da Turma', '5519990001111', 'Campinas', $1) returning id`, [cps])).id
  const fora = (await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, cidade, praca_id) values ('STY-PROVA-T2', 'Prova Fora', '5519990002222', 'Campinas', $1) returning id`, [cps])).id
  await cli.query(`insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id) values ($1, $2)`, [da, ed])
  // da turma: um ANTES do início, em OUTRA praça (realizado); um DEPOIS do fim (agendado)
  await cli.query(`insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, praca_id, status, realizado_em)
     values ('PE-PROVA-T1', 'provat1', $1, now() - interval '30 days', 'LIM', $2, 'realizado', current_date - 30)`, [da, lim])
  await cli.query(`insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, praca_id, status)
     values ('PE-PROVA-T2', 'provat2', $1, now() + interval '60 days', 'CPS', $2, 'agendado')`, [da, cps])
  // fora da turma: DENTRO da janela e da praça — não pode contar
  await cli.query(`insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, praca_id, status)
     values ('PE-PROVA-T3', 'provat3', $1, now() + interval '15 days', 'CPS', $2, 'agendado')`, [fora, cps])
  await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: dono, role: 'authenticated' })])
  await cli.query('set local role authenticated')
  const p = (await uma('select public.vessel_placar_da_edicao($1) as p', [ed])).p
  await cli.query('reset role')
  conferir(p.prospectadas === 1, 'turma = 1 (a de fora não entra)', p.prospectadas)
  conferir(p.encontros_agendados === 2 && p.encontros_realizados === 1, 'conta o de ANTES do início, em outra praça, e o de DEPOIS do fim; não o da de fora', p)
  conferir(p.com_private_edit_realizado === 1 && p.com_private_edit_agendado === 1, 'passos da turma contam os encontros fora da janela', p)
  await cli.query('rollback to savepoint prova')
  const sobrou = await uma(`select (select count(*) from public.vessel_stylists where codigo like 'STY-PROVA-T%')::int s,
    (select count(*) from public.vessel_private_edits where codigo like 'PE-PROVA-T%')::int e`)
  conferir(sobrou.s === 0 && sobrou.e === 0, 'nada da prova sobrou depois do desfazer', sobrou)

  if (falhas.length || !GRAVAR) {
    await cli.query('rollback')
    console.log(falhas.length ? `❌ nada gravado: ${falhas.length} falha(s)` : '✅ ensaio limpo, nada gravado. Rode com --gravar.')
    process.exitCode = falhas.length ? 1 : 0
  } else {
    const r = await cli.query('commit')
    if (r.command !== 'COMMIT') throw new Error('commit virou ' + r.command)
    console.log(`✅ ${ARQUIVO} aplicada e registrada.`)
  }
  const depois = await uma(IMPRESSAO)
  conferir(JSON.stringify(antes) === JSON.stringify(depois), 'tabelas com as mesmas contagens de antes', { antes, depois })
} catch (e) { await cli.query('rollback').catch(() => {}); console.error('❌', e.message); process.exitCode = 1 } finally { await cli.end() }
