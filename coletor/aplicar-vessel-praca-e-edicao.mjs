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

  console.log('\n── TASK 6 RODADA 1 DE CONSERTO (IMPORTANTE 2): a pré-concessão aditiva é PROVADA, não só calculada')
  // ⚠️ Antes desta rodada, o aplicador só ESCREVIA as duas chaves à mão nos
  // perfis de mentira das provas de função (passo 1c) — nunca exercitava a
  // seção 14.3 da migration (o `update` que faz a pré-concessão de verdade).
  // Se o cálculo de "o que acrescentar" errasse, o ensaio continuaria verde e
  // no dia da aplicação real a equipe inteira perderia as duas telas, calada.
  //
  // A MESMA técnica de "IMPORTANTE 1 e 2" logo acima: insere perfis de
  // mentira ANTES de reaplicar a variável `sql` (idempotente — `create or
  // replace`/`on conflict do nothing`/`where ainda não tem a chave`), e
  // confere o resultado DEPOIS. Três perfis: só 'ver' em stylist-circle, 'ver'
  // + 'editar', e um SEM stylist-circle nenhum (só outra chave da família).
  await cli.query('savepoint prova_pre_concessao')
  try {
    const idPcVer = randomUUID(), idPcEditar = randomUUID(), idPcSemMae = randomUUID()
    const emailPcVer = `prova-pre-concessao-ver-${idPcVer}@teste.invalido`
    const emailPcEditar = `prova-pre-concessao-editar-${idPcEditar}@teste.invalido`
    const emailPcSemMae = `prova-pre-concessao-sem-mae-${idPcSemMae}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)`,
      [idPcVer, emailPcVer, idPcEditar, emailPcEditar, idPcSemMae, emailPcSemMae])
    await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin, disabled) values
        ($1, $2, 'Prova — pré-concessão, só ver',    array['atendimentos.stylist-circle'], $3::jsonb, false, false),
        ($4, $5, 'Prova — pré-concessão, editar',    array['atendimentos.stylist-circle'], $6::jsonb, false, false),
        ($7, $8, 'Prova — pré-concessão, sem a mãe', array['atendimentos.private-edit'], $9::jsonb, false, false)`,
      [idPcVer, emailPcVer, JSON.stringify({ 'atendimentos.stylist-circle': ['ver'] }),
       idPcEditar, emailPcEditar, JSON.stringify({ 'atendimentos.stylist-circle': ['ver', 'editar'] }),
       idPcSemMae, emailPcSemMae, JSON.stringify({ 'atendimentos.private-edit': ['ver', 'editar'] })])

    const lerPerfil = (id) => uma(`select permissions, features from public.profiles where id = $1`, [id])

    // ── mutação de propósito: quebra a condição de "quem tem a mãe" — se o
    // cálculo faz falta de verdade, com ele quebrado NINGUÉM ganha nada.
    const trechoDaCondicao = `and (p -> 'atendimentos.stylist-circle') ? 'ver'`
    const ocorrencias = sql.split(trechoDaCondicao).length - 1
    if (ocorrencias !== 1) throw new Error(`esperava 1 ocorrência de "${trechoDaCondicao}" em sql, achei ${ocorrencias} — o texto da migration mudou`)
    const sqlQuebrado = sql.replace(trechoDaCondicao, `and (p -> 'atendimentos.stylist-circle') ? 'ver-quebrado-de-proposito'`)

    await cli.query('savepoint prova_pre_concessao_mutacao')
    await cli.query(sqlQuebrado)
    const verQuebrado = await lerPerfil(idPcVer)
    const editarQuebrado = await lerPerfil(idPcEditar)
    const ninguemGanhouComTravaQuebrada = !('atendimentos.pracas' in (verQuebrado.permissions || {}))
      && !('atendimentos.pracas' in (editarQuebrado.permissions || {}))
    console.log(`    ${ninguemGanhouComTravaQuebrada ? '✗' : '✓'} SEM o cálculo certo: os dois perfis que deveriam ganhar as chaves novas continuam sem elas — é exatamente "a equipe inteira perde as duas telas, calada" → ver=${JSON.stringify(verQuebrado.permissions)}, editar=${JSON.stringify(editarQuebrado.permissions)}`)
    conferir(ninguemGanhouComTravaQuebrada === true,
      'MUTAÇÃO: com a condição de "quem tem a mãe" quebrada, a pré-concessão não roda para ninguém — prova que o cálculo faz falta de verdade',
      { verQuebrado: verQuebrado.permissions, editarQuebrado: editarQuebrado.permissions })
    await cli.query('rollback to savepoint prova_pre_concessao_mutacao')

    // ── com o cálculo restaurado (o `sql` de verdade, sem a mutação)
    await cli.query(sql)
    const verDepois = await lerPerfil(idPcVer)
    const editarDepois = await lerPerfil(idPcEditar)
    const semMaeDepois = await lerPerfil(idPcSemMae)
    console.log(`    ✓ COM o cálculo restaurado: ver=${JSON.stringify(verDepois.permissions)}, editar=${JSON.stringify(editarDepois.permissions)}, sem-mãe=${JSON.stringify(semMaeDepois.permissions)}`)

    conferir(
      JSON.stringify(verDepois.permissions?.['atendimentos.pracas']) === JSON.stringify(['ver'])
      && JSON.stringify(verDepois.permissions?.['atendimentos.edicoes']) === JSON.stringify(['ver']),
      'COM a pré-concessão restaurada: quem tinha SÓ "ver" em stylist-circle ganha as duas chaves novas em "ver" — nunca mais larga do que já tinha',
      verDepois.permissions)
    conferir(
      JSON.stringify(editarDepois.permissions?.['atendimentos.pracas']) === JSON.stringify(['ver', 'editar'])
      && JSON.stringify(editarDepois.permissions?.['atendimentos.edicoes']) === JSON.stringify(['ver', 'editar']),
      'COM a pré-concessão restaurada: quem tinha "ver"+"editar" em stylist-circle ganha as duas chaves novas em "ver"+"editar"',
      editarDepois.permissions)
    conferir(
      !('atendimentos.pracas' in (semMaeDepois.permissions || {})) && !('atendimentos.edicoes' in (semMaeDepois.permissions || {}))
      && JSON.stringify(semMaeDepois.permissions?.['atendimentos.private-edit']) === JSON.stringify(['ver', 'editar']),
      'quem NÃO tinha atendimentos.stylist-circle (só private-edit, intacto) continua SEM as chaves novas — nunca de graça a quem não tinha a mãe',
      semMaeDepois.permissions)
    // MENOR 1: features[] acompanha permissions{} (o precedente de 24/09/2026).
    conferir(
      (verDepois.features || []).includes('atendimentos.pracas') && (verDepois.features || []).includes('atendimentos.edicoes')
      && (editarDepois.features || []).includes('atendimentos.pracas') && (editarDepois.features || []).includes('atendimentos.edicoes'),
      'MENOR 1: features[] acompanha permissions{} (mesmo precedente de 24/09/2026) — as Edge Functions também enxergam a chave nova',
      { verFeatures: verDepois.features, editarFeatures: editarDepois.features })
  } finally {
    await cli.query('rollback to savepoint prova_pre_concessao')
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
    // ⚠️ RODADA 1 DE CONSERTO: idEditar ganha também `atendimentos.private-edit`
    // — precisa para chamar `vessel_criar_private_edit` (uma das 4 portas do
    // conserto do CRÍTICO) pelas provas novas do passo 10/11.
    // ⚠️ TASK 6: idEditar ganha TAMBÉM `atendimentos.pracas`/`atendimentos.
    // edicoes` — é exatamente a pré-concessão ADITIVA da migration (seção 14):
    // quem já tinha `atendimentos.stylist-circle` (editar) recebe as duas
    // chaves novas no mesmo nível. Sem isto, a esteira inteira (passos 1, 1b,
    // 3-11, que já provam a REGRA DE NEGÓCIO de praça/edição) pararia de
    // funcionar só por causa do recorte de chave — o passo 1c, abaixo, é quem
    // prova o recorte em si, com perfis PRÓPRIOS.
    await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin, disabled) values
        ($1, $2, 'Prova — Stylist Circle (editar)', array['atendimentos.stylist-circle','atendimentos.private-edit','atendimentos'], $3::jsonb, false, false),
        ($4, $5, 'Prova — Stylist Circle (ver)',    array['atendimentos.stylist-circle','atendimentos'], $6::jsonb, false, false)`,
      [idEditar, emailEditar, JSON.stringify({
        'atendimentos.stylist-circle': ['ver', 'editar'], 'atendimentos.private-edit': ['ver', 'editar'],
        'atendimentos.pracas': ['ver', 'editar'], 'atendimentos.edicoes': ['ver', 'editar'],
      }),
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

    // ⚠️ TASK 6 RODADA 1 DE CONSERTO (IMPORTANTE 3): `teste = false` de
    // propósito — `vessel_edicoes_listar.stylists` agora filtra `teste`
    // (mesmo critério de `vessel_pracas_listar`), e o passo 5 (CRÍTICO 1,
    // abaixo) precisa que esta stylist CONTE. Fica dentro do savepoint
    // `prova_funcoes`, desfeito por inteiro no fim — não vaza para dados reais.
    const sty1 = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-EDICAO4-1', 'Prova Edição4 Um', '5519990004001', false) returning id, etapa_id`)
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

    console.log('\n  · 1c) TASK 6 — O RECORTE DE CHAVE: quem TEM atendimentos.pracas/edicoes consegue SEM stylist-circle; quem só tem stylist-circle (sem a chave recortada) é recusado')
    // Num savepoint próprio, desfeito no fim — os mesmos três perfis de
    // mentira do passo 1/2 continuam servindo o resto do arquivo sem que esta
    // praça/edição de prova ('PVR') sobre para as contagens finais.
    await cli.query('savepoint prova_recorte_de_chave')
    try {
      const idSoRecorte = randomUUID(), idSoStylistCircle = randomUUID(), idSoPrivateEdit = randomUUID()
      const emailSoRecorte = `prova-praca-so-recorte-${idSoRecorte}@teste.invalido`
      const emailSoStylistCircle = `prova-praca-so-sty-${idSoStylistCircle}@teste.invalido`
      const emailSoPrivateEdit = `prova-praca-so-pe-${idSoPrivateEdit}@teste.invalido`
      await cli.query(`insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)`,
        [idSoRecorte, emailSoRecorte, idSoStylistCircle, emailSoStylistCircle, idSoPrivateEdit, emailSoPrivateEdit])
      await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin, disabled) values
          ($1, $2, 'Prova — SÓ Praças/Edições (Task 6)',    array['atendimentos.pracas','atendimentos.edicoes'], $3::jsonb, false, false),
          ($4, $5, 'Prova — SÓ Stylist Circle (sem recorte)', array['atendimentos.stylist-circle'], $6::jsonb, false, false),
          ($7, $8, 'Prova — SÓ Private Edit (ver)',          array['atendimentos.private-edit'], $9::jsonb, false, false)`,
        [idSoRecorte, emailSoRecorte, JSON.stringify({ 'atendimentos.pracas': ['ver', 'editar'], 'atendimentos.edicoes': ['ver', 'editar'] }),
         idSoStylistCircle, emailSoStylistCircle, JSON.stringify({ 'atendimentos.stylist-circle': ['ver', 'editar'] }),
         idSoPrivateEdit, emailSoPrivateEdit, JSON.stringify({ 'atendimentos.private-edit': ['ver'] })])

      // (a) quem TEM atendimentos.pracas/atendimentos.edicoes, SEM NENHUM
      // stylist-circle, consegue a esteira INTEIRA de cadastro — prova que o
      // recorte não é decoração: a chave nova sozinha já basta.
      await falarComo(idSoRecorte)
      let x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVR', 'Praça de Prova do Recorte', null])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'praca_criar: quem só tem atendimentos.pracas (sem stylist-circle) CONSEGUE criar', x.v ?? x.e?.message)
      const pracaR = x.v?.id

      x = await chamarGravando(`public.vessel_praca_editar(p_id => $1, p_nome => $2, p_loja_destino => $3, p_ativa => $4)`,
        [pracaR, 'Praça de Prova do Recorte (editada)', 'loja-recorte', true])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'praca_editar: idem, consegue editar', x.v ?? x.e?.message)

      x = await chamarGravando(`public.vessel_praca_cidade_vincular(p_praca_id => $1, p_cidade => $2)`, [pracaR, 'Cidade de Prova do Recorte'])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'praca_cidade_vincular: idem, consegue vincular', x.v ?? x.e?.message)
      const cidadeR = x.v?.id

      x = await chamarGravando(`public.vessel_praca_cidade_desvincular(p_id => $1)`, [cidadeR])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'praca_cidade_desvincular: idem, consegue desvincular', x.v ?? x.e?.message)

      // ⚠️ RODADA 1 DE CONSERTO (MENOR 4): uma SEGUNDA cidade, que fica
      // vinculada (a primeira já foi desvinculada acima, para provar o lado
      // "consegue") — esta é o alvo da recusa em (b), abaixo.
      x = await chamarGravando(`public.vessel_praca_cidade_vincular(p_praca_id => $1, p_cidade => $2)`, [pracaR, 'Cidade de Prova do Recorte (para a recusa)'])
      const cidadeRParaRecusa = x.v?.id

      x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`,
        [pracaR, 'Edição de Prova do Recorte', hoje])
      conferir(x.v?.ok === true && x.v?.numero === 1, 'edicao_criar: idem, consegue criar a edição 1', x.v ?? x.e?.message)
      const edicaoR = x.v?.id

      x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoR])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'edicao_abrir: idem, consegue abrir', x.v ?? x.e?.message)

      x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoR, null])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'edicao_encerrar: idem, consegue encerrar', x.v ?? x.e?.message)

      // a leitura também funciona sem NENHUM stylist-circle
      x = await chamarGravando(`public.vessel_pracas_listar()`, [])
      conferir(!x.e && Array.isArray(x.v), 'pracas_listar: quem só tem atendimentos.pracas (ver) consegue listar', x.e?.message)
      x = await chamarGravando(`public.vessel_edicoes_listar(p_praca_id => $1)`, [pracaR])
      conferir(!x.e && Array.isArray(x.v), 'edicoes_listar: idem, consegue listar', x.e?.message)

      // uma segunda edição, ABERTA, só para a prova (d) abaixo (a primeira já
      // está encerrada).
      x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`,
        [pracaR, 'Edição de Prova do Recorte 2', hoje])
      const edicaoR2 = x.v?.id
      await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoR2])
      await cli.query(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
         values ('STY-PROVA-RECORTE-1', 'Prova Recorte Um', '5519990004098', true) returning id`)

      // (b) quem SÓ TEM atendimentos.stylist-circle (editar) — SEM as chaves
      // recortadas — é RECUSADO nas seis funções de cadastro que agora pedem
      // a chave própria (o cerne da mudança desta tarefa: stylist-circle
      // sozinho deixou de bastar).
      await falarComo(idSoStylistCircle)
      const chamadasRecortadas = [
        ['praca_criar', `public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['ZZQ', 'Zona Q', null]],
        ['praca_editar', `public.vessel_praca_editar(p_id => $1, p_nome => $2, p_loja_destino => $3, p_ativa => $4)`, [pracaR, 'Roubado', null, true]],
        ['praca_cidade_vincular', `public.vessel_praca_cidade_vincular(p_praca_id => $1, p_cidade => $2)`, [pracaR, 'Cidade Roubada']],
        ['praca_cidade_desvincular', `public.vessel_praca_cidade_desvincular(p_id => $1)`, [cidadeRParaRecusa]],
        ['edicao_criar', `public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaR, 'Edição Roubada', hoje]],
        ['edicao_abrir', `public.vessel_edicao_abrir(p_id => $1)`, [edicaoR]],
        ['edicao_encerrar', `public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoR2, null]],
      ]
      for (const [nome, expr, params] of chamadasRecortadas) {
        const { v, e } = await chamarIsolada(expr, params)
        conferir(!e && v?.ok === false && v?.situacao === 'sem_permissao',
          `${nome}: quem só tem atendimentos.stylist-circle (sem a chave recortada) toma sem_permissao — stylist-circle sozinho não basta mais`, e?.message ?? v)
      }

      // (c) mas a LEITURA continua aberta a quem só tem stylist-circle (o OR
      // do brief: "as duas telas grandes precisam da lista para os seletores
      // delas").
      x = await chamarGravando(`public.vessel_pracas_listar()`, [])
      conferir(!x.e && Array.isArray(x.v), 'pracas_listar: quem só tem atendimentos.stylist-circle (ver) AINDA consegue listar (OR mantido)', x.e?.message)

      // (d) vessel_edicao_incluir_stylist é a ÚNICA função de cadastro com o
      // OR explícito no brief ("editar em atendimentos.edicoes OU
      // atendimentos.stylist-circle") — quem só tem stylist-circle (editar)
      // continua incluindo direto pelo quadro.
      x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-RECORTE-1', edicaoR2])
      conferir(x.v?.ok === true && x.v?.situacao === 'ok',
        'edicao_incluir_stylist: quem só tem atendimentos.stylist-circle (editar) AINDA consegue incluir (OR mantido de propósito)', x.v ?? x.e?.message)

      // (e) leitura por quem só tem atendimentos.private-edit (ver) — a outra
      // tela grande do OR.
      await falarComo(idSoPrivateEdit)
      x = await chamarGravando(`public.vessel_pracas_listar()`, [])
      conferir(!x.e && Array.isArray(x.v), 'pracas_listar: quem só tem atendimentos.private-edit (ver) consegue listar (para o seletor dela)', x.e?.message)
    } finally {
      await cli.query('rollback to savepoint prova_recorte_de_chave')
    }

    console.log('\n  · 1d) TASK 11 — abrir/criar/definir praça vinculam a turma automaticamente (o placar não nasce mais zerado)')
    // ⚠️ O BURACO: nenhuma tela chamava `vessel_edicao_incluir_stylist` nem
    // `vessel_stylist_definir_praca` — o placar por edição nascia zerado para
    // sempre, sem erro nenhum. Decisão do dono: "edição = a rodada daquela
    // praça", o vínculo é AUTOMÁTICO. Este bloco prova os quatro caminhos que
    // agora vinculam (abrir, criar, definir_praca, editar mudando a praça) e
    // o que NUNCA pode acontecer (desativada, teste, duplicata, encerrada).
    await falarComo(idEditar)

    // ── praça J: a turma que "abrir" tem de incluir ──────────────────────────
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVJ', 'Praça de Prova J', null])
    conferir(x.v?.ok === true, 'praca_criar: praça J (a turma que "abrir" tem de incluir)', x.v ?? x.e?.message)
    const pracaJ = x.v?.id
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVK', 'Praça de Prova K (outra)', null])
    const pracaK = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaJ, 'Edição J1', hoje])
    const edicaoJ1 = x.v?.id

    // as fixtures direto na tabela (mesmo padrão do resto do arquivo) —
    // ativa/teste variados, para provar quem entra e quem NÃO entra.
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativa, praca_id)
       values ('STY-PROVA-T11-A', 'Prova T11 A', '5519990005001', false, true, $1)`, [pracaJ])
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativa, praca_id)
       values ('STY-PROVA-T11-B', 'Prova T11 B', '5519990005002', false, true, $1)`, [pracaJ])
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativa, praca_id)
       values ('STY-PROVA-T11-C', 'Prova T11 C', '5519990005003', false, true, $1)`, [pracaJ])
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativa, praca_id)
       values ('STY-PROVA-T11-DESATIVADA', 'Prova T11 Desativada', '5519990005004', false, false, $1)`, [pracaJ])
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativa, praca_id)
       values ('STY-PROVA-T11-TESTE', 'Prova T11 Teste', '5519990005005', true, true, $1)`, [pracaJ])
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativa, praca_id)
       values ('STY-PROVA-T11-JATEM', 'Prova T11 Já Tem Vínculo', '5519990005006', false, true, $1)`, [pracaJ])
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativa, praca_id)
       values ('STY-PROVA-T11-OUTRAPRACA', 'Prova T11 Outra Praça', '5519990005007', false, true, $1)`, [pracaK])

    // já vinculada ANTES de abrir (a 'planejada' aceita incluir à mão) — não
    // pode virar linha duplicada quando "abrir" processar a turma inteira.
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-T11-JATEM', edicaoJ1])
    conferir(x.v?.ok === true, 'edicao_incluir_stylist: a stylist "já tem" entra à mão, antes de abrir', x.v ?? x.e?.message)

    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoJ1])
    conferir(x.v?.ok === true && x.v?.situacao === 'ok' && x.v?.incluidas === 3,
      'edicao_abrir: incluidas=3 — A, B e C (a desativada, a de teste, a já-vinculada e a de outra praça NÃO contam)', x.v ?? x.e?.message)

    const vinculadosJ1 = await todas(`select s.codigo from public.vessel_stylist_na_edicao n
       join public.vessel_stylists s on s.id = n.stylist_id
      where n.edicao_id = $1 and n.saiu_em is null order by s.codigo`, [edicaoJ1])
    const codigosVinculadosJ1 = vinculadosJ1.map((l) => l.codigo).sort()
    conferir(JSON.stringify(codigosVinculadosJ1) === JSON.stringify(['STY-PROVA-T11-A', 'STY-PROVA-T11-B', 'STY-PROVA-T11-C', 'STY-PROVA-T11-JATEM']),
      'só A, B, C e a já-vinculada estão em J1 — a desativada, a de teste e a de outra praça ficaram de fora', codigosVinculadosJ1)

    // a PROVA QUE FECHA O ASSUNTO: o placar nasce com gente, não zerado.
    let placar = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoJ1])
    conferir(placar.v?.prospectadas === 4, 'vessel_placar_da_edicao: prospectadas=4 — o placar NASCE COM GENTE (A+B+C+já-vinculada), não zerado para sempre', placar.v)
    const somaDasEtapasJ1 = (placar.v?.etapas || []).reduce((soma, et) => soma + (et.stylists || 0), 0)
    conferir(somaDasEtapasJ1 === 4, 'e a soma das etapas do placar bate com a turma (4) — distribuída de verdade pelas etapas, não um número solto', { etapas: placar.v?.etapas, soma: somaDasEtapasJ1 })

    // ── criar stylist: com edição aberta (vincula) e sem edição aberta (não vincula, não é erro) ──
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVL', 'Praça de Prova L', null])
    const pracaL = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaL, 'Edição L1', hoje])
    const edicaoL1 = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoL1])
    conferir(x.v?.ok === true && x.v?.incluidas === 0, 'edicao_abrir: praça L nasce sem ninguém — incluidas=0 (praça vazia ainda, não é erro)', x.v ?? x.e?.message)

    x = await chamarGravando(`public.vessel_stylist_criar(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_origem_contato => $4)`,
      ['Prova T11 Criada Com Edição Aberta', '5519990005008', 'PVL', 'indicacao'])
    conferir(x.v?.ok === true, 'stylist_criar: nasce na praça L (que tem edição aberta)', x.v ?? x.e?.message)
    const codigoCriadaComAberta = x.v?.codigo
    const vinculoCriadaComAberta = await r(`(select exists(select 1 from public.vessel_stylist_na_edicao n
       join public.vessel_stylists s on s.id = n.stylist_id where s.codigo = $1 and n.edicao_id = $2 and n.saiu_em is null))`,
      [codigoCriadaComAberta, edicaoL1])
    conferir(vinculoCriadaComAberta === true, 'e já nasce vinculada à edição aberta de L, sem chamar mais nada', vinculoCriadaComAberta)

    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVM', 'Praça de Prova M (sem edição aberta)', null])
    const pracaM = x.v?.id
    await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaM, 'Edição M1 (planejada)', hoje])
    // ⚠️ de propósito NÃO abro a edição M1 — a praça M fica sem edição aberta.

    x = await chamarGravando(`public.vessel_stylist_criar(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_origem_contato => $4)`,
      ['Prova T11 Criada Sem Edição Aberta', '5519990005009', 'PVM', 'indicacao'])
    conferir(x.v?.ok === true, 'stylist_criar: nasce na praça M (SEM edição aberta) — e isso não é erro', x.v ?? x.e?.message)
    const codigoCriadaSemAberta = x.v?.codigo
    const semVinculoNenhum = await r(`(select count(*)::int from public.vessel_stylist_na_edicao n
       join public.vessel_stylists s on s.id = n.stylist_id where s.codigo = $1)`, [codigoCriadaSemAberta])
    conferir(semVinculoNenhum === 0, 'e nasce SEM vínculo nenhum (nenhuma edição aberta para entrar)', semVinculoNenhum)

    // ── definir/mudar praça vincula à edição aberta da praça nova ────────────
    const styParaDefinir = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-T11-DEFINIR', 'Prova T11 Definir Praça', '5519990005010', false) returning id`)
    x = await chamarGravando(`public.vessel_stylist_definir_praca(p_codigo => $1, p_praca_id => $2)`, ['STY-PROVA-T11-DEFINIR', pracaL])
    conferir(x.v?.ok === true, 'stylist_definir_praca: define a praça L (que tem edição aberta)', x.v ?? x.e?.message)
    const vinculoDefinirPraca = await r(`(select exists(select 1 from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2 and saiu_em is null))`,
      [styParaDefinir.id, edicaoL1])
    conferir(vinculoDefinirPraca === true, 'e fica vinculada à edição aberta de L', vinculoDefinirPraca)

    const styParaEditar = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-T11-EDITAR', 'Prova T11 Editar Praça', '5519990005011', false) returning id`)
    x = await chamarGravando(`public.vessel_stylist_editar(p_codigo => $1, p_praca => $2)`, ['STY-PROVA-T11-EDITAR', 'PVL'])
    conferir(x.v?.ok === true, 'stylist_editar: muda a praça para L (que tem edição aberta)', x.v ?? x.e?.message)
    const vinculoEditarPraca = await r(`(select exists(select 1 from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2 and saiu_em is null))`,
      [styParaEditar.id, edicaoL1])
    conferir(vinculoEditarPraca === true, 'e fica vinculada à edição aberta de L', vinculoEditarPraca)

    // idempotência: chamar de novo (mesma praça) não duplica o vínculo.
    // ⚠️ RODADA 1 DE CONSERTO (MENOR a): confere `ok` também — só contar
    // linhas passaria verde mesmo se a chamada tivesse devolvido `ok:false`
    // por algum motivo (a linha continuaria em 1, mas por não ter feito nada).
    x = await chamarGravando(`public.vessel_stylist_definir_praca(p_codigo => $1, p_praca_id => $2)`, ['STY-PROVA-T11-DEFINIR', pracaL])
    conferir(x.v?.ok === true, 'stylist_definir_praca: a SEGUNDA chamada (mesma praça) também devolve ok:true', x.v ?? x.e?.message)
    const linhasDefinirDeNovo = await r(`(select count(*)::int from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2)`,
      [styParaDefinir.id, edicaoL1])
    conferir(linhasDefinirDeNovo === 1, 'e definir a MESMA praça de novo não duplica o vínculo (on conflict do nothing)', linhasDefinirDeNovo)

    // ── CRÍTICO 1 (Rodada 1 de conserto): mudar de praça NÃO pode deixar a
    // MESMA stylist contando em duas edições ABERTAS ao mesmo tempo. Prova
    // dos dois lados: com a edição de origem ABERTA, o vínculo antigo fecha
    // e o placar da origem perde a pessoa; com a edição de origem
    // ENCERRADA, nada nela muda.
    console.log('\n  · 1d-bis) CRÍTICO 1: mudar de praça fecha o vínculo da edição de origem SE ela estiver aberta; se estiver encerrada, não mexe')

    // (a) origem ABERTA: o vínculo fecha, o placar da origem perde a pessoa.
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVO', 'Praça de Prova O (origem aberta)', null])
    const pracaO = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaO, 'Edição O1', hoje])
    const edicaoO1 = x.v?.id
    await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoO1])
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVP', 'Praça de Prova P (destino)', null])
    const pracaP = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaP, 'Edição P1', hoje])
    const edicaoP1 = x.v?.id
    await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoP1])

    x = await chamarGravando(`public.vessel_stylist_criar(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_origem_contato => $4)`,
      ['Prova T11 Crítico1 Origem Aberta', '5519990005016', 'PVO', 'indicacao'])
    conferir(x.v?.ok === true, 'stylist_criar: nasce na praça O (edição O1 aberta) — já entra em O1', x.v ?? x.e?.message)
    const codigoCritico1 = x.v?.codigo
    const stCritico1Id = await r(`(select id from public.vessel_stylists where codigo = $1)`, [codigoCritico1])

    const placarO1Antes = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoO1])
    conferir(placarO1Antes.v?.prospectadas === 1, 'placar de O1 ANTES de mudar a praça: 1 (a stylist recém-criada)', placarO1Antes.v?.prospectadas)

    x = await chamarGravando(`public.vessel_stylist_editar(p_codigo => $1, p_praca => $2)`, [codigoCritico1, 'PVP'])
    conferir(x.v?.ok === true, 'stylist_editar: muda a praça de O para P (as duas com edição ABERTA)', x.v ?? x.e?.message)

    const vinculoO1DepoisDaMudanca = await uma(`select saiu_em from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2`,
      [stCritico1Id, edicaoO1])
    conferir(vinculoO1DepoisDaMudanca?.saiu_em != null,
      'CRÍTICO 1: o vínculo ANTIGO (O1, que estava aberta) fica FECHADO (saiu_em preenchido) depois da mudança de praça', vinculoO1DepoisDaMudanca)

    const placarO1Depois = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoO1])
    conferir(placarO1Depois.v?.prospectadas === 0,
      'CRÍTICO 1: o placar de O1 (origem, ainda aberta) PERDE a pessoa — não conta mais em duas edições abertas ao mesmo tempo', placarO1Depois.v?.prospectadas)
    const placarP1Depois = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoP1])
    conferir(placarP1Depois.v?.prospectadas === 1, 'e o placar de P1 (destino) passa a contar 1 — a pessoa está só numa aberta agora', placarP1Depois.v?.prospectadas)

    // (b) origem ENCERRADA: nada nela muda quando a stylist troca de praça.
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVQ', 'Praça de Prova Q (origem encerrada)', null])
    const pracaQ = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaQ, 'Edição Q1', hoje])
    const edicaoQ1 = x.v?.id
    await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoQ1])
    x = await chamarGravando(`public.vessel_stylist_criar(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_origem_contato => $4)`,
      ['Prova T11 Crítico1 Origem Encerrada', '5519990005017', 'PVQ', 'indicacao'])
    const codigoCritico1b = x.v?.codigo
    const stCritico1bId = await r(`(select id from public.vessel_stylists where codigo = $1)`, [codigoCritico1b])
    x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoQ1, null])
    conferir(x.v?.ok === true, 'edicao_encerrar: encerra Q1 (congela quem estava lá, inclusive esta stylist)', x.v ?? x.e?.message)
    const vinculoQ1AntesDaMudanca = await uma(`select saiu_em, etapa_ao_sair from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2`,
      [stCritico1bId, edicaoQ1])
    conferir(vinculoQ1AntesDaMudanca?.saiu_em != null, 'o vínculo em Q1 já está fechado pelo PRÓPRIO encerramento (o congelamento de sempre)', vinculoQ1AntesDaMudanca)

    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVS', 'Praça de Prova S (destino, para o caso encerrado)', null])
    const pracaS = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaS, 'Edição S1', hoje])
    const edicaoS1 = x.v?.id
    await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoS1])

    x = await chamarGravando(`public.vessel_stylist_definir_praca(p_codigo => $1, p_praca_id => $2)`, [codigoCritico1b, pracaS])
    conferir(x.v?.ok === true, 'stylist_definir_praca: muda a praça de Q (edição ENCERRADA) para S (edição ABERTA)', x.v ?? x.e?.message)

    const vinculoQ1DepoisDaMudanca = await uma(`select saiu_em, etapa_ao_sair from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2`,
      [stCritico1bId, edicaoQ1])
    conferir(JSON.stringify(vinculoQ1DepoisDaMudanca) === JSON.stringify(vinculoQ1AntesDaMudanca),
      'CRÍTICO 1: o vínculo em Q1 (encerrada) fica EXATAMENTE como estava — mudar de praça não mexe em edição encerrada',
      { antes: vinculoQ1AntesDaMudanca, depois: vinculoQ1DepoisDaMudanca })
    const vinculoS1 = await r(`(select exists(select 1 from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2 and saiu_em is null))`,
      [stCritico1bId, edicaoS1])
    conferir(vinculoS1 === true, 'e ela fica vinculada normalmente à edição aberta de S — só a parte "fechar o antigo" que fica de fora quando ele já está encerrado', vinculoS1)

    // ── edição encerrada continua intocada em todos esses caminhos ───────────
    x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoJ1, null])
    conferir(x.v?.ok === true, 'edicao_encerrar: encerra J1 (a praça J fica sem edição aberta)', x.v ?? x.e?.message)
    const linhasJ1Antes = await r(`(select count(*)::int from public.vessel_stylist_na_edicao where edicao_id = $1)`, [edicaoJ1])

    x = await chamarGravando(`public.vessel_stylist_criar(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_origem_contato => $4)`,
      ['Prova T11 Criada Com J Encerrada', '5519990005012', 'PVJ', 'indicacao'])
    conferir(x.v?.ok === true, 'stylist_criar: nasce na praça J (a única edição dela está ENCERRADA) — não é erro', x.v ?? x.e?.message)
    const codigoComJEncerrada = x.v?.codigo
    const semVinculoComJEncerrada = await r(`(select count(*)::int from public.vessel_stylist_na_edicao n
       join public.vessel_stylists s on s.id = n.stylist_id where s.codigo = $1)`, [codigoComJEncerrada])
    conferir(semVinculoComJEncerrada === 0, 'e nasce sem vínculo nenhum — edição encerrada NÃO aceita gente nova', semVinculoComJEncerrada)

    const styParaDefinirJEncerrada = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-T11-DEFINIR-J-ENCERRADA', 'Prova T11 Definir com J Encerrada', '5519990005013', false) returning id`)
    await chamarGravando(`public.vessel_stylist_definir_praca(p_codigo => $1, p_praca_id => $2)`, ['STY-PROVA-T11-DEFINIR-J-ENCERRADA', pracaJ])
    const semVinculoDefinirJEncerrada = await r(`(select count(*)::int from public.vessel_stylist_na_edicao where stylist_id = $1)`, [styParaDefinirJEncerrada.id])
    conferir(semVinculoDefinirJEncerrada === 0, 'definir a praça J (só tem edição encerrada) também não vincula ninguém', semVinculoDefinirJEncerrada)

    const linhasJ1Depois = await r(`(select count(*)::int from public.vessel_stylist_na_edicao where edicao_id = $1)`, [edicaoJ1])
    conferir(linhasJ1Depois === linhasJ1Antes, 'e a CONTAGEM de vínculos de J1 (encerrada) não mudou nem um pouco com nada disso',
      { antes: linhasJ1Antes, depois: linhasJ1Depois })

    // ── IMPORTANTE 4: o ciclo da rodada — encerrar J1 → criar J2 → abrir J2.
    // É o caminho que o sistema percorre TODO MÊS: quem sobrou (não ativou,
    // ficou congelada em J1) tem de entrar em J2 com uma linha NOVA quando
    // a próxima rodada abrir — não pelo `levar_para` do encerrar (que aqui
    // foi chamado com `null`), mas pela MESMA inclusão automática de
    // `vessel_edicao_abrir` que a Task 11 inteira existe para provar.
    console.log('\n  · 1d-ter) IMPORTANTE 4: o ciclo da rodada — encerrar J1 → criar J2 → abrir J2 (quem sobrou entra com linha NOVA, J1 não muda, ninguém duplica)')
    const linhasJ1AntesDoCiclo = await todas(`select stylist_id, saiu_em, etapa_ao_sair from public.vessel_stylist_na_edicao where edicao_id = $1 order by stylist_id`, [edicaoJ1])
    // ⚠️ contagem INDEPENDENTE (não vem de `incluidas`, a função sob teste):
    // como J2 ainda nem existe, TODA stylist ativa/não-teste da praça J é
    // elegível — ninguém pode ter uma linha para um `edicao_id` que ainda
    // não foi criado.
    const elegiveisPracaJ = await r(`(select count(*)::int from public.vessel_stylists
       where praca_id = $1 and coalesce(ativa, true) and not coalesce(teste, false))`, [pracaJ])

    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaJ, 'Edição J2', hoje])
    conferir(x.v?.ok === true && x.v?.numero === 2, 'edicao_criar: J2 nasce como a edição 2 da praça J', x.v ?? x.e?.message)
    const edicaoJ2 = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoJ2])
    conferir(x.v?.ok === true && x.v?.incluidas === elegiveisPracaJ,
      `edicao_abrir: J2 inclui TODA a turma elegível de praça J de novo (${elegiveisPracaJ}, contado por fora) — quem sobrou de J1 entra com linha NOVA`,
      { incluidas: x.v?.incluidas, esperado: elegiveisPracaJ })

    // (a) A, B, C e a já-vinculada (as quatro que ficaram em J1, sem ativar)
    // entram em J2 com um vínculo NOVO e aberto.
    const linhasOriginaisEmJ2 = await todas(`select s.codigo, n.saiu_em from public.vessel_stylist_na_edicao n
       join public.vessel_stylists s on s.id = n.stylist_id
      where n.edicao_id = $1 and s.codigo in ('STY-PROVA-T11-A', 'STY-PROVA-T11-B', 'STY-PROVA-T11-C', 'STY-PROVA-T11-JATEM')
      order by s.codigo`, [edicaoJ2])
    conferir(linhasOriginaisEmJ2.length === 4 && linhasOriginaisEmJ2.every((l) => l.saiu_em === null),
      '(a) A, B, C e a já-vinculada — que sobraram de J1 sem ativar — entram em J2 com vínculo NOVO e aberto (saiu_em nulo)', linhasOriginaisEmJ2)

    // (b) J1 não ganha nem perde NADA com o ciclo — byte a byte a mesma coisa.
    const linhasJ1DepoisDoCiclo = await todas(`select stylist_id, saiu_em, etapa_ao_sair from public.vessel_stylist_na_edicao where edicao_id = $1 order by stylist_id`, [edicaoJ1])
    conferir(JSON.stringify(linhasJ1DepoisDoCiclo) === JSON.stringify(linhasJ1AntesDoCiclo),
      '(b) J1 não ganha nem perde NADA com o ciclo — as linhas dela continuam byte a byte as mesmas', { antes: linhasJ1AntesDoCiclo, depois: linhasJ1DepoisDoCiclo })

    // (c) ninguém duplica: cada uma das quatro tem EXATAMENTE 2 linhas na
    // praça J inteira (a de J1, fechada, e a de J2, aberta).
    const contagemPorStylistNaPracaJ = await todas(`select s.codigo, count(*)::int as n from public.vessel_stylist_na_edicao nn
       join public.vessel_stylists s on s.id = nn.stylist_id
       join public.vessel_stylist_circle_edicoes ed on ed.id = nn.edicao_id
      where ed.praca_id = $1 and s.codigo in ('STY-PROVA-T11-A', 'STY-PROVA-T11-B', 'STY-PROVA-T11-C', 'STY-PROVA-T11-JATEM')
      group by s.codigo order by s.codigo`, [pracaJ])
    conferir(contagemPorStylistNaPracaJ.every((c) => c.n === 2),
      '(c) ninguém duplica: cada uma das quatro tem EXATAMENTE 2 linhas na praça J (a de J1 fechada + a de J2 aberta)', contagemPorStylistNaPracaJ)

    console.log('\n  · 1e) mutação de propósito: tirando a inclusão automática de vessel_edicao_abrir, o placar nasce ZERADO — a divergência que este achado existia para eliminar')
    await cli.query('savepoint prova_mutacao_turma')
    try {
      const funcaoBoaAbrir = (await uma(`select pg_get_functiondef('public.vessel_edicao_abrir(bigint)'::regprocedure) as def`)).def
      const trechoInclusao = /insert into public\.vessel_stylist_na_edicao \(stylist_id, edicao_id\)\s*select s\.id, p_id[\s\S]*?get diagnostics v_incluidas = row_count;\n/
      if (!trechoInclusao.test(funcaoBoaAbrir)) throw new Error('a mutação não achou o trecho da inclusão automática em vessel_edicao_abrir — o texto da função mudou')
      const funcaoQuebrada = funcaoBoaAbrir.replace(trechoInclusao, '')
      await cli.query(funcaoQuebrada)

      x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVN', 'Praça de Prova N (mutada)', null])
      const pracaN = x.v?.id
      await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativa, praca_id)
         values ('STY-PROVA-T11-N', 'Prova T11 N', '5519990005014', false, true, $1)`, [pracaN])
      x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaN, 'Edição N1', hoje])
      const edicaoN1 = x.v?.id
      x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoN1])
      const incluidasQuebrada = x.v?.incluidas
      const placarN1 = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoN1])
      const zerou = incluidasQuebrada === 0 && placarN1.v?.prospectadas === 0
      console.log(`    ${zerou ? '✗' : '✓'} SEM a inclusão automática: incluidas=${incluidasQuebrada}, placar.prospectadas=${placarN1.v?.prospectadas} ${zerou ? '— ZEROU, é o defeito que este achado existia para eliminar' : '(inesperado)'}`)
      conferir(zerou === true,
        'MUTAÇÃO: sem a inclusão automática em vessel_edicao_abrir, a praça N tem 1 stylist elegível mas o placar nasce ZERADO — a divergência exata do buraco estrutural',
        { incluidasQuebrada, prospectadas: placarN1.v?.prospectadas })
    } finally {
      await cli.query('rollback to savepoint prova_mutacao_turma')
    }

    // com a função REAL (inclusão automática restaurada), o MESMO tipo de cenário não zera.
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVN', 'Praça de Prova N (restaurada)', null])
    const pracaNR = x.v?.id
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativa, praca_id)
       values ('STY-PROVA-T11-NR', 'Prova T11 N Restaurada', '5519990005015', false, true, $1)`, [pracaNR])
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaNR, 'Edição NR1', hoje])
    const edicaoNR1 = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoNR1])
    const incluidasRestaurada = x.v?.incluidas
    const placarNR1 = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoNR1])
    const restaurouCerto = incluidasRestaurada === 1 && placarNR1.v?.prospectadas === 1
    console.log(`    ${restaurouCerto ? '✓' : '✗'} COM a inclusão automática (restaurada): incluidas=${incluidasRestaurada}, placar.prospectadas=${placarNR1.v?.prospectadas} ${restaurouCerto ? '— bate certo' : '— ZEROU, bug de volta!'}`)
    conferir(restaurouCerto === true, 'COM a inclusão automática restaurada: o placar da praça N nasce com 1 (não mais zero)',
      { incluidasRestaurada, prospectadas: placarNR1.v?.prospectadas })

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
    // ⚠️ TASK 6: a trava de `vessel_praca_cidade_desvincular` recortou de
    // 'atendimentos.stylist-circle' para 'atendimentos.pracas' (migration,
    // seção 14) — o regex segue a MESMA chave que a função confere hoje.
    const trechoDoPortao = /if not public\.vessel_pode\('atendimentos\.pracas', 'editar'\) then[\s\S]*?end if;\n/
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

    // ⚠️ TASK 6 RODADA 2 DE CONSERTO: `teste = false` — antes eram `true`, e
    // `vessel_edicao_encerrar` agora filtra `teste` (a correção do I3
    // incompleto, abaixo): com `true` esta stylist deixaria de ser fechada/
    // levada, e `levadas` viraria 0 em vez de 1 — a prova de baixo achou isso
    // rodando (não deduzindo), exatamente como pedido.
    const naoAtivada = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-LEVAR-NAOATIVOU', 'Prova Não Ativou', '5519990004003', false) returning id, etapa_id`)
    const ativada = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste, ativada_em)
       values ('STY-PROVA-LEVAR-ATIVOU', 'Prova Ativou', '5519990004004', false, now()) returning id, etapa_id`)

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

    console.log('\n  · 8c) TASK 6 RODADA 2 — I3 INCOMPLETO: stylist de teste não conta em nao_ativadas E não é levada por vessel_edicao_encerrar (o mesmo critério nos dois lados)')
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVG', 'Praça de Prova G', null])
    conferir(x.v?.ok === true, 'praca_criar: praça G para o teste do I3 incompleto', x.v ?? x.e?.message)
    const pracaG = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaG, 'Origem G', hoje])
    const edicaoOrigemG = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoOrigemG])
    conferir(x.v?.ok === true, 'edicao_abrir: abre a edição origem da praça G', x.v ?? x.e?.message)
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaG, 'Destino G', hoje])
    const edicaoDestinoG = x.v?.id

    const stTesteG = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-I3-TESTE', 'Prova I3 Teste', '5519990004009', true) returning id`)
    const stRealG = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-I3-REAL', 'Prova I3 Real', '5519990004010', false) returning id`)

    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-I3-TESTE', edicaoOrigemG])
    conferir(x.v?.ok === true, 'inclui a stylist de TESTE (não ativada) na edição origem G', x.v ?? x.e?.message)
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-I3-REAL', edicaoOrigemG])
    conferir(x.v?.ok === true, 'inclui a stylist REAL (não ativada) na edição origem G', x.v ?? x.e?.message)

    // (1) nao_ativadas conta só a REAL — a de teste não entra (nem em stylists).
    const listaG = await chamarGravando(`public.vessel_edicoes_listar(p_praca_id => $1)`, [pracaG])
    const edicaoGListada = listaG.v?.find((e) => e.id === edicaoOrigemG)
    conferir(edicaoGListada?.nao_ativadas === 1 && edicaoGListada?.stylists === 1,
      'vessel_edicoes_listar: nao_ativadas=1 e stylists=1 — a stylist de TESTE não conta em nenhum dos dois', edicaoGListada)

    // (2) encerrar: levadas tem de bater com o nao_ativadas que a tela já mostrou — 1, não 2.
    x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoOrigemG, edicaoDestinoG])
    conferir(x.v?.ok === true && x.v?.levadas === 1,
      'edicao_encerrar: levadas=1 — bate com o nao_ativadas que a tela mostrou ANTES de confirmar (não 2)', x.v ?? x.e?.message)

    // (3) a REAL foi levada; a de TESTE não apareceu no destino.
    const realNoDestino = await r(`(select exists(select 1 from public.vessel_stylist_na_edicao where edicao_id = $1 and stylist_id = $2 and saiu_em is null))`,
      [edicaoDestinoG, stRealG.id])
    conferir(realNoDestino === true, 'a stylist REAL está ativa na edição de destino (foi levada)', realNoDestino)
    const testeNoDestino = await r(`(select exists(select 1 from public.vessel_stylist_na_edicao where edicao_id = $1 and stylist_id = $2))`,
      [edicaoDestinoG, stTesteG.id])
    conferir(testeNoDestino === false, 'a stylist de TESTE NÃO foi levada — nenhum vínculo dela na edição de destino', testeNoDestino)

    console.log('\n  · 8d) mutação de propósito: tirando o filtro de teste de vessel_edicao_encerrar, a stylist de teste TAMBÉM é levada — a divergência exata que a revisão descreveu')
    await cli.query('savepoint prova_mutacao_teste_i3')
    try {
      const funcaoBoaEncerrarI3 = (await uma(
        `select pg_get_functiondef('public.vessel_edicao_encerrar(bigint,bigint)'::regprocedure) as def`)).def
      const trechoFechados = `n.saiu_em is null\n       and not coalesce(s.teste, false)`
      const trechoInsert = `and p_levar_para is not null and not coalesce(f.teste, false)`
      if (!funcaoBoaEncerrarI3.includes(trechoFechados)) throw new Error('a mutação não achou o trecho do filtro de teste em `fechados`')
      if (!funcaoBoaEncerrarI3.includes(trechoInsert)) throw new Error('a mutação não achou o trecho do filtro de teste no insert')
      const funcaoQuebradaI3 = funcaoBoaEncerrarI3
        .replace(trechoFechados, 'n.saiu_em is null')
        .replace(trechoInsert, 'and p_levar_para is not null')
      await cli.query(funcaoQuebradaI3)

      x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVH', 'Praça de Prova H (mutada)', null])
      const pracaH = x.v?.id
      x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaH, 'Origem H', hoje])
      const edicaoOrigemH = x.v?.id
      x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoOrigemH])
      x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaH, 'Destino H', hoje])
      const edicaoDestinoH = x.v?.id
      await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
         values ('STY-PROVA-I3-TESTE-MUT', 'Prova I3 Teste Mutação', '5519990004011', true)`)
      await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
         values ('STY-PROVA-I3-REAL-MUT', 'Prova I3 Real Mutação', '5519990004012', false)`)
      await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-I3-TESTE-MUT', edicaoOrigemH])
      await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-I3-REAL-MUT', edicaoOrigemH])

      // `vessel_edicoes_listar` NÃO foi mutada aqui — só `vessel_edicao_encerrar`.
      // Por isso `nao_ativadas` continua dizendo o número certo (1): é exatamente
      // a divergência que a revisão descreveu — a TELA promete 1, o BANCO leva 2.
      const listaHAntes = await chamarGravando(`public.vessel_edicoes_listar(p_praca_id => $1)`, [pracaH])
      const naoAtivadasPrometido = listaHAntes.v?.find((e) => e.id === edicaoOrigemH)?.nao_ativadas

      x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoOrigemH, edicaoDestinoH])
      const divergiu = naoAtivadasPrometido === 1 && x.v?.levadas === 2
      console.log(`    ${divergiu ? '✗' : '✓'} SEM o filtro de teste: a tela prometeu ${naoAtivadasPrometido} e o banco levou ${x.v?.levadas} ${divergiu ? '— DIVERGIU, é o bug que a revisão pediu para eliminar' : '(inesperado)'}`)
      conferir(divergiu === true,
        'MUTAÇÃO: sem o filtro de teste em vessel_edicao_encerrar, a stylist de teste TAMBÉM é levada — nao_ativadas prometeu 1, o banco levou 2 (a divergência que a revisão descreveu)',
        { naoAtivadasPrometido, levadas: x.v?.levadas })
    } finally {
      // Desfaz a mutação (restaura a função) E toda a praça/edições/stylists da demonstração.
      await cli.query('rollback to savepoint prova_mutacao_teste_i3')
    }

    // com a função REAL (filtro de teste restaurado), o MESMO tipo de cenário não diverge mais.
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVH', 'Praça de Prova H (restaurada)', null])
    const pracaHR = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaHR, 'Origem H', hoje])
    const edicaoOrigemHR = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoOrigemHR])
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaHR, 'Destino H', hoje])
    const edicaoDestinoHR = x.v?.id
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-I3-TESTE-RESTAURADA', 'Prova I3 Teste Restaurada', '5519990004013', true)`)
    await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-I3-REAL-RESTAURADA', 'Prova I3 Real Restaurada', '5519990004014', false)`)
    await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-I3-TESTE-RESTAURADA', edicaoOrigemHR])
    await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-I3-REAL-RESTAURADA', edicaoOrigemHR])
    const listaHRAntes = await chamarGravando(`public.vessel_edicoes_listar(p_praca_id => $1)`, [pracaHR])
    const naoAtivadasHR = listaHRAntes.v?.find((e) => e.id === edicaoOrigemHR)?.nao_ativadas
    x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoOrigemHR, edicaoDestinoHR])
    const bateCertoRestaurado = naoAtivadasHR === 1 && x.v?.levadas === 1
    console.log(`    ${bateCertoRestaurado ? '✓' : '✗'} COM o filtro restaurado: a tela prometeu ${naoAtivadasHR} e o banco levou ${x.v?.levadas} ${bateCertoRestaurado ? '— bate certo' : '— DIVERGIU, bug de volta!'}`)
    conferir(bateCertoRestaurado === true,
      'COM o filtro de teste restaurado: nao_ativadas e levadas batem (1 e 1) — a stylist de teste não conta nem é levada',
      { naoAtivadasHR, levadas: x.v?.levadas })

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

    // ⚠️ TASK 6 RODADA 2 DE CONSERTO: `teste = false` — pelo mesmo motivo do
    // passo 7, acima: `teste = true` faria `vessel_edicao_encerrar` (com o
    // filtro novo) nem tentar levar/fechar esta stylist, e o cenário de
    // conflito que este passo existe para provar nunca aconteceria.
    const stConflito = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-CONFLITO', 'Prova Conflito Levar', '5519990004005', false) returning id`)

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
      // ⚠️ TASK 6 RODADA 2 DE CONSERTO: `teste = false`, mesmo motivo.
      await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
         values ('STY-PROVA-CONFLITO-MUT', 'Prova Conflito Mutação', '5519990004006', false)`)
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
    // ⚠️ TASK 6 RODADA 3 DE CONSERTO: `teste = false` — com `true` (como
    // estava) o filtro novo de `vessel_edicao_encerrar` (Rodada 2) exclui
    // esta stylist de `fechados` por INTEIRO, e o caminho que este bloco
    // existe para provar (o `on conflict` restaurado NÃO estourando no
    // cenário real de conflito) nunca é percorrido — a conferência
    // `restaurouSemErro` passava VAZIA (nada aconteceu, `ok:true` por não
    // fazer nada). Com `false`, a stylist entra em `fechados` de verdade.
    const stConflitoRestaurada = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste)
       values ('STY-PROVA-CONFLITO-RESTAURADA', 'Prova Conflito Restaurada', '5519990004007', false) returning id`)
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-CONFLITO-RESTAURADA', edicaoOrigemFRestaurada])
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-CONFLITO-RESTAURADA', edicaoDestinoFRestaurada])
    x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoOrigemFRestaurada, edicaoDestinoFRestaurada])
    const restaurouSemErro = !x.e && x.v?.ok === true
    console.log(`    ${restaurouSemErro ? '✓' : '✗'} COM o \`on conflict\` (restaurado): o mesmo cenário ${restaurouSemErro ? 'não estourou, como tem de ser' : 'quebrou — bug!'} → ${JSON.stringify(x.v ?? x.e?.message)}`)
    conferir(restaurouSemErro === true, 'COM o `on conflict` restaurado: edicao_encerrar não estoura no mesmo cenário de conflito', x.v ?? x.e?.message)
    // ⚠️ RODADA 3: prova de que o caminho foi REALMENTE percorrido (não uma
    // passagem vazia) — `levadas` continua 0 aqui DE PROPÓSITO (ela já
    // estava no destino, o `on conflict` barra a segunda linha — a mesma
    // regra do passo 9), mas o vínculo de ORIGEM tem de estar FECHADO
    // (`saiu_em` preenchido): só acontece se `fechados` processou a stylist
    // de verdade, e só é possível com `teste = false`.
    conferir(x.v?.levadas === 0, 'e `levadas` é 0 — ela já estava no destino, não conflito duplicado (mesma regra do passo 9)', x.v)
    const origemFRestauradaFechada = await r(`(select saiu_em is not null from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2)`,
      [stConflitoRestaurada.id, edicaoOrigemFRestaurada])
    conferir(origemFRestauradaFechada === true,
      'e o vínculo de ORIGEM foi REALMENTE fechado (prova que `fechados` processou a stylist — o caminho não passou vazio)', origemFRestauradaFechada)
    const linhasNoDestinoFRestaurada = await r(`(select count(*)::int from public.vessel_stylist_na_edicao where stylist_id = $1 and edicao_id = $2)`,
      [stConflitoRestaurada.id, edicaoDestinoFRestaurada])
    conferir(linhasNoDestinoFRestaurada === 1, 'e continua com UMA linha só na edição de destino (sem duplicar)', linhasNoDestinoFRestaurada)

    console.log('\n  · 10) TASK 5: vessel_rastreio_dos_stylists — assinatura nova (sem fantasma) e recorte por praça/edição')
    // Chamada como o PostgREST FAZ: parâmetros por NOME. Só os dois de
    // sempre — exatamente o que tela-de-stylist-circle.vue e
    // tela-de-material-grafico.vue mandam hoje.
    const chamadaAntiga = await chamarGravando(
      `public.vessel_rastreio_dos_stylists(p_dias => $1, p_incluir_desativadas => $2)`, [7, true])
    conferir(!chamadaAntiga.e && Array.isArray(chamadaAntiga.v),
      'a chamada com SÓ os 2 parâmetros de sempre (por nome) continua respondendo depois do drop — a Central não quebra', chamadaAntiga.e?.message ?? 'ok')

    const assinaturas = await todas(`select p.pronargs from pg_proc p
       where p.proname = 'vessel_rastreio_dos_stylists' and p.pronamespace = 'public'::regnamespace`)
    conferir(assinaturas.length === 1 && assinaturas[0].pronargs === 4,
      'só existe UMA vessel_rastreio_dos_stylists no catálogo, com 4 parâmetros — a de 2 foi dropada, sem fantasma para o PostgREST escolher entre duas', assinaturas)

    console.log('\n  · 10a) RODADA 1 DE CONSERTO — CRÍTICO: a praça deixa de ser lista fechada, provado pelas 4 PORTAS DE VERDADE')
    // ⚠️ Nada de praça fabricada: LIM (Limeira) e PIR (Piracicaba) são as
    // praças DE VERDADE da carga inicial (seção 7) — o exemplo do trabalho
    // inteiro. Antes do conserto, NINGUÉM conseguia cadastrar stylist nem
    // marcar encontro nelas pela tela (a lista fechada só tinha CPS/SAO/SBO/BSB).
    // ⚠️ `id` é `bigint`: o driver devolve como STRING nas consultas cruas
    // (evita perder precisão) — `::int` aqui, contra os ids que vêm de JSON
    // (Number), como os campos `praca_id`/`edicao_atual_id` do rastreio.
    const pracaLim = await uma(`select id::int as id from public.vessel_pracas where sigla = 'LIM'`)
    const pracaPir = await uma(`select id::int as id from public.vessel_pracas where sigla = 'PIR'`)

    // (b) stylist criada PELA PORTA REAL (vessel_stylist_criar), na praça
    // PIR — nasce com praca_id preenchido (não só o texto praca_preview).
    x = await chamarGravando(`public.vessel_stylist_criar(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_origem_contato => $4)`,
      ['Prova Rodada1 PIR', '5519990006302', 'PIR', 'indicacao'])
    conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'vessel_stylist_criar: cadastra PELA PORTA REAL com praça PIR (Piracicaba)', x.v ?? x.e?.message)
    const codigoStyPir = x.v?.codigo
    const styPir = await uma(`select id, praca_id::int as praca_id from public.vessel_stylists where codigo = $1`, [codigoStyPir])
    conferir(styPir?.praca_id === pracaPir.id,
      '(b) a stylist de Piracicaba nasceu com praca_id preenchido — antes do conserto isto era impossível (Piracicaba nem entrava na lista fechada)', styPir)

    // a mesma porta real, para a stylist de Limeira que vira a turma do placar.
    x = await chamarGravando(`public.vessel_stylist_criar(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_origem_contato => $4)`,
      ['Prova Rodada1 LIM', '5519990006301', 'LIM', 'indicacao'])
    conferir(x.v?.ok === true && x.v?.situacao === 'ok', 'vessel_stylist_criar: cadastra PELA PORTA REAL com praça LIM (Limeira)', x.v ?? x.e?.message)
    const codigoStyLim = x.v?.codigo
    const styLim = await uma(`select id, praca_id::int as praca_id from public.vessel_stylists where codigo = $1`, [codigoStyLim])
    conferir(styLim?.praca_id === pracaLim.id, 'a stylist de Limeira também nasceu com praca_id preenchido', styLim)

    // (c) sigla que NÃO EXISTE no cadastro — recusada com motivo escrito, sem estourar.
    const antesZzz = await r(`(select count(*)::int from public.vessel_stylists where whatsapp = $1)`, ['5519990006399'])
    x = await chamarGravando(`public.vessel_stylist_criar(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_origem_contato => $4)`,
      ['Prova Sigla Inexistente', '5519990006399', 'ZZZ', 'indicacao'])
    conferir(!x.e && x.v?.ok === false && x.v?.situacao === 'praca_invalida',
      '(c) vessel_stylist_criar: sigla ZZZ (não cadastrada) é recusada com situacao=praca_invalida, sem estourar erro cru de banco', x.v ?? x.e?.message)
    const depoisZzz = await r(`(select count(*)::int from public.vessel_stylists where whatsapp = $1)`, ['5519990006399'])
    conferir(antesZzz === 0 && depoisZzz === 0, 'e nada foi gravado (medido pela contagem real, não só pela resposta)', { antesZzz, depoisZzz })

    // (d) praça que EXISTE mas está `ativa = false` — também recusada.
    x = await chamarGravando(`public.vessel_praca_criar(p_sigla => $1, p_nome => $2, p_loja_destino => $3)`, ['PVI', 'Praça de Prova Inativa', null])
    conferir(x.v?.ok === true, 'praca_criar: praça de prova PVI, para virar inativa', x.v ?? x.e?.message)
    const pracaInativaId = x.v?.id
    x = await chamarGravando(`public.vessel_praca_editar(p_id => $1, p_nome => $2, p_loja_destino => $3, p_ativa => $4)`,
      [pracaInativaId, 'Praça de Prova Inativa', null, false])
    conferir(x.v?.ok === true, 'praca_editar: desativa a praça de prova (PVI)', x.v ?? x.e?.message)
    const antesPvi = await r(`(select count(*)::int from public.vessel_stylists where whatsapp = $1)`, ['5519990006398'])
    x = await chamarGravando(`public.vessel_stylist_criar(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_origem_contato => $4)`,
      ['Prova Praça Inativa', '5519990006398', 'PVI', 'indicacao'])
    conferir(!x.e && x.v?.ok === false && x.v?.situacao === 'praca_invalida',
      '(d) vessel_stylist_criar: praça PVI existe mas está `ativa = false` — também recusada com praca_invalida', x.v ?? x.e?.message)
    const depoisPvi = await r(`(select count(*)::int from public.vessel_stylists where whatsapp = $1)`, ['5519990006398'])
    conferir(antesPvi === 0 && depoisPvi === 0, 'e nada foi gravado (medido pela contagem real)', { antesPvi, depoisPvi })

    // A MESMA trava em vessel_stylist_editar (a 3ª das quatro portas) — sigla
    // inexistente e praça inativa, sobre a stylist que acabamos de criar.
    x = await chamarGravando(`public.vessel_stylist_editar(p_codigo => $1, p_praca => $2)`, [codigoStyPir, 'ZZZ'])
    conferir(!x.e && x.v?.ok === false && x.v?.situacao === 'praca_invalida', 'vessel_stylist_editar: sigla ZZZ também é recusada com praca_invalida', x.v ?? x.e?.message)
    x = await chamarGravando(`public.vessel_stylist_editar(p_codigo => $1, p_praca => $2)`, [codigoStyPir, 'PVI'])
    conferir(!x.e && x.v?.ok === false && x.v?.situacao === 'praca_invalida', 'vessel_stylist_editar: praça PVI (inativa) também é recusada com praca_invalida', x.v ?? x.e?.message)
    const styPirDepoisDeTentativas = await uma(`select praca_id::int as praca_id from public.vessel_stylists where codigo = $1`, [codigoStyPir])
    conferir(styPirDepoisDeTentativas?.praca_id === pracaPir.id, 'e a praça da stylist PIR NÃO mudou com as duas tentativas recusadas', styPirDepoisDeTentativas)

    // setup para o encontro real: mover a stylist de Limeira para a etapa que
    // libera Private Edit (a mesma trava de sempre — nada disto é do conserto
    // desta rodada, é pré-requisito para poder criar o encontro).
    const [etapaLibera] = await todas(`select id from public.vessel_stylist_etapas where libera_private_edit and ativa order by id limit 1`)
    if (!etapaLibera) throw new Error('nenhuma etapa libera_private_edit ativa — não dá para provar o encontro real')
    const [motivoLibera] = await todas(`select id from public.vessel_stylist_motivos_de_saida where etapa_id = $1 and ativo order by id limit 1`, [etapaLibera.id])
    x = await chamarGravando(`public.vessel_stylist_mover_de_etapa(p_codigo => $1, p_etapa_id => $2, p_motivo_id => $3)`,
      [codigoStyLim, etapaLibera.id, motivoLibera?.id ?? null])
    conferir(x.v?.ok === true, 'vessel_stylist_mover_de_etapa: move a stylist de Limeira para a etapa que libera Private Edit (setup)', x.v ?? x.e?.message)

    // a MESMA trava, agora em vessel_criar_private_edit (a 4ª porta) — sigla
    // inexistente e praça inativa, sem gravar nada.
    const antesEncontrosLim1 = await r(`(select count(*)::int from public.vessel_private_edits where stylist_id = $1)`, [styLim.id])
    x = await chamarGravando(`public.vessel_criar_private_edit(p_stylist => $1, p_quando => $2, p_praca => $3)`,
      [codigoStyLim, new Date(Date.now() + 3600 * 1000), 'ZZZ'])
    conferir(!x.e && x.v?.ok === false && x.v?.situacao === 'praca_invalida', 'vessel_criar_private_edit: sigla ZZZ também é recusada com praca_invalida', x.v ?? x.e?.message)
    x = await chamarGravando(`public.vessel_criar_private_edit(p_stylist => $1, p_quando => $2, p_praca => $3)`,
      [codigoStyLim, new Date(Date.now() + 3600 * 1000), 'PVI'])
    conferir(!x.e && x.v?.ok === false && x.v?.situacao === 'praca_invalida', 'vessel_criar_private_edit: praça PVI (inativa) também é recusada com praca_invalida', x.v ?? x.e?.message)
    const depoisEncontrosLim1 = await r(`(select count(*)::int from public.vessel_private_edits where stylist_id = $1)`, [styLim.id])
    conferir(antesEncontrosLim1 === 0 && depoisEncontrosLim1 === 0, 'e nenhum encontro foi gravado com as duas praças recusadas', { antesEncontrosLim1, depoisEncontrosLim1 })

    // a 4ª porta: vessel_pedido_do_stylist — a inscrição PÚBLICA da landing
    // page. ⚠️ É PORTA DE `anon`, NÃO de `authenticated` (medido em
    // information_schema.role_routine_grants: só anon/service_role/postgres
    // têm EXECUTE) — chamando como authenticated (o resto do arquivo) ela
    // devolveria 42501 CRU do PostgreSQL, não um `situacao` — e o erro cru
    // aborta a transação, o que já pegou esta prova na primeira rodada.
    // A MESMA trava do praca_invalida, simulada como o visitante público.
    const chamarComoAnon = async (expr, params = []) => {
      await cli.query('set local role anon')
      try {
        return { v: await r(expr, params) }
      } catch (e) {
        return { e }
      } finally {
        await cli.query('reset role')
      }
    }
    x = await chamarComoAnon(`public.vessel_pedido_do_stylist(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_teste => $4)`,
      ['Prova Pedido ZZZ', '5519990006397', 'ZZZ', true])
    conferir(!x.e && x.v?.ok === false && x.v?.situacao === 'praca_invalida', 'vessel_pedido_do_stylist (como anon): sigla ZZZ também é recusada com praca_invalida', x.v ?? x.e?.message)
    x = await chamarComoAnon(`public.vessel_pedido_do_stylist(p_nome => $1, p_whatsapp => $2, p_praca => $3, p_teste => $4)`,
      ['Prova Pedido PVI', '5519990006396', 'PVI', true])
    conferir(!x.e && x.v?.ok === false && x.v?.situacao === 'praca_invalida', 'vessel_pedido_do_stylist (como anon): praça PVI (inativa) também é recusada com praca_invalida', x.v ?? x.e?.message)
    const semGravarPedido = await r(`(select count(*)::int from public.vessel_stylists where whatsapp in ('5519990006397','5519990006396'))`)
    conferir(semGravarPedido === 0, 'e nenhuma das duas tentativas recusadas em vessel_pedido_do_stylist gravou stylist nenhuma', semGravarPedido)

    console.log('\n  · 10b) o recorte por praça e por edição, com as praças DE VERDADE')
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaLim.id, 'Edição LIM 1 (prova)', hoje])
    conferir(x.v?.ok === true, 'edicao_criar: edição 1 de Limeira', x.v ?? x.e?.message)
    const edicaoLim1 = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoLim1])
    conferir(x.v?.ok === true, 'edicao_abrir: abre a edição 1 de Limeira', x.v ?? x.e?.message)
    // ⚠️ TASK 11 RODADA 1 DE CONSERTO (IMPORTANTE 5): o baseline das provas de
    // placar abaixo (seção 11/11b/11c) NÃO vem de `incluidas` — devolvido
    // pela PRÓPRIA função sob teste, o que faria a prova "se salvar sozinha"
    // se `vessel_edicao_abrir` um dia perdesse o filtro por praça (o
    // baseline infla junto com o placar, e a comparação bateria mesmo
    // quebrada). Vem de uma contagem INDEPENDENTE, direto na tabela, com o
    // MESMO critério de elegibilidade que `sty` usa no placar (ativa,
    // não-teste, só desta edição) — se o filtro por praça sumisse de
    // `vessel_edicao_abrir`, `incluidas` infla para o total GLOBAL mas esta
    // contagem continua só de Limeira, e a conferência seguinte pega a
    // divergência entre os dois.
    //
    // ⚠️ DE ONDE VEM A PROTEÇÃO: a contagem é sobre `vessel_stylists`
    // FILTRANDO PELA PRAÇA (`praca_id = Limeira`) — nunca olha
    // `vessel_stylist_na_edicao`. Por isso ela não se move quando
    // `vessel_edicao_abrir` erra: contar as linhas da edição não serviria
    // (com o filtro por praça perdido, o `insert` enche a edição com o mundo
    // inteiro e a contagem inflaria JUNTO, e a comparação bateria mesmo
    // quebrada). É o que faz a conferência seguinte ter dente.
    const prospectadasBaseLim = await r(`(select count(*)::int from public.vessel_stylists s
      where s.praca_id = $1 and coalesce(s.ativa, true) and not coalesce(s.teste, false))`, [pracaLim.id])
    conferir(prospectadasBaseLim > 0,
      'TASK 11: a praça de Limeira tem turma real elegível (baseline > 0) — contado em `vessel_stylists` por `praca_id`, não em `incluidas` nem nas linhas da edição', prospectadasBaseLim)
    conferir(x.v?.incluidas === prospectadasBaseLim,
      'e `incluidas` (devolvido pela função sob teste) bate com a contagem independente — se o filtro por praça sumisse de vessel_edicao_abrir, `incluidas` inflaria para o total GLOBAL e esta conferência reprovaria',
      { incluidas: x.v?.incluidas, baseline: prospectadasBaseLim })
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaLim.id, 'Edição LIM 2 (prova)', hoje])
    conferir(x.v?.ok === true, 'edicao_criar: edição 2 de Limeira (destino do levar_para)', x.v ?? x.e?.message)
    const edicaoLim2 = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, [codigoStyLim, edicaoLim1])
    conferir(x.v?.ok === true, 'edicao_incluir_stylist: a stylist de Limeira entra na edição 1', x.v ?? x.e?.message)

    // uma edição de Piracicaba, com a stylist de PIR dentro — é ela que a
    // mutação do recorte (abaixo) tem de "vazar" para o placar de Limeira.
    x = await chamarGravando(`public.vessel_edicao_criar(p_praca_id => $1, p_nome => $2, p_comeca_em => $3, p_termina_em => null)`, [pracaPir.id, 'Edição PIR 1 (prova)', hoje])
    conferir(x.v?.ok === true, 'edicao_criar: edição 1 de Piracicaba', x.v ?? x.e?.message)
    const edicaoPir1 = x.v?.id
    x = await chamarGravando(`public.vessel_edicao_abrir(p_id => $1)`, [edicaoPir1])
    conferir(x.v?.ok === true, 'edicao_abrir: abre a edição 1 de Piracicaba', x.v ?? x.e?.message)
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, [codigoStyPir, edicaoPir1])
    conferir(x.v?.ok === true, 'edicao_incluir_stylist: a stylist de Piracicaba entra na edição 1 dela', x.v ?? x.e?.message)

    // MENOR 1, com dente: uma stylist de TESTE incluída na MESMA edição não
    // pode contar no placar — `sty` (seção 11) filtra `not coalesce(teste,
    // false)`, igual às irmãs `vessel_rastreio_dos_stylists`/
    // `vessel_numeros_do_stylist_circle`.
    const styTeste = await uma(`insert into public.vessel_stylists (codigo, nome, whatsapp, praca_id, teste)
       values ('STY-PROVA-PLACAR-TESTE', 'Prova Placar Teste', '5519990006303', $1, true) returning id`, [pracaLim.id])
    x = await chamarGravando(`public.vessel_edicao_incluir_stylist(p_codigo => $1, p_edicao_id => $2)`, ['STY-PROVA-PLACAR-TESTE', edicaoLim1])
    conferir(x.v?.ok === true, 'edicao_incluir_stylist: MENOR 1 — uma stylist de TESTE também entra na edição 1 (para provar o filtro no placar)', x.v ?? x.e?.message)

    const chamadaPorPraca = await chamarGravando(`public.vessel_rastreio_dos_stylists(p_dias => 7, p_incluir_desativadas => true, p_praca_id => $1, p_edicao_id => null)`, [pracaLim.id])
    const listaPorPraca = chamadaPorPraca.v
    conferir(Array.isArray(listaPorPraca) && listaPorPraca.some((s) => s.codigo === codigoStyLim) && !listaPorPraca.some((s) => s.codigo === codigoStyPir),
      'p_praca_id => LIM: a lista traz a stylist de Limeira e NÃO traz a de Piracicaba', listaPorPraca?.map((s) => s.codigo))
    const limNaLista = listaPorPraca.find((s) => s.codigo === codigoStyLim)
    conferir(limNaLista?.praca_id === pracaLim.id && limNaLista?.praca_sigla === 'LIM' && limNaLista?.edicao_atual_id === edicaoLim1,
      'MENOR 4: a linha vem com praca_id/praca_sigla/`edicao_atual_id` certos (renomeado de `edicao_id` — não se confunde com o parâmetro p_edicao_id)', limNaLista)

    const chamadaPorEdicao = await chamarGravando(`public.vessel_rastreio_dos_stylists(p_dias => 7, p_incluir_desativadas => true, p_praca_id => null, p_edicao_id => $1)`, [edicaoLim1])
    const listaPorEdicao = chamadaPorEdicao.v
    conferir(Array.isArray(listaPorEdicao) && listaPorEdicao.some((s) => s.codigo === codigoStyLim) && !listaPorEdicao.some((s) => s.codigo === codigoStyPir),
      'p_edicao_id => Edição LIM 1: a lista traz quem está na edição (a de Piracicaba, fora dela, não aparece)', listaPorEdicao?.map((s) => s.codigo))

    console.log('\n  · 10c) sem_permissao em vessel_rastreio_dos_stylists também levanta (função de LEITURA — raise, não {ok:false})')
    {
      await cli.query('savepoint prova_rastreio_sem_permissao')
      await falarComo(null)
      await cli.query('set local role authenticated')
      let erro
      try { await r(`public.vessel_rastreio_dos_stylists(p_dias => $1, p_incluir_desativadas => $2)`, [7, false]) } catch (e) { erro = e }
      await cli.query('rollback to savepoint prova_rastreio_sem_permissao')
      conferir(erro?.code === '42501', 'vessel_rastreio_dos_stylists: sem nenhuma permissão de tela, levanta 42501', erro?.message)
      await falarComo(idEditar)
    }

    console.log('\n  · 11) TASK 5: vessel_placar_da_edicao — não zera ao encerrar, o recorte reprova sob mutação, sem receita')
    // (a) O ENCONTRO REAL: criado PELA PORTA (vessel_criar_private_edit), na
    // praça LIM, dentro da janela da edição 1 — tem de aparecer nos números.
    x = await chamarGravando(`public.vessel_criar_private_edit(p_stylist => $1, p_quando => $2, p_praca => $3, p_vagas => 8, p_teste => false)`,
      [codigoStyLim, new Date(Date.now() + 3600 * 1000), 'LIM'])
    conferir(x.v?.ok === true, '(a) vessel_criar_private_edit: cria o 1º encontro PELA PORTA REAL, praça LIM', x.v ?? x.e?.message)
    const encontro1Codigo = x.v?.codigo

    // ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 4): os dois números que voltaram —
    // `intervalos`/`intervalo_medio_em_dias` e `contatos_ate_ativar`/
    // `stylists_com_contatos_ate_ativar` — entram no contrato. Esquecer de
    // atualizar esta lista faria a MENOR 2 (conjunto exato de chaves, logo
    // abaixo) reprovar sozinha — é o próprio guarda avisando.
    const CHAVES_DO_CONTRATO = ['edicao', 'etapas', 'prospectadas', 'prospectadas_ja_ativadas', 'ativadas',
      'com_private_edit_agendado', 'com_private_edit_realizado', 'recorrentes_no_periodo',
      'encontros_agendados', 'encontros_realizados', 'encontros_cancelados', 'convidadas', 'confirmadas',
      'presentes', 'confirmadas_em_realizados', 'presentes_em_realizados',
      'intervalos', 'intervalo_medio_em_dias', 'contatos_ate_ativar', 'stylists_com_contatos_ate_ativar']

    const placarAntes = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
    conferir(!placarAntes.e, 'vessel_placar_da_edicao: chama sem erro para a edição 1 de Limeira (aberta)', placarAntes.e?.message)

    // MENOR 2: igualdade do CONJUNTO de chaves — não uma lista de 5 nomes
    // proibidos (que `receita_total`/`ticket_medio` passariam por baixo).
    const chavesRecebidas = Object.keys(placarAntes.v ?? {}).sort()
    const chavesEsperadas = [...CHAVES_DO_CONTRATO].sort()
    conferir(JSON.stringify(chavesRecebidas) === JSON.stringify(chavesEsperadas),
      'MENOR 2: o CONJUNTO de chaves da resposta é EXATAMENTE o do contrato (nenhuma falta, nenhuma sobra — `receita_total` ou qualquer chave nova também reprovaria aqui)',
      { chavesRecebidas, chavesEsperadas })

    // ⚠️ TASK 11: `prospectadas` é a TURMA REAL da praça, não mais "só a
    // stylist que a prova incluiu à mão" — o baseline (`prospectadasBaseLim`,
    // medido no 10b, logo depois de abrir) é o número certo agora. A de TESTE
    // (MENOR 1) continua de fora, seja qual for o baseline.
    conferir(placarAntes.v?.prospectadas === prospectadasBaseLim,
      'prospectadas: a turma real de Limeira (baseline do TASK 11 — a de TESTE, MENOR 1, não conta)', { prospectadas: placarAntes.v?.prospectadas, prospectadasBaseLim })
    conferir(placarAntes.v?.encontros_agendados === 1, '(a) encontros_agendados: o encontro criado pela porta real EM LIM aparece nos números', placarAntes.v)

    const totalEtapasAtivas = await r(`(select count(*)::int from public.vessel_stylist_etapas where ativa)`)
    conferir(placarAntes.v?.etapas?.length === totalEtapasAtivas,
      'etapas: TODAS as etapas ativas aparecem (nenhum número fixo no código) — inclusive as de zero', { esperado: totalEtapasAtivas, recebido: placarAntes.v?.etapas?.length })
    const somaEtapas = (placarAntes.v?.etapas ?? []).reduce((n, e) => n + (e.stylists || 0), 0)
    conferir(somaEtapas === prospectadasBaseLim, 'a soma das etapas bate com a turma real (a de teste não entra)', { somaEtapas, prospectadasBaseLim })

    console.log('\n    · edição inexistente levanta (não devolve silêncio)')
    {
      await cli.query('savepoint prova_placar_invalido')
      let erro
      try { await r(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [-1]) } catch (e) { erro = e }
      await cli.query('rollback to savepoint prova_placar_invalido')
      conferir(erro?.code === 'P0002', 'vessel_placar_da_edicao: edição inexistente levanta P0002', erro?.message)
    }

    console.log('\n    · sem_permissao em vessel_placar_da_edicao (função de LEITURA — raise)')
    {
      await cli.query('savepoint prova_placar_sem_permissao')
      await falarComo(null)
      await cli.query('set local role authenticated')
      let erro
      try { await r(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1]) } catch (e) { erro = e }
      await cli.query('rollback to savepoint prova_placar_sem_permissao')
      conferir(erro?.code === '42501', 'vessel_placar_da_edicao: sem nenhuma permissão de tela, levanta 42501', erro?.message)
      await falarComo(idEditar)
    }

    console.log('\n    · MUTAÇÃO DO RECORTE (edição): trocar `where n.edicao_id = p_edicao_id` por `1=1` tem de REPROVAR')
    await cli.query('savepoint prova_mutacao_recorte')
    try {
      const funcaoBoaPlacar = (await uma(
        `select pg_get_functiondef('public.vessel_placar_da_edicao(bigint)'::regprocedure) as def`)).def
      const trechoDoRecorte = /where n\.edicao_id = p_edicao_id\n/
      if (!trechoDoRecorte.test(funcaoBoaPlacar)) throw new Error('a mutação não achou o `where` do recorte em vessel_placar_da_edicao — o texto da função mudou')
      await cli.query(funcaoBoaPlacar.replace(trechoDoRecorte, 'where 1=1\n'))

      // ⚠️ O total "global" para comparar tem de passar pelos MESMOS filtros
      // que a função aplica fora do recorte mutado — senão a expectativa
      // infla e a conferência reprova pela CONTA, não pelo recorte:
      //  · `teste` e `ativa`, da CTE `sty` (MENOR 1 e IMPORTANTE 5);
      //  · `saiu_em is null`, do `turma_ids` (RODADA 1 DE CONSERTO, CRÍTICO
      //    1) — `edicaoLim1` está ABERTA, e numa edição aberta o vínculo
      //    fechado (quem mudou de praça) não conta mais. Sem espelhar este
      //    terceiro, a expectativa deu 56 contra os 54 reais.
      const totalTesteFalseGlobal = await r(`(select count(distinct n.stylist_id)::int
         from public.vessel_stylist_na_edicao n join public.vessel_stylists s on s.id = n.stylist_id
        where not coalesce(s.teste, false) and coalesce(s.ativa, true) and n.saiu_em is null)`)
      const placarMutado = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
      const reprovou = !placarMutado.e && placarMutado.v?.prospectadas === totalTesteFalseGlobal && placarMutado.v?.prospectadas > placarAntes.v?.prospectadas
      console.log(`      ${reprovou ? '✗' : '✓'} SEM o recorte (\`1=1\`): o placar de Limeira ${reprovou ? `passou a contar ${placarMutado.v?.prospectadas} stylists (a de Piracicaba incluída) — era para contar só 1` : 'não mudou (inesperado)'} → prospectadas=${placarMutado.v?.prospectadas}`)
      conferir(reprovou === true,
        'MUTAÇÃO: sem o `where n.edicao_id = p_edicao_id`, o placar de Limeira conta a stylist de Piracicaba (de qualquer edição) — prova que o recorte não é decoração',
        { prospectadas: placarMutado.v?.prospectadas, esperadoComBug: totalTesteFalseGlobal, correto: placarAntes.v?.prospectadas })
    } finally {
      // Desfaz a mutação (restaura a função de verdade).
      await cli.query('rollback to savepoint prova_mutacao_recorte')
    }

    // COM o recorte restaurado, o mesmo cenário volta a dar 1 — a prova tem dente nos dois sentidos.
    const placarRestaurado = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
    console.log(`      ${placarRestaurado.v?.prospectadas === prospectadasBaseLim ? '✓' : '✗'} COM o recorte (restaurado): prospectadas volta a ${placarRestaurado.v?.prospectadas} (era para ser ${prospectadasBaseLim})`)
    conferir(placarRestaurado.v?.prospectadas === prospectadasBaseLim, 'COM o `where` restaurado: o placar de Limeira volta a contar só a turma real dela', { prospectadas: placarRestaurado.v?.prospectadas, prospectadasBaseLim })

    console.log('\n    · MUTAÇÃO (a) — o CRÍTICO original: tirar `praca_id` de vessel_criar_private_edit, mostrar a conferência REPROVANDO, restaurar e mostrar o ✓')
    await cli.query('savepoint prova_mutacao_praca_id_do_encontro')
    try {
      const assinaturaCriarPE = 'public.vessel_criar_private_edit(text,timestamp with time zone,text,text,text,integer,boolean,boolean)'
      const funcaoBoaCriarPE = (await uma(
        `select pg_get_functiondef($1::regprocedure) as def`, [assinaturaCriarPE])).def
      const trechoColunas = `(codigo, chave, stylist_id, quando, local, praca, praca_id, loja, vagas, teste)`
      const trechoValores = `nullif(trim(coalesce(p_local, '')), ''), v_praca, v_praca_id, p_loja, p_vagas, p_teste);`
      if (!funcaoBoaCriarPE.includes(trechoColunas)) throw new Error('a mutação não achou a lista de colunas do insert em vessel_criar_private_edit — o texto da função mudou')
      if (!funcaoBoaCriarPE.includes(trechoValores)) throw new Error('a mutação não achou a lista de valores do insert em vessel_criar_private_edit — o texto da função mudou')
      const funcaoMutada = funcaoBoaCriarPE
        .replace(trechoColunas, `(codigo, chave, stylist_id, quando, local, praca, loja, vagas, teste)`)
        .replace(trechoValores, `nullif(trim(coalesce(p_local, '')), ''), v_praca, p_loja, p_vagas, p_teste);`)
      await cli.query(funcaoMutada)

      // um 2º encontro real, MESMA stylist/praça/janela — pela porta MUTADA
      // (sem gravar praca_id, o bug original).
      const semPracaId = await chamarGravando(`public.vessel_criar_private_edit(p_stylist => $1, p_quando => $2, p_praca => $3, p_vagas => 8, p_teste => false)`,
        [codigoStyLim, new Date(Date.now() + 2 * 3600 * 1000), 'LIM'])
      conferir(semPracaId.v?.ok === true, 'SEM praca_id: o 2º encontro é criado normalmente (a mutação não trava a criação, só cala o dado)', semPracaId.v ?? semPracaId.e?.message)

      const praca_idDoEncontro2 = await r(`(select praca_id from public.vessel_private_edits where codigo = $1)`, [semPracaId.v?.codigo])
      const totalRealDeEncontros = await r(`(select count(*)::int from public.vessel_private_edits where stylist_id = $1 and not coalesce(teste,false) and not coalesce(arquivada,false))`, [styLim.id])
      const placarComBug = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
      const reprovouA = praca_idDoEncontro2 === null && totalRealDeEncontros === 2 && placarComBug.v?.encontros_agendados === 1
      console.log(`      ${reprovouA ? '✗' : '✓'} SEM \`praca_id\`: ${reprovouA ? `2 encontros existem DE VERDADE na tabela (stylist ${codigoStyLim}), mas o placar continua contando só ${placarComBug.v?.encontros_agendados} — o bug original (calado) voltou` : 'não reproduziu o bug (inesperado)'}`)
      conferir(reprovouA === true,
        'MUTAÇÃO (a): sem gravar `praca_id` no insert de vessel_criar_private_edit, o 2º encontro nasce de verdade mas some do placar — prova que a coluna é o guarda de regressão do CRÍTICO original',
        { praca_idDoEncontro2, totalRealDeEncontros, encontros_agendados_no_placar: placarComBug.v?.encontros_agendados })
    } finally {
      // Desfaz a mutação (restaura a função) E o 2º encontro que ela gravou.
      await cli.query('rollback to savepoint prova_mutacao_praca_id_do_encontro')
    }

    // COM a função restaurada, um novo encontro real (o 2º de verdade) ENTRA no placar.
    x = await chamarGravando(`public.vessel_criar_private_edit(p_stylist => $1, p_quando => $2, p_praca => $3, p_vagas => 8, p_teste => false)`,
      [codigoStyLim, new Date(Date.now() + 2 * 3600 * 1000), 'LIM'])
    conferir(x.v?.ok === true && x.v?.codigo !== encontro1Codigo, 'COM praca_id (restaurado): cria um 2º encontro real, código diferente do 1º', x.v ?? x.e?.message)
    const encontro2Codigo = x.v?.codigo
    const placarComDois = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
    console.log(`      ${placarComDois.v?.encontros_agendados === 2 ? '✓' : '✗'} COM praca_id (restaurado): encontros_agendados sobe para ${placarComDois.v?.encontros_agendados} (era para ser 2)`)
    conferir(placarComDois.v?.encontros_agendados === 2, 'COM o `praca_id` restaurado: o 2º encontro real ENTRA no placar — encontros_agendados = 2', placarComDois.v?.encontros_agendados)

    console.log('\n    · CONGELAMENTO: encerrar a edição 1 de Limeira levando as sobras para a 2 — o placar da 1 não muda')
    const placarAntesDeEncerrar = placarComDois
    x = await chamarGravando(`public.vessel_edicao_encerrar(p_id => $1, p_levar_para => $2)`, [edicaoLim1, edicaoLim2])
    conferir(x.v?.ok === true, 'edicao_encerrar: encerra a edição 1 de Limeira levando para a 2', x.v ?? x.e?.message)
    const placarDepois = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
    conferir(!placarDepois.e, 'vessel_placar_da_edicao: continua respondendo depois de encerrada', placarDepois.e?.message)
    const semSituacao = (pl) => JSON.stringify({ ...pl, edicao: pl?.edicao ? { ...pl.edicao, situacao: undefined } : pl?.edicao })
    conferir(semSituacao(placarAntesDeEncerrar.v) === semSituacao(placarDepois.v),
      'CRÍTICO (guarda de regressão): o placar da edição 1 é IDÊNTICO antes e depois de encerrar (só `edicao.situacao` muda, de "aberta" para "encerrada") — não zera',
      { antes: placarAntesDeEncerrar.v, depois: placarDepois.v })
    conferir(placarAntesDeEncerrar.v?.edicao?.situacao === 'aberta' && placarDepois.v?.edicao?.situacao === 'encerrada',
      'e a situação REALMENTE mudou (a chamada de depois não é um eco em cache da de antes)',
      { antes: placarAntesDeEncerrar.v?.edicao?.situacao, depois: placarDepois.v?.edicao?.situacao })

    console.log('\n  · 11b) RODADA 1 DE CONSERTO (IMPORTANTE 4): intervalo médio entre encontros e contatos até ativar voltam ao placar')
    // ⚠️ DEPOIS do congelamento (acima) de propósito: marcar os dois encontros
    // como realizados MUDA o placar, e a prova do CRÍTICO logo acima compara
    // "antes"/"depois de encerrar" byte a byte — fazer isto antes derrubaria
    // aquela prova por um motivo que não é dela.
    const hojeMenos = (n) => { const d = new Date(`${hoje}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
    x = await chamarGravando(`public.vessel_private_edit_situacao(p_codigo => $1, p_status => 'realizado', p_realizado_em => $2)`,
      [encontro1Codigo, hojeMenos(6)])
    conferir(x.v?.ok === true, 'private_edit_situacao: marca o 1º encontro como realizado, 6 dias atrás', x.v ?? x.e?.message)
    x = await chamarGravando(`public.vessel_private_edit_situacao(p_codigo => $1, p_status => 'realizado', p_realizado_em => $2)`,
      [encontro2Codigo, hojeMenos(2)])
    conferir(x.v?.ok === true, 'private_edit_situacao: marca o 2º encontro como realizado, 2 dias atrás — intervalo de 4 dias entre os dois', x.v ?? x.e?.message)

    // ⚠️ TASK 11: `stylists_com_contatos_ate_ativar`/`contatos_ate_ativar` são
    // somas sobre a TURMA INTEIRA — com a turma real de Limeira (não mais só
    // a stylist da prova), outras stylists reais podem já contribuir para
    // esses dois números. Mede o BASELINE agora (antes de inserir os contatos
    // de prova) e compara por DELTA — a única coisa que esta prova pode
    // garantir é o que ELA ACRESCENTA, não um total absoluto.
    const placarAntesDosContatos = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
    const stylistsComContatosBase = placarAntesDosContatos.v?.stylists_com_contatos_ate_ativar
    const contatosAteAtivarBase = placarAntesDosContatos.v?.contatos_ate_ativar

    // Dois contatos ANTES de ativar (contam) e um DEPOIS (não conta).
    const ativouEm = await r(`(select public.vessel_stylist_ativada_em($1))`, [styLim.id])
    conferir(ativouEm !== null, 'a stylist de Limeira está ativada (senão a prova de contatos não tem o que medir)', ativouEm)
    await cli.query(
      `insert into public.vessel_stylist_contatos (stylist_id, canal, resultado, criado_em) values
         ($1, 'whatsapp', 'conversou', $2::timestamptz - interval '3 days'),
         ($1, 'ligacao', 'interesse', $2::timestamptz - interval '1 day'),
         ($1, 'whatsapp', 'marcou_encontro', $2::timestamptz + interval '1 day')`,
      [styLim.id, ativouEm])

    const placarComOsDoisNumeros = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
    conferir(!placarComOsDoisNumeros.e, 'vessel_placar_da_edicao: continua respondendo com os dois encontros realizados', placarComOsDoisNumeros.e?.message)
    conferir(placarComOsDoisNumeros.v?.intervalos === 1,
      'intervalos: 1 (o segundo realizado tem um primeiro antes dele, na mesma stylist)', placarComOsDoisNumeros.v?.intervalos)
    conferir(placarComOsDoisNumeros.v?.intervalo_medio_em_dias === 4,
      'intervalo_medio_em_dias: exatamente 4 (6 dias atrás → 2 dias atrás)', placarComOsDoisNumeros.v?.intervalo_medio_em_dias)
    // ⚠️ TASK 11 — leitura correta do campo (não é "quem TEM contato"; é o
    // DIVISOR da média: quantas estão ATIVADAS na turma, ver a query da
    // função). Inserir contatos não ativa ninguém — não muda.
    conferir(placarComOsDoisNumeros.v?.stylists_com_contatos_ate_ativar === stylistsComContatosBase,
      'stylists_com_contatos_ate_ativar: NÃO muda ao inserir contatos — é quem está ATIVADA na turma (o divisor da média), e isso não muda',
      { antes: stylistsComContatosBase, depois: placarComOsDoisNumeros.v?.stylists_com_contatos_ate_ativar })
    // ⚠️ TASK 11 RODADA 1 DE CONSERTO (IMPORTANTE 3): `contatos_ate_ativar` é
    // MÉDIA sobre a turma inteira, não soma — um `+2` fixo só seria exato
    // enquanto a de Limeira for a ÚNICA stylist ativada na turma real. Isso
    // quebraria (e travaria a aplicação da migration) no dia em que uma
    // SEGUNDA stylist real de Limeira ativar — que é o objetivo do próprio
    // programa, não uma condição de erro. Em vez de exigir `n === 1`, calculo
    // o ESPERADO com uma consulta independente (o MESMO formato da função,
    // mas escrita à parte — não é "chamar a função de novo": é reconstruir o
    // número a partir da tabela crua) e comparo com o que a função devolveu.
    const somaEContagem = await uma(`select
        coalesce(sum(n), 0)::numeric as soma, count(*)::int as n
      from (
        select (select count(*) from public.vessel_stylist_contatos c
                 where c.stylist_id = s.id and c.criado_em < public.vessel_stylist_ativada_em(s.id)) as n
          from public.vessel_stylists s
         where s.id in (select distinct stylist_id from public.vessel_stylist_na_edicao where edicao_id = $1)
           and not coalesce(s.teste, false) and coalesce(s.ativa, true)
           and public.vessel_stylist_ativada_em(s.id) is not null
      ) x`, [edicaoLim1])
    const contatosAteAtivarEsperado = somaEContagem.n > 0 ? Math.round((Number(somaEContagem.soma) / somaEContagem.n) * 10) / 10 : null
    conferir(placarComOsDoisNumeros.v?.contatos_ate_ativar === contatosAteAtivarEsperado,
      `contatos_ate_ativar: bate com a média recalculada por fora (soma=${somaEContagem.soma}, n=${somaEContagem.n}) — robusto a mais de uma stylist real ativada, não um "+2" fixo`,
      { recebido: placarComOsDoisNumeros.v?.contatos_ate_ativar, esperado: contatosAteAtivarEsperado, antes: contatosAteAtivarBase })

    console.log('\n    · MUTAÇÃO: sem o `lag()` no `realizados`, `intervalos`/`intervalo_medio_em_dias` têm de voltar a zero/nulo — reprova')
    await cli.query('savepoint prova_mutacao_intervalo')
    try {
      const funcaoBoaIntervalo = (await uma(
        `select pg_get_functiondef('public.vessel_placar_da_edicao(bigint)'::regprocedure) as def`)).def
      // ⚠️ TOLERANTE A REFORMATAÇÃO: `pg_get_functiondef` reindenta o corpo —
      // não se pode contar com a formatação exata do arquivo-fonte (a
      // diferença de `\s+` das outras mutações desta prova já mostra isso).
      const trechoLag = /e\.realizado_em\s*-\s*lag\(e\.realizado_em\)\s*over\s*\(partition by e\.stylist_id\s*order by e\.realizado_em,\s*e\.id\)\s*as\s*intervalo/
      if (!trechoLag.test(funcaoBoaIntervalo)) throw new Error('a mutação não achou a expressão do `lag()` em vessel_placar_da_edicao — o texto da função mudou')
      // `date - date` dá INTEIRO em Postgres (não `interval`) — o `null` da
      // mutação precisa do MESMO tipo, senão `avg(intervalo)::numeric` (mais
      // abaixo na função) quebra com erro de cast em vez de devolver 0/nulo.
      const semLag = funcaoBoaIntervalo.replace(trechoLag, 'null::integer as intervalo')
      await cli.query(semLag)
      const placarSemLag = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
      const reprovouIntervalo = placarSemLag.v?.intervalos === 0 && placarSemLag.v?.intervalo_medio_em_dias === null
      console.log(`      ${reprovouIntervalo ? '✗' : '✓'} SEM o \`lag()\`: intervalos=${placarSemLag.v?.intervalos}, intervalo_medio_em_dias=${placarSemLag.v?.intervalo_medio_em_dias} (era para os dois números somem)`)
      conferir(reprovouIntervalo === true,
        'MUTAÇÃO: sem o `lag()`, `intervalos`/`intervalo_medio_em_dias` somem — prova que o guarda de regressão é o `lag()`, não decoração',
        { intervalos: placarSemLag.v?.intervalos, intervalo_medio_em_dias: placarSemLag.v?.intervalo_medio_em_dias })
    } finally {
      await cli.query('rollback to savepoint prova_mutacao_intervalo')
    }

    console.log('\n  · 11c) RODADA 1 DE CONSERTO (IMPORTANTE 5): stylist DESATIVADA na turma some do placar, do mesmo jeito que some do quadro')
    x = await chamarGravando(`public.vessel_stylist_desativar(p_codigo => $1, p_ativa => false)`, [codigoStyLim])
    conferir(x.v?.ok === true, 'stylist_desativar: desativa a stylist de Limeira (ainda na turma da edição)', x.v ?? x.e?.message)
    const rastreioSemDesativada = await chamarGravando(
      `public.vessel_rastreio_dos_stylists(p_dias => 7, p_incluir_desativadas => false, p_praca_id => null, p_edicao_id => $1)`, [edicaoLim1])
    const sumiuDoRastreio = Array.isArray(rastreioSemDesativada.v) && !rastreioSemDesativada.v.some((s) => s.codigo === codigoStyLim)
    conferir(sumiuDoRastreio === true,
      'vessel_rastreio_dos_stylists (o quadro/lista, sem pedir desativadas): a stylist desativada some — o comportamento de sempre', rastreioSemDesativada.v)
    const placarComDesativada = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
    // ⚠️ TASK 11: com a turma real de Limeira, "cai a zero" não vale mais —
    // cai em UM (só a de Limeira sai; o resto da turma real continua).
    conferir(placarComDesativada.v?.prospectadas === prospectadasBaseLim - 1,
      'IMPORTANTE 5: com o mesmo filtro `ativa`, o placar TAMBÉM fica sem ela — prospectadas cai em exatamente 1 (o resto da turma real continua)',
      { prospectadas: placarComDesativada.v?.prospectadas, esperado: prospectadasBaseLim - 1 })
    const somaEtapasComDesativada = (placarComDesativada.v?.etapas ?? []).reduce((n, e) => n + (e.stylists || 0), 0)
    conferir(somaEtapasComDesativada === prospectadasBaseLim - 1, 'e a soma das etapas do placar acompanha — os dois lados fecham', { somaEtapasComDesativada, esperado: prospectadasBaseLim - 1 })
    x = await chamarGravando(`public.vessel_stylist_desativar(p_codigo => $1, p_ativa => true)`, [codigoStyLim])
    conferir(x.v?.ok === true, 'stylist_desativar: reativa (deixando o resto da prova como estava)', x.v ?? x.e?.message)

    console.log('\n    · MUTAÇÃO: tirar `and coalesce(s.ativa, true)` da CTE `sty` tem de fazer a desativada voltar a contar — reprova')
    x = await chamarGravando(`public.vessel_stylist_desativar(p_codigo => $1, p_ativa => false)`, [codigoStyLim])
    conferir(x.v?.ok === true, 'desativa de novo, para a mutação ter o que mostrar', x.v ?? x.e?.message)
    await cli.query('savepoint prova_mutacao_ativa')
    try {
      const funcaoBoaAtiva = (await uma(
        `select pg_get_functiondef('public.vessel_placar_da_edicao(bigint)'::regprocedure) as def`)).def
      const trechoAtiva = /\s*and\s+coalesce\(s\.ativa,\s*true\)/
      if (!trechoAtiva.test(funcaoBoaAtiva)) throw new Error('a mutação não achou o filtro de `ativa` em vessel_placar_da_edicao — o texto da função mudou')
      await cli.query(funcaoBoaAtiva.replace(trechoAtiva, ''))
      const placarMutadoAtiva = await chamarGravando(`public.vessel_placar_da_edicao(p_edicao_id => $1)`, [edicaoLim1])
      // ⚠️ TASK 11: sem o filtro, TODA a turma_ids original conta de novo —
      // volta a bater com o baseline (a desativada é a única cujo `ativa`
      // mudou DEPOIS de ela já estar em turma_ids; o resto da turma real
      // nunca deixou de ser ativa).
      const reprovouAtiva = placarMutadoAtiva.v?.prospectadas === prospectadasBaseLim
      console.log(`      ${reprovouAtiva ? '✗' : '✓'} SEM o filtro de \`ativa\`: prospectadas=${placarMutadoAtiva.v?.prospectadas} (era para a desativada ${reprovouAtiva ? 'voltar a contar — o defeito original' : 'continuar de fora (inesperado)'})`)
      conferir(reprovouAtiva === true,
        'MUTAÇÃO: sem `and coalesce(s.ativa, true)`, a stylist desativada volta a contar no placar — prova que o filtro não é decoração',
        { prospectadas: placarMutadoAtiva.v?.prospectadas, prospectadasBaseLim })
    } finally {
      await cli.query('rollback to savepoint prova_mutacao_ativa')
    }
    x = await chamarGravando(`public.vessel_stylist_desativar(p_codigo => $1, p_ativa => true)`, [codigoStyLim])
    conferir(x.v?.ok === true, 'stylist_desativar: reativa de novo, depois da mutação desfeita', x.v ?? x.e?.message)
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
