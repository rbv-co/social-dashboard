// APLICA, PROVA e REGISTRA: trocar o motivo da saída sem mudar a etapa
// (decisão do dono, 29/09/2026 — migration 2026-09-29-vessel-stylist-trocar-motivo.sql).
//   node coletor/aplicar-vessel-stylist-trocar-motivo.mjs           → ensaio (desfaz)
//   node coletor/aplicar-vessel-stylist-trocar-motivo.mjs --gravar  → prova tudo e só então grava
// Tudo numa transação (repeatable read). Cada prova mora num savepoint DESFEITO,
// com stylists de mentira `STY-PROVA-TRM-*` — conferido no fim e de novo no
// `finally`, já fora da transação. As chamadas são como o DONO (erick@),
// `role authenticated` + `request.jwt.claims`, igual à tela.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-29-vessel-stylist-trocar-motivo.sql'
const EDICAO_1 = 46 // Edição 1 · Campinas (aberta)
const GRAVAR = process.argv.includes('--gravar')
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const falhas = []
const conferir = (ok, frase, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : '  → ' + JSON.stringify(d)}`); if (!ok) falhas.push(frase) }

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const todas = async (s, a = []) => (await cli.query(s, a)).rows
const uma = async (s, a = []) => (await todas(s, a))[0]

// ── ajudantes ────────────────────────────────────────────────────────────────
const comoDono = async (fn) => { await cli.query('set local role authenticated'); try { return await fn() } finally { await cli.query('reset role') } }
const rpc = (fn, args = []) => comoDono(async () => (await uma(`select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(', ')}) as r`, args)).r)
let nSp = 0
const desfeito = async (fn) => { const n = `sp_${++nSp}`; await cli.query(`savepoint ${n}`); try { return await fn() } finally { await cli.query(`rollback to savepoint ${n}`) } }
let nSty = 0
const novaStylist = async (pracaId) => {
  const n = ++nSty
  return uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, cidade, praca_id, teste)
    values ($1, $2, $3, 'Prova', $4, false) returning id::int, codigo`,
    [`STY-PROVA-TRM-${n}`, `Prova Troca ${n}`, `55199966${String(n).padStart(5, '0')}`, pracaId])
}
const historico = (id) => todas(`select id::int, de_etapa_id::int de, para_etapa_id::int para, motivo, motivo_id::int mid, nota, liberava_private_edit lib
   from public.vessel_stylist_etapas_historico where stylist_id = $1 order by id`, [id])
const etapaDe = async (id) => (await uma('select etapa_id::int e from public.vessel_stylists where id = $1', [id])).e
const linha = (stylistId, edicaoId) => uma(`select * from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2`, [stylistId, edicaoId])
const tempo = (x) => (x ? new Date(x).getTime() : null)

// ── as provas: devolvem as conferências SEM imprimir (a mesma prova roda
// depois contra a função MUTADA e ali tem de reprovar) ───────────────────────
const provas = {}

provas.p1 = (ctx) => desfeito(async () => {
  const s = await novaStylist(ctx.sao)
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.desclassificado, ctx.outro, 'Nota da prova'])
  const h0 = await historico(s.id)
  const r = await rpc('vessel_stylist_trocar_motivo', [s.codigo, ctx.desinteresse, null])
  const h1 = await historico(s.id)
  const nova = h1.at(-1)
  const sa = await uma('select motivo_id::int mid, nota from public.vessel_stylist_saida_atual($1)', [s.id])
  const r2 = await rpc('vessel_stylist_trocar_motivo', [s.codigo, ctx.desinteresse, null])
  const h2 = await historico(s.id)
  return [[r?.ok === true && r.situacao === 'ok', '1. trocar responde ok', r],
    [h1.length === h0.length + 1, '1. grava exatamente 1 linha de histórico', { antes: h0.length, depois: h1.length }],
    [nova?.de === ctx.et.desclassificado && nova.para === ctx.et.desclassificado && nova.motivo === 'troca_de_motivo'
      && nova.mid === ctx.desinteresse && nova.lib === false, '1. a linha: mesma etapa em de/para, troca_de_motivo, motivo novo, não libera', nova],
    [await etapaDe(s.id) === ctx.et.desclassificado, '1. a etapa não mudou', null],
    [sa?.mid === ctx.desinteresse && sa.nota === 'Nota da prova', '1. saida_atual = motivo novo, nota mantida (p_nota nula)', sa],
    [r2?.situacao === 'sem_mudanca' && h2.length === h1.length, '1. trocar para o mesmo motivo = sem_mudanca, nenhuma linha', { r2, n: h2.length }]]
})

provas.p2 = (ctx) => desfeito(async () => {
  const s = await novaStylist(ctx.sao)
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.convidado, null, null])
  const h0 = await historico(s.id)
  const r = await rpc('vessel_stylist_trocar_motivo', [s.codigo, ctx.indisponivel, null])
  const h1 = await historico(s.id)
  return [[r?.ok === false && r.situacao === 'nao_esta_em_saida', '2. recusa quem NÃO está numa saída', r],
    [h1.length === h0.length && await etapaDe(s.id) === ctx.et.convidado, '2. e não grava nem move nada', { h0: h0.length, h1: h1.length }]]
})

provas.p3 = (ctx) => desfeito(async () => {
  const s = await novaStylist(ctx.sao)
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.ativada, null, null])
  const h0 = await historico(s.id)
  const r = await rpc('vessel_stylist_trocar_motivo', [s.codigo, ctx.indisponivel, null])   // motivo do Desclassificado
  const d = await novaStylist(ctx.sao)
  await rpc('vessel_stylist_mover_de_etapa', [d.codigo, ctx.et.desclassificado, ctx.desinteresse, null])
  const rn = await rpc('vessel_stylist_trocar_motivo', [d.codigo, ctx.outro, null])          // "Outro" exige nota; ela não tem
  const h1 = await historico(s.id)
  return [[r?.ok === false && r.situacao === 'motivo_invalido', '3. recusa motivo que não é da etapa atual', r],
    [h1.length === h0.length && await etapaDe(s.id) === ctx.et.ativada, '3. e não grava nem move nada', { h0: h0.length, h1: h1.length }],
    [rn?.ok === false && rn.situacao === 'nota_obrigatoria', '3. motivo que pede nota, sem nota: recusa', rn]]
})

provas.p4 = (ctx) => desfeito(async () => {
  const s = await novaStylist(ctx.sao)
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.desclassificado, ctx.desinteresse, null])
  const h0 = await historico(s.id)
  // o erro aborta a subtransação: cada tentativa no SEU savepoint, que se desfaz
  // (e com ele o `set local role` e o jwt) — o código do erro é o da função.
  const tentar = async (papel, claims) => {
    const n = `sp_${++nSp}`
    await cli.query(`savepoint ${n}`)
    try {
      if (claims) await cli.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
      await cli.query(`set local role ${papel}`)
      await cli.query('select public.vessel_stylist_trocar_motivo($1, $2, null)', [s.codigo, ctx.indisponivel])
      return 'passou'
    } catch (e) { return e.code } finally { await cli.query(`rollback to savepoint ${n}`) }
  }
  const semLogin = await tentar('authenticated', JSON.stringify({ role: 'authenticated' }))
  const semPermissao = ctx.semPermissao ? await tentar('authenticated', JSON.stringify({ sub: ctx.semPermissao, role: 'authenticated' })) : null
  const anon = await tentar('anon', null)
  const h1 = await historico(s.id)
  return [[semLogin === '42501', '4. sem login → 42501', semLogin],
    [ctx.semPermissao ? semPermissao === '42501' : true, `4. conta sem permissão no Stylist Circle → 42501${ctx.semPermissao ? '' : ' (nenhuma conta assim: pulada)'}`, semPermissao],
    [anon === '42501', '4. anon nem executa (42501)', anon],
    [h1.length === h0.length, '4. nada gravado', { h0: h0.length, h1: h1.length }]]
})

provas.p5 = (ctx) => desfeito(async () => {
  const s = await novaStylist(ctx.cps)
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.convidado, null, null])
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.confirmado, null, null])
  // as marcas de antes vêm de DIAS atrás (dentro da transação, now() é um só)
  await cli.query(`update public.vessel_stylist_na_edicao set convidada_em = now() - interval '5 days', confirmou_em = now() - interval '3 days'
     where stylist_id = $1 and edicao_id = $2`, [s.id, EDICAO_1])
  await rpc('vessel_stylist_mover_de_etapa', [s.codigo, ctx.et.desclassificado, ctx.outro, 'Terá outro evento'])
  const l0 = await linha(s.id, EDICAO_1)
  const r = await rpc('vessel_stylist_trocar_motivo', [s.codigo, ctx.indisponivel, 'Terá outro evento — trocado'])
  const l1 = await linha(s.id, EDICAO_1)
  const sa = await uma('select motivo_id::int mid, nota from public.vessel_stylist_saida_atual($1)', [s.id])
  // e quem NÃO volta (outro motivo) não ganha a marca
  const o = await novaStylist(ctx.cps)
  await rpc('vessel_stylist_mover_de_etapa', [o.codigo, ctx.et.convidado, null, null])
  await rpc('vessel_stylist_mover_de_etapa', [o.codigo, ctx.et.desclassificado, ctx.outro, 'x'])
  await rpc('vessel_stylist_trocar_motivo', [o.codigo, ctx.desinteresse, null])
  const lo = await linha(o.id, EDICAO_1)
  return [[r?.ok === true && !l0?.indisponivel_em && !!l1?.indisponivel_em, '5. trocar para "Indisponível na data" marca indisponivel_em na edição aberta', { r, l0, l1 }],
    [tempo(l1?.convidada_em) === tempo(l0?.convidada_em) && tempo(l1?.confirmou_em) === tempo(l0?.confirmou_em) && !!l1?.confirmou_em
      && tempo(l1?.presente_em) === tempo(l0?.presente_em), '5. sem apagar nem mexer nas outras marcas', { l0, l1 }],
    [sa?.mid === ctx.indisponivel && sa.nota === 'Terá outro evento — trocado', '5. saida_atual = Indisponível, com a nota nova', sa],
    [!!lo && !lo.indisponivel_em, '5. trocar para outro motivo NÃO marca indisponivel_em', lo]]
})

// ── as mutações: a função errada tem de REPROVAR a prova dela ────────────────
const funcaoDaMigration = (nome) => {
  const i = sql.indexOf(`create or replace function public.${nome}(`)
  const f = sql.indexOf('\n$$;', i)
  if (i < 0 || f < 0) throw new Error(`função ${nome} não achada na migration`)
  return sql.slice(i, f + 4)
}
const MUTACOES = [
  { prova: 'p2', frase: "mutação: sem a trava de 'só saída'", de: "v_e.id is null or v_e.tipo <> 'saida'", para: 'v_e.id is null' },
  { prova: 'p5', frase: 'mutação: sem chamar vessel_edicao_marcar_movimento', de: 'perform public.vessel_edicao_marcar_movimento(v_s.id, v_e.id, p_motivo_id);', para: '' },
  { prova: 'p4', frase: 'mutação: sem a trava de permissão', de: "if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then", para: 'if false then' },
  { prova: 'p1', frase: 'mutação: sem o sem_mudanca', de: 'v_atual.motivo_id is not distinct from p_motivo_id and', para: 'false and' },
]

let registradasAntes = null
try {
  await cli.query('begin isolation level repeatable read')
  await cli.query("set local lock_timeout = '5s'")
  const FOTO = `select (select md5(coalesce(string_agg(id || ':' || etapa_id, ',' order by id), '')) from public.vessel_stylists) f,
    (select count(*)::int from public.vessel_stylist_etapas_historico) h,
    (select md5(coalesce(string_agg(concat_ws(':', id, stylist_id, edicao_id, convidada_em, confirmou_em, presente_em, indisponivel_em), ',' order by id), '')) from public.vessel_stylist_na_edicao) n,
    (select count(*)::int from public.schema_migrations) m`
  const antes = await uma(FOTO)
  registradasAntes = antes.m
  if ((await cli.query('select 1 from public.schema_migrations where name = $1', [ARQUIVO])).rowCount) throw new Error('já registrada')

  await cli.query(sql)
  await cli.query('insert into public.schema_migrations (name, observacao) values ($1, $2)',
    [ARQUIVO, 'trocar o motivo da saída sem mudar a etapa (vessel_stylist_trocar_motivo)'])

  console.log('— estrutura')
  const chk = (await uma(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'vessel_stylist_etapas_historico_motivo_valido'`))?.d ?? ''
  conferir(['cadastro', 'mudanca', 'etapa_excluida', 'troca_de_motivo'].every((m) => chk.includes(`'${m}'`)), "CHECK do histórico aceita 'troca_de_motivo' (e os três de antes)", chk)
  const acl = (await uma(`select coalesce(p.proacl::text, '') a, p.prosecdef d from pg_proc p where p.proname = 'vessel_stylist_trocar_motivo'`))
  conferir(/authenticated=X/.test(acl.a) && !/anon=/.test(acl.a) && !/(^|[{,])=X/.test(acl.a) && acl.d, 'porta: security definer, authenticated sim, anon e public não', acl)

  const dono = (await uma(`select id from public.profiles where email ilike 'erick@%' limit 1`)).id
  await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: dono, role: 'authenticated' })])
  const et = await uma(`select
      max(id) filter (where tipo = 'funil' and lower(btrim(nome)) = 'convidado')::int convidado,
      max(id) filter (where tipo = 'funil' and lower(btrim(nome)) = 'confirmado')::int confirmado,
      max(id) filter (where tipo = 'saida' and lower(btrim(nome)) = 'ativada')::int ativada,
      max(id) filter (where tipo = 'saida' and lower(btrim(nome)) = 'desclassificado')::int desclassificado
    from public.vessel_stylist_etapas where ativa`)
  const mot = await todas(`select id::int, nome, volta_na_proxima_edicao v from public.vessel_stylist_motivos_de_saida where etapa_id = $1 and ativo`, [et.desclassificado])
  const ctx = {
    et,
    cps: Number((await uma(`select id from public.vessel_pracas where sigla = 'CPS'`)).id),
    sao: Number((await uma(`select id from public.vessel_pracas p where sigla = 'SAO'
      and not exists (select 1 from public.vessel_stylist_circle_edicoes e where e.praca_id = p.id and e.situacao = 'aberta')`)).id),
    indisponivel: mot.find((m) => m.nome === 'Indisponível na data' && m.v)?.id,
    desinteresse: mot.find((m) => m.nome === 'Desinteresse')?.id,
    outro: mot.find((m) => m.nome === 'Outro')?.id,
    semPermissao: (await uma(`select p.id from public.profiles p where not coalesce(p.is_superadmin, false)
       and not (coalesce(p.permissions, '{}'::jsonb) ? 'atendimentos.stylist-circle') limit 1`))?.id ?? null,
  }
  conferir(et.convidado && et.confirmado && et.ativada && et.desclassificado && ctx.indisponivel && ctx.desinteresse && ctx.outro,
    'etapas e motivos que as provas usam existem', { et, mot })

  console.log('\n— provas (cada uma num savepoint desfeito)')
  for (const [nome, prova] of Object.entries(provas)) {
    try { for (const [ok, frase, d] of await prova(ctx)) conferir(ok, frase, d) } catch (e) { conferir(false, `${nome} estourou`, e.message) }
  }

  console.log('\n— mutações (a prova tem de REPROVAR)')
  const original = funcaoDaMigration('vessel_stylist_trocar_motivo')
  for (const m of MUTACOES) {
    if (!original.includes(m.de)) { conferir(false, `${m.frase}: trecho não achado`, m.de); continue }
    const reprovou = await desfeito(async () => {
      await cli.query(original.replace(m.de, m.para))
      try { return (await provas[m.prova](ctx)).some(([ok]) => !ok) } catch { return true }
    })
    conferir(reprovou, m.frase, null)
  }

  console.log('\n— antes × depois')
  const sobrou = (await uma(`select count(*)::int s from public.vessel_stylists where codigo like 'STY-PROVA-TRM-%'`)).s
  conferir(sobrou === 0, 'nada da prova sobrou depois dos desfazer', sobrou)
  const depois = await uma(FOTO)
  conferir(depois.f === antes.f, 'nenhuma stylist mudou de etapa (md5 de id:etapa_id igual)', { antes: antes.f, depois: depois.f })
  conferir(depois.h === antes.h, 'histórico de etapas sem linha nova', { antes: antes.h, depois: depois.h })
  conferir(depois.n === antes.n, 'marcas das turmas iguais (md5)', { antes: antes.n, depois: depois.n })
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
  try {
    const f = await uma(`select (select count(*) from public.vessel_stylists where codigo like 'STY-PROVA-TRM-%')::int s,
      (select count(*)::int from public.schema_migrations) m,
      (select count(*)::int from public.schema_migrations where name = $1) esta,
      (select count(*)::int from pg_proc where proname = 'vessel_stylist_trocar_motivo') fn`, [ARQUIVO])
    const esperado = GRAVAR && !falhas.length && process.exitCode !== 1 ? 1 : 0
    const ok = f.s === 0 && f.esta === esperado && f.fn === esperado && (registradasAntes == null || f.m === registradasAntes + esperado)
    console.log(`${ok ? '✓' : '✗'} fora da transação: STY-PROVA-TRM-% = ${f.s}, esta migration registrada = ${f.esta}, função existe = ${f.fn}`)
    if (!ok) process.exitCode = 1
  } catch (e) { console.error('❌ conferência final', e.message); process.exitCode = 1 }
  await cli.end()
}
