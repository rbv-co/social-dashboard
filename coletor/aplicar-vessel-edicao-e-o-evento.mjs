// APLICA, PROVA e REGISTRA: a edição do Stylist Circle passa a SER o evento
// (decisão do dono, 28/09/2026 — spec 2026-09-28-stylist-circle-edicao-e-evento).
//   node coletor/aplicar-vessel-edicao-e-o-evento.mjs           → ensaio (desfaz)
//   node coletor/aplicar-vessel-edicao-e-o-evento.mjs --gravar  → prova tudo e só então grava
// Tudo numa transação (repeatable read: as contagens de antes e de depois saem
// da MESMA foto, mesmo com a equipe mexendo no quadro ao mesmo tempo). Cada
// prova mora num savepoint DESFEITO, com stylists de mentira `STY-PROVA-EVT-*`
// (`teste = false` de propósito: a turma filtra `teste`) — conferido no fim e
// de novo no `finally`, já fora da transação.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { funilDoEvento } from '../src/ferramentas/comercial-vessel/edicao-regras.js'

const ARQUIVO = '2026-09-28-zzzzzz-vessel-edicao-e-o-evento.sql'
const EDICAO_1 = 46 // Edição 1 · Campinas (aberta, evento em 15/10)
const GRAVAR = process.argv.includes('--gravar')
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const falhas = []
const conferir = (ok, frase, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : '  → ' + JSON.stringify(d)}`); if (!ok) falhas.push(frase) }

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const todas = async (s, a = []) => (await cli.query(s, a)).rows
const uma = async (s, a = []) => (await todas(s, a))[0]

// ── ajudantes ────────────────────────────────────────────────────────────────
// Chamar como o DONO (authenticated + jwt), igual à tela.
const comoDono = async (fn) => { await cli.query('set local role authenticated'); try { return await fn() } finally { await cli.query('reset role') } }
const rpc = (fn, args = []) => comoDono(async () => (await uma(`select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(', ')}) as r`, args)).r)
// Um savepoint que SEMPRE se desfaz, dê certo ou errado.
let nSp = 0
const desfeito = async (fn) => { const n = `sp_${++nSp}`; await cli.query(`savepoint ${n}`); try { return await fn() } finally { await cli.query(`rollback to savepoint ${n}`) } }
let nSty = 0
const novaStylist = async (pracaId) => {
  const n = ++nSty
  return uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, cidade, praca_id, teste)
    values ($1, $2, $3, 'Prova', $4, false) returning id::int, codigo`,
    [`STY-PROVA-EVT-${n}`, `Prova Evento ${n}`, `55199977${String(n).padStart(5, '0')}`, pracaId])
}
const linha = (stylistId, edicaoId) => uma(`select * from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2`, [stylistId, edicaoId])
// Encerra a Edição 1 e abre a próxima de Campinas (sempre dentro de um savepoint).
const proximaEdicaoDeCampinas = async (cps) => {
  const enc = await rpc('vessel_edicao_encerrar', [EDICAO_1, null])
  const cri = await rpc('vessel_edicao_criar', [cps, 'Prova evento', '2026-12-10', null])
  const abr = await rpc('vessel_edicao_abrir', [cri.id])
  return { id: Number(cri.id), numero: cri.numero, enc, cri, abr }
}
// O funil do placar (SQL) tem de ser o MESMO da regra pura (edicao-regras.js).
const funilPelaRegra = async (edicaoId) => {
  const turma = (await comoDono(() => todas('select * from public.vessel_edicao_turma($1)', [edicaoId])))
    .map((t) => ({ ...t, stylist_id: Number(t.stylist_id), origem: t.origem == null ? null : Number(t.origem) }))
  const encontros = (await todas(`select stylist_id::int, status from public.vessel_private_edits
     where not coalesce(teste, false) and not coalesce(arquivada, false) and stylist_id = any($1::bigint[])`,
    [turma.map((t) => t.stylist_id)]))
  return funilDoEvento(turma, encontros, edicaoId)
}
const funilDoPlacar = async (edicaoId) => {
  const p = await rpc('vessel_placar_da_edicao', [edicaoId])
  return { passos: p.funil, indisponiveis: p.indisponiveis, meta: p.meta, p }
}
const passo = (f, chave) => f.passos?.find((x) => x.chave === chave)?.n
const mesmoFunil = async (edicaoId) => {
  const a = await funilDoPlacar(edicaoId); const b = await funilPelaRegra(edicaoId)
  const sa = JSON.stringify({ passos: a.passos, indisponiveis: a.indisponiveis, meta: a.meta })
  return { ok: sa === JSON.stringify(b), placar: a, regra: b }
}

// ── as provas: cada uma devolve a lista de conferências, SEM imprimir — a
// mesma prova roda depois contra a função MUTADA e ali tem de reprovar. ──────
const provas = {}

provas.p1 = (ctx) => desfeito(async () => {
  const s = await novaStylist(ctx.cps)
  const r = await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.convidado, null, null])
  const l = await linha(s.id, EDICAO_1)
  return [[r?.ok === true, '1. mover para Convidado responde ok', r],
    [!!l?.convidada_em && !l.confirmou_em && !l.presente_em, '1. com edição aberta na praça: ganha a linha com convidada_em', l]]
})

provas.p2 = (ctx) => desfeito(async () => {
  const s = await novaStylist(ctx.sao)
  const r = await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.convidado, null, null])
  const n = (await uma('select count(*)::int n from public.vessel_stylist_na_edicao where stylist_id = $1', [s.id])).n
  return [[r?.ok === true && r.situacao === 'ok', '2. praça SEM edição aberta: move sem erro', r],
    [n === 0, '2. praça SEM edição aberta: nenhuma linha', n]]
})

provas.p3 = (ctx) => desfeito(async () => {
  const s = await novaStylist(ctx.cps)
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.convidado, null, null])
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.confirmado, null, null])
  const l1 = await linha(s.id, EDICAO_1)
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.presenca, null, null])
  const l2 = await linha(s.id, EDICAO_1)
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.confirmado, null, null])
  const l3 = await linha(s.id, EDICAO_1)
  // quem PULA etapas: de Stylist levantado direto para Presença ganha as três marcas
  const p = await novaStylist(ctx.cps)
  await rpc('vessel_stylist_mover_de_etapa', [p.codigo, ctx.et.presenca, null, null])
  const lp = await linha(p.id, EDICAO_1)
  return [[!!l1?.confirmou_em && !l1.presente_em, '3. Confirmado marca confirmou_em', l1],
    [!!l2?.presente_em, '3. Presença marca presente_em', l2],
    [!!l3?.presente_em && String(l3.presente_em) === String(l2?.presente_em), '3. voltar para Confirmado NÃO desmarca a presença', { l2, l3 }],
    [!!lp?.convidada_em && !!lp.confirmou_em && !!lp.presente_em, '3. quem pula direto para Presença ganha as três marcas', lp]]
})

provas.p4 = (ctx) => desfeito(async () => {
  const s = await novaStylist(ctx.cps)
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.convidado, null, null])
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.presenca, null, null])
  // a presença na A foi DIAS antes (dentro de uma transação, now() é um só)
  await cli.query(`update public.vessel_stylist_na_edicao set presente_em = now() - interval '10 days' where stylist_id = $1 and edicao_id = $2`, [s.id, EDICAO_1])
  const b = await proximaEdicaoDeCampinas(ctx.cps)
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.confirmado, null, null])
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.presenca, null, null])
  const lb = await linha(s.id, b.id)
  const antesA = await funilDoPlacar(EDICAO_1)
  await cli.query(`insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, praca_id, status, realizado_em)
     values ('PE-PROVA-EVT-1', 'provaevt1', $1, now() - interval '2 days', 'CPS', $2, 'realizado', current_date - 2)`, [s.id, ctx.cps])
  const origem = (await uma('select public.vessel_evento_de_origem($1)::int o', [s.id])).o
  const lista = (await comoDono(() => todas('select stylist_id::int, codigo, edicao_id::int from public.vessel_eventos_de_origem() where stylist_id = $1', [s.id])))
  const depoisA = await funilDoPlacar(EDICAO_1)
  const B = await funilDoPlacar(b.id)
  const igualA = await mesmoFunil(EDICAO_1); const igualB = await mesmoFunil(b.id)
  return [[!!lb?.presente_em, '4. presente também na B (linha nova na B)', lb],
    [origem === EDICAO_1, '4. evento de origem = A (a 1ª presença)', { origem, a: EDICAO_1, b: b.id }],
    [lista.length === 1 && lista[0].edicao_id === EDICAO_1 && lista[0].codigo === s.codigo, '4. vessel_eventos_de_origem diz o mesmo (e traz o código)', lista],
    [passo(depoisA, 'fizeram') === passo(antesA, 'fizeram') + 1 && passo(depoisA, 'agendaram') === passo(antesA, 'agendaram') + 1,
      '4. o Private Edit realizado conta na A', { antes: antesA.passos, depois: depoisA.passos }],
    [passo(B, 'presentes') === 1 && passo(B, 'agendaram') === 0 && passo(B, 'fizeram') === 0 && B.p.encontros_realizados === 0,
      '4. e NÃO conta na B (nem no funil, nem nos encontros)', B.p],
    [igualA.ok && igualB.ok, '4. o funil do placar = funilDoEvento (A e B)', igualA.ok ? igualB : igualA]]
})

provas.p5 = (ctx) => desfeito(async () => {
  const b = await proximaEdicaoDeCampinas(ctx.cps)
  const turma = await comoDono(() => todas('select * from public.vessel_edicao_turma($1)', [b.id]))
  const n = (await uma('select count(*)::int n from public.vessel_stylist_na_edicao where edicao_id = $1', [b.id])).n
  return [[b.enc?.ok === true && b.abr?.ok === true && b.abr.situacao === 'ok' && b.abr.voltaram === 0, '5. encerrar a 1 e abrir a próxima respondem ok (voltaram 0)', b],
    [ctx.ativasCps > 0 && turma.length === 0 && n === 0, `5. abrir numa praça com ${ctx.ativasCps} ativas NÃO puxa a praça: turma vazia`, { turma: turma.length, n }]]
})

provas.p6 = (ctx) => desfeito(async () => {
  const volta = await novaStylist(ctx.cps)     // convidada, indisponível → volta
  const inativa = await novaStylist(ctx.cps)   // mesmo motivo, mas desativada → não volta
  const outro = await novaStylist(ctx.cps)     // outro motivo → não volta
  const semLinha = await novaStylist(ctx.cps)  // indisponível sem ter sido convidada → volta mesmo assim
  for (const s of [volta, inativa, outro]) await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.convidado, null, null])
  const r1 = await rpc('vessel_stylist_mover_de_etapa', [volta.codigo, ctx.et.desclassificado, ctx.indisponivel, null])
  await rpc('vessel_stylist_mover_de_etapa', [inativa.codigo, ctx.et.desclassificado, ctx.indisponivel, null])
  await rpc('vessel_stylist_mover_de_etapa', [outro.codigo, ctx.et.desclassificado, ctx.desinteresse, null])
  await rpc('vessel_stylist_mover_de_etapa', [semLinha.codigo, ctx.et.desclassificado, ctx.indisponivel, null])
  await cli.query('update public.vessel_stylists set ativa = false where id = $1', [inativa.id])
  const l1 = await linha(volta.id, EDICAO_1)
  const lo = await linha(outro.id, EDICAO_1)
  const placar1 = await funilDoPlacar(EDICAO_1)
  const igual1 = await mesmoFunil(EDICAO_1)
  const b = await proximaEdicaoDeCampinas(ctx.cps)
  const etapa = async (s) => (await uma('select etapa_id::int e from public.vessel_stylists where id = $1', [s.id])).e
  const ultima = async (s) => uma(`select para_etapa_id::int para, nota, motivo from public.vessel_stylist_etapas_historico where stylist_id = $1 order by id desc limit 1`, [s.id])
  const hv = await ultima(volta); const hs = await ultima(semLinha)
  const lbv = await linha(volta.id, b.id); const lbs = await linha(semLinha.id, b.id)
  const lbi = await linha(inativa.id, b.id); const lbo = await linha(outro.id, b.id)
  return [[r1?.ok === true && !!l1?.indisponivel_em, '6. Desclassificado com "Indisponível na data" marca indisponivel_em', { r1, l1 }],
    [!lo?.indisponivel_em, '6. outro motivo NÃO marca indisponivel_em', lo],
    [placar1.indisponiveis === 1 && passo(placar1, 'convidadas') === ctx.convidadas1 + 2 && igual1.ok,
      '6. placar: indisponíveis à parte, seguem dentro de convidadas (e = funilDoEvento)', { indisp: placar1.indisponiveis, passos: placar1.passos, igual: igual1.ok }],
    [b.abr?.voltaram === 2, '6. abrir a próxima: voltaram 2 (a convidada e a sem linha)', b.abr],
    [await etapa(volta) === ctx.et.convidado && await etapa(semLinha) === ctx.et.convidado, '6. as duas voltam para Convidado', null],
    [!!lbv?.convidada_em && !!lbs?.convidada_em, '6. e ganham a linha na edição nova com convidada_em', { lbv, lbs }],
    [hv?.para === ctx.et.convidado && hv.motivo === 'mudanca' && /^Voltou: indisponível na Edição 1\b/.test(hv.nota ?? '')
      && /^Voltou: indisponível na Edição 1\b/.test(hs?.nota ?? ''), '6. histórico: "Voltou: indisponível na Edição 1"', { hv, hs }],
    [await etapa(inativa) === ctx.et.desclassificado && !lbi, '6. a desativada (ativa=false) com o mesmo motivo NÃO volta', lbi],
    [await etapa(outro) === ctx.et.desclassificado && !lbo, '6. a de outro motivo NÃO volta', lbo]]
})

provas.p7 = (ctx) => desfeito(async () => {
  const pres = await novaStylist(ctx.cps)
  await rpc('vessel_stylist_mover_de_etapa', [pres.codigo, ctx.et.presenca, null, null])
  const t1 = await rpc('vessel_edicao_tirar_stylist', [pres.codigo, EDICAO_1])
  const fica = await linha(pres.id, EDICAO_1)
  const eng = await novaStylist(ctx.cps)
  const inc = await rpc('vessel_edicao_incluir_stylist', [eng.codigo, EDICAO_1])
  const li = await linha(eng.id, EDICAO_1)
  const t2 = await rpc('vessel_edicao_tirar_stylist', [eng.codigo, EDICAO_1])
  const sumiu = await linha(eng.id, EDICAO_1)
  return [[t1?.ok === false && t1.situacao === 'ja_esteve_presente' && !!fica, '7. Tirar recusa quem tem presente_em', { t1, fica }],
    [inc?.ok === true && !!li?.convidada_em, '7. Incluir grava convidada_em', { inc, li }],
    [t2?.ok === true && !sumiu, '7. Tirar apaga quem não esteve presente', { t2, sumiu }]]
})

provas.p9 = (ctx) => desfeito(async () => {
  const r = await rpc('vessel_edicao_encerrar', [EDICAO_1, EDICAO_1])
  const sit = (await uma('select situacao from public.vessel_stylist_circle_edicoes where id = $1', [EDICAO_1])).situacao
  const c = await rpc('vessel_edicao_criar', [ctx.cps, 'Prova data', '2026-12-10', '2026-12-31'])
  const te = (await uma('select termina_em from public.vessel_stylist_circle_edicoes where id = $1', [c.id])).termina_em
  return [[r?.ok === false && r.situacao === 'levar_para_nao_existe_mais' && sit === 'aberta', '9. encerrar com levar_para recusa e não mexe', { r, sit }],
    [c?.ok === true && te === null, '9. criar ignora termina_em (grava nulo)', { c, te }]]
})

// ── as mutações: a função errada tem de REPROVAR a prova dela ────────────────
const funcaoDaMigration = (nome) => {
  const i = sql.indexOf(`create or replace function public.${nome}(`)
  const f = sql.indexOf('\n$$;', i)
  if (i < 0 || f < 0) throw new Error(`função ${nome} não achada na migration`)
  return sql.slice(i, f + 4)
}
const MUTACOES = [
  { prova: 'p4', frase: '8. mutação: origem pela MAIOR presença (Private Edit contaria na B)', funcao: 'vessel_evento_de_origem',
    de: 'order by n.presente_em, n.edicao_id', para: 'order by n.presente_em desc, n.edicao_id' },
  { prova: 'p3', frase: 'mutação: voltar de etapa DESMARCA a presença', funcao: 'vessel_edicao_marcar_movimento',
    de: 'else n.presente_em end', para: 'else null end' },
  { prova: 'p5', frase: 'mutação: abrir PUXA a praça inteira (o jeito de 25/09)', funcao: 'vessel_edicao_abrir',
    de: "update public.vessel_stylist_circle_edicoes set situacao = 'aberta' where id = p_id;",
    para: `update public.vessel_stylist_circle_edicoes set situacao = 'aberta' where id = p_id;
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id)
  select s.id, p_id from public.vessel_stylists s
   where s.praca_id = v_ed.praca_id and coalesce(s.ativa, true) and not coalesce(s.teste, false)
  on conflict (stylist_id, edicao_id) do nothing;` },
]

let registradasAntes = null
try {
  await cli.query('begin isolation level repeatable read')
  // ⚠️ o ensaio segura ACCESS EXCLUSIVE em produção (create or replace, alter):
  // se alguém já está na tabela, desiste em 5s em vez de travar a Central.
  await cli.query("set local lock_timeout = '5s'")
  const FOTO = `select (select md5(coalesce(string_agg(id || ':' || etapa_id, ',' order by id), '')) from public.vessel_stylists) f,
    (select json_object_agg(et.nome, (select count(*) from public.vessel_stylists s where s.etapa_id = et.id)) from public.vessel_stylist_etapas et) c,
    (select count(*)::int from public.schema_migrations) m`
  const antes = await uma(FOTO)
  registradasAntes = antes.m
  console.log('antes, por etapa:', JSON.stringify(antes.c))
  if ((await cli.query('select 1 from public.schema_migrations where name = $1', [ARQUIVO])).rowCount) throw new Error('já registrada')
  // quem da Edição 1 DEVE ficar, medido ANTES e por conta própria: quem já
  // chegou (pelo histórico) ou está numa etapa de funil de Convidado para lá.
  const deveFicar = (await todas(`
    with conv as (select ordem from public.vessel_stylist_etapas where ativa and tipo = 'funil' and lower(btrim(nome)) = 'convidado')
    select n.stylist_id::int id,
      -- a 1ª chegada NA PRÓPRIA etapa (quem pulou Convidado: a de Confirmado)
      coalesce((select min(h.em) from public.vessel_stylist_etapas_historico h join public.vessel_stylist_etapas e on e.id = h.para_etapa_id
                 where h.stylist_id = n.stylist_id and e.tipo = 'funil' and lower(btrim(e.nome)) = 'convidado'),
               (select min(h.em) from public.vessel_stylist_etapas_historico h join public.vessel_stylist_etapas e on e.id = h.para_etapa_id
                 where h.stylist_id = n.stylist_id and e.tipo = 'funil' and lower(btrim(e.nome)) = 'confirmado')) conv,
      (select min(h.em) from public.vessel_stylist_etapas_historico h join public.vessel_stylist_etapas e on e.id = h.para_etapa_id
        where h.stylist_id = n.stylist_id and e.tipo = 'funil' and lower(btrim(e.nome)) = 'confirmado') conf
      from public.vessel_stylist_na_edicao n join public.vessel_stylists s on s.id = n.stylist_id
     where n.edicao_id = $1 and (
       exists (select 1 from public.vessel_stylist_etapas_historico h join public.vessel_stylist_etapas e on e.id = h.para_etapa_id
                where h.stylist_id = n.stylist_id and e.tipo = 'funil' and e.ordem >= (select ordem from conv))
       or exists (select 1 from public.vessel_stylist_etapas e where e.id = s.etapa_id and e.tipo = 'funil' and e.ordem >= (select ordem from conv)))
     order by 1`, [EDICAO_1]))
  const turmaAntes = (await uma('select count(*)::int n from public.vessel_stylist_na_edicao where edicao_id = $1', [EDICAO_1])).n
  const codigosAntes = await todas(`select n.stylist_id::int id, s.codigo from public.vessel_stylist_na_edicao n
     join public.vessel_stylists s on s.id = n.stylist_id where n.edicao_id = $1 order by s.codigo`, [EDICAO_1])
  console.log(`Edição 1: ${turmaAntes} na turma hoje; ${deveFicar.length} já foram convidadas (ficam).`)

  await cli.query(sql)
  await cli.query('insert into public.schema_migrations (name, observacao) values ($1, $2)',
    [ARQUIVO, 'a edição é o evento: marcas da turma, evento de origem e indisponível na data'])

  console.log('\n— estrutura')
  const cols = (await todas(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'vessel_stylist_na_edicao'`)).map((r) => r.column_name)
  conferir(['convidada_em', 'confirmou_em', 'presente_em', 'indisponivel_em'].every((c) => cols.includes(c)), 'colunas novas em vessel_stylist_na_edicao', cols)
  const et = await uma(`select
      max(id) filter (where tipo = 'funil' and lower(btrim(nome)) = 'convidado')::int convidado,
      max(id) filter (where tipo = 'funil' and lower(btrim(nome)) = 'confirmado')::int confirmado,
      max(id) filter (where tipo = 'funil' and lower(btrim(nome)) = 'presença')::int presenca,
      max(id) filter (where tipo = 'saida' and lower(btrim(nome)) = 'desclassificado')::int desclassificado
    from public.vessel_stylist_etapas where ativa`)
  conferir(et.convidado && et.confirmado && et.presenca && et.desclassificado, 'as etapas que a marcação procura pelo nome existem', et)
  const mot = await todas(`select id::int, nome, volta_na_proxima_edicao v, ativo from public.vessel_stylist_motivos_de_saida where etapa_id = $1 order by ordem`, [et.desclassificado])
  const indisp = mot.filter((m) => m.nome === 'Indisponível na data' && m.ativo)
  conferir(indisp.length === 1 && indisp[0].v && mot.filter((m) => m.v).length === 1 && mot.at(-1).nome === 'Outro',
    'motivo "Indisponível na data" (volta = true), só ele volta, "Outro" segue por último', mot.map((m) => `${m.nome}${m.v ? '*' : ''}`))
  const acl = Object.fromEntries((await todas(`select p.proname n, coalesce(p.proacl::text, '') a from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname in ('vessel_evento_de_origem', 'vessel_eventos_de_origem', 'vessel_edicao_tirar_stylist',
       'vessel_edicao_turma', 'vessel_edicao_marcar_movimento', 'vessel_placar_da_edicao', 'vessel_edicao_abrir', 'vessel_edicao_encerrar',
       'vessel_edicao_incluir_stylist', 'vessel_edicao_criar', 'vessel_edicoes_listar', 'vessel_stylist_mover_de_etapa', 'vessel_stylist_sincronizar_edicao')`)).map((r) => [r.n, r.a]))
  const porta = (a) => /authenticated=X/.test(a) && !/anon=/.test(a) && !/(^|[{,])=X/.test(a)
  const fechada = (a) => !/authenticated=/.test(a) && !/anon=/.test(a) && !/(^|[{,])=X/.test(a)
  conferir(['vessel_evento_de_origem', 'vessel_eventos_de_origem', 'vessel_edicao_tirar_stylist', 'vessel_edicao_turma', 'vessel_placar_da_edicao',
    'vessel_edicao_abrir', 'vessel_edicao_encerrar', 'vessel_edicao_incluir_stylist', 'vessel_edicao_criar', 'vessel_edicoes_listar',
    'vessel_stylist_mover_de_etapa'].every((f) => porta(acl[f] ?? '')), 'portas: authenticated sim, anon e public não', acl)
  conferir(fechada(acl.vessel_edicao_marcar_movimento ?? '') && fechada(acl.vessel_stylist_sincronizar_edicao ?? ''),
    'internas (marcar_movimento, sincronizar): ninguém de fora', { m: acl.vessel_edicao_marcar_movimento, s: acl.vessel_stylist_sincronizar_edicao })
  const sinc = (await uma(`select prosrc from pg_proc where proname = 'vessel_stylist_sincronizar_edicao'`)).prosrc
  conferir(!/vessel_stylist_na_edicao/.test(sinc), 'vessel_stylist_sincronizar_edicao não toca mais na turma', sinc)

  console.log('\n— dados da Edição 1')
  const ficou = await todas(`select stylist_id::int id, convidada_em, confirmou_em, presente_em from public.vessel_stylist_na_edicao where edicao_id = $1 order by 1`, [EDICAO_1])
  conferir(JSON.stringify(ficou.map((l) => l.id)) === JSON.stringify(deveFicar.map((l) => l.id)),
    `a turma fica só com as já convidadas: ${ficou.length} (saíram ${turmaAntes - ficou.length})`, { ficou: ficou.map((l) => l.id), deveFicar: deveFicar.map((l) => l.id) })
  const ficouIds = new Set(ficou.map((l) => l.id))
  console.log(`  ficam (${ficouIds.size}):`, codigosAntes.filter((c) => ficouIds.has(c.id)).map((c) => c.codigo).join(', '))
  console.log(`  saem (${codigosAntes.length - ficouIds.size}):`, codigosAntes.filter((c) => !ficouIds.has(c.id)).map((c) => c.codigo).join(', '))
  if (ficou.length !== 10) console.log(`  ⚠️  o brief esperava 10 em 28/09; hoje são ${ficou.length}`)
  const tempo = (x) => (x ? new Date(x).getTime() : null)
  const datas = ficou.every((l) => { const d = deveFicar.find((x) => x.id === l.id); return d && tempo(l.convidada_em) === tempo(d.conv) && tempo(l.confirmou_em) === tempo(d.conf) && !l.presente_em })
  conferir(datas && ficou.every((l) => l.convidada_em), 'convidada_em / confirmou_em = a 1ª chegada no histórico (ninguém sem convidada_em)', { ficou, deveFicar })

  await cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: (await uma(`select id from public.profiles where email ilike 'erick@%' limit 1`)).id, role: 'authenticated' })])
  const p46 = await funilDoPlacar(EDICAO_1)
  const igual46 = await mesmoFunil(EDICAO_1)
  console.log('  placar da Edição 1 (como o dono):', p46.passos.map((x) => `${x.rotulo} ${x.n}${x.pct == null ? '' : ` (${x.pct}%)`}`).join(' → '),
    `| meta ${JSON.stringify(p46.meta)} | indisponíveis ${p46.indisponiveis}`)
  conferir(passo(p46, 'convidadas') === ficou.length && igual46.ok, 'placar da Edição 1 lido como o dono = funilDoEvento', igual46)

  const ctx = {
    et,
    cps: Number((await uma(`select id from public.vessel_pracas where sigla = 'CPS'`)).id),
    sao: Number((await uma(`select id from public.vessel_pracas p where sigla = 'SAO'
      and not exists (select 1 from public.vessel_stylist_circle_edicoes e where e.praca_id = p.id and e.situacao = 'aberta')`)).id),
    indisponivel: indisp[0]?.id,
    desinteresse: mot.find((m) => m.nome === 'Desinteresse')?.id,
    convidadas1: passo(p46, 'convidadas'),
  }
  ctx.ativasCps = (await uma(`select count(*)::int n from public.vessel_stylists where praca_id = $1 and coalesce(ativa, true) and not coalesce(teste, false)`, [ctx.cps])).n

  console.log('\n— provas (cada uma num savepoint desfeito)')
  for (const [nome, prova] of Object.entries(provas)) {
    try { for (const [ok, frase, d] of await prova(ctx)) conferir(ok, frase, d) } catch (e) { conferir(false, `${nome} estourou`, e.message) }
  }

  console.log('\n— mutações (a prova tem de REPROVAR)')
  for (const m of MUTACOES) {
    const original = funcaoDaMigration(m.funcao)
    if (!original.includes(m.de)) { conferir(false, `${m.frase}: trecho não achado`, m.de); continue }
    const reprovou = await desfeito(async () => {
      await cli.query(original.replace(m.de, m.para))
      try { return (await provas[m.prova](ctx)).some(([ok]) => !ok) } catch { return true }
    })
    conferir(reprovou, m.frase, null)
  }

  console.log('\n— antes × depois')
  const sobrou = await uma(`select (select count(*) from public.vessel_stylists where codigo like 'STY-PROVA-EVT-%')::int s,
    (select count(*) from public.vessel_private_edits where codigo like 'PE-PROVA-EVT-%')::int e,
    (select count(*) from public.vessel_stylist_circle_edicoes where nome like 'Prova %')::int ed`)
  conferir(sobrou.s === 0 && sobrou.e === 0 && sobrou.ed === 0, 'nada da prova sobrou depois dos desfazer', sobrou)
  const depois = await uma(FOTO)
  conferir(depois.f === antes.f && JSON.stringify(depois.c) === JSON.stringify(antes.c), 'nenhuma stylist mudou de etapa (contagem e etapa de cada uma iguais)', { antes: antes.c, depois: depois.c })
  conferir(depois.m === antes.m + 1, 'migrations registradas +1 (dentro da transação)', { antes: antes.m, depois: depois.m })

  if (falhas.length || !GRAVAR) {
    await cli.query('rollback')
    console.log(falhas.length ? `\n❌ nada gravado: ${falhas.length} falha(s)` : '\n✅ ENSAIO — nada gravado. Rode com --gravar.')
    process.exitCode = falhas.length ? 1 : 0
  } else {
    const r = await cli.query('commit')
    if (r.command !== 'COMMIT') throw new Error('commit virou ' + r.command)
    console.log(`\n✅ ${ARQUIVO} aplicada e registrada.`)
  }
} catch (e) {
  await cli.query('rollback').catch(() => {}); console.error('❌', e.message); process.exitCode = 1
} finally {
  // conferido de novo FORA da transação: nada de prova ficou no banco
  try {
    const f = await uma(`select (select count(*) from public.vessel_stylists where codigo like 'STY-PROVA-EVT-%')::int s,
      (select count(*) from public.vessel_private_edits where codigo like 'PE-PROVA-EVT-%')::int e,
      (select count(*)::int from public.schema_migrations) m,
      (select count(*)::int from public.schema_migrations where name = $1) esta`, [ARQUIVO])
    const esperado = GRAVAR && !falhas.length && process.exitCode !== 1 ? 1 : 0
    const ok = f.s === 0 && f.e === 0 && f.esta === esperado && (registradasAntes == null || f.m === registradasAntes + esperado)
    console.log(`${ok ? '✓' : '✗'} fora da transação: STY-PROVA-EVT-% = ${f.s}, PE-PROVA-EVT-% = ${f.e}, esta migration registrada = ${f.esta}`)
    if (!ok) process.exitCode = 1
  } catch (e) { console.error('❌ conferência final', e.message); process.exitCode = 1 }
  await cli.end()
}
