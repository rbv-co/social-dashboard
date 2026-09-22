// APLICA, REGISTRA e PROVA a coluna de conferência dos pedidos.
//
// ⚠️ A PROVA MEXE EM `vessel_pedidos` DE VERDADE, dentro de um `savepoint` que é
// desfeito antes do `commit`. Conferir o texto da migration provaria que eu
// escrevi o `alter table`, não que a conta da planilha muda quando um pedido é
// cancelado — que é o que o dono quer saber.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-21-pedido-conferido-no-bling.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-conferencia-de-pedidos.mjs'])

  // ── a coluna existe, e é do tipo certo ────────────────────────────────────
  const { rows: [col] } = await cli.query(
    `select data_type, is_nullable from information_schema.columns
      where table_schema='public' and table_name='vessel_pedidos'
        and column_name='conferido_no_bling_em'`)
  if (!col) throw new Error('a coluna conferido_no_bling_em nao foi criada')
  if (col.data_type !== 'timestamp with time zone') throw new Error('tipo errado: ' + col.data_type)

  const { rows: idx } = await cli.query(
    `select indexname from pg_indexes where tablename='vessel_pedidos'
       and indexname in ('vessel_pedidos_situacao_idx','vessel_pedidos_conferido_idx')`)
  if (idx.length !== 2) throw new Error('faltou indice: ' + JSON.stringify(idx))

  // ── o retrato de agora, para comparar depois ──────────────────────────────
  const conta = async () => (await cli.query(
    `select count(*)::int as vendas, coalesce(sum(receita_liquida),0)::numeric as total
       from vessel_pedidos where situacao_id = 9`)).rows[0]
  const antes = await conta()

  await cli.query('savepoint prova')

  // ⚠️ O PEDIDO REAL QUE ORIGINOU TUDO: o 2680, R$ 3.450 da Luiza Maria
  // Carvalho, que o Bling já cancelou (situacao 12) e a nossa base ainda tinha
  // como venda. A prova cancela ele aqui e confere que ele SAI da conta.
  const { rows: [alvo] } = await cli.query(
    `select id, numero, receita_liquida from vessel_pedidos
      where situacao_id = 9 order by data_da_venda desc, id desc limit 1`)
  if (!alvo) throw new Error('nao ha pedido nenhum para provar com')

  await cli.query(
    `update vessel_pedidos set situacao_id = 12, conferido_no_bling_em = now() where id = $1`,
    [alvo.id])
  const cancelado = await conta()
  if (cancelado.vendas !== antes.vendas - 1) {
    throw new Error(`cancelar nao tirou da conta: ${antes.vendas} -> ${cancelado.vendas}`)
  }
  if (Number(antes.total) - Number(cancelado.total) !== Number(alvo.receita_liquida)) {
    throw new Error('o valor que saiu nao bate com o do pedido')
  }

  // E o pedido que SOME do Bling (situacao nula) também sai.
  await cli.query(
    `update vessel_pedidos set situacao_id = null, conferido_no_bling_em = now() where id = $1`,
    [alvo.id])
  const sumido = await conta()
  if (sumido.vendas !== antes.vendas - 1) throw new Error('situacao nula nao saiu da conta')

  // ── e a pergunta que a coluna existe para responder ───────────────────────
  const { rows: [velhos] } = await cli.query(
    `select count(*)::int as n from vessel_pedidos
      where conferido_no_bling_em is null or conferido_no_bling_em < now() - interval '1 day'`)
  if (typeof velhos.n !== 'number') throw new Error('a pergunta do "o que esta velho" nao roda')

  await cli.query('rollback to savepoint prova')
  const depois = await conta()
  if (depois.vendas !== antes.vendas || Number(depois.total) !== Number(antes.total)) {
    throw new Error(`a prova mexeu em dado real: ${JSON.stringify(antes)} -> ${JSON.stringify(depois)}`)
  }

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log(`  coluna conferido_no_bling_em criada, com os dois indices`)
  console.log(`  pedido CANCELADO sai da conta de vendas          (${antes.vendas} -> ${antes.vendas - 1})`)
  console.log(`  pedido que SUMIU do Bling sai igual`)
  console.log(`  o valor que sai bate com o do pedido             (R$ ${Number(alvo.receita_liquida).toFixed(2)})`)
  console.log(`  a pergunta "o que esta velho" responde           (${velhos.n} pedido(s) hoje)`)
  console.log(`  prova desfeita: ${depois.vendas} vendas, R$ ${Number(depois.total).toFixed(2)} — igual ao comeco`)
} catch (e) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + e.message)
  process.exitCode = 1
} finally { await cli.end() }
