// PROVA a migration do valor corrigido SEM deixar rastro: roda tudo dentro de
// uma transação que termina em ROLLBACK.
//
// O que ele confere, além de "rodou sem erro" — que não é prova de nada:
//   1. a tabela existe com as colunas e a trava de `motivo`;
//   2. as políticas da tabela nova são iguaisàs da IRMÃ `bling_pedido_nota`,
//      linha a linha, inclusive a coluna `permissive`. Tabela nova que sobe só
//      com a permissiva PARECE instalada e vaza — foi assim com campaign_adsets;
//   3. a linha do pedido 2656 entra e é lida de volta com o valor certo.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const sql = readFileSync(new URL('../db/migrations/2026-09-12-valor-corrigido-da-venda.sql', import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
let falhou = false
const diz = (ok, texto) => { if (!ok) falhou = true; console.log((ok ? '  ok   ' : '  FALHA') + '  ' + texto) }

try {
  await cli.query(sql)
  console.log('SQL rodou. Agora as provas:\n')

  const cols = await cli.query(
    `select column_name, data_type, is_nullable from information_schema.columns
      where table_name = 'bling_pedido_ajuste_valor' order by ordinal_position`)
  diz(cols.rows.length === 7, `7 colunas (vieram ${cols.rows.length}): ${cols.rows.map(c => c.column_name).join(', ')}`)

  // As políticas, comparadas com a irmã.
  const pol = await cli.query(
    `select tablename, policyname, permissive, cmd, qual from pg_policies
      where tablename in ('bling_pedido_ajuste_valor','bling_pedido_nota') order by tablename, policyname`)
  const daNova = pol.rows.filter(p => p.tablename === 'bling_pedido_ajuste_valor')
  const daIrma = pol.rows.filter(p => p.tablename === 'bling_pedido_nota')
  console.log('\n  políticas da IRMÃ bling_pedido_nota:')
  for (const p of daIrma) console.log(`    ${p.policyname.padEnd(24)} ${p.permissive.padEnd(12)} ${p.cmd.padEnd(7)} ${p.qual}`)
  console.log('  políticas da NOVA bling_pedido_ajuste_valor:')
  for (const p of daNova) console.log(`    ${p.policyname.padEnd(24)} ${p.permissive.padEnd(12)} ${p.cmd.padEnd(7)} ${p.qual}`)

  const restritivaDaIrma = daIrma.find(p => p.permissive === 'RESTRICTIVE')
  const restritivaDaNova = daNova.find(p => p.permissive === 'RESTRICTIVE')
  diz(!!restritivaDaNova, 'a nova TEM política RESTRICTIVE (é ela que recorta; a permissiva sozinha não segura nada)')
  diz(restritivaDaNova?.qual === restritivaDaIrma?.qual,
    `o recorte da nova é o MESMO da irmã: ${restritivaDaNova?.qual} == ${restritivaDaIrma?.qual}`)
  diz(daNova.length >= daIrma.length, `a nova tem ${daNova.length} políticas; a irmã tem ${daIrma.length} (menos que a irmã = falta metade)`)
  diz(!!daNova.find(p => p.cmd === 'ALL'), 'tem política de ESCRITA (só super-admin)')

  // A linha de verdade, ida e volta.
  await cli.query(
    `insert into public.bling_pedido_ajuste_valor
       (pedido_id, loja_id, total_corrigido, total_do_bling, motivo)
     values (26851358889, 205834116, 1615.00, 1900.00, 'prova de rollback')`)
  const lida = await cli.query('select total_corrigido, total_do_bling from public.bling_pedido_ajuste_valor where pedido_id = 26851358889')
  diz(Number(lida.rows[0]?.total_corrigido) === 1615, `a linha volta valendo 1615 (veio ${lida.rows[0]?.total_corrigido})`)

  // A trava do motivo tem que RECUSAR motivo curto.
  try {
    await cli.query('savepoint p1')
    await cli.query(`insert into public.bling_pedido_ajuste_valor (pedido_id, total_corrigido, motivo) values (1, 10, 'curto')`)
    await cli.query('rollback to savepoint p1')
    diz(false, 'motivo de 5 letras NÃO devia passar — a trava não está pegando')
  } catch {
    await cli.query('rollback to savepoint p1')
    diz(true, 'motivo curto é recusado pelo banco (a explicação é obrigatória de verdade)')
  }

  // E valor negativo também.
  try {
    await cli.query('savepoint p2')
    await cli.query(`insert into public.bling_pedido_ajuste_valor (pedido_id, total_corrigido, motivo) values (2, -5, 'motivo bem comprido aqui')`)
    await cli.query('rollback to savepoint p2')
    diz(false, 'valor negativo NÃO devia passar')
  } catch {
    await cli.query('rollback to savepoint p2')
    diz(true, 'valor negativo é recusado pelo banco')
  }
} catch (e) {
  falhou = true
  console.error('ESTOUROU:', e.message)
} finally {
  await cli.query('rollback')
  await cli.end()
  console.log('\nROLLBACK dado — o banco está exatamente como estava.')
  console.log(falhou ? '\nTEM FALHA ACIMA. Não aplicar.' : '\nTodas as provas passaram.')
  process.exitCode = falhou ? 1 : 0
}
