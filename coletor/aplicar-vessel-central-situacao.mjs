// APLICA, REGISTRA e PROVA a porta de escrita da Central.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-17-vessel-central-muda-a-situacao.sql'
const ASSINATURA = 'public.vessel_situacao_do_atendimento(bigint, text)'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-central-situacao.mjs'])

  const { rows: [porta] } = await cli.query(
    `select has_function_privilege('anon',          $1, 'EXECUTE') as anon,
            has_function_privilege('authenticated', $1, 'EXECUTE') as autenticado,
            has_function_privilege('public',        $1, 'EXECUTE') as qualquer_um`,
    [ASSINATURA])
  if (porta.anon) throw new Error('a porta da Central ficou aberta para a rua (anon)')
  if (porta.qualquer_um) throw new Error('public ficou com a porta aberta')
  if (!porta.autenticado) throw new Error('quem esta logado nao consegue chamar')

  await cli.query('savepoint prova')
  const { rows: [p] } = await cli.query(
    `insert into public.vessel_pessoas (nome, telefone, teste)
     values ('Prova da Migration', '5519000000001', true) returning id`)
  const { rows: [a] } = await cli.query(
    `insert into public.vessel_atendimentos
       (pessoa_id, loja, client_advisor, quando, status, origem_registro, teste)
     values ($1, 'iguatemi', 'CA-99', now() + interval '1 day', 'confirmado',
             'prova', true) returning id`, [p.id])

  const chamar = async (id, s) => (await cli.query(
    'select public.vessel_situacao_do_atendimento($1,$2) as r', [id, s])).rows[0].r

  // ⚠️ SEM PERMISSAO NAO PASSA. `auth.uid()` e nulo nesta conexao (nao ha
  // sessao), entao `is_vessel_atendimentos()` responde false — e e exatamente
  // o caso de "qualquer sessao autenticada sem a permissao".
  const negado = await chamar(a.id, 'realizado')
  if (negado.ok !== false || negado.situacao !== 'sem_permissao')
    throw new Error('mudou a situacao SEM permissao: ' + JSON.stringify(negado))

  // Daqui em diante, fingindo que a permissao existe — o que a Central tera.
  await cli.query(`create or replace function public.is_vessel_atendimentos()
    returns boolean language sql stable as $f$ select true $f$`)

  const invalida = await chamar(a.id, 'virou_po')
  if (invalida.situacao !== 'situacao_invalida') throw new Error('aceitou situacao inventada')
  const sumida = await chamar(-1, 'realizado')
  if (sumida.situacao !== 'nao_achei') throw new Error('nao avisou que a linha nao existe')

  const veio = await chamar(a.id, 'realizado')
  if (!veio.ok || veio.antes !== 'confirmado') throw new Error('nao marcou presenca: ' + JSON.stringify(veio))
  const { rows: [depois] } = await cli.query(
    'select status, presenca_em from public.vessel_atendimentos where id = $1', [a.id])
  if (depois.status !== 'realizado' || !depois.presenca_em)
    throw new Error('marcou realizado sem carimbar a chegada')

  // ⚠️ CORRIGIR PARA "NAO VEIO" TEM DE APAGAR A HORA DE CHEGADA. Sem isso o
  // show rate contaria quem nao veio.
  await chamar(a.id, 'no_show')
  const { rows: [corrigido] } = await cli.query(
    'select status, presenca_em from public.vessel_atendimentos where id = $1', [a.id])
  if (corrigido.status !== 'no_show') throw new Error('nao corrigiu para no_show')
  if (corrigido.presenca_em !== null) throw new Error('no_show ficou com hora de chegada — QA11 quebrado')

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query(
    `select count(*)::int as n from public.vessel_atendimentos where origem_registro = 'prova'`)
  if (sobrou.n !== 0) throw new Error('a prova deixou sujeira')

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  porta: authenticated SIM, anon NAO, public NAO')
  console.log('  sem a permissao `atendimentos`, NAO muda nada')
  console.log('  situacao inventada recusada; linha inexistente avisada')
  console.log('  realizado carimba a chegada; corrigir para no_show APAGA o carimbo (QA11)')
  console.log('  prova desfeita                              ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
