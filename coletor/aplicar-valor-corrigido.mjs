// APLICA a migration do valor corrigido da venda E a REGISTRA, na mesma
// transação. Roda uma vez e só.
//
// Registrar junto é o ponto: migration aplicada e não registrada vira
// "pendente", e mandar o runner aplicar as pendentes é o que já ameaçou
// sobrescrever função em produção por versão velha. Se o insert falhar, o
// rollback desfaz a tabela também — nunca sobra metade.
//
// O SQL é todo `if not exists` / `create or replace` / `drop policy if exists`,
// então rodar de novo é inofensivo. Mas não há motivo para rodar.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-12-valor-corrigido-da-venda.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao)
     values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao pelo coletor/aplicar-valor-corrigido.mjs'],
  )

  // A LINHA QUE MOTIVOU TUDO ISTO. Vai na mesma transação: tabela sem a linha
  // seria uma tabela vazia no ar e o telão ainda errado.
  await cli.query(
    `insert into public.bling_pedido_ajuste_valor
       (pedido_id, loja_id, total_corrigido, total_do_bling, motivo)
     values (26851358889, 205834116, 1615.00, 1900.00, $1)
     on conflict (pedido_id) do update
        set total_corrigido = excluded.total_corrigido,
            total_do_bling  = excluded.total_do_bling,
            motivo          = excluded.motivo`,
    ['Pedido no 2656 de 11/09/2026: desconto a vista no Pix de R$ 285,00 nao foi lancado antes da NFC-e. '
      + 'A NFC-e 000107/serie 5 foi autorizada em 11/09 20:27 por R$ 1.900,00 e congelou o pedido: o PUT da API '
      + 'responde 200 sem gravar, estornar contas e estoque nao destrava, e a tela do Bling fica cinza. '
      + 'Entrou R$ 1.615,00 no caixa. Autorizado pelo dono em 12/09/2026.'],
  )

  const conferencia = await cli.query(
    `select pedido_id, loja_id, total_corrigido, total_do_bling
       from public.bling_pedido_ajuste_valor where pedido_id = 26851358889`)
  console.table(conferencia.rows)

  await cli.query('commit')
  console.log('APLICADA, REGISTRADA, linha do 2656 gravada e commitada.')
} catch (e) {
  await cli.query('rollback')
  console.error('FALHOU, nada foi aplicado:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
