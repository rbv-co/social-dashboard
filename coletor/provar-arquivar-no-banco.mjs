// CONFERE, EM CONEXAO NOVA, o que de fato ficou no banco depois do commit de
// `2026-09-19-vessel-arquivar.sql`.
//
// ⚠️ POR QUE UM SEGUNDO SCRIPT: um `COMMIT` mandado depois de um erro vira um
// ROLLBACK calado, e o script que mandou o commit imprime sucesso do mesmo
// jeito. A unica forma de saber o que entrou e perguntar de novo, de fora,
// numa conexao que nao sabe nada da transacao anterior.
//
// ⚠️ E CHAMA COMO A TELA NO AR CHAMA: um parametro so, pelo nome — que e
// exatamente o `{ "p_dias": 7 }` que o PostgREST manda. Se as duas versoes da
// funcao tivessem sobrado no banco, esta chamada morreria com
// "function is not unique" e as telas do Comercial Vessel estariam quebradas
// para gente de verdade agora.
import './lib/carregar-env.mjs'
import pg from 'pg'

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const falhas = []
const ok = (t) => console.log('  ✔', t)
const nao = (t) => { falhas.push(t); console.log('  ✘', t) }

// ── 1. sobrou uma so de cada, com dois argumentos ───────────────────────────
for (const nome of ['vessel_conta_das_private_edits', 'vessel_conta_das_beauty_sessions']) {
  const r = await uma(
    `select count(*)::int as quantas,
            string_agg(p.oid::regprocedure::text, ' | ') as assinaturas
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`, [nome])
  if (r.quantas === 1 && /\(integer,boolean\)$/.test(r.assinaturas)) ok(`${r.assinaturas}`)
  else nao(`${nome}: ${r.quantas} versao(oes) — ${r.assinaturas}`)
}

// ── 2. as colunas novas ─────────────────────────────────────────────────────
for (const t of ['vessel_private_edits', 'vessel_beauty_sessions']) {
  const c = await uma(
    `select data_type, column_default, is_nullable from information_schema.columns
      where table_schema='public' and table_name=$1 and column_name='arquivada'`, [t])
  if (c && c.data_type === 'boolean' && c.column_default === 'false' && c.is_nullable === 'NO')
    ok(`${t}.arquivada boolean not null default false`)
  else nao(`${t}.arquivada: ${JSON.stringify(c)}`)
}

// ── 3. a porta: so `authenticated`, como antes ──────────────────────────────
for (const f of ['public.vessel_conta_das_private_edits(int, boolean)',
                 'public.vessel_conta_das_beauty_sessions(int, boolean)']) {
  const p = await uma(
    `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])
  if (p.autenticado && !p.anon && !p.qualquer_um) ok(`${f}: so authenticated`)
  else nao(`${f}: ${JSON.stringify(p)}`)
}

// ── 4. a migration ficou registrada ─────────────────────────────────────────
const m = await uma(
  `select name from public.schema_migrations where name = '2026-09-19-vessel-arquivar.sql'`)
m ? ok('registrada em schema_migrations') : nao('NAO registrada em schema_migrations')

// ── 5. A PROVA DE COMPATIBILIDADE COM A TELA NO AR ──────────────────────────
// 5a. do jeito cru, sem sessao: tem de responder 42501 (a tranca de dentro da
// funcao), e NAO 42883/"does not exist" nem 42725/"is not unique".
for (const nome of ['vessel_conta_das_private_edits', 'vessel_conta_das_beauty_sessions']) {
  try {
    await cli.query(`select public.${nome}(p_dias => 7)`)
    nao(`${nome}(p_dias => 7) respondeu sem sessao — a tranca sumiu`)
  } catch (e) {
    if (e.code === '42501') ok(`${nome}(p_dias => 7) resolve e cai na tranca (42501 sem permissao)`)
    else nao(`${nome}(p_dias => 7) devolveu ${e.code}: ${e.message}`)
  }
}

// 5b. com a permissao fingida DENTRO de uma transacao desfeita, para ver a
// FORMA da resposta que a tela recebe.
await cli.query('begin')
await cli.query(`create or replace function public.is_vessel_atendimentos()
  returns boolean language sql stable as $f$ select true $f$`)
for (const nome of ['vessel_conta_das_private_edits', 'vessel_conta_das_beauty_sessions']) {
  const { r } = await uma(`select public.${nome}(p_dias => 7) as r`)
  if (!Array.isArray(r)) { nao(`${nome} nao devolveu lista: ${JSON.stringify(r)}`); continue }
  ok(`${nome}(p_dias => 7) -> lista JSON com ${r.length} linha(s)` +
     (r.length ? `; chaves: ${Object.keys(r[0]).join(', ')}` : ''))
  if (r.length) console.log('    1a linha:', JSON.stringify(r[0]))
  if (r.some((l) => l.arquivada === true)) nao(`${nome} trouxe arquivada no padrao`)
}
await cli.query('rollback')

// ── 6. nenhuma linha nasceu arquivada, e nada da prova sobrou ──────────────
const sobra = await uma(
  `select (select count(*)::int from public.vessel_private_edits where arquivada) as pe_arq,
          (select count(*)::int from public.vessel_beauty_sessions where arquivada) as bs_arq,
          (select count(*)::int from public.vessel_private_edits where codigo = 'PE-20260919-CPS-Z9') as pe_prova,
          (select count(*)::int from public.vessel_beauty_sessions where codigo = 'BS-20260919-CPS-Z9') as bs_prova,
          (select count(*)::int from public.vessel_stylists where codigo = 'STY-9999') as sty_prova`)
if (sobra.pe_arq === 0 && sobra.bs_arq === 0) ok('nenhuma linha de verdade nasceu arquivada')
else nao(`ja existe linha arquivada: ${JSON.stringify(sobra)}`)
if (sobra.pe_prova === 0 && sobra.bs_prova === 0 && sobra.sty_prova === 0)
  ok('o dado de mentira da prova nao sobrou no banco')
else nao(`sobrou dado de prova: ${JSON.stringify(sobra)}`)

await cli.end()
if (falhas.length) {
  console.error(`\n❌ ${falhas.length} conferencia(s) reprovada(s)`)
  process.exitCode = 1
} else console.log('\n✅ o banco confirma: assinatura nova, porta igual, tela no ar intacta')
