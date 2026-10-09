// APLICA, REGISTRA e PROVA a tabela vessel_cartao_arquivos (db/migrations/2026-10-09-vessel-cartao-arquivos.sql).
//
// Só a migration desta entrega, na mesma transação do registro em `schema_migrations`. NUNCA rodar `run-migrations.mjs`
// inteiro: há migrations pendentes de outras pessoas (CLAUDE.md). A prova que importa: anon e authenticated NÃO leem
// nem escrevem, o service role sim.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-10-09-vessel-cartao-arquivos.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2) on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-arquivos-do-cartao.mjs'])

  const pode = async (papel, privilegio) => (await cli.query(
    `select has_table_privilege($1, 'public.vessel_cartao_arquivos', $2) as pode`, [papel, privilegio])).rows[0].pode
  for (const papel of ['anon', 'authenticated']) {
    for (const priv of ['select', 'insert', 'update', 'delete']) {
      if (await pode(papel, priv)) throw new Error(`${papel} consegue ${priv} em vessel_cartao_arquivos`)
    }
  }
  for (const priv of ['select', 'insert', 'update']) {
    if (!await pode('service_role', priv)) throw new Error(`o service role nao consegue ${priv}`)
  }
  const { rows: [{ rls }] } = await cli.query(`select relrowsecurity as rls from pg_class where oid = 'public.vessel_cartao_arquivos'::regclass`)
  if (!rls) throw new Error('RLS desligada')

  await cli.query('commit')
  console.log('ok: tabela criada, registrada em schema_migrations; anon/authenticated sem acesso, service role com acesso, RLS ligada')
} catch (e) {
  await cli.query('rollback')
  console.error('FALHOU (nada foi gravado):', e.message)
  process.exitCode = 1
} finally {
  await cli.end()
}
