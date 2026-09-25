// APLICA, REGISTRA e PROVA as quatro tabelas de praça e edição do Stylist Circle.
//
//   node coletor/aplicar-vessel-praca-e-edicao.mjs            → ensaio: prova tudo e DESFAZ
//   node coletor/aplicar-vessel-praca-e-edicao.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar, provar e só então `commit`,
// conferido (`.command === 'COMMIT'`). As provas moram em savepoints desfeitos
// e a impressão das tabelas reais é conferida antes, depois do desfazer e,
// quando grava, numa conexão nova.
//
// Esta migration (Task 3) só cria as tabelas e migra os dados de hoje —
// nenhuma função de negócio nasce aqui (isso é Task 4 e 5, no mesmo arquivo).
// Por isso não há RPC para provar como gente: as provas conferem estrutura
// (RLS, grants, constraints, índices) e o resultado da carga e da migração
// dos dados.
//
// ⚠️ RODADA 1 DE CONSERTO (revisão de 25/09/2026):
//   · a prova do backfill NUNCA reroda um UPDATE redigitado à mão — ela
//     insere dado sujo e reaplica a própria variável `sql` (lida do arquivo
//     em disco), que é idempotente (`if not exists` / `on conflict do
//     nothing` / `where praca_id is null`). Se o UPDATE do .sql quebrar, a
//     prova quebra junto — nunca passaria verde com o backfill errado.
//   · a chave da cidade não é mais comparada contra um mapa digitado à mão:
//     é comparada contra o `achatarCidade` do PRÓPRIO FRONT
//     (`src/ferramentas/comercial-vessel/praca-regras.js`), chamado ao vivo.
//   · RLS/grants filtram por `schema = 'public'` (um homônimo em outro schema
//     não engana mais a prova).
// DATABASE_URL: coletor/.env OU o ambiente (`node --env-file=<.env> …`).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { achatarCidade } from '../src/ferramentas/comercial-vessel/praca-regras.js'

const ARQUIVO = '2026-09-25-vessel-praca-e-edicao.sql'
const args = process.argv.slice(2)
const GRAVAR = args.includes('--gravar')

const TABELAS_NOVAS = ['vessel_pracas', 'vessel_praca_cidades', 'vessel_stylist_circle_edicoes', 'vessel_stylist_na_edicao']
// Comparamos RLS/grants contra uma tabela irmã que já está no ar no mesmo
// molde (RLS ligada, sem política, sem grant a anon/authenticated).
const IRMA = 'vessel_stylist_etapas'

const PRACAS_ESPERADAS = [
  ['CPS', 'Campinas', 'iguatemi', 1],
  ['SAO', 'São Paulo', null, 2],
  ['SBO', 'Santa Bárbara', null, 3],
  ['BSB', 'Brasília', null, 4],
  ['LIM', 'Limeira', null, 5],
  ['PIR', 'Piracicaba', null, 6],
]

const IMPRESSAO = `
  select (select count(*) from public.vessel_stylists)::int as stylists,
         (select count(*) from public.vessel_private_edits)::int as private_edits,
         (select count(*) from public.vessel_stylist_etapas)::int as etapas,
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
            from (select id, codigo, cidade, praca_preview, whatsapp, instagram
                    from public.vessel_stylists) t) as stylists_hash`

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
const todas = async (s, a = []) => (await cli.query(s, a)).rows
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r
const registrada = async (nome) =>
  (await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ok`, [nome])).ok
// ⚠️ MENOR 4: sempre filtrado por `public` — um homônimo em outro schema não
// pode fazer a prova ler a linha errada.
const estruturaDaTabela = (tabela) => uma(`
  select c.relrowsecurity as rls,
      (select count(*) from pg_policies where schemaname = 'public' and tablename = $1)::int as politicas,
      (select count(*) from information_schema.role_table_grants
        where table_schema = 'public' and table_name = $1 and grantee in ('anon', 'authenticated'))::int as grants
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = $1`, [tabela])

// ── as travas de antes ──────────────────────────────────────────────────────
if (await registrada(ARQUIVO)) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }
for (const t of TABELAS_NOVAS) {
  if (await r(`(to_regclass('public.${t}') is not null)`)) {
    console.error(`❌ public.${t} já existe e a migration não está registrada — pare e investigue.`)
    process.exit(1)
  }
}

const antes = await uma(IMPRESSAO)

await cli.query('begin')
try {
  console.log('\n── aplicar e registrar')
  await cli.query(sql)
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-praca-e-edicao.mjs'])

  console.log('\n── as tabelas: RLS ligada, sem política, sem grant a anon/authenticated (igual à irmã), só em public')
  const irma = await estruturaDaTabela(IRMA)
  for (const t of TABELAS_NOVAS) {
    const x = await estruturaDaTabela(t)
    conferir(JSON.stringify(x) === JSON.stringify(irma), `${t}: igual à irmã ${IRMA} (RLS, 0 políticas, 0 grants)`, { x, irma })
  }

  console.log('\n── as colunas novas de praca_id')
  for (const [tabela, coluna] of [['vessel_stylists', 'praca_id'], ['vessel_private_edits', 'praca_id']]) {
    const col = await uma(`select data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2`, [tabela, coluna])
    conferir(col?.data_type === 'bigint' && col?.is_nullable === 'YES', `${tabela}.${coluna}: bigint, aceita nulo`, col)
  }

  console.log('\n── MENOR 5: os três índices (o cascade de na_edicao varria sem índice)')
  for (const [tabela, coluna] of [
    ['vessel_praca_cidades', 'praca_id'], ['vessel_stylist_na_edicao', 'edicao_id'], ['vessel_stylists', 'praca_id'],
  ]) {
    const existe = await r(`exists (
      select 1 from pg_index i
        join pg_class t on t.oid = i.indrelid
        join pg_namespace n on n.oid = t.relnamespace
        join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey)
       where n.nspname = 'public' and t.relname = $1 and a.attname = $2)`, [tabela, coluna])
    conferir(existe === true, `índice em ${tabela}.${coluna}`, existe)
  }

  console.log('\n── as praças: a carga inicial')
  const pracas = await todas(`select sigla, nome, loja_destino, ordem, ativa from public.vessel_pracas order by ordem`)
  conferir(pracas.length === 6 && pracas.every((p, i) =>
    p.sigla === PRACAS_ESPERADAS[i][0] && p.nome === PRACAS_ESPERADAS[i][1] &&
    p.loja_destino === PRACAS_ESPERADAS[i][2] && p.ordem === PRACAS_ESPERADAS[i][3] && p.ativa === true),
    'as 6 praças, na ordem, com a loja de destino certa (só Campinas tem)', pracas)

  console.log('\n── MENOR 1: as cidades de cada praça — a chave bate com o front, não com um mapa digitado à mão')
  const cidades = await todas(`select p.sigla, c.cidade, c.cidade_chave from public.vessel_praca_cidades c
     join public.vessel_pracas p on p.id = c.praca_id order by p.ordem`)
  conferir(cidades.length === 6 && cidades.every((c) => c.cidade_chave === achatarCidade(c.cidade)),
    'as 6 cidades, cada cidade_chave = achatarCidade(cidade) do front (src/ferramentas/comercial-vessel/praca-regras.js)', cidades)

  console.log('\n── MENOR 2 e 3: vessel_achatar_cidade — immutable, com search_path, sem portão, mesma conta do front')
  const def = await uma(`select provolatile, prosecdef, proconfig from pg_proc where proname = 'vessel_achatar_cidade'`)
  conferir(def?.provolatile === 'i' && def?.prosecdef === false, 'immutable, sem security definer (não precisa de portão)', def)
  conferir(Array.isArray(def?.proconfig) && def.proconfig.includes('search_path=public'),
    'proconfig fixa o search_path (tirar o `set search_path` não pode passar verde)', def?.proconfig)
  // A comparação é sempre AO VIVO contra o front — nunca um literal esperado
  // digitado à mão duas vezes (o mesmo erro dos dois lados não passa mais).
  const casosDeAchatar = [
    'Campinas', '  Campinas  ', 'CAMPINAS', 'São Paulo', 'Santa Bárbara', 'Brasília',
    'Limeira / Piracicaba', null,
    'São Paulo',            // NFD: "a" + til combinante (~), como o macOS cola
    '\tCampinas\n',               // tab e quebra de linha nas pontas
    ' São Paulo ',      // NBSP (espaço "invisível") nas pontas
  ]
  for (const entrada of casosDeAchatar) {
    const esperado = achatarCidade(entrada)
    const saida = await r(`public.vessel_achatar_cidade($1)`, [entrada])
    conferir(saida === esperado, `achatar(${JSON.stringify(entrada)}) bate com o front (${JSON.stringify(esperado)})`, { saida, esperado })
  }

  console.log('\n── a migração dos dados existentes (63 stylists não-teste)')
  const porPraca = await todas(`select coalesce(p.sigla, '(sem praca)') as sigla, count(*)::int as n
     from public.vessel_stylists s left join public.vessel_pracas p on p.id = s.praca_id
     where not coalesce(s.teste, false) group by 1 order by 1`)
  const mapa = Object.fromEntries(porPraca.map((x) => [x.sigla, x.n]))
  conferir(mapa.CPS === 27 && mapa.LIM === 18 && mapa.PIR === 17 && mapa['(sem praca)'] === 1 && !mapa.SAO && !mapa.SBO && !mapa.BSB,
    'praca_id por cidade: 27 Campinas, 18 Limeira, 17 Piracicaba, 1 sem praça (Limeira / Piracicaba)', porPraca)
  const semPraca = await uma(`select cidade from public.vessel_stylists
     where not coalesce(teste, false) and praca_id is null`)
  conferir(semPraca?.cidade === 'Limeira / Piracicaba', 'a única sem praça é exatamente a "Limeira / Piracicaba"', semPraca)

  console.log('\n── IMPORTANTE 1 e 2: dado SUJO, migrado pelo UPDATE REAL do .sql (nunca uma cópia redigitada)')
  // ⚠️ Isto NÃO reroda um UPDATE retiplado à mão: reroda a própria variável
  // `sql`, lida do arquivo em disco lá no topo deste script. Se o UPDATE do
  // .sql for quebrado de propósito, é ESTA prova que reprova — não uma cópia
  // que poderia ficar de bem com o arquivo mesmo com o arquivo quebrado.
  // O arquivo é idempotente (`if not exists` / `on conflict do nothing` /
  // `where praca_id is null`): rerodar não duplica nada e só alcança as duas
  // linhas sujas novas, inseridas ANTES desta segunda aplicação.
  await cli.query('savepoint prova_dado_sujo')
  try {
    const sao = (await uma(`select id from public.vessel_pracas where sigla = 'SAO'`)).id
    const cps = (await uma(`select id from public.vessel_pracas where sigla = 'CPS'`)).id
    const stSuja = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, cidade, teste)
       values ('STY-PROVA-SUJA', 'Prova Cidade Suja', '5519990007777', '  sÃo   PAULO ', true) returning id`)
    const peSuja = await uma(`insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, teste)
       values ('CA-PROVA-PRACA', 'ca-prova-praca', $1, now() + interval '1 day', '  cps  ', true) returning id`, [stSuja.id])

    await cli.query(sql)

    const stDepois = await uma(`select praca_id from public.vessel_stylists where id = $1`, [stSuja.id])
    conferir(stDepois?.praca_id === sao,
      'IMPORTANTE 2 — stylist com cidade suja ("  sÃo   PAULO ") casa com SAO pelo UPDATE real do .sql', stDepois)
    const peDepois = await uma(`select praca_id from public.vessel_private_edits where id = $1`, [peSuja.id])
    conferir(peDepois?.praca_id === cps,
      'IMPORTANTE 1 — private_edit com praca suja ("  cps  ") casa com CPS pelo UPDATE real do .sql (não uma cópia)', peDepois)
  } finally {
    await cli.query('rollback to savepoint prova_dado_sujo')
  }

  console.log('\n── constraints das tabelas novas')
  const falhaEsperada = async (savepoint, sqlTexto, params, codigoEsperado, frase) => {
    await cli.query(`savepoint ${savepoint}`)
    try {
      await cli.query(sqlTexto, params)
      conferir(false, frase, 'passou')
    } catch (e) {
      conferir(e.code === codigoEsperado, frase, e.message)
    } finally {
      await cli.query(`rollback to savepoint ${savepoint}`)
    }
  }
  const cps = (await uma(`select id from public.vessel_pracas where sigla = 'CPS'`)).id
  await falhaEsperada('prova_termina_antes', `insert into public.vessel_stylist_circle_edicoes
       (praca_id, numero, comeca_em, termina_em) values ($1, 1, current_date, current_date - 1)`,
    [cps], '23514', 'termina_em antes de comeca_em é recusado')
  await falhaEsperada('prova_situacao', `insert into public.vessel_stylist_circle_edicoes
       (praca_id, numero, comeca_em, situacao) values ($1, 1, current_date, 'nao_existe')`,
    [cps], '23514', 'situacao fora da lista fechada é recusada')

  await cli.query('savepoint prova_unique_numero')
  try {
    await cli.query(`insert into public.vessel_stylist_circle_edicoes (praca_id, numero, comeca_em) values ($1, 1, current_date)`, [cps])
    await falhaEsperada('prova_unique_numero_repete',
      `insert into public.vessel_stylist_circle_edicoes (praca_id, numero, comeca_em) values ($1, 1, current_date)`,
      [cps], '23505', 'praca_id+numero repetido é recusado')
  } finally {
    await cli.query('rollback to savepoint prova_unique_numero')
  }

  await cli.query('savepoint prova_na_edicao')
  try {
    const ed = await uma(`insert into public.vessel_stylist_circle_edicoes (praca_id, numero, comeca_em)
       values ($1, 1, current_date) returning id`, [cps])
    const st = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-EDICAO', 'Prova Edição', '5519990008888', true) returning id`)
    await cli.query(`insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id) values ($1, $2)`, [st.id, ed.id])
    await falhaEsperada('prova_na_edicao_repete',
      `insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id) values ($1, $2)`,
      [st.id, ed.id], '23505', 'stylist repetida na mesma edição é recusada')
    await cli.query(`delete from public.vessel_stylist_circle_edicoes where id = $1`, [ed.id])
    const depois = await uma(`select count(*)::int as n from public.vessel_stylist_na_edicao where edicao_id = $1`, [ed.id])
    conferir(depois.n === 0, 'apagar a edição arrasta (cascade) quem estava nela', depois)
  } finally {
    await cli.query('rollback to savepoint prova_na_edicao')
  }

  const depoisDaProva = await uma(IMPRESSAO)
  conferir(JSON.stringify(depoisDaProva) === JSON.stringify(antes), 'as provas não deixaram rastro nos dados de antes (stylists/private_edits/etapas)', { antes, depoisDaProva })
  const semProva = await uma(`select count(*)::int as n from public.vessel_stylists where codigo like 'STY-PROVA-%'`)
  conferir(semProva.n === 0, 'nenhuma stylist de prova sobrou', semProva)

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
  const pr = (await outra.query(`select count(*)::int as n from public.vessel_pracas`)).rows[0]
  await outra.end()
  if (JSON.stringify(agora) !== JSON.stringify(antes) || reg !== 1 || pr.n !== 6) {
    console.error('❌ depois do commit algo não bate', { antes, agora, reg, pr })
    process.exitCode = 1
  } else {
    console.log('  ✓ depois do commit, numa conexão nova: tabelas intactas, 6 praças e migration registrada')
  }
}
