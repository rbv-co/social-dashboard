// APLICA e REGISTRA a entrada do robô da cópia no painel de saúde.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-16-robo-da-copia-entra-no-painel.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-robo-da-copia.mjs'])
  const { rows: [r] } = await cli.query(
    `select * from public.robos_esperados where robo = 'guardar-copia-do-banco'`)
  if (!r) throw new Error('a linha nao ficou no painel')
  if (!r.critico) throw new Error('entrou como NAO critico')
  await cli.query('commit')
  console.log(`no painel: ${r.robo}, critico=${r.critico}, cobra apos ${r.horas_sem_sucesso_ate}h`)
} catch (erro) {
  await cli.query('rollback')
  console.error('⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
