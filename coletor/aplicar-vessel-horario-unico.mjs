// APLICA, REGISTRA e PROVA a trava de horario (QA10 do plano).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-17-vessel-um-horario-uma-visita.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-horario-unico.mjs'])

  // ── a trava da tabela nova ───────────────────────────────────────────────
  const { rows: [t] } = await cli.query(
    `select c.relrowsecurity as trava,
            (select count(*)::int from pg_policies p
              where p.schemaname='public' and p.tablename='vessel_agenda_da_loja') as politicas
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='vessel_agenda_da_loja'`)
  if (!t?.trava) throw new Error('vessel_agenda_da_loja: RLS desligada')
  if (t.politicas !== 0) throw new Error('vessel_agenda_da_loja: tem politica')

  // ── as portas ────────────────────────────────────────────────────────────
  const porta = async (a) => (await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [a])).rows[0]
  const bruta = await porta('public.vessel_visitas_no_horario(text, timestamptz, bigint)')
  if (bruta.anon || bruta.autenticado || bruta.qualquer_um)
    throw new Error('a conta bruta de conflito ficou aberta — seria a agenda pedida instante a instante')
  const lista = await porta('public.vessel_horarios_ocupados(text, date)')
  if (!lista.anon) throw new Error('o gerador (anon) nao consegue ler os horarios ocupados')

  // ── a prova, desfeita no fim ─────────────────────────────────────────────
  await cli.query('savepoint prova')
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1)
  const dia = `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, '0')}-${String(amanha.getDate()).padStart(2, '0')}`
  const marcar = async (hora, loja = 'iguatemi', ca = 'CA-01') => (await cli.query(
    `select public.vessel_registrar_cartao($1,$2,$3,$4::timestamptz,$5,null,true) as r`,
    [`Cliente ${hora}`, '5519' + String(900000000 + Math.floor(Math.random() * 9999999)),
     loja, `${dia}T${hora}:00-03:00`, ca])).rows[0].r

  const primeira = await marcar('15:00')
  if (!primeira.ok) throw new Error('a primeira visita foi recusada: ' + JSON.stringify(primeira))

  // ⚠️ QA10: a segunda no MESMO horario, por OUTRA Client Advisor, e recusada.
  const segunda = await marcar('15:00', 'iguatemi', 'CA-02')
  if (segunda.ok !== false || segunda.situacao !== 'horario_ocupado')
    throw new Error('DUAS clientes no mesmo horario passaram: ' + JSON.stringify(segunda))

  // ⚠️ E 15:30 TAMBEM, porque a visita das 15:00 ocupa uma hora.
  const meia = await marcar('15:30', 'iguatemi', 'CA-02')
  if (meia.situacao !== 'horario_ocupado')
    throw new Error('15:30 passou com a visita das 15:00 ainda acontecendo: ' + JSON.stringify(meia))

  // 16:00 ja esta livre — a hora acabou.
  const depois = await marcar('16:00', 'iguatemi', 'CA-02')
  if (!depois.ok) throw new Error('16:00 deveria estar livre: ' + JSON.stringify(depois))

  // Outra LOJA no mesmo horario nao briga.
  const outraLoja = await marcar('15:00', 'tivoli', 'CA-03')
  if (!outraLoja.ok) throw new Error('outra loja nao deveria estar bloqueada')

  // ── remarcar SOLTA a hora ────────────────────────────────────────────────
  await cli.query(
    `update public.vessel_atendimentos set status = 'remarcado' where convite_codigo = $1`,
    [primeira.codigo])
  const soltou = await marcar('15:00', 'iguatemi', 'CA-02')
  if (!soltou.ok) throw new Error('remarcar nao soltou a hora: ' + JSON.stringify(soltou))

  // ── a lista que a tela le: horas, e SO horas ─────────────────────────────
  const { rows: [{ r: agenda }] } = await cli.query(
    `select public.vessel_horarios_ocupados('iguatemi', $1::date) as r`, [dia])
  if (!agenda.ok) throw new Error('a leitura de horarios falhou')
  const horas = agenda.ocupados.map((o) => o.hora).sort()
  if (!horas.includes('15:00') || !horas.includes('16:00'))
    throw new Error('a lista nao trouxe as horas ocupadas: ' + JSON.stringify(agenda))
  const texto = JSON.stringify(agenda)
  for (const proibido of ['Cliente', 'nome', 'telefone', 'whatsapp', 'convite', 'CA-'])
    if (texto.includes(proibido))
      throw new Error(`a lista de horarios VAZOU "${proibido}": ${texto}`)

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query(
    `select count(*)::int as n from public.vessel_atendimentos`)
  if (sobrou.n !== 0) throw new Error('a prova deixou sujeira')

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  vessel_agenda_da_loja: trava ligada, 0 politicas, 3 lojas (1 por vez, 60 min)')
  console.log('  porta: a LISTA abre para anon; a conta bruta fica fechada para todos')
  console.log('  QA10: a segunda cliente no mesmo horario e RECUSADA, por outra CA')
  console.log('  15:30 tambem e recusado — a visita das 15:00 ocupa uma hora')
  console.log('  16:00 livre; outra loja livre; remarcar SOLTA a hora')
  console.log('  a lista devolve horas e SO horas — sem nome, telefone, convite ou CA')
  console.log('  prova desfeita                              ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
