// APLICA, REGISTRA e PROVA o log de caroços ao vivo.
//
// ⚠️ A PROVA QUE MAIS IMPORTA AQUI é a de que as quinze conferências existem
// DOS DOIS LADOS: o nome e o "o que fazer" no JavaScript, a consulta na função
// do banco. Depois desta entrega elas moram em arquivos diferentes, e é
// exatamente assim que uma some sem ninguém notar — o log continuaria saindo,
// só que com uma aba a menos de verdade dentro.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { CONFERENCIAS } from '../supabase/functions/_shared/carocos-no-angu.js'

const ARQUIVO = '2026-09-22-log-de-carocos-ao-vivo.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-log-ao-vivo.mjs'])

  // ── a porta: só o service role ────────────────────────────────────────────
  // Esta função devolve nome, WhatsApp e valor de venda de gente de verdade.
  const porta = async (papel) => (await cli.query(
    `select has_function_privilege($1, 'public.vessel_carocos()', 'EXECUTE') as pode`,
    [papel])).rows[0].pode
  for (const papel of ['anon', 'authenticated']) {
    if (await porta(papel)) throw new Error(`${papel} consegue ler a base inteira pela funcao`)
  }
  if (!await porta('service_role')) throw new Error('o robo nao consegue chamar a funcao')

  // ── ⚠️ AS QUINZE, DOS DOIS LADOS ──────────────────────────────────────────
  const { rows: [{ vessel_carocos: tudo }] } = await cli.query('select public.vessel_carocos()')
  const noBanco = new Set(Object.keys(tudo ?? {}))
  const noCodigo = new Set(CONFERENCIAS.map((c) => c.chave))

  const soNoCodigo = [...noCodigo].filter((k) => !noBanco.has(k))
  const soNoBanco = [...noBanco].filter((k) => !noCodigo.has(k))
  if (soNoCodigo.length) {
    throw new Error('conferencia sem consulta no banco: ' + soNoCodigo.join(', '))
  }
  if (soNoBanco.length) {
    throw new Error('consulta no banco sem conferencia no codigo: ' + soNoBanco.join(', '))
  }

  // ── e cada uma devolve o contrato de quatro colunas ───────────────────────
  // ⚠️ Conferência que devolve coluna com outro nome geraria célula vazia sem
  // erro nenhum — o log mentiria em silêncio.
  let comLinha = 0
  for (const c of CONFERENCIAS) {
    const linhas = tudo[c.chave]
    if (!Array.isArray(linhas)) throw new Error(`${c.chave} nao devolveu lista`)
    if (linhas.length === 0) continue
    comLinha++
    for (const coluna of ['quem', 'quando', 'detalhe', 'valor']) {
      if (!(coluna in linhas[0])) {
        throw new Error(`${c.chave} nao devolve a coluna "${coluna}": `
          + JSON.stringify(Object.keys(linhas[0])))
      }
    }
  }

  // ── o horário e o vigia ───────────────────────────────────────────────────
  const { rows: [job] } = await cli.query(
    `select schedule, active from cron.job where jobname = 'vessel-log-de-carocos'`)
  if (!job) throw new Error('o horario nao foi criado')
  if (!job.active) throw new Error('o horario nasceu desligado')

  const { rows: [segredo] } = await cli.query(
    `select length(segredo) as n from public.segredos_de_cron where nome = 'vessel-log-de-carocos'`)
  if (!segredo || segredo.n !== 64) throw new Error('o segredo do cron nao foi gerado direito')

  const { rows: [vigia] } = await cli.query(
    `select situacao from public.robos_saude where robo = 'vessel-log-de-carocos'`)
  if (!vigia) throw new Error('o vigia nao passou a olhar para o robo')

  await cli.query('commit')
  const total = Object.values(tudo).reduce((t, l) => t + l.length, 0)
  console.log('aplicada, registrada e provada.\n')
  console.log(`  ${CONFERENCIAS.length} conferencias, e as ${CONFERENCIAS.length} existem DOS DOIS LADOS`)
  console.log(`  ${comLinha} delas acharam algo agora — ${total} linha(s) no total`)
  console.log('  as quatro colunas do contrato (quem, quando, detalhe, valor) conferidas')
  console.log('  a porta: anon NAO · authenticated NAO · service_role SIM')
  console.log(`  horario: ${job.schedule}  (ativo)`)
  console.log(`  o vigia ja olha para ele: situacao "${vigia.situacao}"`)
} catch (e) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + e.message)
  process.exitCode = 1
} finally { await cli.end() }
