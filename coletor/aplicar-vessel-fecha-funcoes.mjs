// APLICA e REGISTRA o fechamento das funções internas, na mesma transação.
// Ver o cabeçalho do .sql: `revoke from public` não fecha `anon`.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-16-vessel-fecha-as-funcoes-internas.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-fecha-funcoes.mjs'])

  const { rows } = await cli.query(
    `select p.proname,
            has_function_privilege('anon', p.oid, 'execute') as anon_pode
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'vessel_%'
        and p.proname in ('vessel_pedir_atendimento','vessel_registrar_cartao','vessel_abrir_convite',
                          'vessel_pessoa_por_telefone','vessel_novo_codigo_de_convite',
                          'vessel_hash_de_origem','vessel_telefone_canonico','vessel_toca_atualizado_em')
      order by p.proname`)
  const PORTAS = new Set(['vessel_pedir_atendimento', 'vessel_registrar_cartao', 'vessel_abrir_convite'])
  for (const f of rows) {
    const deveria = PORTAS.has(f.proname)
    if (f.anon_pode !== deveria) {
      throw new Error(`${f.proname}: anon ${f.anon_pode ? 'PODE' : 'nao pode'}, e deveria ${deveria ? 'poder' : 'NAO poder'}`)
    }
  }
  await cli.query('commit')
  console.log('aplicada e registrada.\n')
  for (const f of rows) {
    console.log(`  ${f.proname.padEnd(30)} anon ${f.anon_pode ? 'PODE chamar (é porta)' : 'não pode chamar'}`)
  }
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally {
  await cli.end()
}
