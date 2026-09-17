// APLICA, REGISTRA e PROVA os tres modelos elegiveis do Personal Atelier.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-18-vessel-atelier-so-tres-modelos.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-atelier-tres-modelos.mjs'])

  await cli.query('savepoint prova')
  const fone = () => '5519' + String(900000000 + Math.floor(Math.random() * 9999999))
  const pedir = async (modelo) => (await cli.query(
    `select public.vessel_pedido_de_personal_atelier($1,$2,'iguatemi',$3,null,null,null,null,
            false,'v3',null,null,true) as r`, ['Cliente de Prova', fone(), modelo])).rows[0].r

  for (const bom of ['nerea', 'cyrene', 'astrea', 'nao-sei']) {
    const r = await pedir(bom)
    if (!r.ok) throw new Error(`${bom} deveria ser elegivel: ` + JSON.stringify(r))
  }
  // ⚠️ Os que SAIRAM da lista tem de ser recusados — nao basta a pagina nao
  // oferecer: quem manda um POST na mao nao passa pela tela.
  for (const fora of ['alba', 'linear', 'mochila']) {
    const r = await pedir(fora)
    if (r.ok !== false || r.situacao !== 'modelo_invalido')
      throw new Error(`${fora} NAO e elegivel e passou: ` + JSON.stringify(r))
  }

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query('select count(*)::int as n from vessel_pessoas')
  if (sobrou.n !== 0) throw new Error('a prova deixou sujeira')

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  nerea, cyrene, astrea e "quero ver na loja": aceitos')
  console.log('  alba, linear e um modelo inventado: RECUSADOS pelo banco')
  console.log('  prova desfeita                              ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
