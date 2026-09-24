// APLICA, REGISTRA e PROVA a etapa nova "Identificada" no funil da stylist.
//
//   node coletor/aplicar-vessel-stylist-etapa-identificada.mjs            → ensaio: prova tudo e DESFAZ
//   node coletor/aplicar-vessel-stylist-etapa-identificada.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar em `schema_migrations`, provar
// e só então `commit` — conferido (`.command === 'COMMIT'`).
//
// ⚠️ A PROVA FALA COMO GENTE DE VERDADE (perfis de mentira + `request.jwt.claims`)
// e mora inteira em `savepoint prova` … `rollback to savepoint prova`. A
// impressão de `vessel_stylists`/encontros é conferida antes, depois do desfazer
// e, quando grava, numa conexão nova depois do `commit`.
//
// ⚠️ E PROVA QUE A CENTRAL QUE ESTÁ NO AR CONTINUA FUNCIONANDO: os corpos JSON
// de `tela-de-stylist-circle.vue` de hoje (criar, corrigir, mover), por nome,
// como o PostgREST chama.
//
// DATABASE_URL: coletor/.env OU o ambiente (`node --env-file=<.env> …`).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-24-vessel-stylist-etapa-identificada.sql'
const GRAVAR = process.argv.includes('--gravar')

const PORTAS = {
  vessel_stylist_criar: 'vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date,text,text)',
  vessel_stylist_editar: 'vessel_stylist_editar(text,text,text,text,text,text,text,text,text,text,text,date,text,date,boolean,text)',
}

const IMPRESSAO = `
  select (select count(*) from public.vessel_stylists)::int as stylists,
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.vessel_stylists t) as stylists_md5,
         (select count(*) from public.vessel_private_edits)::int as private_edits,
         (select count(*) from public.vessel_stylist_contatos)::int as contatos,
         (select count(*) from public.vessel_consentimentos where stylist_id is not null)::int as consentimentos`

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}

if (!process.env.DATABASE_URL) { console.error('❌ sem DATABASE_URL'); process.exit(1) }
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r
// Como o PostgREST: parâmetros por NOME, só as chaves do corpo.
const rpc = async (fn, corpo) => {
  const ks = Object.keys(corpo)
  return r(`public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, ks.map((k) => corpo[k]))
}
const linha = (codigo) => uma(`select * from public.vessel_stylists where codigo = $1`, [codigo])
const iso = (d) => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d)

const antes = await uma(IMPRESSAO)
const { ja } = await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ja`, [ARQUIVO])
if (ja) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }
const PRE = await uma(`select exists (select 1 from public.schema_migrations
  where name = '2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql') as ok`)
if (!PRE.ok) { console.error('❌ falta 2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql antes desta.'); process.exit(1) }

await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-stylist-etapa-identificada.mjs'])
  const { hoje } = await uma(`select ((now() at time zone 'America/Sao_Paulo')::date)::text as hoje`)

  console.log('\n── as portas')
  for (const [nome, assinatura] of Object.entries(PORTAS)) {
    const { quantas, lista } = await uma(
      `select count(*)::int as quantas, string_agg(p.oid::regprocedure::text, ' | ') as lista
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    conferir(quantas === 1 && lista === assinatura, `${nome}: uma assinatura só`, lista)
    const pr = await uma(`select has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
                                 has_function_privilege('anon', $1, 'EXECUTE') as anon`, [`public.${assinatura}`])
    conferir(pr.aut === true && pr.anon === false, `${nome}: a Central entra, a página pública não`, pr)
  }
  const mi = await uma(`select has_function_privilege('authenticated', 'public.vessel_stylist_seguir_os_encontros(bigint)', 'EXECUTE') as aut`)
  conferir(mi.aut === false, 'vessel_stylist_seguir_os_encontros: miolo fechado', mi)
  const col = await uma(`select is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='vessel_stylists' and column_name='prospectado_em'`)
  conferir(col.is_nullable === 'YES', 'prospectado_em aceita vazio', col)
  const est = await uma(`select column_default from information_schema.columns
    where table_schema='public' and table_name='vessel_stylists' and column_name='estagio'`)
  conferir(/'prospectado'/.test(est.column_default), 'o padrão do estágio continua prospectado', est)

  await cli.query('savepoint prova')
  const perfil = async (features, permissions) => {
    const id = randomUUID(), email = `prova-identificada-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(`insert into public.profiles (id, email, features, permissions, is_superadmin)
                     values ($1, $2, $3, $4::jsonb, false)`, [id, email, features, JSON.stringify(permissions)])
    return id
  }
  const falarComo = async (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])
  const mexe = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] })
  await falarComo(mexe)
  const placarDeHoje = () => r(`public.vessel_placar_do_stylist_circle($1::date, $1::date, 14)`, [hoje])
  const p0 = await placarDeHoje()

  console.log('\n── a Central que está no ar hoje (corpos de tela-de-stylist-circle.vue)')
  const velha = await rpc('vessel_stylist_criar', { p_nome: 'Prova Central de Hoje', p_whatsapp: '(19) 99000-2451',
    p_cidade: 'Campinas', p_instagram: null, p_atuacao: null, p_praca: 'CPS', p_loja: 'iguatemi',
    p_origem_contato: 'indicacao', p_responsavel: 'Fulana', p_prospectado_em: hoje, p_proxima_acao: null, p_proxima_acao_em: null })
  let s = velha.ok ? await linha(velha.codigo) : null
  conferir(velha.ok && velha.situacao === 'ok' && /^STY-\d{4}$/.test(velha.codigo) && s.estagio === 'prospectado'
    && iso(s.prospectado_em) === hoje, 'criar com o corpo de hoje: {ok, situacao, codigo}, nasce Prospectado', { velha, s })
  const edVelha = await rpc('vessel_stylist_editar', { p_codigo: velha.codigo, p_nome: 'Prova Central de Hoje',
    p_whatsapp: '(19) 99000-2451', p_cidade: 'Campinas', p_instagram: null, p_atuacao: null, p_estagio: null,
    p_praca: 'CPS', p_loja: 'iguatemi', p_origem_contato: 'indicacao', p_responsavel: 'Fulana', p_prospectado_em: hoje,
    p_proxima_acao: 'Ligar', p_proxima_acao_em: null, p_sem_proxima_acao: false })
  conferir(edVelha.ok === true && edVelha.situacao === 'ok', 'corrigir com o corpo de hoje', edVelha)
  const mvVelha = await rpc('vessel_stylist_editar', { p_codigo: velha.codigo, p_estagio: 'contatado' })
  conferir(mvVelha.ok === true, 'mover() do quadro de hoje', mvVelha)

  console.log('\n── nascer identificada')
  const ident = await rpc('vessel_stylist_criar', { p_nome: 'Prova Identificada', p_whatsapp: null,
    p_instagram: '@prova.identificada', p_origem_contato: 'pesquisa', p_estagio: 'identificada' })
  s = await linha(ident.codigo)
  conferir(ident.ok && s.estagio === 'identificada' && s.prospectado_em === null, 'nasce identificada, sem data de prospecção', { ident, s })
  const comData = await rpc('vessel_stylist_criar', { p_nome: 'X', p_whatsapp: '(19) 99000-2452',
    p_origem_contato: 'pesquisa', p_estagio: 'identificada', p_prospectado_em: hoje })
  conferir(comData.situacao === 'identificada_sem_prospeccao', 'identificada com data é recusada', comData)
  const pulando = await rpc('vessel_stylist_criar', { p_nome: 'X', p_whatsapp: '(19) 99000-2452',
    p_origem_contato: 'pesquisa', p_estagio: 'contatado' })
  conferir(pulando.situacao === 'estagio_invalido', 'nascer contatada é recusado (só prospectado ou identificada)', pulando)
  try {
    await cli.query('savepoint direto')
    await cli.query(`update public.vessel_stylists set prospectado_em = current_date where codigo = $1`, [ident.codigo])
    conferir(false, 'a tabela recusa identificada com data (23514)', 'passou')
  } catch (e) {
    await cli.query('rollback to savepoint direto')
    conferir(e.code === '23514' && /identificada_sem_prospeccao/.test(e.message), 'a tabela recusa identificada com data (23514)', e.message)
  }

  console.log('\n── o placar não conta identificada')
  const p1 = await placarDeHoje()
  conferir(p1.prospectadas === p0.prospectadas + 1 && p1.prospectadas_ja_ativadas === p0.prospectadas_ja_ativadas
    && p1.ativadas === p0.ativadas,
    'só a cadastrada à mão (prospectada hoje) entrou em prospectadas; a identificada não entrou em nada', { p0, p1 })

  console.log('\n── corrigir e mover')
  const semData = await rpc('vessel_stylist_editar', { p_codigo: ident.codigo, p_cidade: 'Limeira', p_prospectado_em: hoje })
  conferir(semData.situacao === 'identificada_sem_prospeccao', 'corrigir uma identificada com data é recusado', semData)
  const soCidade = await rpc('vessel_stylist_editar', { p_codigo: ident.codigo, p_cidade: 'Limeira' })
  s = await linha(ident.codigo)
  conferir(soCidade.ok && s.estagio === 'identificada' && s.prospectado_em === null && s.cidade === 'Limeira',
    'corrigir outro campo mantém identificada e sem data', s)
  const volta = await rpc('vessel_stylist_editar', { p_codigo: velha.codigo, p_estagio: 'identificada' })
  conferir(volta.situacao === 'volta_para_identificada', 'não se volta para identificada', volta)
  const avancar = await rpc('vessel_stylist_editar', { p_codigo: ident.codigo, p_estagio: 'prospectado' })
  s = await linha(ident.codigo)
  conferir(avancar.ok && s.estagio === 'prospectado' && iso(s.prospectado_em) === hoje,
    'identificada → prospectado: a data da prospecção vira a da mudança (hoje)', s)
  const p2 = await placarDeHoje()
  conferir(p2.prospectadas === p1.prospectadas + 1, '…e aí sim entra em prospectadas', { p1, p2 })

  const i2 = await rpc('vessel_stylist_criar', { p_nome: 'Prova Identificada 2', p_whatsapp: '(19) 99000-2453',
    p_origem_contato: 'pesquisa', p_estagio: 'identificada' })
  const saida = await rpc('vessel_stylist_editar', { p_codigo: i2.codigo, p_estagio: 'sem_retorno' })
  s = await linha(i2.codigo)
  conferir(saida.ok && s.estagio === 'sem_retorno' && s.prospectado_em === null, 'identificada → sem retorno: continua sem data', s)
  const reabre = await rpc('vessel_stylist_editar', { p_codigo: i2.codigo, p_estagio: 'prospectado' })
  s = await linha(i2.codigo)
  conferir(reabre.ok && iso(s.prospectado_em) === hoje, 'e reaberta para prospectado ganha a data de hoje', s)

  console.log('\n── a sugestão de etapa: a mesma que valeria para prospectado')
  for (const res of ['sem_resposta', 'conversou', 'interesse', 'proposta', 'marcou_encontro', 'recusou']) {
    const a = await r(`public.vessel_stylist_sugestao_de_etapa($1, 'identificada', null)`, [res])
    const b = await r(`public.vessel_stylist_sugestao_de_etapa($1, 'prospectado', null)`, [res])
    conferir(a === b, `${res}: identificada → ${a}, prospectado → ${b}`, { a, b })
  }
  const i3 = await rpc('vessel_stylist_criar', { p_nome: 'Prova Identificada 3', p_whatsapp: '(19) 99000-2454',
    p_origem_contato: 'pesquisa', p_estagio: 'identificada' })
  const cont = await r(`public.vessel_stylist_registrar_contato($1, 'whatsapp', 'conversou')`, [i3.codigo])
  conferir(cont.ok && cont.sugestao === 'contatado', 'registrar contato numa identificada sugere Contatado', cont)
  const aceita = await rpc('vessel_stylist_editar', { p_codigo: i3.codigo, p_estagio: cont.sugestao })
  s = await linha(i3.codigo)
  conferir(aceita.ok && s.estagio === 'contatado' && iso(s.prospectado_em) === hoje,
    'aceitar a sugestão (identificada → contatado) também grava a data da prospecção', s)

  console.log('\n── o gatilho dos encontros')
  const i4 = await rpc('vessel_stylist_criar', { p_nome: 'Prova Identificada 4', p_whatsapp: '(19) 99000-2455',
    p_origem_contato: 'pesquisa', p_estagio: 'identificada' })
  const p3 = await placarDeHoje()
  const enc = await r(`public.vessel_criar_private_edit($1, now() + interval '3 days', null, 'CPS', 'iguatemi', 8)`, [i4.codigo])
  s = await linha(i4.codigo)
  const { dia } = await uma(`select ((criado_em at time zone 'America/Sao_Paulo')::date)::text as dia
    from public.vessel_private_edits where codigo = $1`, [enc.codigo])
  conferir(enc.ok && s.estagio === 'ativado' && s.ativada_em !== null && iso(s.prospectado_em) === dia,
    'identificada com encontro agendado → ativado, e a data da prospecção = dia em que o encontro foi criado', { enc, s, dia })
  const p4 = await placarDeHoje()
  conferir(p4.prospectadas === p3.prospectadas + 1 && p4.ativadas === p3.ativadas + 1
    && p4.prospectadas_ja_ativadas === p3.prospectadas_ja_ativadas + 1,
    'no placar ela entra em prospectadas E em ativadas juntas (a taxa não cai)', { p3, p4 })

  console.log('\n── a landing continua entrando em Prospectado')
  await falarComo(null)
  await r(`public.vessel_pedido_do_stylist('Prova Landing', '(19) 99000-2456')`)
  s = await uma(`select estagio, prospectado_em from public.vessel_stylists where whatsapp = '5519990002456'`)
  conferir(s && s.estagio === 'prospectado' && iso(s.prospectado_em) === hoje, 'inscrição pela landing nasce Prospectado, com data', s)
  await falarComo(mexe)
  const i5 = await rpc('vessel_stylist_criar', { p_nome: 'Prova Identificada 5', p_whatsapp: null,
    p_instagram: '@prova.identificada5', p_origem_contato: 'pesquisa', p_estagio: 'identificada' })
  const lista = await r(`public.vessel_rastreio_dos_stylists(7, true)`)
  const na = (lista || []).find((x) => x.codigo === i5.codigo)
  conferir(na && na.estagio === 'identificada' && na.prospectado_em === null,
    'a lista da Central devolve a identificada, com a data vazia', na)

  await cli.query('rollback to savepoint prova')
  const depoisDaProva = await uma(IMPRESSAO)
  conferir(JSON.stringify(depoisDaProva) === JSON.stringify(antes), 'a prova não deixou rastro', { antes, depoisDaProva })

  if (falhas.length) throw new Error(`${falhas.length} conferência(s) falharam`)
  if (GRAVAR) {
    const fim = await cli.query('commit')
    if (fim.command !== 'COMMIT') throw new Error(`o commit voltou ${fim.command}`)
    console.log(`\n✅ ${ARQUIVO} aplicada e registrada.`)
  } else {
    await cli.query('rollback')
    console.log('\n✅ ensaio limpo: tudo passou e NADA foi gravado. Rode com --gravar para valer.')
  }
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error(`\n❌ nada foi gravado: ${e.message}`)
  process.exitCode = 1
} finally {
  await cli.end()
}

if (GRAVAR && !process.exitCode) {
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  const agora = (await outra.query(IMPRESSAO)).rows[0]
  const reg = (await outra.query(`select 1 from public.schema_migrations where name = $1`, [ARQUIVO])).rowCount
  const chk = (await outra.query(`select pg_get_constraintdef(oid) d from pg_constraint
     where conname = 'vessel_stylists_estagio_valido'`)).rows[0]
  await outra.end()
  if (JSON.stringify(agora) !== JSON.stringify(antes) || reg !== 1 || !/identificada/.test(chk?.d || '')) {
    console.error('❌ depois do commit algo não bate', { antes, agora, reg, chk })
    process.exitCode = 1
  } else {
    console.log('  ✓ depois do commit, numa conexão nova: tabelas intactas, etapa nova na trava e migration registrada')
  }
}
