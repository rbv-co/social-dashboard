// APLICA, REGISTRA e PROVA "sem contato ainda" na parceira do Stylist Circle.
//
//   node coletor/aplicar-vessel-stylist-sem-contato.mjs            → ensaio: prova tudo e DESFAZ
//   node coletor/aplicar-vessel-stylist-sem-contato.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar em `schema_migrations`, provar
// e só então `commit` — conferido (`.command === 'COMMIT'`). Nenhum `.catch`
// dentro da transação: um erro engolido faria o COMMIT virar ROLLBACK calado.
//
// ⚠️ ANTES DE APLICAR, CONFERE QUE O BANCO ESTÁ ONDE A MIGRATION PARTIU: o
// texto de criar/editar/lista na migration saiu do `pg_get_functiondef` de
// 24/09/2026. Se alguém mexeu numa delas depois, o ensaio para e diz qual.
//
// ⚠️ A PROVA FALA COMO GENTE DE VERDADE (perfis de mentira + `request.jwt.claims`)
// e mora inteira em `savepoint prova` … `rollback to savepoint prova`.
//
// ⚠️ E PROVA QUE A CENTRAL QUE ESTÁ NO AR CONTINUA FUNCIONANDO: os corpos JSON
// de `tela-de-stylist-circle.vue` e `ficha-da-stylist.vue` de hoje (criar,
// corrigir, mover, registrar contato, a lista), por nome, como o PostgREST chama
// — nenhum deles manda `p_sem_contato`.
//
// DATABASE_URL: coletor/.env OU o ambiente (`node --env-file=<.env> …`).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-24-vessel-stylist-sem-contato.sql'
const GRAVAR = process.argv.includes('--gravar')

const PORTAS = {
  vessel_stylist_criar: 'vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date,text,boolean)',
  vessel_stylist_editar: 'vessel_stylist_editar(text,text,text,text,text,text,text,text,text,text,text,date,text,date,boolean,text,boolean)',
  vessel_rastreio_dos_stylists: 'vessel_rastreio_dos_stylists(integer,boolean)',
}
const ANTES_DA_MIGRATION = {
  vessel_stylist_criar: 'vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date,text)',
  vessel_stylist_editar: 'vessel_stylist_editar(text,text,text,text,text,text,text,text,text,text,text,date,text,date,boolean,text)',
  vessel_rastreio_dos_stylists: 'vessel_rastreio_dos_stylists(integer,boolean)',
}

// ⚠️ A IMPRESSÃO IGNORA A COLUNA NOVA: `to_jsonb(t) - 'sem_contato'` é o mesmo
// texto antes (a coluna não existe) e depois (ela existe, sempre false).
const IMPRESSAO = `
  select (select count(*) from public.vessel_stylists)::int as stylists,
         (select md5(coalesce(string_agg((to_jsonb(t) - 'sem_contato')::text, '|' order by t.id), ''))
            from public.vessel_stylists t) as stylists_md5,
         (select count(*) from public.vessel_stylist_etapas_historico)::int as historico,
         (select count(*) from public.vessel_private_edits)::int as private_edits,
         (select count(*) from public.vessel_stylist_contatos)::int as contatos`

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

const antes = await uma(IMPRESSAO)
const { ja } = await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ja`, [ARQUIVO])
if (ja) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }
const PRE = await uma(`select exists (select 1 from public.schema_migrations
  where name = '2026-09-24-vessel-stylist-funil-configuravel.sql') as ok`)
if (!PRE.ok) { console.error('❌ falta 2026-09-24-vessel-stylist-funil-configuravel.sql antes desta.'); process.exit(1) }

// ── o banco está onde a migration partiu? ───────────────────────────────────
// A migration carrega o texto de cada função como ele estava no banco quando
// ela foi escrita (sha256 de `pg_get_functiondef`, medido em 24/09/2026). Se o
// texto de agora é outro, alguém mexeu depois — e a migration apagaria a
// mudança. Então para, e diz qual.
const MEDIDO = {
  vessel_stylist_criar: 'e4b8457c640fd02717832c654969808629a20b2f0d155136c55c4e58b8b67f26',
  vessel_stylist_editar: '389e258c5be5b6d67d1814099d992da2cd6726a1e80ec3b7bb136789c44a9cd8',
  vessel_rastreio_dos_stylists: 'dc1510c4b2b690550e50c4ce3cea52d0303507136ad71c889d26e4fd01931e2a',
}
console.log('\n── o banco de agora contra o texto de onde a migration partiu')
for (const [nome, assinatura] of Object.entries(ANTES_DA_MIGRATION)) {
  const { lista, def } = await uma(`select string_agg(p.oid::regprocedure::text, ' | ') as lista,
      max(pg_get_functiondef(p.oid)) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [nome])
  conferir(lista === assinatura, `${nome}: a assinatura de agora é a de onde a migration partiu`, lista)
  const sha = createHash('sha256').update(def || '').digest('hex')
  conferir(sha === MEDIDO[nome], `${nome}: o texto no banco é o mesmo de quando a migration foi escrita`, sha)
}
if (falhas.length) { console.error('\n❌ o banco mudou depois de a migration ser escrita — nada foi aplicado.'); await cli.end(); process.exit(1) }

await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-stylist-sem-contato.mjs'])

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
  const gat = await uma(`select has_function_privilege('authenticated', 'public.vessel_stylists_sem_contato_some()', 'EXECUTE') as aut,
                                has_function_privilege('anon', 'public.vessel_stylists_sem_contato_some()', 'EXECUTE') as anon`)
  conferir(gat.aut === false && gat.anon === false, 'o gatilho novo é miolo fechado', gat)

  console.log('\n── a tabela')
  const col = await uma(`select is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='vessel_stylists' and column_name='sem_contato'`)
  conferir(col && col.is_nullable === 'NO' && col.column_default === 'false', 'sem_contato: not null default false', col)
  const chk = await uma(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'vessel_stylists_tem_contato'`)
  conferir(/sem_contato/.test(chk?.d || '') && /whatsapp IS NOT NULL/.test(chk?.d || ''), 'a trava: WhatsApp OU Instagram OU sem_contato', chk)
  const { ligadas } = await uma(`select count(*) filter (where sem_contato)::int as ligadas from public.vessel_stylists`)
  conferir(ligadas === 0, 'as que já existem nascem com a marca desligada', ligadas)

  await cli.query('savepoint prova')
  const perfil = async (features, permissions) => {
    const id = randomUUID(), email = `prova-sem-contato-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(`insert into public.profiles (id, email, features, permissions, is_superadmin)
                     values ($1, $2, $3, $4::jsonb, false)`, [id, email, features, JSON.stringify(permissions)])
    return id
  }
  const falarComo = async (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])
  const mexe = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] })
  const ve = await perfil(['atendimentos'], { atendimentos: ['ver'] })
  await falarComo(mexe)
  const { primeira } = await uma(`select id as primeira from public.vessel_stylist_etapas
    where ativa and tipo = 'funil' order by ordem, id limit 1`)
  const { segunda } = await uma(`select id as segunda from public.vessel_stylist_etapas
    where ativa and tipo = 'funil' order by ordem, id offset 1 limit 1`)

  console.log('\n── a Central que está no ar hoje (corpos de tela-de-stylist-circle.vue, SEM p_sem_contato)')
  const corpoCriar = (x) => ({ p_nome: x.nome, p_whatsapp: x.whatsapp ?? '', p_cidade: x.cidade ?? null,
    p_instagram: x.instagram ?? null, p_atuacao: null, p_praca: null, p_loja: null, p_origem_contato: 'indicacao',
    p_responsavel: 'Fulana', p_proxima_acao: null, p_proxima_acao_em: null, p_observacoes: null })
  const v1 = await rpc('vessel_stylist_criar', corpoCriar({ nome: 'Prova Central de Hoje', whatsapp: '(19) 99000-3461', cidade: 'Campinas' }))
  let s = v1.ok ? await linha(v1.codigo) : null
  conferir(v1.ok && v1.situacao === 'ok' && /^STY-\d{4}$/.test(v1.codigo) && s.sem_contato === false && s.etapa_id === primeira,
    'criar com WhatsApp: {ok, situacao, codigo}, primeira etapa, marca desligada', { v1, s })
  const v2 = await rpc('vessel_stylist_criar', corpoCriar({ nome: 'Prova Só Instagram', instagram: '@prova.so.insta.3462' }))
  conferir(v2.ok === true, 'criar só com Instagram continua entrando', v2)
  const v3 = await rpc('vessel_stylist_criar', corpoCriar({ nome: 'Prova Sem Nada', cidade: 'Limeira' }))
  conferir(v3.ok === false && v3.situacao === 'sem_contato', 'criar sem os dois continua recusado (sem_contato) — igual a antes', v3)
  const v4 = await rpc('vessel_stylist_criar', corpoCriar({ nome: 'Prova Insta Ruim', instagram: 'não sei' }))
  conferir(v4.situacao === 'instagram_invalido', 'Instagram que não é perfil, sem WhatsApp, continua recusado', v4)
  const corpoEditar = (codigo, x) => ({ p_codigo: codigo, p_nome: x.nome, p_whatsapp: x.whatsapp || null,
    p_cidade: x.cidade || null, p_instagram: x.instagram || null, p_atuacao: null, p_praca: null, p_loja: null,
    p_origem_contato: 'indicacao', p_responsavel: 'Fulana', p_proxima_acao: 'Ligar', p_proxima_acao_em: null,
    p_sem_proxima_acao: false, p_observacoes: x.observacoes ?? '' })
  const e1 = await rpc('vessel_stylist_editar', corpoEditar(v1.codigo, { nome: 'Prova Central de Hoje', whatsapp: '(19) 99000-3461', cidade: 'Campinas', observacoes: 'nota' }))
  s = await linha(v1.codigo)
  conferir(e1.ok && s.proxima_acao === 'Ligar' && s.observacoes === 'nota' && s.sem_contato === false, 'corrigir com o corpo de hoje', { e1, s })
  const m1 = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: v1.codigo, p_etapa_id: segunda, p_motivo_id: null, p_nota: null })
  conferir(m1?.ok === true, 'mover de etapa (quadro/ficha de hoje)', m1)

  console.log('\n── sem contato ainda (a Central nova)')
  const n1 = await rpc('vessel_stylist_criar', { ...corpoCriar({ nome: 'Prova Sem Contato', cidade: 'Piracicaba' }), p_sem_contato: true })
  s = n1.ok ? await linha(n1.codigo) : null
  conferir(n1.ok && s.sem_contato === true && s.whatsapp === null && s.instagram === null && s.etapa_id === primeira,
    'com a caixa marcada entra sem os dois, na primeira etapa, com a marca', { n1, s })
  const n2 = await rpc('vessel_stylist_criar', { ...corpoCriar({ nome: 'Prova Caixa e Zap', whatsapp: '(19) 99000-3463' }), p_sem_contato: true })
  s = await linha(n2.codigo)
  conferir(n2.ok && s.sem_contato === false, 'caixa marcada MAS com WhatsApp: a marca não liga', s)
  const n3 = await rpc('vessel_stylist_criar', { ...corpoCriar({ nome: 'Prova Caixa e Insta Ruim', instagram: 'não sei' }), p_sem_contato: true })
  conferir(n3.situacao === 'instagram_invalido', 'caixa marcada com Instagram escrito errado: recusa o Instagram (não joga fora calado)', n3)

  console.log('\n── a Central de hoje mexendo numa "sem contato"')
  const e2 = await rpc('vessel_stylist_editar', corpoEditar(n1.codigo, { nome: 'Prova Sem Contato', cidade: 'Piracicaba', observacoes: 'Ionara vai ligar' }))
  s = await linha(n1.codigo)
  conferir(e2.ok && s.sem_contato === true && s.observacoes === 'Ionara vai ligar', 'corrigir sem dar contato (corpo de hoje): grava e a marca fica', { e2, s })
  const c1 = await rpc('vessel_stylist_registrar_contato', { p_codigo: n1.codigo, p_canal: 'presencial', p_resultado: 'conversou',
    p_nota: null, p_proxima_acao: null, p_proxima_acao_em: null })
  conferir(c1?.ok === true, 'registrar contato numa "sem contato" (ficha de hoje)', c1)
  const m2 = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: n1.codigo, p_etapa_id: segunda, p_motivo_id: null, p_nota: null })
  conferir(m2?.ok === true, 'mover de etapa uma "sem contato"', m2)

  console.log('\n── o contato chega: a marca some sozinha')
  const e3 = await rpc('vessel_stylist_editar', corpoEditar(n1.codigo, { nome: 'Prova Sem Contato', instagram: '@prova.sem.contato.3464' }))
  s = await linha(n1.codigo)
  conferir(e3.ok && s.sem_contato === false && s.instagram === '@prova.sem.contato.3464', 'corrigir com Instagram (corpo de hoje) desliga a marca', { e3, s })
  const n4 = await rpc('vessel_stylist_criar', { ...corpoCriar({ nome: 'Prova Sem Contato 2' }), p_sem_contato: true })
  const e4 = await rpc('vessel_stylist_editar', { p_codigo: n4.codigo, p_sem_contato: false })
  conferir(e4.situacao === 'sem_contato', 'desmarcar a caixa sem dar contato é recusado', e4)
  const e5 = await rpc('vessel_stylist_editar', { p_codigo: n4.codigo, p_whatsapp: '(19) 99000-3465', p_sem_contato: true })
  s = await linha(n4.codigo)
  conferir(e5.ok && s.sem_contato === false && s.whatsapp === '5519990003465', 'WhatsApp com a caixa ainda marcada: o contato vence, a marca desliga', s)
  const e6 = await rpc('vessel_stylist_editar', { p_codigo: v1.codigo, p_sem_contato: true })
  s = await linha(v1.codigo)
  conferir(e6.ok && s.sem_contato === false, 'marcar a caixa em quem já tem contato não liga nada', s)

  console.log('\n── a tabela por fora das funções')
  const n5 = await rpc('vessel_stylist_criar', { ...corpoCriar({ nome: 'Prova Sem Contato 3' }), p_sem_contato: true })
  await cli.query(`update public.vessel_stylists set whatsapp = '5519990003466' where codigo = $1`, [n5.codigo])
  s = await linha(n5.codigo)
  conferir(s.sem_contato === false, 'update direto do WhatsApp: o gatilho desliga a marca', s)
  await cli.query('savepoint direto')
  let recusa = null
  try {
    await cli.query(`insert into public.vessel_stylists (codigo, nome, origem_contato) values ('STY-9998', 'Prova Direta', 'pesquisa')`)
  } catch (err) { recusa = err }
  await cli.query('rollback to savepoint direto')
  conferir(recusa?.code === '23514' && /tem_contato/.test(recusa?.message || ''), 'sem contato e SEM a marca a tabela recusa (23514)', recusa?.message)
  await cli.query('savepoint direto2')
  recusa = null
  try {
    await cli.query(`update public.vessel_stylists set sem_contato = false, whatsapp = null, instagram = null where codigo = $1`, [n5.codigo])
  } catch (err) { recusa = err }
  await cli.query('rollback to savepoint direto2')
  conferir(recusa?.code === '23514', 'apagar os dois contatos e a marca de uma vez: a tabela recusa', recusa?.message)

  console.log('\n── a landing continua entrando igual')
  await falarComo(null)
  await r(`public.vessel_pedido_do_stylist('Prova Landing', '(19) 99000-3467')`)
  s = await uma(`select sem_contato, etapa_id from public.vessel_stylists where whatsapp = '5519990003467'`)
  conferir(s && s.sem_contato === false, 'inscrição pela landing: com WhatsApp, marca desligada', s)

  console.log('\n── a lista da Central (quem só vê)')
  await falarComo(ve)
  const lista = await r(`public.vessel_rastreio_dos_stylists(14, false)`)
  const na = (lista || []).find((x) => x.codigo === n4.codigo)
  const semC = (lista || []).find((x) => x.codigo === n5.codigo)
  const nova = await rpc('vessel_stylist_criar', { ...corpoCriar({ nome: 'X' }), p_sem_contato: true })
  conferir(nova.situacao === 'sem_permissao', 'quem só vê não cadastra (nem sem contato)', nova)
  await falarComo(mexe)
  const n6 = await rpc('vessel_stylist_criar', { ...corpoCriar({ nome: 'Prova Sem Contato 4' }), p_sem_contato: true })
  await falarComo(ve)
  const lista2 = await r(`public.vessel_rastreio_dos_stylists(14, false)`)
  const l6 = (lista2 || []).find((x) => x.codigo === n6.codigo)
  const chavesVelhas = ['codigo', 'nome', 'cidade', 'etapa_id', 'etapa', 'etapa_tipo', 'whatsapp', 'instagram', 'observacoes',
    'proxima_acao', 'ultimo_contato_em', 'receita', 'janela_de_venda_em_dias', 'ativada_em']
  conferir(l6 && l6.sem_contato === true && na?.sem_contato === false && semC?.sem_contato === false
    && chavesVelhas.every((k) => k in l6), 'a lista devolve sem_contato (true/false) e todas as chaves de antes', { l6, na: na?.sem_contato })

  await cli.query('rollback to savepoint prova')
  await falarComo(null)
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
  const chk = (await outra.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'vessel_stylists_tem_contato'`)).rows[0]
  const assin = (await outra.query(`select string_agg(p.oid::regprocedure::text, ' | ' order by p.proname) a from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('vessel_stylist_criar', 'vessel_stylist_editar')`)).rows[0]
  await outra.end()
  if (JSON.stringify(agora) !== JSON.stringify(antes) || reg !== 1 || !/sem_contato/.test(chk?.d || '')
      || assin.a !== `${PORTAS.vessel_stylist_criar} | ${PORTAS.vessel_stylist_editar}`) {
    console.error('❌ depois do commit algo não bate', { antes, agora, reg, chk, assin })
    process.exitCode = 1
  } else {
    console.log('  ✓ depois do commit, numa conexão nova: tabelas intactas, trava nova, portas novas e migration registrada')
  }
}
