// APLICA, REGISTRA e PROVA: a agenda do Private Edit e o aviso de encontro
// sobreposto (`db/migrations/2026-09-25-vessel-agenda-do-private-edit.sql`).
//
//   node --env-file=<coletor/.env> coletor/aplicar-vessel-agenda-do-private-edit.mjs            → ensaio: prova tudo e DESFAZ
//   node --env-file=<coletor/.env> coletor/aplicar-vessel-agenda-do-private-edit.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar, provar e só então `commit`,
// conferido (`.command === 'COMMIT'`). Cada cenário mora num savepoint desfeito,
// fala como gente de verdade (perfis de mentira + `request.jwt.claims`), e a
// impressão das tabelas reais é conferida antes, depois da migration, depois
// das provas e numa conexão nova. Nenhum `.catch` engole erro DENTRO da
// transação sem savepoint em volta.
//
// ⚠️ O CORPO DE PARTIDA É O DO BANCO: antes de aplicar, a impressão (`md5` do
// `prosrc`) de `vessel_criar_private_edit` e de `vessel_private_edit_editar`
// tem de ser a que esta migration copiou. Se alguém mexeu nelas depois, o
// aplicador PARA — senão a migration apagaria calada o que a outra pôs.
//
// DATABASE_URL: coletor/.env OU o ambiente (`node --env-file=<.env> …`).
import './lib/carregar-env.mjs'
import { contasDeProva } from './lib/contas-de-prova.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-25-vessel-agenda-do-private-edit.sql'
const ANTERIORES = ['2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql', '2026-09-24-vessel-codigo-do-encontro-sem-repetir.sql']
const GRAVAR = process.argv.slice(2).includes('--gravar')

// O corpo que a migration copiou, lido do banco em 24/09/2026 (depois das duas
// de cima): se o banco disser outra coisa, alguém mexeu depois.
const CORPO_DE_PARTIDA = {
  'vessel_criar_private_edit(text,timestamp with time zone,text,text,text,integer,boolean)': '659aeef921e5c74224978f881908fb69',
  'vessel_private_edit_editar(text,timestamp with time zone,text,text,text,integer,text)': '846d6f47238ec180d9b03f397f14132d',
}
const PORTAS = {
  vessel_agenda_das_lojas: 'vessel_agenda_das_lojas(date,date,text)',
  vessel_private_edit_sobreposicoes: 'vessel_private_edit_sobreposicoes(timestamp with time zone,text,text,text,text)',
  vessel_criar_private_edit: 'vessel_criar_private_edit(text,timestamp with time zone,text,text,text,integer,boolean,boolean)',
  vessel_private_edit_editar: 'vessel_private_edit_editar(text,timestamp with time zone,text,text,text,integer,text,boolean)',
}
const MIOLO = ['vessel_private_edit_duracao()', 'vessel_lugar_do_encontro(text,text,text)',
  'vessel_encontros_que_sobrepoem(timestamp with time zone,text,text)', 'vessel_contexto_da_loja(timestamp with time zone,text)']
// ⚠️ A FORMA DA RESPOSTA — a mesma que o banco de mentira devolve e que a tela
// lê (`agenda-regras.js`). Todo item, de qualquer tipo, com TODAS estas chaves.
const CHAVES_DA_AGENDA = ['tipo', 'id', 'codigo', 'dia', 'hora', 'hora_fim', 'inicio', 'fim', 'loja', 'praca', 'local',
  'lugar', 'stylist', 'anfitria', 'parceiro', 'client_advisor', 'status', 'sobrepoe'].sort()

const IMPRESSAO = `
  select (select count(*) from public.vessel_private_edits)::int as private_edits,
         (select md5(coalesce(string_agg(row_to_json(e)::text, '|' order by e.id), '')) from public.vessel_private_edits e) as private_edits_md5,
         (select count(*) from public.vessel_beauty_sessions)::int as sessoes,
         (select md5(coalesce(string_agg(row_to_json(b)::text, '|' order by b.codigo), '')) from public.vessel_beauty_sessions b) as sessoes_md5,
         (select count(*) from public.vessel_atendimentos)::int as atendimentos,
         (select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.id), '')) from public.vessel_atendimentos t) as atendimentos_md5,
         (select count(*) from public.vessel_stylists)::int as stylists,
         (select md5(coalesce(string_agg(row_to_json(s)::text, '|' order by s.id), '')) from public.vessel_stylists s) as stylists_md5,
         (select count(*) from public.vessel_pessoas)::int as pessoas`

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

if (!process.env.DATABASE_URL) { console.error('❌ sem DATABASE_URL'); process.exit(1) }
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r
const rpc = async (fn, corpo = {}) => {
  const ks = Object.keys(corpo)
  return r(`public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, ks.map((k) => corpo[k]))
}
const registrada = async (nome) =>
  (await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ok`, [nome])).ok
/** Roda dentro de um savepoint e devolve o erro (ou nulo): a transação não aborta. */
const tentar = async (fn) => {
  await cli.query('savepoint tentativa')
  try { await fn(); await cli.query('release savepoint tentativa'); return null } catch (e) {
    await cli.query('rollback to savepoint tentativa'); return e
  }
}

// ── as travas de antes ──────────────────────────────────────────────────────
if (await registrada(ARQUIVO)) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }
for (const a of ANTERIORES) {
  if (!(await registrada(a))) { console.error(`❌ falta ${a} antes desta.`); process.exit(1) }
}
for (const [assinatura, md5] of Object.entries(CORPO_DE_PARTIDA)) {
  const x = await uma(`select md5(prosrc) as m from pg_proc where oid = to_regprocedure($1)`, [`public.${assinatura}`])
  if (x?.m !== md5) {
    console.error(`❌ ${assinatura} no banco NÃO é a que esta migration copiou (${x?.m} ≠ ${md5}). Alguém mexeu depois: compare antes de aplicar.`)
    process.exit(1)
  }
}
console.log('✓ os dois corpos de partida são os do banco (impressão do prosrc)')

const antes = await uma(IMPRESSAO)
console.log(`impressão de hoje: ${antes.private_edits} encontros, ${antes.sessoes} sessões, ${antes.atendimentos} atendimentos, ${antes.stylists} stylists`)

await cli.query('begin')
try {
  const provas = contasDeProva(cli)
  const perfil = (features, permissions, nome) => provas.criar('prova-pe-agenda', { name: nome, features, permissions })
  const falarComo = async (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])
  // A chave da TELA (`atendimentos.private-edit`); o banco ainda confere a da
  // família, que a aceita (B13).
  const mexe = await perfil(['atendimentos.private-edit'], { 'atendimentos.private-edit': ['ver', 'editar'] }, 'Prova Agenda')
  const soVe = await perfil(['atendimentos.private-edit'], { 'atendimentos.private-edit': ['ver'] }, 'Só Vê Agenda')
  const deFora = await perfil(['gestao-interna'], { 'gestao-interna': ['ver'] }, 'De Fora')

  console.log('\n── aplicar e registrar')
  await cli.query(sql)
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-agenda-do-private-edit.mjs'])
  const depoisDaMigration = await uma(IMPRESSAO)
  conferir(igual(depoisDaMigration, antes), 'encontros, sessões, atendimentos, stylists e pessoas: intactos linha a linha depois da migration',
    { antes, depoisDaMigration })

  console.log('\n── as portas e a estrutura')
  for (const [nome, assinatura] of Object.entries(PORTAS)) {
    const { quantas, lista } = await uma(
      `select count(*)::int as quantas, string_agg(p.oid::regprocedure::text, ' | ') as lista
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    const pr = await uma(`select has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
                                 has_function_privilege('anon', $1, 'EXECUTE') as anon,
                                 has_function_privilege('service_role', $1, 'EXECUTE') as servico,
                                 (select prosecdef from pg_proc where oid = $1::regprocedure) as definer`, [`public.${assinatura}`])
    conferir(quantas === 1 && lista === assinatura && pr.aut === true && pr.anon === false && pr.servico === true && pr.definer === true,
      `${nome}: UMA assinatura só (a antiga sumiu — o PostgREST não fica com duas), security definer, authenticated sim, anon não`, { lista, pr })
  }
  // ⚠️ CONFERIDO CONTRA A IRMÃ: as permissões de execução das portas novas são
  // as mesmas de `vessel_conta_das_private_edits` (a leitura de sempre).
  const acl = async (f) => (await uma(`select array_to_string(array(select x::text from unnest(proacl) x order by 1), ',') as a
    from pg_proc where oid = $1::regprocedure`, [`public.${f}`])).a
  const daIrma = await acl('vessel_conta_das_private_edits(integer,boolean)')
  for (const [nome, assinatura] of Object.entries(PORTAS)) {
    const a = await acl(assinatura)
    conferir(a === daIrma, `${nome}: mesmos papéis que a irmã vessel_conta_das_private_edits`, { a, daIrma })
  }
  for (const f of MIOLO) {
    const pr = await uma(`select has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
                                 has_function_privilege('anon', $1, 'EXECUTE') as anon`, [`public.${f}`])
    conferir(pr.aut === false && pr.anon === false, `${f}: miolo fechado`, pr)
  }
  const dur = await r(`public.vessel_private_edit_duracao()`)
  conferir(dur?.hours === 4 && !dur?.minutes && !dur?.days, 'a duração do encontro é 4 horas (o único lugar do banco)', dur)

  // ── o que todo cenário usa ────────────────────────────────────────────────
  const ativada = Number((await uma(`select id from public.vessel_stylist_etapas where ativa and libera_private_edit order by ordem limit 1`)).id)
  let fone = 90
  const novaStylist = async (nome) => {
    const c = (await rpc('vessel_stylist_criar', { p_nome: nome, p_whatsapp: `(19) 99000-25${fone++}`, p_origem_contato: 'pesquisa' })).codigo
    const mv = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: c, p_etapa_id: ativada })
    if (!mv?.ok) throw new Error(`não consegui ativar a stylist de prova: ${JSON.stringify(mv)}`)
    return c
  }
  const hojeSP = (await uma(`select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`)).d
  const dia = async (n) => (await uma(`select to_char($1::date + $2::int, 'YYYY-MM-DD') as d`, [hojeSP, n])).d
  const as = (d, hora) => `${d}T${hora}:00-03:00`
  const quantos = async () => (await uma(`select count(*)::int as n from public.vessel_private_edits`)).n
  const doEncontro = (codigo) => uma(`select quando, loja, praca, local, vagas, status, arquivada from public.vessel_private_edits where codigo = $1`, [codigo])
  let S = null, S2 = null
  const criar = (quando, extra = {}) => rpc('vessel_criar_private_edit', {
    p_stylist: S, p_quando: quando, p_local: null, p_praca: 'CPS', p_loja: 'iguatemi', p_vagas: 8, p_teste: false, ...extra })
  const editar = (codigo, extra) => rpc('vessel_private_edit_editar', { p_codigo: codigo, ...extra })
  const cenario = async (titulo, corpo) => {
    console.log(`\n── ${titulo}`)
    await cli.query('savepoint cenario')
    await falarComo(mexe)
    fone = 90   // o cenário anterior foi desfeito: os mesmos telefones servem de novo
    S = await novaStylist('Prova Agenda A')
    S2 = await novaStylist('Prova Agenda B')
    await corpo()
    await falarComo(null)
    await cli.query('rollback to savepoint cenario')
  }
  const D = await dia(20)

  await cenario('mesma loja, horários que se cruzam', async () => {
    const A = await criar(as(D, '14:00'), { p_confirmar_sobreposicao: false })
    conferir(A?.ok === true && igual(Object.keys(A).sort(), ['chave', 'codigo', 'ok']),
      'A (14h, Iguatemi), conferência ligada e nada no caminho: criado, resposta de sempre (ok, codigo, chave)', A)
    const n0 = await quantos()
    let x = await criar(as(D, '16:00'), { p_stylist: S2, p_confirmar_sobreposicao: false })
    const s = x?.sobrepoe?.[0]
    conferir(x?.ok === false && x.situacao === 'sobrepoe' && x.sobrepoe.length === 1 && s.codigo === A.codigo
      && s.stylist === S && s.anfitria === 'Prova Agenda A' && s.hora === '14:00' && s.hora_fim === '18:00' && s.dia === D
      && s.loja === 'iguatemi' && typeof x.erro === 'string' && Array.isArray(x.contexto) && (await quantos()) === n0,
    'B (16h, mesma loja): RECUSADO com `sobrepoe`, diz com quem (código, stylist, loja, 14:00–18:00) e NADA foi gravado', x)
    x = await criar(as(D, '16:00'), { p_stylist: S2, p_confirmar_sobreposicao: true })
    conferir(x?.ok === true && /^PE-/.test(x.codigo) && x.sobrepoe?.[0]?.codigo === A.codigo && (await quantos()) === n0 + 1,
      '…confirmando (true): criado, e a resposta leva a lista para constar', x)
    x = await criar(as(D, '17:59'), { p_confirmar_sobreposicao: false })
    conferir(x?.situacao === 'sobrepoe' && x.sobrepoe.length === 2, 'um minuto antes do fim de A (17h59) cruza A e B: os dois vêm na lista', x)
  })

  await cenario('encostar não é sobrepor', async () => {
    const A = await criar(as(D, '14:00'), { p_confirmar_sobreposicao: false })
    const antesDele = await criar(as(D, '10:00'), { p_confirmar_sobreposicao: false })
    const depoisDele = await criar(as(D, '18:00'), { p_confirmar_sobreposicao: false })
    conferir(A?.ok && antesDele?.ok === true && depoisDele?.ok === true,
      '10h–14h e 18h–22h ao lado de 14h–18h, na mesma loja: passam SEM aviso (termina exatamente quando o outro começa)', { A, antesDele, depoisDele })
  })

  await cenario('lugares diferentes nunca se cruzam', async () => {
    await criar(as(D, '14:00'), { p_confirmar_sobreposicao: false })
    const tivoli = await criar(as(D, '15:00'), { p_praca: 'SBO', p_loja: 'tivoli', p_confirmar_sobreposicao: false })
    conferir(tivoli?.ok === true, 'outra loja (Tivoli) na mesma hora: passa', tivoli)
    const X = await criar(as(D, '14:00'), { p_loja: null, p_local: 'Hotel da Prova', p_confirmar_sobreposicao: false })
    const Y = await criar(as(D, '15:00'), { p_loja: null, p_local: '  hotel   DA prova ', p_confirmar_sobreposicao: false })
    const Z = await criar(as(D, '15:00'), { p_loja: null, p_local: 'Outro lugar', p_confirmar_sobreposicao: false })
    const W = await criar(as(D, '15:00'), { p_loja: null, p_praca: 'SAO', p_local: 'Hotel da Prova', p_confirmar_sobreposicao: false })
    conferir(X?.ok === true && Y?.situacao === 'sobrepoe' && Y.sobrepoe[0].codigo === X.codigo && Z?.ok === true && W?.ok === true,
      'sem loja, o lugar é praça + lugar escrito: "hotel   DA prova" = "Hotel da Prova" (sobrepõe); outro lugar ou outra praça, não', { X, Y, Z, W })
  })

  await cenario('cancelado, não realizado, arquivado e teste não contam', async () => {
    const A = await criar(as(D, '14:00'), { p_confirmar_sobreposicao: false })
    const sit = await rpc('vessel_private_edit_situacao', { p_codigo: A.codigo, p_status: 'cancelado', p_motivo: 'Prova da agenda' })
    let x = await criar(as(D, '15:00'), { p_confirmar_sobreposicao: false })
    conferir(sit?.ok && x?.ok === true, 'A cancelado: outro às 15h na mesma loja passa', { sit, x })
    const D1 = await dia(21)
    const N = await criar(as(D1, '14:00'), { p_confirmar_sobreposicao: false })
    await rpc('vessel_private_edit_situacao', { p_codigo: N.codigo, p_status: 'nao_realizado', p_motivo: 'Prova da agenda' })
    x = await criar(as(D1, '15:00'), { p_confirmar_sobreposicao: false })
    conferir(x?.ok === true, 'não realizado: não conta', x)
    const D2 = await dia(22)
    const P = await criar(as(D2, '14:00'), { p_confirmar_sobreposicao: false })
    const arq = await rpc('vessel_private_edit_arquivar', { p_codigo: P.codigo, p_arquivada: true })
    x = await criar(as(D2, '15:00'), { p_confirmar_sobreposicao: false })
    conferir(arq?.ok && x?.ok === true, 'arquivado: não conta', { arq, x })
    const D3 = await dia(23)
    const T = await criar(as(D3, '14:00'), { p_teste: true, p_confirmar_sobreposicao: false })
    x = await criar(as(D3, '15:00'), { p_confirmar_sobreposicao: false })
    conferir(T?.ok && x?.ok === true, 'encontro de teste: não conta', { T, x })
    const R = await criar(as(D3, '09:00'), { p_confirmar_sobreposicao: false })
    // A porta não marca realizado no futuro: a data é mexida à mão (desfeita junto).
    await cli.query(`update public.vessel_private_edits set status = 'realizado', realizado_em = $2::date where codigo = $1`, [R.codigo, D3])
    x = await criar(as(D3, '10:00'), { p_confirmar_sobreposicao: false })
    conferir(x?.situacao === 'sobrepoe', '…mas o REALIZADO conta (a loja esteve ocupada)', x)
  })

  await cenario('editar: o encontro ignora a si mesmo, e só confere quando a hora ou o lugar mudam', async () => {
    const A = await criar(as(D, '14:00'), { p_confirmar_sobreposicao: false })
    let x = await editar(A.codigo, { p_quando: as(D, '15:00'), p_confirmar_sobreposicao: false })
    conferir(x?.ok === true && +(await doEncontro(A.codigo)).quando === +new Date(as(D, '15:00')),
      'mover A de 14h para 15h (cruza o próprio horário de antes): passa, ele não conflita consigo mesmo', x)
    const C = await criar(as(D, '20:00'), { p_confirmar_sobreposicao: false })
    const antesDeC = await doEncontro(C.codigo)
    x = await editar(C.codigo, { p_quando: as(D, '17:00'), p_confirmar_sobreposicao: false })
    conferir(x?.ok === false && x.situacao === 'sobrepoe' && x.sobrepoe.length === 1 && x.sobrepoe[0].codigo === A.codigo
      && igual(await doEncontro(C.codigo), antesDeC), 'mover C para 17h (cruza A, 15h–19h): recusado, e C fica como estava', x)
    x = await editar(C.codigo, { p_quando: as(D, '17:00'), p_confirmar_sobreposicao: true })
    conferir(x?.ok === true && x.sobrepoe?.[0]?.codigo === A.codigo && +(await doEncontro(C.codigo)).quando === +new Date(as(D, '17:00')),
      '…confirmando: movido, e a resposta leva a lista', x)
    x = await editar(C.codigo, { p_vagas: 9, p_confirmar_sobreposicao: false })
    conferir(x?.ok === true && !('sobrepoe' in x) && (await doEncontro(C.codigo)).vagas === 9,
      'mexer SÓ nas vagas de C (que já se cruza com A): passa sem pedir confirmação de novo', x)
    x = await editar(C.codigo, { p_quando: as(D, '17:00'), p_local: null, p_confirmar_sobreposicao: false })
    conferir(x?.ok === true, 'mandar a MESMA hora de novo não é mudar: passa', x)
    x = await editar(C.codigo, { p_loja: 'tivoli', p_confirmar_sobreposicao: false })
    conferir(x?.ok === true && (await doEncontro(C.codigo)).loja === 'tivoli', 'mudar C para outra loja: confere, e lá não há ninguém', x)
    x = await editar(C.codigo, { p_loja: 'iguatemi', p_confirmar_sobreposicao: false })
    conferir(x?.situacao === 'sobrepoe', '…e voltar para o Iguatemi confere de novo (o lugar mudou)', x)
  })

  await cenario('sem o parâmetro (a Central que está no ar): comportamento de antes', async () => {
    const A = await criar(as(D, '14:00'))
    const B = await rpc('vessel_criar_private_edit', { p_stylist: S2, p_quando: as(D, '16:00'), p_local: null, p_praca: 'CPS',
      p_loja: 'iguatemi', p_vagas: 8, p_teste: false })
    conferir(A?.ok && B?.ok === true && igual(Object.keys(B).sort(), ['chave', 'codigo', 'ok']),
      'criar com os 7 parâmetros de sempre, cruzando A: grava calado, resposta idêntica à de antes', B)
    const e = await editar(B.codigo, { p_quando: as(D, '15:00'), p_local: null, p_praca: null, p_loja: null, p_vagas: null, p_stylist: null })
    conferir(e?.ok === true && igual(Object.keys(e).sort(), ['codigo', 'ok', 'situacao']), 'editar com os 7 de sempre: grava, resposta de antes', e)
    const semData = await rpc('vessel_criar_private_edit', { p_stylist: S, p_quando: null, p_praca: 'CPS', p_confirmar_sobreposicao: false })
    const semPraca = await criar(as(D, '15:00'), { p_praca: null, p_confirmar_sobreposicao: false })
    conferir(semData?.situacao === 'sem_data' && semPraca?.situacao === 'praca_invalida',
      'as conferências de antes vêm ANTES da nova (sem data, sem praça: as recusas de sempre)', { semData, semPraca })
    const um = await criar(as(await dia(24), '10:00'), { p_confirmar_sobreposicao: false })
    const dois = await criar(as(await dia(24), '19:00'), { p_confirmar_sobreposicao: false })
    conferir(um?.ok && dois?.ok && um.codigo !== dois.codigo && /-01$/.test(um.codigo) && /-02$/.test(dois.codigo),
      'o código do dia continua o de sempre (01, 02…, sem repetir)', { um, dois })
  })

  await cenario('a agenda: os três tipos, o dia de São Paulo e a forma da resposta', async () => {
    const E = await dia(25), E1 = await dia(26)
    const P1 = await criar(as(E, '22:00'), { p_confirmar_sobreposicao: false })         // 01h UTC do dia seguinte
    const P2 = await criar(as(E1, '00:30'), { p_stylist: S2, p_confirmar_sobreposicao: true })
    const Pt = await criar(as(E, '12:00'), { p_teste: true })
    const Pc = await criar(as(E, '09:00'))
    await rpc('vessel_private_edit_situacao', { p_codigo: Pc.codigo, p_status: 'cancelado', p_motivo: 'Prova da agenda' })
    await cli.query(`insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro)
                     values ('BS-PROVA-AGENDA-01', $1, 'CPS', 'iguatemi', 'Salão da Prova'),
                            ('BS-PROVA-AGENDA-02', $1, 'CPS', 'iguatemi', 'Arquivada da Prova')`, [E])
    await cli.query(`update public.vessel_beauty_sessions set arquivada = true where codigo = 'BS-PROVA-AGENDA-02'`)
    const pessoa = Number((await uma(`insert into public.vessel_pessoas (nome, telefone) values ('Cliente da Prova', '5519990002599') returning id`)).id)
    const visita = async (quando, o = {}) => Number((await uma(`insert into public.vessel_atendimentos
        (pessoa_id, loja, quando, status, origem_registro, teste, evento_codigo, client_advisor)
      values ($1, 'iguatemi', $2, $3, 'appointment_card', $4, $5, 'CA da Prova') returning id`,
      [pessoa, quando, o.status || 'confirmado', !!o.teste, o.evento || null])).id)
    const V = await visita(as(E, '22:30'))
    const fora = [await visita(as(E, '10:00'), { status: 'cancelado' }), await visita(as(E, '11:00'), { teste: true }),
      await visita(as(E, '22:00'), { evento: P1.codigo }), await visita(as(E, '13:00'), { status: 'remarcado' })]

    const noDia = await rpc('vessel_agenda_das_lojas', { p_de: E, p_ate: E })
    const meus = noDia.filter((i) => [P1.codigo, P2.codigo, Pt.codigo, Pc.codigo, 'BS-PROVA-AGENDA-01', 'BS-PROVA-AGENDA-02'].includes(i.codigo)
      || [V, ...fora].includes(i.id))
    const pe = meus.find((i) => i.codigo === P1.codigo)
    const bs = meus.find((i) => i.codigo === 'BS-PROVA-AGENDA-01')
    const pa = meus.find((i) => i.id === V && i.tipo === 'private_appointment')
    conferir(meus.length === 3 && pe && bs && pa, 'o dia traz UM de cada tipo: o encontro, a sessão e a visita (fora o teste, o cancelado, o arquivado, o remarcado e a convidada do encontro)',
      meus.map((i) => `${i.tipo}:${i.codigo || i.id}`))
    conferir(pe?.tipo === 'private_edit' && pe.dia === E && pe.hora === '22:00' && pe.hora_fim === '02:00'
      && +new Date(pe.inicio) === +new Date(as(E, '22:00')) && +new Date(pe.fim) === +new Date(as(E1, '02:00'))
      && pe.stylist === S && pe.anfitria === 'Prova Agenda A' && pe.loja === 'iguatemi' && pe.lugar === 'iguatemi',
    `o encontro das 22h de São Paulo (01h UTC do dia seguinte) cai no dia ${E}, não no ${E1}; início/fim em ISO com fuso`, pe)
    conferir(igual(pe?.sobrepoe, [P2.codigo]), 'e diz com quem cruza, mesmo que o outro (0h30 do dia seguinte) esteja FORA do período pedido', pe?.sobrepoe)
    conferir(bs?.tipo === 'beauty_session' && bs.dia === E && bs.hora === null && bs.parceiro === 'Salão da Prova' && bs.status === 'aberta'
      && bs.sobrepoe === null, 'a Beauty Session: o dia inteiro (sem hora), com o parceiro', bs)
    conferir(pa?.tipo === 'private_appointment' && pa.dia === E && pa.hora === '22:30' && pa.client_advisor === 'CA da Prova'
      && pa.status === 'confirmado' && !('nome' in pa) && !('telefone' in pa),
    'a visita: dia e hora de São Paulo, a Client Advisor, SEM o nome nem o telefone da cliente', pa)
    conferir(meus.every((i) => igual(Object.keys(i).sort(), CHAVES_DA_AGENDA)), `todo item, de qualquer tipo, tem as mesmas ${CHAVES_DA_AGENDA.length} chaves`,
      meus.map((i) => Object.keys(i).sort()))
    const doDiaSeguinte = await rpc('vessel_agenda_das_lojas', { p_de: E1, p_ate: E1 })
    const p2 = doDiaSeguinte.find((i) => i.codigo === P2.codigo)
    conferir(!doDiaSeguinte.some((i) => i.codigo === P1.codigo || i.id === V) && p2?.dia === E1 && p2.hora === '00:30' && igual(p2.sobrepoe, [P1.codigo]),
      `o dia ${E1} NÃO traz o das 22h nem a visita das 22h30; traz o da 0h30, que cruza o de ontem`, { p2 })
    const tivoli = await rpc('vessel_agenda_das_lojas', { p_de: E, p_ate: E, p_loja: 'tivoli' })
    const iguatemi = await rpc('vessel_agenda_das_lojas', { p_de: E, p_ate: E, p_loja: 'iguatemi' })
    const dosMeus = (lista) => lista.filter((i) => meus.some((m) => m.tipo === i.tipo && m.codigo === i.codigo && m.id === i.id)).length
    conferir(dosMeus(tivoli) === 0 && dosMeus(iguatemi) === 3,
      'o filtro de loja: o Tivoli não traz nada do Iguatemi; o Iguatemi traz os três', { tivoli: tivoli.length })
    const e1 = await tentar(() => rpc('vessel_agenda_das_lojas', { p_de: E1, p_ate: E }))
    const longe = await dia(25 + 191)
    const e2 = await tentar(() => rpc('vessel_agenda_das_lojas', { p_de: E, p_ate: longe }))
    conferir(e1?.code === '22023' && e2?.code === '22023', 'fim antes do começo, ou mais de 190 dias: recusado (22023)', { e1: e1?.message, e2: e2?.message })

    console.log('   · a pergunta de antes de gravar')
    let s = await rpc('vessel_private_edit_sobreposicoes', { p_quando: as(E, '23:00'), p_loja: 'iguatemi' })
    conferir(s?.ok && s.duracao_em_horas === 4 && igual(s.sobrepoe.map((o) => o.codigo), [P1.codigo, P2.codigo])
      && s.contexto.length === 1 && s.contexto[0].tipo === 'beauty_session',
    '23h no Iguatemi: cruza os dois encontros; a nota traz a sessão do dia (a visita das 22h30 é antes da janela)', s)
    s = await rpc('vessel_private_edit_sobreposicoes', { p_quando: as(E, '21:00'), p_loja: 'iguatemi', p_ignorar_codigo: P1.codigo.toLowerCase() })
    conferir(igual(s.sobrepoe.map((o) => o.codigo), [P2.codigo]) && igual(s.contexto.map((c) => c.tipo), ['beauty_session', 'private_appointment'])
      && s.contexto[1].hora === '22:30' && !('nome' in s.contexto[1]),
    '21h ignorando o próprio P1: só P2; a nota traz a sessão E a visita das 22h30 (dentro da janela), sem o nome da cliente', s)
    s = await rpc('vessel_private_edit_sobreposicoes', { p_quando: as(E, '21:00'), p_loja: null, p_praca: 'CPS', p_local: 'Casa da Prova' })
    conferir(s.sobrepoe.length === 0 && s.contexto.length === 0, 'sem loja e noutro lugar: nada (e sem loja não há nota)', s)
    const c = await criar(as(E, '21:00'), { p_confirmar_sobreposicao: false })
    conferir(c?.situacao === 'sobrepoe' && c.sobrepoe.length === 2 && c.contexto.length === 2,
      'a recusa do criar traz a mesma lista e a mesma nota da pergunta', c)

    console.log('   · quem pode ler')
    await falarComo(soVe)
    const leVe = await rpc('vessel_agenda_das_lojas', { p_de: E, p_ate: E })
    const sVe = await rpc('vessel_private_edit_sobreposicoes', { p_quando: as(E, '21:00'), p_loja: 'iguatemi' })
    const criaVe = await criar(as(E, '08:00'), { p_confirmar_sobreposicao: false })
    const editaVe = await editar(P1.codigo, { p_vagas: 9, p_confirmar_sobreposicao: false })
    conferir(leVe.some((i) => i.codigo === P1.codigo) && sVe.ok && criaVe?.situacao === 'sem_permissao' && editaVe?.situacao === 'sem_permissao',
      'quem só VÊ o Private Edit lê a agenda e a pergunta; criar e editar continuam recusados (sem_permissao)', { criaVe, editaVe })
    await falarComo(deFora)
    const f1 = await tentar(() => rpc('vessel_agenda_das_lojas', { p_de: E, p_ate: E }))
    const f2 = await tentar(() => rpc('vessel_private_edit_sobreposicoes', { p_quando: as(E, '21:00'), p_loja: 'iguatemi' }))
    conferir(f1?.code === '42501' && f2?.code === '42501', 'quem não tem nada do Comercial Vessel: recusado (42501)', { f1: f1?.code, f2: f2?.code })
    await falarComo(null)
    const a1 = await tentar(() => rpc('vessel_agenda_das_lojas', { p_de: E, p_ate: E }))
    const a2 = await tentar(() => rpc('vessel_private_edit_sobreposicoes', { p_quando: as(E, '21:00'), p_loja: 'iguatemi' }))
    const a3 = await criar(as(E, '08:00'), { p_confirmar_sobreposicao: true })
    const a4 = await editar(P1.codigo, { p_vagas: 9 })
    conferir(a1?.code === '42501' && a2?.code === '42501' && a3?.situacao === 'sem_permissao' && a4?.situacao === 'sem_permissao',
      'sem sessão (a chave pública): as leituras recusam (42501) e as gravações dizem sem_permissao', { a1: a1?.code, a2: a2?.code, a3, a4 })
  })

  const depoisDaProva = await uma(IMPRESSAO)
  conferir(igual(depoisDaProva, antes), 'as provas não deixaram rastro nas tabelas reais', { antes, depoisDaProva })

  if (falhas.length) throw new Error(`${falhas.length} conferência(s) falharam`)
  if (GRAVAR) {
    // ⚠️ As contas de prova NÃO vão para produção (ver coletor/lib/contas-de-prova.mjs).
    await provas.apagarEConferir()
    const fim = await cli.query('commit')
    if (fim.command !== 'COMMIT') throw new Error(`o commit voltou ${fim.command}`)
    console.log(`\n✅ ${ARQUIVO} aplicada e registrada.`)
  } else {
    const fim = await cli.query('rollback')
    if (fim.command !== 'ROLLBACK') throw new Error(`o rollback voltou ${fim.command}`)
    console.log('\n✅ ensaio limpo: tudo passou e NADA foi gravado. Rode com --gravar para valer.')
  }
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error(`\n❌ nada foi gravado: ${e.message}`)
  process.exitCode = 1
} finally {
  await cli.end()
}

// ⚠️ CONFERIDO DE FORA, numa conexão nova: no ensaio, o banco tem de estar
// IGUAL ao de antes (as funções antigas, nenhuma nova, sem registro); gravando,
// tem de ter as novas e só elas.
{
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  const agora = (await outra.query(IMPRESSAO)).rows[0]
  const reg = (await outra.query(`select 1 from public.schema_migrations where name = $1`, [ARQUIVO])).rowCount
  const existe = async (s) => (await outra.query(`select to_regprocedure($1) is not null as ok`, [`public.${s}`])).rows[0].ok
  const novas = [await existe(PORTAS.vessel_agenda_das_lojas), await existe(PORTAS.vessel_criar_private_edit), await existe(PORTAS.vessel_private_edit_editar)]
  const velhas = [await existe(Object.keys(CORPO_DE_PARTIDA)[0]), await existe(Object.keys(CORPO_DE_PARTIDA)[1])]
  await outra.end()
  if (GRAVAR && !process.exitCode) {
    if (!igual(agora, antes) || reg !== 1 || !novas.every(Boolean) || velhas.some(Boolean)) { console.error('❌ depois do commit algo não bate', { antes, agora, reg, novas, velhas }); process.exitCode = 1 }
    else console.log('  ✓ depois do commit, numa conexão nova: dados intactos, as portas novas no lugar das velhas, migration registrada')
  } else if (!GRAVAR) {
    if (!igual(agora, antes) || reg !== 0 || novas.some(Boolean) || !velhas.every(Boolean)) {
      console.error('❌ O ENSAIO DEIXOU RASTRO', { antes, agora, reg, novas, velhas }); process.exitCode = 1
    } else console.log(`  ✓ conexão nova depois do ensaio: banco idêntico ao de antes (${agora.private_edits} encontros, as funções de antes, nenhuma nova, sem registro)`)
  }
}
