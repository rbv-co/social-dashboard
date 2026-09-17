// APLICA, REGISTRA e PROVA a porta das Beauty Sessions (T05).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-18-vessel-beauty-sessions.sql'
const A_BS = 'public.vessel_interesse_da_beauty_session(text, text, text, text, boolean, text, jsonb, text, boolean)'
const A_MIOLO = 'public.vessel_anotar_interesse(text, text, text, text, text, text, text, text, text, boolean, text, jsonb, boolean)'
const A_LP = 'public.vessel_solicitar_atendimento(text, text, text, text, text, text, boolean, text, jsonb, text, boolean)'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-beauty-sessions.mjs'])

  const { rows: [t] } = await cli.query(
    `select c.relrowsecurity as trava,
            (select count(*)::int from pg_policies p
              where p.schemaname='public' and p.tablename='vessel_beauty_sessions') as politicas,
            (select count(*)::int from public.vessel_beauty_sessions) as sessoes
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='vessel_beauty_sessions'`)
  if (!t?.trava) throw new Error('vessel_beauty_sessions: RLS desligada')
  if (t.politicas !== 0) throw new Error('vessel_beauty_sessions: tem politica')
  if (t.sessoes !== 3) throw new Error('esperava as 3 sessoes do plano, achei ' + t.sessoes)

  const porta = async (a) => (await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [a])).rows[0]
  const miolo = await porta(A_MIOLO)
  if (miolo.anon || miolo.autenticado || miolo.qualquer_um)
    throw new Error('o MIOLO ficou aberto — ele aceita origem_registro arbitrario')
  const bs = await porta(A_BS)
  if (!bs.anon) throw new Error('a pagina publica nao consegue chamar a Beauty Session')
  const lp = await porta(A_LP)
  if (!lp.anon) throw new Error('⚠️ a LP Private Appointment PERDEU a porta na refatoracao')

  await cli.query('savepoint prova')
  const bsChamar = async (a) => (await cli.query(
    `select public.vessel_interesse_da_beauty_session($1,$2,$3,$4,$5,$6,$7::jsonb,$8,true) as r`, a)).rows[0].r
  const fone = () => '5519' + String(900000000 + Math.floor(Math.random() * 9999999))

  // ── o caminho bom ────────────────────────────────────────────────────────
  const ok = await bsChamar(['Beatriz Almeida', fone(), 'BS-20260925-CPS-01', 'rever-uma-peca',
    false, 'v3', JSON.stringify({ utm_medium: 'offline_qr' }), null])
  if (!ok.ok) throw new Error('o caminho bom foi recusado: ' + JSON.stringify(ok))

  const { rows: [a] } = await cli.query(
    `select loja, status, origem_registro, interesse, quando from vessel_atendimentos order by id desc limit 1`)
  if (a.loja !== 'iguatemi') throw new Error('a loja nao veio da praca do evento')
  if (a.status !== 'solicitado') throw new Error('entrou como ' + a.status)
  if (a.quando !== null) throw new Error('uma Beauty Session nao marca horario')
  if (a.origem_registro !== 'beauty-session') throw new Error('o canal ficou errado')
  if (a.interesse !== 'rever-uma-peca') throw new Error('o proximo passo nao foi gravado')

  // ⚠️ O EVENTO E O CANAL SAO CRAVADOS PELO SERVIDOR, por cima do endereco.
  const { rows: [o] } = await cli.query(
    `select canal, evento_id, utm_medium from vessel_origens order by id desc limit 1`)
  if (o.canal !== 'beauty_session') throw new Error('o canal nao foi cravado: ' + o.canal)
  if (o.evento_id !== 'BS-20260925-CPS-01') throw new Error('o evento nao foi cravado: ' + o.evento_id)
  if (o.utm_medium !== 'offline_qr') throw new Error('a UTM que veio do endereco se perdeu')

  const mentindo = await bsChamar(['x y', fone(), 'BS-20260925-CPS-01', null, false, 'v3',
    JSON.stringify({ canal: 'inventado', evento_id: 'BS-NAO-EXISTE' }), null])
  if (!mentindo.ok) throw new Error('o caminho bom com origem suja foi recusado')
  const { rows: [o2] } = await cli.query(
    `select canal, evento_id from vessel_origens order by id desc limit 1`)
  if (o2.canal !== 'beauty_session' || o2.evento_id !== 'BS-20260925-CPS-01')
    throw new Error('⚠️ o endereco conseguiu escrever o canal/evento: ' + JSON.stringify(o2))

  // ── evento inventado e recusado ──────────────────────────────────────────
  const falso = await bsChamar(['x y', fone(), 'BS-20990101-XXX-99', null, false, 'v3', null, null])
  if (falso.ok !== false || falso.situacao !== 'evento_desconhecido')
    throw new Error('um QR inventado virou evento: ' + JSON.stringify(falso))

  const interesseTorto = await bsChamar(['x y', fone(), 'BS-20260925-CPS-01', 'me da um desconto',
    false, 'v3', null, null])
  if (interesseTorto.ok !== false) throw new Error('interesse fora da lista passou')

  const robo = await bsChamar(['Robo', fone(), 'BS-20260925-CPS-01', null, false, 'v3', null, 'caiu'])
  if (robo.ok !== true) throw new Error('a armadilha deixou de ser muda')

  // ── a LP irma continua funcionando DEPOIS da refatoracao ─────────────────
  const { rows: [{ r: lpOk }] } = await cli.query(
    `select public.vessel_solicitar_atendimento($1,$2,'iguatemi','trabalho','tarde',null,true,'v3',
            $3::jsonb,null,true) as r`,
    ['Marina Sampaio', fone(), JSON.stringify({ utm_campaign: 'vessel_cps_lead_202609' })])
  if (!lpOk.ok || lpOk.situacao !== 'solicitado')
    throw new Error('⚠️ a LP Private Appointment QUEBROU na refatoracao: ' + JSON.stringify(lpOk))
  const { rows: [permLp] } = await cli.query(
    `select count(*) filter (where finalidade='marketing')::int as m,
            count(*) filter (where finalidade='atendimento')::int as at
       from vessel_consentimentos c join vessel_pessoas p on p.id=c.pessoa_id
      where p.nome='Marina Sampaio'`)
  if (permLp.at !== 1 || permLp.m !== 1) throw new Error('as permissoes da LP mudaram de comportamento')

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query(`select count(*)::int as n from vessel_pessoas`)
  if (sobrou.n !== 0) throw new Error('a prova deixou sujeira')

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  vessel_beauty_sessions: trava ligada, 0 politicas, 3 sessoes do plano')
  console.log('  o MIOLO compartilhado fica fechado para todos')
  console.log('  a porta da Beauty Session abre para anon; a da LP CONTINUA aberta')
  console.log('  a loja vem da praca do evento; entra solicitado e SEM horario')
  console.log('  ⚠️ o canal e o evento sao cravados pelo servidor — o endereco NAO escreve neles')
  console.log('  QR inventado e recusado; interesse fora da lista e recusado')
  console.log('  a armadilha continua muda')
  console.log('  a LP Private Appointment segue igual depois da refatoracao')
  console.log('  prova desfeita                              ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
