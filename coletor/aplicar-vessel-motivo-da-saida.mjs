// APLICA, REGISTRA e PROVA a anotacao de por onde a cliente saiu.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'
const ARQUIVO = '2026-09-18-vessel-por-que-nao-respondeu.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-motivo-da-saida.mjs'])

  const porta = async (a) => (await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado`, [a])).rows[0]
  const nova = await porta('public.vessel_marcar_objetivo_e_motivo(text, text, text, text)')
  if (!nova.anon) throw new Error('a pagina nao consegue chamar a nova')
  if (nova.autenticado) throw new Error('a nova ficou aberta para authenticated')
  const velha = await porta('public.vessel_marcar_objetivo(text, text, text)')
  if (!velha.anon) throw new Error('⚠️ a ANTIGA perdeu a porta — aba aberta ha horas para de funcionar')

  await cli.query('savepoint prova')
  const nova_senha = async () => {
    const s = 'prova-' + Math.random().toString(36).slice(2)
    await cli.query(
      `insert into public.vessel_lista_espera (nome, email, whatsapp, aceite_versao, origem, senha_hash, senha_em)
       values ('Prova', $1, '19999999999', 'prova', 'prova',
               encode(extensions.digest($2,'sha256'),'hex'), now())`,
      [`p${Math.random()}@exemplo.invalido`, s])
    return s
  }
  const marcar = async (s, obj, motivo) => (await cli.query(
    'select public.vessel_marcar_objetivo_e_motivo($1,$2,$3) as r', [s, obj, motivo])).rows[0].r

  for (const m of ['pulou', 'fechou', 'esc', 'fora', 'saiu-da-pagina']) {
    const s = await nova_senha()
    const r = await marcar(s, 'visita', m)
    if (!r.ok) throw new Error(`motivo "${m}" foi recusado`)
  }
  const { rows: [c] } = await cli.query(
    `select count(*)::int n, count(distinct objetivo_motivo)::int motivos
       from vessel_lista_espera where origem='prova' and objetivo_motivo is not null`)
  if (c.n !== 5 || c.motivos !== 5) throw new Error('os motivos nao foram gravados: ' + JSON.stringify(c))

  const inventado = await marcar(await nova_senha(), 'visita', 'desisti da vida')
  if (inventado.situacao !== 'motivo_invalido') throw new Error('motivo inventado passou')

  // ⚠️ A ANTIGA continua gravando igual, e sem motivo.
  const s = await nova_senha()
  const velhaR = (await cli.query('select public.vessel_marcar_objetivo($1,$2) as r', [s, 'visita'])).rows[0].r
  if (!velhaR.ok) throw new Error('a antiga parou de funcionar')
  const { rows: [v] } = await cli.query(
    `select objetivo, objetivo_motivo, (senha_hash is null) as queimada
       from vessel_lista_espera where origem='prova' order by id desc limit 1`)
  if (v.objetivo !== 'visita' || v.objetivo_motivo !== null || !v.queimada)
    throw new Error('a antiga mudou de comportamento: ' + JSON.stringify(v))

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query(`select count(*)::int n from vessel_lista_espera where origem='prova'`)
  if (sobrou.n !== 0) throw new Error('a prova deixou sujeira')
  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  as cinco saidas sao gravadas; motivo inventado e recusado')
  console.log('  a funcao ANTIGA continua aberta e com o mesmo comportamento')
  console.log('  (aba aberta ha horas nao perde a escolha de ninguem)')
  console.log('  prova desfeita                              ok')
} catch (e) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + e.message)
  process.exitCode = 1
} finally { await cli.end() }
