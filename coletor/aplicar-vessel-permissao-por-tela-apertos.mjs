// APLICA, REGISTRA e PROVA a segunda rodada do B13 (os três apertos do dono):
// base comum só com Private Appointment, veio/não veio só com editar, e a lista
// das parceiras recortada para quem só tem o Material Gráfico.
//
//   node --env-file=coletor/.env coletor/aplicar-vessel-permissao-por-tela-apertos.mjs            → ensaio: prova tudo e DESFAZ
//   node --env-file=coletor/.env coletor/aplicar-vessel-permissao-por-tela-apertos.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar, provar e só então `commit`
// (conferido `.command === 'COMMIT'`). Nenhum `.catch` dentro da transação.
// ⚠️ O banco tem de estar onde a migration partiu (sha256 das duas funções).
// ⚠️ AS CONTAS DE PROVA nascem DENTRO do savepoint `prova` e morrem com ele — e
// a impressão do fim confere que o número de contas (auth.users) não mudou.
// Ver PADRAO-DA-CENTRAL.md, "Aplicador de migration".
//
// DATABASE_URL: coletor/.env OU o ambiente (`node --env-file=<.env> …`).
// contas-de-prova: nascem DENTRO do savepoint `prova` e morrem com ele; a IMPRESSAO confere o número de contas.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-25-zz-vessel-permissao-por-tela-apertos.sql'
const PRECISA = '2026-09-25-vessel-permissao-por-tela-no-banco.sql'
const GRAVAR = process.argv.includes('--gravar')

const MEDIDO = {
  'vessel_situacao_do_atendimento(bigint,text)': '25b4936850bda8afca446451d4a968d4a9ddb1361f0d3e36dec8e14d665ec7a5',
  'vessel_rastreio_dos_stylists(integer,boolean)': 'ea1716539dbf6eed99e9d81d07034ba2a4e626a6b6c1c1c41b3925efe8060869',
  'vessel_pode(text,text)': '10a3fe5aaa94a45a86b2b674c31491df1430c73aae0530319dd1843d2adc285d',
}
const NOVO = {
  'vessel_situacao_do_atendimento(bigint,text)': '0d5399565cd6d7f3617fd36eab9cda46669f197ebd9b683c4e45551a58d109f2',
  'vessel_rastreio_dos_stylists(integer,boolean)': '27a3a42e51e9e3963874a9875dfdbbff1c251c81bd9a38735e34705b744d0e8d',
}
const BASE_COMUM = ['vessel_pessoas', 'vessel_atendimentos', 'vessel_pedidos', 'vessel_pedido_itens']
const PA = 'atendimentos', BS = 'atendimentos.beauty-sessions', PE = 'atendimentos.private-edit'
const SC = 'atendimentos.stylist-circle', MG = 'atendimentos.material-grafico'
// O que o Material Gráfico lê de cada parceira (itemDaStylist, material-grafico-regras.js).
const CHAVES_DO_MATERIAL = ['ativa', 'cidade', 'codigo', 'etapa', 'etapa_libera_private_edit', 'nome']

const IMPRESSAO = `
  select (select count(*) from auth.users)::int as contas,
         (select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) from public.profiles p) as perfis_md5,
         (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.vessel_atendimentos t) as atendimentos_md5,
         (select count(*) from public.vessel_pessoas)::int as pessoas,
         (select count(*) from public.vessel_pedidos)::int as pedidos,
         (select count(*) from public.vessel_stylists)::int as stylists`
const TODAS = `select p.oid::regprocedure::text as a, md5(pg_get_functiondef(p.oid)) as m
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}
const sha256 = (t) => createHash('sha256').update(t || '').digest('hex')

if (!process.env.DATABASE_URL) { console.error('❌ sem DATABASE_URL'); process.exit(1) }
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r
const registrada = async (n) => (await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ok`, [n])).ok
const falarComo = (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
  [id ? JSON.stringify({ sub: id, role: 'authenticated' }) : ''])
const comoCentral = async (id, consulta, a = []) => {
  await falarComo(id)
  await cli.query('savepoint chamada; set local role authenticated')
  try { const v = await r(consulta, a); await cli.query('rollback to savepoint chamada'); return { v } } catch (e) {
    await cli.query('rollback to savepoint chamada'); return { e }
  }
}
const polDaBase = async () => Object.fromEntries((await cli.query(`select tablename, qual from pg_policies
  where tablename = any($1) and policyname like '%_le_central'`, [BASE_COMUM])).rows.map((p) => [p.tablename, p.qual]))

if (await registrada(ARQUIVO)) { console.error(`❌ ${ARQUIVO} já está registrada.`); process.exit(1) }
if (!(await registrada(PRECISA))) { console.error(`❌ falta ${PRECISA} antes desta.`); process.exit(1) }

console.log('\n── o banco de agora contra o texto de onde a migration partiu')
for (const [a, esperado] of Object.entries(MEDIDO)) {
  const { def } = await uma(`select pg_get_functiondef($1::regprocedure) as def`, [`public.${a}`])
  conferir(sha256(def) === esperado, `${a}: igual a quando a migration foi escrita`, sha256(def))
}
const polAntes = await polDaBase()
conferir(BASE_COMUM.every((t) => polAntes[t] === 'is_vessel_atendimentos()'), 'as 4 políticas da base comum pedem a família hoje', polAntes)
if (falhas.length) { console.error('\n❌ o banco mudou — nada foi aplicado.'); await cli.end(); process.exit(1) }

const antes = await uma(IMPRESSAO)
const todasAntes = Object.fromEntries((await cli.query(TODAS)).rows.map((x) => [x.a, x.m]))
const PESSOAS = (await cli.query(`select id, email, coalesce(is_superadmin, false) as sa, coalesce(disabled, false) as desativada,
    case when jsonb_typeof(permissions) = 'object' then permissions else '{}'::jsonb end as permissions
  from public.profiles where email not like '%@teste.invalido' order by email`)).rows
const tem = (perm, f, nivel) => Array.isArray(perm[f]) && perm[f].includes('ver') && (nivel === 'ver' || perm[f].includes(nivel))
// A Central: a tela do Private Appointment abre com 'ver' (lê as quatro tabelas);
// Veio/Não veio aparece com 'editar' do Private Appointment OU do Private Edit.
const centralLeBase = (p) => !p.desativada && (p.sa || tem(p.permissions, PA, 'ver'))
const centralMarca = (p) => !p.desativada && (p.sa || tem(p.permissions, PA, 'editar') || tem(p.permissions, PE, 'editar'))
const EXPR_BASE_DEPOIS = `public.vessel_pode('atendimentos', 'ver')`
const EXPR_MARCA_DEPOIS = `(public.vessel_pode('atendimentos', 'editar') or public.vessel_pode('atendimentos.private-edit', 'editar'))`
const EXPR_MARCA_ANTES = `(public.vessel_pode('atendimentos', 'ver') or public.vessel_pode('atendimentos.private-edit', 'ver'))`

await cli.query('begin')
try {
  const medirAntes = {}
  for (const p of PESSOAS) {
    await falarComo(p.id)
    medirAntes[p.id] = await uma(`select public.is_vessel_atendimentos() as base, ${EXPR_MARCA_ANTES} as marca`)
  }
  await falarComo(null)
  conferir(PESSOAS.filter((p) => p.sa && !p.desativada).every((p) => medirAntes[p.id].base && medirAntes[p.id].marca),
    'controle: medido antes, os super-admins passam (a medição enxerga quem passa)')

  console.log('\n── aplicar e registrar')
  await cli.query(sql)
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-permissao-por-tela-apertos.mjs'])

  console.log('\n── a estrutura')
  for (const [a, esperado] of Object.entries(NOVO)) {
    const { def } = await uma(`select pg_get_functiondef($1::regprocedure) as def`, [`public.${a}`])
    conferir(sha256(def) === esperado, `${a}: EXATAMENTE o texto da migration`, sha256(def))
  }
  const todasDepois = Object.fromEntries((await cli.query(TODAS)).rows.map((x) => [x.a, x.m]))
  const mudaram = Object.keys({ ...todasAntes, ...todasDepois }).filter((k) => todasAntes[k] !== todasDepois[k]).sort()
  conferir(JSON.stringify(mudaram) === JSON.stringify(Object.keys(NOVO).sort()), 'nenhuma outra função do schema mudou', mudaram)
  const gr = (await cli.query(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') as aut, has_function_privilege('anon', p.oid, 'EXECUTE') as anon
    from pg_proc p where p.oid::regprocedure::text = any($1)`, [Object.keys(NOVO)])).rows
  conferir(gr.length === 2 && gr.every((g) => g.aut && !g.anon), 'as duas: a Central executa, o anon não (como antes)', gr)
  const pol = await polDaBase()
  conferir(BASE_COMUM.every((t) => pol[t] === "vessel_pode('atendimentos'::text, 'ver'::text)"), 'as 4 políticas da base comum pedem Private Appointment ver', pol)
  const leads = (await cli.query(`select tablename, qual from pg_policies where policyname like '%_leitura_meta_leads'
    and tablename in ('vessel_atendimentos', 'vessel_pessoas') order by 1`)).rows
  conferir(leads.length === 2 && leads.every((l) => l.qual === 'is_vessel_leads()'), 'a política própria da Base de Leads (Meta Ads) não mudou', leads)

  console.log('\n── as pessoas de verdade: antes × depois × o que a Central mostra')
  let mudancas = 0, contra = 0
  for (const p of PESSOAS) {
    await falarComo(p.id)
    const d = await uma(`select ${EXPR_BASE_DEPOIS} as base, ${EXPR_MARCA_DEPOIS} as marca`)
    const a = medirAntes[p.id]
    const dif = []
    if (a.base !== d.base) dif.push(`base comum: ${a.base ? 'lia' : 'não lia'} → ${d.base ? 'lê' : 'não lê'}`)
    if (a.marca !== d.marca) dif.push(`veio/não veio: ${a.marca ? 'marcava' : 'não marcava'} → ${d.marca ? 'marca' : 'não marca'}`)
    const fora = (d.base !== centralLeBase(p)) || (d.marca !== centralMarca(p))
    if (a.base || a.marca || d.base || d.marca || dif.length) {
      console.log(`     ${p.email}${p.sa ? ' (super-admin)' : ''}: base ${d.base ? 'lê' : 'não lê'}, veio/não veio ${d.marca ? 'marca' : 'não marca'}${dif.length ? ` — MUDA: ${dif.join('; ')}` : ''}`)
    }
    mudancas += dif.length
    if (fora) { contra++; console.log(`       ✗ discorda da Central: ${p.email}`) }
  }
  await falarComo(null)
  console.log(`     (${PESSOAS.length} perfis reais; os que não aparecem não leem nem marcam, antes e depois)`)
  conferir(contra === 0, 'depois, cada pessoa lê a base e marca presença EXATAMENTE onde a Central mostra')
  conferir(mudancas === 0, 'nenhuma pessoa de verdade perde nem ganha nada que usa pela Central', mudancas)

  console.log('\n── perfis de mentira (savepoint, desfeito)')
  await cli.query('savepoint prova')
  const perfil = async (rotulo, permissions, { sa = false, desativada = false, features = null } = {}) => {
    const id = randomUUID(), email = `prova-b13b-${id}@teste.invalido`
    const feats = features || [...new Set(Object.entries(permissions).filter(([, a]) => a.includes('ver'))
      .flatMap(([k]) => (k.includes('.') ? [k, k.split('.')[0]] : [k])))]
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin, disabled)
      values ($1, $2, $3, $4, $5::jsonb, $6, $7)`, [id, email, `Prova ${rotulo}`, feats, JSON.stringify(permissions), sa, desativada])
    return id
  }
  const P = {
    paVer: await perfil('PA ver', { [PA]: ['ver'] }),
    paMexe: await perfil('PA mexer', { [PA]: ['ver', 'editar'] }),
    peVer: await perfil('PE ver', { [PE]: ['ver'] }),
    peMexe: await perfil('PE mexer', { [PE]: ['ver', 'editar'] }),
    mg: await perfil('MG', { [MG]: ['ver'] }),
    bs: await perfil('BS mexer', { [BS]: ['ver', 'editar'] }),
    scVer: await perfil('SC ver', { [SC]: ['ver'] }),
    leads: await perfil('Base de Leads', { 'meta.leads': ['ver'] }),
    sa: await perfil('super-admin', {}, { sa: true }),
    des: await perfil('desativada', { [PA]: ['ver', 'editar'], [SC]: ['ver', 'editar'], [MG]: ['ver'] }, { desativada: true }),
  }

  console.log('\n  a base comum, lida direto (como o PostgREST)')
  const total = {}
  for (const t of BASE_COMUM) total[t] = (await uma(`select count(*)::int as n from public.${t}`)).n
  const le = async (id, t) => (await comoCentral(id, `(select count(*)::int from public.${t})`)).v
  for (const t of BASE_COMUM) {
    const [paVer, sa, mg, bs, peMexe, scVer, des] = [await le(P.paVer, t), await le(P.sa, t), await le(P.mg, t), await le(P.bs, t),
      await le(P.peMexe, t), await le(P.scVer, t), await le(P.des, t)]
    conferir(total[t] > 0 && paVer === total[t] && sa === total[t] && mg + bs + peMexe + scVer + des === 0,
      `${t}: Private Appointment e super-admin leem as ${total[t]}; só Material Gráfico / Beauty / Private Edit / Stylist Circle / desativada leem zero`,
      { total: total[t], paVer, sa, mg, bs, peMexe, scVer, des })
  }
  const lAt = await le(P.leads, 'vessel_atendimentos'), lPe = await le(P.leads, 'vessel_pessoas'), lPd = await le(P.leads, 'vessel_pedidos')
  conferir(lAt === total.vessel_atendimentos && lPe === total.vessel_pessoas && lPd === 0,
    'a Base de Leads (só meta.leads) continua lendo visitas e clientes pela política dela, e não vendas', { lAt, lPe, lPd })

  console.log('\n  veio / não veio')
  const { id: atId } = await uma(`select id from public.vessel_atendimentos order by id limit 1`)
  const marcar = async (id) => {
    const s = await comoCentral(id, `public.vessel_situacao_do_atendimento(p_id => $1, p_situacao => 'realizado')`, [atId])
    return s.e ? `erro ${s.e.code}` : s.v?.situacao
  }
  const m = { paVer: await marcar(P.paVer), peVer: await marcar(P.peVer), mg: await marcar(P.mg), des: await marcar(P.des),
    paMexe: await marcar(P.paMexe), peMexe: await marcar(P.peMexe), sa: await marcar(P.sa) }
  conferir(m.paVer === 'sem_permissao' && m.peVer === 'sem_permissao' && m.mg === 'sem_permissao' && m.des === 'sem_permissao',
    'quem só VÊ (Private Appointment ou Private Edit), Material Gráfico e desativada: sem_permissao', m)
  conferir(m.paMexe === 'realizado' && m.peMexe === 'realizado' && m.sa === 'realizado', 'Private Appointment mexer, Private Edit mexer e super-admin marcam', m)
  const anon = await (async () => {
    await falarComo(null)
    await cli.query('savepoint chamada; set local role anon')
    try { await r(`public.vessel_situacao_do_atendimento(p_id => $1, p_situacao => 'realizado')`, [atId]); return 'passou' } catch (e) { return e.code } finally {
      await cli.query('rollback to savepoint chamada')
    }
  })()
  conferir(anon === '42501', 'anon: permissão negada', anon)

  console.log('\n  a lista das parceiras')
  const lista = async (id) => (await comoCentral(id, `public.vessel_rastreio_dos_stylists(p_dias => 7, p_incluir_desativadas => true)`)).v
  const doSC = await lista(P.scVer), doMG = await lista(P.mg), doSA = await lista(P.sa)
  const chaves = (l) => [...new Set((l || []).flatMap((x) => Object.keys(x)))].sort()
  conferir(Array.isArray(doMG) && doMG.length > 0 && JSON.stringify(chaves(doMG)) === JSON.stringify(CHAVES_DO_MATERIAL),
    `só Material Gráfico: ${doMG?.length} parceiras, só ${CHAVES_DO_MATERIAL.join(', ')}`, chaves(doMG))
  conferir(!JSON.stringify(doMG).match(/whatsapp|instagram|observacoes|responsavel/), 'só Material Gráfico: nenhum WhatsApp, Instagram, observação ou responsável')
  conferir(doSC.length === doMG.length && doSC.every((s, i) => CHAVES_DO_MATERIAL.every((k) => JSON.stringify(s[k]) === JSON.stringify(doMG[i][k]))),
    'o que o Material Gráfico recebe é igual, parceira por parceira e na mesma ordem, ao que o Stylist Circle recebe nessas chaves')
  conferir(['whatsapp', 'instagram', 'observacoes', 'proxima_acao', 'receita', 'sem_contato'].every((k) => chaves(doSC).includes(k))
    && JSON.stringify(chaves(doSC)) === JSON.stringify(chaves(doSA)), 'Stylist Circle (ver) e super-admin continuam recebendo a lista inteira', chaves(doSC))
  const vazio = await comoCentral(P.bs, `public.vessel_rastreio_dos_stylists()`)
  conferir(vazio.e?.code === '42501', 'só Beauty Sessions: continua recusado', vazio.e?.message)

  await cli.query('rollback to savepoint prova')
  await falarComo(null)
  const depoisDaProva = await uma(IMPRESSAO)
  conferir(JSON.stringify(depoisDaProva) === JSON.stringify(antes), 'a prova não deixou rastro (nem conta de mentira)', { antes, depoisDaProva })

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
  const q = (await outra.query(`select qual from pg_policies where policyname = 'vessel_pessoas_le_central'`)).rows[0]?.qual
  await outra.end()
  if (JSON.stringify(agora) !== JSON.stringify(antes) || reg !== 1 || !/vessel_pode/.test(q || '')) {
    console.error('❌ depois do commit algo não bate', { antes, agora, reg, q })
    process.exitCode = 1
  } else {
    console.log('  ✓ depois do commit, numa conexão nova: dados intactos, política nova e migration registrada')
  }
}
