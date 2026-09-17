// APLICA e REGISTRA a camada 3 (a venda, pedido a pedido), na mesma transação.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-17-vessel-pedidos.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-pedidos.mjs'])

  const { rows: tabelas } = await cli.query(
    `select c.relname, c.relrowsecurity as trava,
            (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as politicas
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r'
        and c.relname in ('vessel_pedidos','vessel_pedido_itens','vessel_envios_ao_meta')
      order by c.relname`)
  if (tabelas.length !== 3) throw new Error(`esperava 3 tabelas, achei ${tabelas.length}`)
  for (const t of tabelas) {
    if (!t.trava) throw new Error(`${t.relname}: RLS desligada`)
    if (Number(t.politicas) !== 0) throw new Error(`${t.relname}: tem politica`)
  }
  const { rows: [col] } = await cli.query(
    `select count(*)::int as n from information_schema.columns
      where table_schema='public' and table_name='vessel_pessoas' and column_name='bling_contato_id'`)
  if (!col.n) throw new Error('vessel_pessoas nao ganhou bling_contato_id')

  await cli.query('commit')
  console.log('aplicada e registrada.\n')
  for (const t of tabelas) console.log(`  ${t.relname.padEnd(24)} trava ligada, ${t.politicas} politicas`)
  console.log('  vessel_pessoas.bling_contato_id  ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
