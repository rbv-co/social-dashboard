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
// contas-de-prova: os dois perfis de mentira (Task 4) nascem DENTRO do
// savepoint `prova_funcoes` e morrem com ele — nunca chegam ao COMMIT (o fim
// confere que nenhuma linha `%teste.invalido` sobra em profiles/auth.users).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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

  console.log('\n── as onze funções (Task 4): a trava tem de DEIXAR PASSAR e tem de BARRAR')
  // Como o PostgREST: papel `authenticated`, argumentos por NOME, claim de
  // `request.jwt.claims` a dizer quem está "logado".
  const falarComo = (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [id ? JSON.stringify({ sub: id, role: 'authenticated' }) : ''])
  // Chamada ISOLADA: savepoint próprio, desfeita na volta — para o que TEM de
  // ser recusado (nada pode sobrar mesmo que a trava falhe).
  //
  // ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 3): `depoisFn`, quando passado, é
  // medido AQUI — ainda DENTRO do savepoint, ANTES do rollback. Medir depois
  // do rollback (como a primeira versão fazia) compara sempre contra o MESMO
  // estado de antes, porque o rollback já desfez qualquer coisa que a chamada
  // tenha gravado — a conferência de "nada foi gravado" passaria mesmo com a
  // trava quebrada (é tautológica). Medindo antes do rollback, uma trava
  // quebrada que deixasse a escrita passar aparece de verdade.
  const chamarIsolada = async (expr, params = [], depoisFn = null) => {
    await cli.query('savepoint chamada_isolada')
    await cli.query('set local role authenticated')
    let resultado
    try {
      resultado = { v: await r(expr, params) }
    } catch (e) {
      resultado = { e }
    } finally {
      await cli.query('reset role')
    }
    const depois = depoisFn ? await depoisFn() : undefined
    await cli.query('rollback to savepoint chamada_isolada')
    return { ...resultado, depois }
  }
  // Chamada que GRAVA — monta a esteira (praça → cidade → edição → abrir →
  // incluir), que precisa persistir de um passo para o outro dentro do
  // savepoint maior da prova.
  const chamarGravando = async (expr, params = []) => {
    await cli.query('set local role authenticated')
    try {
      return { v: await r(expr, params) }
    } catch (e) {
      return { e }
    } finally {
      await cli.query('reset role')
    }
  }

  await cli.query('savepoint prova_funcoes')
  try {
    const idEditar = randomUUID(), idVer = randomUUID()
    const emailEditar = `prova-praca-editar-${idEditar}@teste.invalido`
    const emailVer = `prova-praca-ver-${idVer}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`,
      [idEditar, emailEditar, idVer, emailVer])
    await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin, disabled) values
        ($1, $2, 'Prova — Stylist Circle (editar)', array['atendimentos.stylist-circle','atendimentos'], $3::jsonb, false, false),
        ($4, $5, 'Prova — Stylist Circle (ver)',    array['atendimentos.stylist-circle','atendimentos'], $6::jsonb, false, false)`,
      [idEditar, emailEditar, JSON.stringify({ 'atendimentos.stylist-circle': ['ver', 'editar'] }),
       idVer, emailVer, JSON.stringify({ 'atendimentos.stylist-circle': ['ver'] })])
    const hoje = await r(`current_date::text`)

    console.log('\n  · 1) quem TEM atendimentos.stylist-circle (editar) — a esteira inteira tem de funcionar')
    await falarComo(idEditar)
    let x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`,
      ['PVA', 'Praça de Prova A', 'loja-prova-a'])
    conferir(x.v?.ok === true && x.v?.situacao === 'ok' && Number.isInteger(x.v?.id), 'praca_criar: cria a praça PVA', x.v ?? x.e?.message)
    const pracaA = x.v?.id

    x = await chamarGravando(`public.vessel_praca_cidade_vincular(p_praca_id => $1, p_cidade => $2)`, [pracaA, 'Cidade de Prova A'])
    conferir(x.v?.ok === true && x.v?.situacao === 'ok' && Number.isInteger(x.v?.id), 'praca_cidade_vincular: vincula a cidade à praça A', x.v ?? x.e?.message)
    const cidadeA = x.v?.id

    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`,
      [pracaA, 'Edição 1', hoje])
    conferir(x.v?.ok === true && x.v?.situacao === 'ok' && x.v?.numero === 1 && Number.isInteger(x.v?.id),
      'edicao_criar: cria a edição 1 da praça A (numero = maior + 1 = 1)', x.v ?? x.e?.message)
    const edicaoA1 = x.v?.id

    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoA1])
    conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'edicao_abrir: abre a edição 1', x.v ?? x.e?.message)

    const sty1 = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-EDICAO4-1', 'Prova Edição4 Um', '5519990004001', true) returning id, etapa_id`)
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`,
      ['STY-PROVA-EDICAO4-1', edicaoA1])
    conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'edicao_incluir_stylist: inclui a stylist na edição aberta', x.v ?? x.e?.message)
    const vinculoGravado = await r(`(select count(*)::int from public.vessel_stylist_na_edicao where edicao_id = $1 and stylist_id = $2 and saiu_em is null)`,
      [edicaoA1, sty1.id])
    conferir(vinculoGravado === 1, 'e o vínculo REALMENTE foi gravado (não só a resposta ok)', vinculoGravado)

    // Criada já aqui, ainda 'planejada' — serve de alvo tanto do teste de
    // permissão (passo 2, abrir sem poder) quanto do `ja_tem_aberta` (passo 4).
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`,
      [pracaA, 'Edição 2', hoje])
    conferir(x.v?.ok === true && x.v?.numero === 2, 'edicao_criar: edição 2 da praça A (numero = 2)', x.v ?? x.e?.message)
    const edicaoA2 = x.v?.id

    console.log('\n  · 1b) MENOR 7: as outras três (editar, desvincular, definir_praca) também têm de PASSAR')
    // Num savepoint próprio, desfeito no fim — prova que passa, sem deixar
    // rastro para as provas seguintes (a praça A e a stylist 1 continuam como
    // a prova 3 e a prova 2 esperam).
    await cli.query('savepoint prova_menor7')
    try {
      x = await chamarGravando(`public.vessel_praca_editar(p_id => $1, p_nome => $2, p_loja_destino => $3, p_ativa => $4)`,
        [pracaA, 'Praça de Prova A (editada)', 'loja-prova-a-2', true])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'praca_editar: quem edita consegue editar a praça A', x.v ?? x.e?.message)
      const pracaAEditada = await uma(`select nome, loja_destino from public.vessel_pracas where id = $1`, [pracaA])
      conferir(pracaAEditada?.nome === 'Praça de Prova A (editada)' && pracaAEditada?.loja_destino === 'loja-prova-a-2',
        'e a edição REALMENTE foi gravada', pracaAEditada)

      // MENOR 5: loja_destino nula PRESERVA (nunca apaga) — mesma semântica
      // de `ativa` nulo, que já preserva.
      x = await chamarGravando(`public.vessel_praca_editar(p_id => $1, p_nome => $2, p_loja_destino => $3, p_ativa => $4)`,
        [pracaA, 'Praça de Prova A (nome só)', null, true])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'praca_editar: MENOR 5 — chamada com loja_destino nulo', x.v ?? x.e?.message)
      const pracaAApósNulo = await uma(`select nome, loja_destino from public.vessel_pracas where id = $1`, [pracaA])
      conferir(pracaAApósNulo?.nome === 'Praça de Prova A (nome só)' && pracaAApósNulo?.loja_destino === 'loja-prova-a-2',
        'MENOR 5: loja_destino nula PRESERVA a loja gravada (não apaga)', pracaAApósNulo)

      x = await chamarGravando(`public.vessel_stylist_definir_praca(p_codigo => $1, p_praca_id => $2)`, ['STY-PROVA-EDICAO4-1', pracaA])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'stylist_definir_praca: quem edita consegue definir a praça da stylist', x.v ?? x.e?.message)
      // ⚠️ `praca_id` é `bigint`: o driver devolve como STRING (evita perder
      // precisão) — `::int` aqui, contra o `pracaA` que veio de JSON (Number).
      const styComPraca = await r(`(select praca_id::int from public.vessel_stylists where id = $1)`, [sty1.id])
      conferir(styComPraca === pracaA, 'e a stylist REALMENTE ficou com a praça A', styComPraca)

      // uma cidade DESCARTÁVEL só para provar que desvincular funciona — a
      // cidadeA "de verdade" segue vinculada, porque a prova 3 (colisão) precisa dela.
      const descartavel = await chamarGravando(`public.vessel_praca_cidade_vincular(p_praca_id => $1, p_cidade => $2)`,
        [pracaA, 'Cidade Descartável de Prova'])
      x = await chamarGravando(`public.vessel_praca_cidade_desvincular(p_id => $1)`, [descartavel.v?.id])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'praca_cidade_desvincular: quem edita consegue desvincular', x.v ?? x.e?.message)
      const existeAindaDescartavel = await r(`(select exists(select 1 from public.vessel_praca_cidades where id = $1))`, [descartavel.v?.id])
      conferir(existeAindaDescartavel === false, 'e a cidade descartável REALMENTE sumiu', existeAindaDescartavel)
    } finally {
      await cli.query('rollback to savepoint prova_menor7')
    }

    console.log("\n  · 2) quem SÓ TEM 'ver' — as nove funções de escrita têm de barrar, e NADA grava (medido DENTRO do savepoint, antes do rollback)")
    await falarComo(idVer)
    // Uma medida ESPECÍFICA por função (não só "a contagem total das 4
    // tabelas"): cada uma mede exatamente o que aquela escrita mudaria — uma
    // troca (`update`) não muda contagem nenhuma, só o conteúdo da linha.
    const chamadasDeEscrita = [
      ['praca_criar', `public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['ZZZ', 'Zona Zeta', null],
        () => r(`(select count(*)::int from public.vessel_pracas where sigla = 'ZZZ')`)],
      ['praca_editar', `public.vessel_praca_editar(p_id => $1, p_nome => $2, p_loja_destino => $3, p_ativa => $4)`, [pracaA, 'Nome Roubado', null, true],
        () => uma(`select nome, loja_destino from public.vessel_pracas where id = $1`, [pracaA])],
      ['praca_cidade_vincular', `public.vessel_praca_cidade_vincular(p_praca_id => $1, p_cidade => $2)`, [pracaA, 'Outra Cidade Qualquer'],
        () => r(`(select count(*)::int from public.vessel_praca_cidades where praca_id = $1)`, [pracaA])],
      ['praca_cidade_desvincular', `public.vessel_praca_cidade_desvincular(p_id => $1)`, [cidadeA],
        () => r(`(select exists(select 1 from public.vessel_praca_cidades where id = $1))`, [cidadeA])],
      ['stylist_definir_praca', `public.vessel_stylist_definir_praca(p_codigo => $1, p_praca_id => $2)`, ['STY-PROVA-EDICAO4-1', pracaA],
        () => r(`(select praca_id from public.vessel_stylists where id = $1)`, [sty1.id])],
      ['edicao_criar', `public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaA, 'Edição fantasma', hoje],
        () => r(`(select count(*)::int from public.vessel_stylist_circle_edicoes where praca_id = $1)`, [pracaA])],
      ['edicao_abrir', `public.vessel_edicao_abrir(p_id => $1)`, [edicaoA2],
        () => r(`(select situacao from public.vessel_stylist_circle_edicoes where id = $1)`, [edicaoA2])],
      ['edicao_encerrar', `public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoA1, null],
        () => r(`(select situacao from public.vessel_stylist_circle_edicoes where id = $1)`, [edicaoA1])],
      ['edicao_incluir_stylist', `public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-EDICAO4-1', edicaoA2],
        () => r(`(select exists(select 1 from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2))`, [sty1.id, edicaoA2])],
    ]
    for (const [nome, expr, params, medir] of chamadasDeEscrita) {
      const antes = await medir()
      const { v, e, depois } = await chamarIsolada(expr, params, medir)
      conferir(!e && v?.ok === false && v?.situacao === 'sem_permissao', `${nome}: quem só tem 'ver' toma sem_permissao`, e?.message ?? v)
      conferir(JSON.stringify(antes) === JSON.stringify(depois),
        `${nome}: nada mudou de verdade (medido DENTRO do savepoint, antes do rollback)`, { antes, depois })
    }

    console.log('\n  · 2b) a medida DENTRO do savepoint tem dente — mutação de propósito em praca_cidade_desvincular')
    // ⚠️ A MESMA técnica do passo 5: se eu tirar o portão de
    // `vessel_praca_cidade_desvincular`, quem só tem 'ver' apaga a cidade DE
    // VERDADE — e é isso que a medida "antes/depois DENTRO do savepoint" (o
    // conserto do IMPORTANTE 3) tem de pegar. A versão antiga (medindo depois
    // do rollback) NUNCA pegaria isto: o rollback já teria desfeito o apagão
    // antes da medida rodar.
    await cli.query('savepoint prova_mutacao_ver')
    const funcaoBoaDesvincular = (await uma(
      `select pg_get_functiondef('public.vessel_praca_cidade_desvincular(bigint)'::regprocedure) as def`)).def
    const trechoDoPortao = /if not public\.vessel_pode\('atendimentos\.stylist-circle', 'editar'\) then[\s\S]*?end if;\n/
    if (!trechoDoPortao.test(funcaoBoaDesvincular)) throw new Error('a mutação não achou o portão de vessel_praca_cidade_desvincular')
    await cli.query(funcaoBoaDesvincular.replace(trechoDoPortao, ''))
    const existiaAntesDaMutacao = await r(`(select exists(select 1 from public.vessel_praca_cidades where id = $1))`, [cidadeA])
    await cli.query('set local role authenticated')
    try {
      await r(`public.vessel_praca_cidade_desvincular(p_id => $1)`, [cidadeA])
    } finally {
      await cli.query('reset role')
    }
    // medido AINDA DENTRO do savepoint da mutação, antes de desfazer.
    const existeDepoisDaMutacao = await r(`(select exists(select 1 from public.vessel_praca_cidades where id = $1))`, [cidadeA])
    const apagouSemPortao = existiaAntesDaMutacao === true && existeDepoisDaMutacao === false
    console.log(`    ${apagouSemPortao ? '✗' : '✓'} SEM o portão: quem só tem 'ver' ${apagouSemPortao ? 'CONSEGUIU apagar a cidade — a medida dentro do savepoint pegou isso' : 'não conseguiu apagar (inesperado)'} → existia antes=${existiaAntesDaMutacao}, existe depois=${existeDepoisDaMutacao}`)
    conferir(apagouSemPortao === true,
      "MUTAÇÃO: sem o `if not vessel_pode(...)`, quem só tem 'ver' apaga a cidade de verdade — prova que medir DENTRO do savepoint tem dente (medir DEPOIS do rollback nunca pegaria isto)",
      { existiaAntesDaMutacao, existeDepoisDaMutacao })
    // Desfaz a mutação (restaura a função) E o apagão.
    await cli.query('rollback to savepoint prova_mutacao_ver')

    const existeAntesDeVerdade = await r(`(select exists(select 1 from public.vessel_praca_cidades where id = $1))`, [cidadeA])
    x = await chamarIsolada(`public.vessel_praca_cidade_desvincular(p_id => $1)`, [cidadeA],
      () => r(`(select exists(select 1 from public.vessel_praca_cidades where id = $1))`, [cidadeA]))
    const continuouExistindo = existeAntesDeVerdade === true && x.depois === true
    console.log(`    ${continuouExistindo ? '✓' : '✗'} COM o portão (restaurado): quem só tem 'ver' ${continuouExistindo ? 'NÃO conseguiu apagar, como tem de ser' : 'apagou — bug!'} → ${JSON.stringify(x.v ?? x.e?.message)}`)
    conferir(x.v?.ok === false && x.v?.situacao === 'sem_permissao', 'praca_cidade_desvincular: com o portão restaurado, sem_permissao de novo', x.v ?? x.e?.message)
    conferir(continuouExistindo === true, 'e a cidade continua lá (medido dentro do savepoint) — a trava restaurada barra de verdade', { existeAntesDeVerdade, depois: x.depois })

    console.log('\n  · 3) cidade já vinculada a outra praça')
    await falarComo(idEditar)
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVB', 'Praça de Prova B', null])
    conferir(x.v?.ok === true, 'praca_criar: praça B criada para o teste de colisão de cidade', x.v ?? x.e?.message)
    const pracaB = x.v?.id
    const cidadesBAntes = await r(`(select count(*)::int from public.vessel_praca_cidades where praca_id = $1)`, [pracaB])
    // mesma CHAVE achatada (caixa e espaço diferentes) — já é da praça A
    x = await chamarIsolada(`public.vessel_praca_cidade_vincular(p_praca_id => $1, p_cidade => $2)`, [pracaB, '  CIDADE   de Prova A  '],
      () => r(`(select count(*)::int from public.vessel_praca_cidades where praca_id = $1)`, [pracaB]))
    conferir(x.v?.ok === false && x.v?.situacao === 'cidade_em_outra_praca' && x.v?.praca_id === pracaA,
      'praca_cidade_vincular: cidade de outra praça devolve cidade_em_outra_praca, com a praça A', x.v ?? x.e?.message)
    conferir(cidadesBAntes === 0 && x.depois === 0, 'nada foi gravado para a praça B (medido dentro do savepoint)', { cidadesBAntes, depois: x.depois })

    console.log('\n  · 4) segunda edição aberta na mesma praça')
    x = await chamarIsolada(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoA2],
      () => r(`(select situacao from public.vessel_stylist_circle_edicoes where id = $1)`, [edicaoA2]))
    conferir(x.v?.ok === false && x.v?.situacao === 'ja_tem_aberta', 'edicao_abrir: a segunda edição da mesma praça recusa com ja_tem_aberta', x.v ?? x.e?.message)
    conferir(x.depois === 'planejada', 'a edição 2 continua planejada — nada foi gravado (medido dentro do savepoint)', x.depois)

    console.log('\n  · 5) CRÍTICO 1: o placar NÃO ZERA ao encerrar — e a prova de que edicao_encerrada FAZ FALTA (quebrando de propósito)')
    const listaAntes = await chamarGravando(`public.vessel_edicoes_listar(p_praca_id => $1)`, [pracaA])
    const stylistsAntesDeEncerrar = listaAntes.v?.find((e) => e.id === edicaoA1)?.stylists

    x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoA1, null])
    conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'edicao_encerrar: encerra a edição 1 (sem destino — ninguém ativou)', x.v ?? x.e?.message)
    const situacaoA1 = await r(`(select situacao from public.vessel_stylist_circle_edicoes where id = $1)`, [edicaoA1])
    conferir(situacaoA1 === 'encerrada', 'a edição 1 está encerrada', situacaoA1)

    const listaDepois = await chamarGravando(`public.vessel_edicoes_listar(p_praca_id => $1)`, [pracaA])
    const stylistsDepoisDeEncerrar = listaDepois.v?.find((e) => e.id === edicaoA1)?.stylists
    conferir(stylistsAntesDeEncerrar === 1 && stylistsDepoisDeEncerrar === stylistsAntesDeEncerrar,
      'CRÍTICO 1: vessel_edicoes_listar — o placar (stylists) da edição 1 é o MESMO número antes e depois de encerrar (não zera)',
      { stylistsAntesDeEncerrar, stylistsDepoisDeEncerrar })

    const sty2 = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-EDICAO4-2', 'Prova Edição4 Dois', '5519990004002', true) returning id`)

    // ⚠️ A MUTAÇÃO DE PROPÓSITO: `situacao = 'encerrada'` NÃO tem nenhuma
    // constraint de banco impedindo um insert em `vessel_stylist_na_edicao` —
    // quem impede é só este `if`. Tirando-o, a inclusão numa edição encerrada
    // PASSARIA (o congelamento seria só de fachada).
    await cli.query('savepoint prova_mutacao')
    const funcaoBoa = (await uma(
      `select pg_get_functiondef('public.vessel_edicao_incluir_stylist(text,bigint)'::regprocedure) as def`)).def
    const trechoDaTrava = /if v_ed\.situacao = 'encerrada' then[\s\S]*?end if;\n/
    if (!trechoDaTrava.test(funcaoBoa)) throw new Error('a mutação não achou o trecho da trava — o texto da função mudou de forma inesperada')
    const funcaoQuebrada = funcaoBoa.replace(trechoDaTrava, '')
    await cli.query(funcaoQuebrada)
    const semTrava = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`,
      ['STY-PROVA-EDICAO4-2', edicaoA1])
    const passouSemTrava = semTrava.v?.ok === true
    console.log(`    ${passouSemTrava ? '✗' : '✓'} SEM a trava: incluir numa edição encerrada ${passouSemTrava ? 'PASSOU — era para recusar; a trava faz falta de verdade' : 'ainda recusou'} → ${JSON.stringify(semTrava.v ?? semTrava.e?.message)}`)
    conferir(passouSemTrava === true, "MUTAÇÃO: sem o `if` de edicao_encerrada, a inclusão passa — prova que a trava não é decoração", semTrava.v ?? semTrava.e?.message)
    // Desfaz a mutação (restaura a função) E o que ela gravou.
    await cli.query('rollback to savepoint prova_mutacao')

    x = await chamarIsolada(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`,
      ['STY-PROVA-EDICAO4-2', edicaoA1],
      () => r(`(select count(*)::int from public.vessel_stylist_na_edicao where edicao_id = $1 and stylist_id = $2)`, [edicaoA1, sty2.id]))
    const recusouComATrava = x.v?.ok === false && x.v?.situacao === 'edicao_encerrada'
    console.log(`    ${recusouComATrava ? '✓' : '✗'} COM a trava (restaurada): incluir numa edição encerrada ${recusouComATrava ? 'recusou, como tem de ser' : 'PASSOU — bug!'} → ${JSON.stringify(x.v ?? x.e?.message)}`)
    conferir(recusouComATrava === true, 'COM a trava restaurada: edicao_incluir_stylist recusa com edicao_encerrada', x.v ?? x.e?.message)
    conferir(x.depois === 0, 'nada ficou gravado para a stylist 2 na edição 1 encerrada (medido dentro do savepoint)', x.depois)

    console.log('\n  · 6) sigla repetida')
    const comPVAAntes = await r(`(select count(*)::int from public.vessel_pracas where sigla = 'PVA')`)
    x = await chamarIsolada(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['pva', 'Outra Praça Qualquer', null],
      () => r(`(select count(*)::int from public.vessel_pracas where sigla = 'PVA')`))
    conferir(x.v?.ok === false && x.v?.situacao === 'sigla_repetida', 'praca_criar: sigla repetida (mesmo em minúscula) devolve sigla_repetida', x.v ?? x.e?.message)
    conferir(comPVAAntes === 1 && x.depois === 1, 'nenhuma segunda PVA foi gravada (medido dentro do savepoint)', { comPVAAntes, depois: x.depois })

    console.log('\n  · 7) IMPORTANTE 4: p_levar_para — quem NÃO ativou vai, quem ativou fica, com etapa_ao_sair e levadas certos')
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVC', 'Praça de Prova C', null])
    conferir(x.v?.ok === true, 'praca_criar: praça C para o teste de levar_para', x.v ?? x.e?.message)
    const pracaC = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaC, 'Origem', hoje])
    const edicaoOrigem = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoOrigem])
    conferir(x.v?.ok === true, 'edicao_abrir: abre a edição origem da praça C', x.v ?? x.e?.message)
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaC, 'Destino', hoje])
    const edicaoDestino = x.v?.id

    const naoAtivada = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-LEVAR-NAOATIVOU', 'Prova Não Ativou', '5519990004003', true) returning id, etapa_id`)
    const ativada = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativada_em)
       values ('STY-PROVA-LEVAR-ATIVOU', 'Prova Ativou', '5519990004004', true, now()) returning id, etapa_id`)

    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-LEVAR-NAOATIVOU', edicaoOrigem])
    conferir(x.v?.ok === true, 'inclui a não-ativada na edição origem', x.v ?? x.e?.message)
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-LEVAR-ATIVOU', edicaoOrigem])
    conferir(x.v?.ok === true, 'inclui a ativada na edição origem', x.v ?? x.e?.message)

    x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoOrigem, edicaoDestino])
    conferir(x.v?.ok === true && x.v?.situacao === 'ok' && x.v?.levadas === 1,
      '(d) levadas bate com o número real — só 1 (a que não ativou)', x.v ?? x.e?.message)

    const vinculoOrigemNaoAtivada = await uma(`select saiu_em, etapa_ao_sair from public.vessel_stylist_na_edicao
       where edicao_id = $1 and stylist_id = $2`, [edicaoOrigem, naoAtivada.id])
    conferir(vinculoOrigemNaoAtivada?.saiu_em != null && vinculoOrigemNaoAtivada?.etapa_ao_sair === naoAtivada.etapa_id,
      '(c) etapa_ao_sair guarda a etapa em que a não-ativada estava, no vínculo fechado da origem', { vinculoOrigemNaoAtivada, esperado: naoAtivada.etapa_id })

    const vinculoDestinoNaoAtivada = await uma(`select entrou_em, saiu_em from public.vessel_stylist_na_edicao
       where edicao_id = $1 and stylist_id = $2`, [edicaoDestino, naoAtivada.id])
    conferir(vinculoDestinoNaoAtivada?.entrou_em != null && vinculoDestinoNaoAtivada?.saiu_em === null,
      '(a) a não-ativada FOI LEVADA e está ativa na edição de destino', vinculoDestinoNaoAtivada)

    const vinculoOrigemAtivada = await uma(`select saiu_em, etapa_ao_sair from public.vessel_stylist_na_edicao
       where edicao_id = $1 and stylist_id = $2`, [edicaoOrigem, ativada.id])
    conferir(vinculoOrigemAtivada?.saiu_em != null && vinculoOrigemAtivada?.etapa_ao_sair === ativada.etapa_id,
      '(b/c) a ativada tem o vínculo de origem fechado, com etapa_ao_sair certo', { vinculoOrigemAtivada, esperado: ativada.etapa_id })
    const vinculoDestinoAtivada = await r(`(select exists(select 1 from public.vessel_stylist_na_edicao where edicao_id = $1 and stylist_id = $2))`,
      [edicaoDestino, ativada.id])
    conferir(vinculoDestinoAtivada === false, '(b) a ativada NÃO foi levada — não existe vínculo dela na edição de destino', vinculoDestinoAtivada)

    console.log('\n  · 8) MENOR 6: p_levar_para de OUTRA praça é recusado (destino_de_outra_praca)')
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVD', 'Praça de Prova D', null])
    const pracaD = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaD, 'Origem D', hoje])
    const edicaoOrigemD = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoOrigemD])
    conferir(x.v?.ok === true, 'edicao_abrir: abre a edição origem da praça D', x.v ?? x.e?.message)

    const situacaoOrigemDAntes = await r(`(select situacao from public.vessel_stylist_circle_edicoes where id = $1)`, [edicaoOrigemD])
    // edicaoDestino é da praça C, não da praça D — destino errado de propósito.
    x = await chamarIsolada(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoOrigemD, edicaoDestino],
      () => r(`(select situacao from public.vessel_stylist_circle_edicoes where id = $1)`, [edicaoOrigemD]))
    conferir(x.v?.ok === false && x.v?.situacao === 'destino_de_outra_praca',
      'edicao_encerrar: MENOR 6 — levar para edição de outra praça é recusado', x.v ?? x.e?.message)
    conferir(situacaoOrigemDAntes === x.depois, 'a edição de origem NÃO foi encerrada — nada mudou (medido dentro do savepoint)',
      { situacaoOrigemDAntes, depois: x.depois })

    console.log("\n  · 9) CRÍTICO 2 — GUARDA DE REGRESSÃO: mesma stylist nas duas edições, encerrar com levar_para não estoura 23505")
    // O cenário exato que fazia a unique (stylist_id, edicao_id) estourar: a
    // stylist é incluída na edição de ORIGEM e, à parte, também na de
    // DESTINO — a 'planejada' aceita incluir, só a 'encerrada' recusa. Ao
    // encerrar a origem levando para o destino, o insert de "quem não ativou"
    // bateria de frente com a linha que ela já tem lá.
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVE', 'Praça de Prova E', null])
    conferir(x.v?.ok === true, 'praca_criar: praça E para o teste de conflito do levar_para', x.v ?? x.e?.message)
    const pracaE = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaE, 'Origem E', hoje])
    const edicaoOrigemE = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoOrigemE])
    conferir(x.v?.ok === true, 'edicao_abrir: abre a edição origem da praça E', x.v ?? x.e?.message)
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaE, 'Destino E', hoje])
    const edicaoDestinoE = x.v?.id

    const stConflito = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-CONFLITO', 'Prova Conflito Levar', '5519990004005', true) returning id`)

    // 1) a MESMA stylist nas duas edições da mesma praça — a planejada aceita.
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-CONFLITO', edicaoOrigemE])
    conferir(x.v?.ok === true, '1) inclui a stylist na edição origem E', x.v ?? x.e?.message)
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-CONFLITO', edicaoDestinoE])
    conferir(x.v?.ok === true, '1) inclui a MESMA stylist na edição destino E (planejada aceita)', x.v ?? x.e?.message)

    // 2) encerra a origem levando para o destino onde ela JÁ está.
    x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoOrigemE, edicaoDestinoE])
    // 3) não estourou, ok:true, e levadas conta certo (ela já estava lá — não conta de novo).
    conferir(!x.e, '3) edicao_encerrar: a chamada NÃO estourou (sem erro cru de banco)', x.e?.message)
    conferir(x.v?.ok === true && x.v?.situacao === 'ok', '3) edicao_encerrar: devolveu ok:true mesmo com a stylist já na edição de destino', x.v)
    conferir(x.v?.levadas === 0, '3) levadas bate com o número REAL — 0, porque ela já estava no destino (não conta duas vezes)', x.v)

    // 4) continua com UMA linha só na edição de destino (sem duplicar).
    const linhasNoDestinoE = await r(`(select count(*)::int from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2)`,
      [stConflito.id, edicaoDestinoE])
    conferir(linhasNoDestinoE === 1, '4) a stylist continua com UMA linha só na edição de destino', linhasNoDestinoE)
    // e o vínculo de ORIGEM foi mesmo fechado (congelado), apesar do conflito no destino.
    const origemEFechada = await r(`(select saiu_em is not null from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2)`,
      [stConflito.id, edicaoOrigemE])
    conferir(origemEFechada === true, 'e o vínculo de ORIGEM continua fechado mesmo com o conflito no destino', origemEFechada)

    console.log('\n  · 9b) mutação de propósito: tirando o `on conflict`, o MESMO cenário estoura 23505 cru')
    await cli.query('savepoint prova_mutacao_conflito')
    try {
      const funcaoBoaEncerrar = (await uma(
        `select pg_get_functiondef('public.vessel_edicao_encerrar(bigint,bigint)'::regprocedure) as def`)).def
      const trechoDoOnConflict = /\n\s*on conflict \(stylist_id, edicao_id\) do nothing;/
      if (!trechoDoOnConflict.test(funcaoBoaEncerrar)) throw new Error('a mutação não achou o `on conflict` de vessel_edicao_encerrar — o texto da função mudou')
      await cli.query(funcaoBoaEncerrar.replace(trechoDoOnConflict, ';'))

      x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVF', 'Praça de Prova F (mutada)', null])
      const pracaF = x.v?.id
      x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaF, 'Origem F', hoje])
      const edicaoOrigemF = x.v?.id
      x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoOrigemF])
      x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaF, 'Destino F', hoje])
      const edicaoDestinoF = x.v?.id
      await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
         values ('STY-PROVA-CONFLITO-MUT', 'Prova Conflito Mutação', '5519990004006', true)`)
      x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-CONFLITO-MUT', edicaoOrigemF])
      x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-CONFLITO-MUT', edicaoDestinoF])

      // ⚠️ Esta chamada pode estourar 23505 DE VERDADE — savepoint próprio,
      // porque um erro de banco aborta a transação até o rollback (não dá
      // para seguir chamando nada — nem `reset role` — sem desfazer antes).
      await cli.query('savepoint chamada_mutada')
      let erroCru, semErro
      try {
        await cli.query('set local role authenticated')
        semErro = await r(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoOrigemF, edicaoDestinoF])
      } catch (e) {
        erroCru = e
      } finally {
        await cli.query('rollback to savepoint chamada_mutada')
      }
      const estourou23505 = erroCru?.code === '23505'
      console.log(`    ${estourou23505 ? '✗' : '✓'} SEM o \`on conflict\`: encerrar com a stylist já no destino ${estourou23505 ? 'ESTOUROU 23505 cru — era para não estourar; a cláusula faz falta de verdade' : 'não estourou (inesperado)'} → ${JSON.stringify(erroCru ? { code: erroCru.code, message: erroCru.message } : semErro)}`)
      conferir(estourou23505 === true,
        'MUTAÇÃO: sem `on conflict (stylist_id, edicao_id) do nothing`, o MESMO cenário estoura 23505 cru — prova que a cláusula é o guarda de regressão do Crítico 2 (sem ela, o erro cru volta pela mesma porta)',
        erroCru ? { code: erroCru.code, message: erroCru.message } : semErro)
    } finally {
      // Desfaz a mutação (restaura a função) E toda a praça/edições/stylist da demonstração.
      await cli.query('rollback to savepoint prova_mutacao_conflito')
    }

    // com a função REAL (on conflict restaurado), o MESMO tipo de cenário não estoura.
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVF', 'Praça de Prova F (restaurada)', null])
    const pracaFRestaurada = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaFRestaurada, 'Origem F', hoje])
    const edicaoOrigemFRestaurada = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoOrigemFRestaurada])
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaFRestaurada, 'Destino F', hoje])
    const edicaoDestinoFRestaurada = x.v?.id
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-CONFLITO-RESTAURADA', 'Prova Conflito Restaurada', '5519990004007', true)`)
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-CONFLITO-RESTAURADA', edicaoOrigemFRestaurada])
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-CONFLITO-RESTAURADA', edicaoDestinoFRestaurada])
    x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoOrigemFRestaurada, edicaoDestinoFRestaurada])
    const restaurouSemErro = !x.e && x.v?.ok === true
    console.log(`    ${restaurouSemErro ? '✓' : '✗'} COM o \`on conflict\` (restaurado): o mesmo cenário ${restaurouSemErro ? 'não estourou, como tem de ser' : 'quebrou — bug!'} → ${JSON.stringify(x.v ?? x.e?.message)}`)
    conferir(restaurouSemErro === true, 'COM o `on conflict` restaurado: edicao_encerrar não estoura no mesmo cenário de conflito', x.v ?? x.e?.message)
  } finally {
    await falarComo(null)
    await cli.query('rollback to savepoint prova_funcoes')
  }

  const pracasDepoisDasFuncoes = await r(`(select count(*)::int from public.vessel_pracas)`)
  conferir(pracasDepoisDasFuncoes === 6, 'depois do savepoint desfeito: continuam exatamente as 6 praças da carga inicial', pracasDepoisDasFuncoes)
  const perfisSobrando = await r(`(select count(*)::int from public.profiles where email like '%@teste.invalido')`)
  conferir(perfisSobrando === 0, 'nenhum perfil de prova sobrou em public.profiles', perfisSobrando)
  const usersSobrando = await r(`(select count(*)::int from auth.users where email like '%@teste.invalido')`)
  conferir(usersSobrando === 0, 'nenhuma conta de prova sobrou em auth.users', usersSobrando)

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
