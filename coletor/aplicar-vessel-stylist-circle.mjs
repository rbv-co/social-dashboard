// APLICA, REGISTRA e PROVA a porta do Stylist Circle (T06).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-18-vessel-stylist-circle.sql'
const A = 'public.vessel_pedido_do_stylist(text, text, text, text, text, text, text, text, boolean, text, jsonb, text, boolean)'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-stylist-circle.mjs'])

  const { rows: [t] } = await cli.query(
    `select c.relrowsecurity as trava,
            (select count(*)::int from pg_policies p
              where p.schemaname='public' and p.tablename='vessel_stylists') as politicas
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='vessel_stylists'`)
  if (!t?.trava) throw new Error('vessel_stylists: RLS desligada')
  if (t.politicas !== 0) throw new Error('vessel_stylists: tem politica')

  const { rows: [porta] } = await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [A])
  if (!porta.anon) throw new Error('a pagina publica nao consegue chamar')
  if (porta.autenticado || porta.qualquer_um) throw new Error('a porta ficou aberta alem do necessario')

  await cli.query('savepoint prova')
  const fone = () => '5519' + String(900000000 + Math.floor(Math.random() * 9999999))
  const pedir = async (a) => (await cli.query(
    `select public.vessel_pedido_do_stylist($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,true) as r`,
    a)).rows[0].r

  const f1 = fone()
  const ok = await pedir(['Raissa Herculano', f1, 'Campinas', '@raissa', 'stylist', 'sim',
    '5-8', 'CPS', true, 'v3', JSON.stringify({ utm_campaign: 'vessel_cps_stylist_202609' }), null])
  if (!ok.ok) throw new Error('o caminho bom foi recusado: ' + JSON.stringify(ok))

  // ⚠️ O CODIGO NAO VOLTA PARA A PAGINA: e identificador interno de rastreio.
  if (JSON.stringify(ok).includes('STY-'))
    throw new Error('o codigo interno da stylist vazou na resposta: ' + JSON.stringify(ok))

  const { rows: [s] } = await cli.query(
    `select codigo, nome, whatsapp, cidade, instagram, atuacao, quer_sessao, convidadas,
            praca_preview, estagio from vessel_stylists order by id desc limit 1`)
  if (s.codigo !== 'STY-0001') throw new Error('o codigo saiu ' + s.codigo)
  if (s.estagio !== 'prospect') throw new Error('nao entrou como prospect')
  if (s.praca_preview !== 'CPS' || s.convidadas !== '5-8') throw new Error('o que ela contou nao foi gravado')

  // ⚠️ NAO E PESSOA: ela nao pode aparecer no funil de cliente.
  const { rows: [p] } = await cli.query('select count(*)::int as n from vessel_pessoas')
  if (p.n !== 0) throw new Error('a stylist virou uma cliente em vessel_pessoas')
  const { rows: [at] } = await cli.query('select count(*)::int as n from vessel_atendimentos')
  if (at.n !== 0) throw new Error('a stylist criou um atendimento — ela entraria no show rate da loja')

  // ⚠️ A ORIGEM DELA MORA NA PROPRIA LINHA, nao em `vessel_origens` — aquela
  // tabela e dos toques de uma PESSOA, e o `stylist_id` dela quer dizer outra
  // coisa ("esta cliente veio POR uma stylist"). Misturar as duas faria a conta
  // de atribuicao somar o canal duas vezes.
  const { rows: [o] } = await cli.query(
    `select origem_canal, origem_campanha from vessel_stylists order by id desc limit 1`)
  if (o.origem_campanha !== 'vessel_cps_stylist_202609') throw new Error('a UTM se perdeu')
  const { rows: [semToque] } = await cli.query('select count(*)::int as n from vessel_origens')
  if (semToque.n !== 0) throw new Error('a stylist escreveu na tabela de toques de CLIENTE')

  // As permissoes apontam para a stylist, separadas por finalidade.
  const { rows: [perm] } = await cli.query(
    `select count(*) filter (where finalidade='atendimento')::int as at,
            count(*) filter (where finalidade='marketing')::int as m,
            count(*) filter (where pessoa_id is not null)::int as com_pessoa
       from vessel_consentimentos`)
  if (perm.at !== 1 || perm.m !== 1) throw new Error('permissoes erradas: ' + JSON.stringify(perm))
  if (perm.com_pessoa !== 0) throw new Error('a permissao da stylist foi gravada como se fosse de cliente')

  // ⚠️ A MESMA STYLIST VOLTANDO NAO VIRA DUAS, e o codigo dela NAO muda.
  const denovo = await pedir(['Raissa Herculano Silva', f1, null, null, null, 'entender',
    'mais-de-8', null, false, 'v3', null, null])
  if (!denovo.ok) throw new Error('o retorno dela foi recusado')
  const { rows: [depois] } = await cli.query(
    `select count(*)::int as quantas, max(codigo) as codigo, max(convidadas) as convidadas,
            max(praca_preview) as praca from vessel_stylists`)
  if (depois.quantas !== 1) throw new Error('a mesma stylist virou ' + depois.quantas)
  if (depois.codigo !== 'STY-0001') throw new Error('o codigo dela MUDOU: ' + depois.codigo)
  if (depois.convidadas !== 'mais-de-8') throw new Error('o que ela contou agora nao valeu')
  if (depois.praca !== 'CPS') throw new Error('o que ela NAO respondeu de novo se perdeu')

  // A segunda stylist ganha o codigo seguinte.
  await pedir(['Outra Stylist', fone(), null, null, 'personal-shopper', null, null, null, false, 'v3', null, null])
  const { rows: [duas] } = await cli.query(
    `select codigo from vessel_stylists order by id desc limit 1`)
  if (duas.codigo !== 'STY-0002') throw new Error('o segundo codigo saiu ' + duas.codigo)

  for (const [caso, args] of [
    ['sem nome', ['  ', fone(), null, null, null, null, null, null, false, 'v3', null, null]],
    ['telefone torto', ['x y', '123', null, null, null, null, null, null, false, 'v3', null, null]],
    ['atuacao inventada', ['x y', fone(), null, null, 'astrologa', null, null, null, false, 'v3', null, null]],
    ['convidadas inventado', ['x y', fone(), null, null, null, null, 'umas 50', null, false, 'v3', null, null]],
    ['praca inventada', ['x y', fone(), null, null, null, null, null, 'LUA', false, 'v3', null, null]],
  ]) {
    const r = await pedir(args)
    if (r.ok !== false) throw new Error(`"${caso}" respondeu sucesso: ` + JSON.stringify(r))
  }

  const robo = await pedir(['Robo', fone(), null, null, null, null, null, null, false, 'v3', null, 'caiu'])
  if (robo.ok !== true) throw new Error('a armadilha deixou de ser muda')

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query('select count(*)::int as n from vessel_stylists')
  if (sobrou.n !== 0) throw new Error('a prova deixou sujeira')

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  vessel_stylists: trava ligada, 0 politicas')
  console.log('  porta: anon SIM; authenticated e public NAO')
  console.log('  ⚠️ a stylist NAO vira cliente: zero linhas em pessoas e em atendimentos')
  console.log('  o codigo sai STY-0001, STY-0002… e NAO volta para a pagina')
  console.log('  a mesma stylist voltando nao vira duas, e o codigo dela nao muda')
  console.log('  a origem e as permissoes apontam para a STYLIST, nao para uma pessoa')
  console.log('  cinco entradas invalidas viram erro tratado; a armadilha continua muda')
  console.log('  prova desfeita                              ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
