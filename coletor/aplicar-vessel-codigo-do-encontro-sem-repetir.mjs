// APLICA, REGISTRA e PROVA: o código do encontro nunca se repete (e a irmã, a
// Beauty Session, não reusa código nem volta erro cru na corrida).
//
//   node --env-file=<coletor/.env> coletor/aplicar-vessel-codigo-do-encontro-sem-repetir.mjs            → ensaio: prova tudo e DESFAZ
//   node --env-file=<coletor/.env> coletor/aplicar-vessel-codigo-do-encontro-sem-repetir.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ ORDEM: `2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql` VAI
// PRIMEIRO (esta reescreve a versão dela de `vessel_criar_private_edit`). No
// ensaio, se ela ainda não estiver no banco, é aplicada DENTRO da mesma
// transação desfeita, antes desta; com `--gravar`, este aplicador PARA.
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ, provas em savepoints desfeitos, `commit` conferido
// (`.command === 'COMMIT'`), e os códigos que já existem conferidos antes,
// depois da migration, depois do desfazer e numa conexão nova.
//
// ⚠️ A CORRIDA DE DUAS CONEXÕES NÃO É PROVÁVEL NO ENSAIO: a função nova só
// existe dentro desta transação, que nenhuma outra conexão enxerga. A prova é a
// da FILA (a trava por dia e praça aparece em `pg_locks` depois de criar) e a
// do CINTO (um código tomado por fora da conta é pulado, não repetido).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-24-vessel-codigo-do-encontro-sem-repetir.sql'
const ANTES_DESTA = '2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql'
const GRAVAR = process.argv.slice(2).includes('--gravar')

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const IMPRESSAO = `
  select (select count(*) from public.vessel_private_edits)::int as encontros,
         (select md5(coalesce(string_agg(codigo || ':' || chave, '|' order by codigo), '')) from public.vessel_private_edits) as codigos_pe,
         (select count(*) from public.vessel_beauty_sessions)::int as sessoes,
         (select md5(coalesce(string_agg(codigo, '|' order by codigo), '')) from public.vessel_beauty_sessions) as codigos_bs,
         (select md5(coalesce(string_agg(row_to_json(s)::text, '|' order by s.id), '')) from public.vessel_stylists s) as stylists,
         (select count(*) from public.vessel_sessao_aberturas)::int as aberturas`

if (!process.env.DATABASE_URL) { console.error('❌ sem DATABASE_URL'); process.exit(1) }
const ler = (f) => readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r
const registrada = async (nome) =>
  (await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ok`, [nome])).ok
const tentar = async (fn) => {
  await cli.query('savepoint tentativa')
  try { const v = await fn(); await cli.query('release savepoint tentativa'); return { v } } catch (e) {
    await cli.query('rollback to savepoint tentativa'); return { e }
  }
}

if (await registrada(ARQUIVO)) { console.error(`❌ ${ARQUIVO} já está registrada.`); process.exit(1) }
const antesDestaNoBanco = await registrada(ANTES_DESTA)
if (GRAVAR && !antesDestaNoBanco) { console.error(`❌ ${ANTES_DESTA} vai primeiro e não está no banco.`); process.exit(1) }
const antes = await uma(IMPRESSAO)
console.log(`hoje: ${antes.encontros} encontro(s), ${antes.sessoes} sessão(ões)`)

await cli.query('begin')
try {
  if (!antesDestaNoBanco) {
    console.log(`\n(ensaio) aplicando ${ANTES_DESTA} dentro da transação, antes desta`)
    await cli.query(ler(ANTES_DESTA))
  }
  const id = randomUUID(), email = `prova-codigo-${id}@teste.invalido`
  await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
  await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin)
    values ($1, $2, 'Prova Código', $3, $4::jsonb, false)`, [id, email, ['atendimentos'], JSON.stringify({ atendimentos: ['ver', 'editar'] })])
  await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id })])
  const ativada = Number((await uma(`select id from public.vessel_stylist_etapas where ativa and libera_private_edit order by ordem limit 1`)).id)
  const dia = (n) => r(`to_char((now() at time zone 'America/Sao_Paulo')::date + $1::int, 'YYYYMMDD')`, [n])
  const quando = (n) => `((now() at time zone 'America/Sao_Paulo')::date + ${Number(n)})::timestamp + time '19:00'`
  const criarPE = (codigo, n) => r(`public.vessel_criar_private_edit($1, (${quando(n)}) at time zone 'America/Sao_Paulo', null, 'CPS', 'iguatemi', 8)`, [codigo])
  /** O caso do defeito: um encontro no dia D muda para D+1, e cria-se outro no dia D. */
  const cenario = async () => {
    const s = await r(`public.vessel_stylist_criar('Prova Código', '(19) 99000-2591', null, null, null, null, null, 'pesquisa')`)
    await r(`public.vessel_stylist_mover_de_etapa($1, $2)`, [s.codigo, ativada])
    const e1 = await criarPE(s.codigo, 40)
    const ed = await r(`public.vessel_private_edit_editar($1, (${quando(41)}) at time zone 'America/Sao_Paulo')`, [e1.codigo])
    const segundo = await tentar(() => criarPE(s.codigo, 40))
    return { s: s.codigo, e1, ed, segundo }
  }

  console.log('\n── ANTES: o defeito, reproduzido')
  await cli.query('savepoint antes')
  const velho = await cenario()
  conferir(velho.e1.ok && velho.e1.codigo === `PE-${await dia(40)}-CPS-01` && velho.ed.ok,
    `encontro criado em D (${velho.e1.codigo}) e mudado para D+1`, velho)
  conferir(velho.segundo.e?.code === '23505' && /vessel_private_edits_codigo_idx/.test(velho.segundo.e?.message || ''),
    'criar outro no dia D QUEBRA com chave duplicada (o defeito)', velho.segundo.e?.message || velho.segundo.v)
  await cli.query('rollback to savepoint antes')

  console.log('\n── aplicar e registrar')
  await cli.query(ler(ARQUIVO))
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-codigo-do-encontro-sem-repetir.mjs'])
  const depoisDaMigration = await uma(IMPRESSAO)
  conferir(igual(depoisDaMigration, antes), 'os códigos que já existem (encontros e sessões) e as stylists: intactos', { antes, depoisDaMigration })
  for (const [f, def] of [['vessel_criar_private_edit(text,timestamp with time zone,text,text,text,integer,boolean)', true],
    ['vessel_beauty_session_criar(text,date,text,text,text)', true], ['vessel_codigo_de_evento_usado(text)', false]]) {
    const pr = await uma(`select has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
      has_function_privilege('anon', $1, 'EXECUTE') as anon, (select count(*)::int from pg_proc where proname = $2) as n`, [`public.${f}`, f.split('(')[0]])
    conferir(pr.aut === def && pr.anon === false && pr.n === 1, `${f}: ${def ? 'authenticated sim' : 'miolo fechado'}, anon não, uma assinatura`, pr)
  }

  console.log('\n── DEPOIS: o mesmo caso cria com o próximo número livre')
  await cli.query('savepoint depois')
  const novo = await cenario()
  const d40 = await dia(40)
  conferir(novo.e1.codigo === `PE-${d40}-CPS-01` && novo.segundo.v?.ok === true && novo.segundo.v.codigo === `PE-${d40}-CPS-02`,
    `o segundo do dia D nasce ${novo.segundo.v?.codigo} (o 01 continua com o que mudou de dia)`, novo)
  const terceiro = await criarPE(novo.s, 40)
  conferir(terceiro.codigo === `PE-${d40}-CPS-03`, `e o terceiro, ${terceiro.codigo}`, terceiro)
  const mudou = await uma(`select codigo, (quando at time zone 'America/Sao_Paulo')::date::text as dia from public.vessel_private_edits where codigo = $1`, [novo.e1.codigo])
  conferir(mudou.codigo === novo.e1.codigo && mudou.dia.replace(/-/g, '') === await dia(41),
    'o encontro que mudou de dia MANTÉM o código dele (links e QR já enviados)', mudou)
  const trava = await uma(`select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
    and objid = (hashtext('vessel.codigo_do_encontro:PE-' || $1 || '-CPS-') & 4294967295)::oid`, [d40])
  conferir(trava.n >= 1, 'a FILA: a trava do dia e da praça está presa até o fim da transação (a outra criação espera)', trava)
  // Código com rastro fora da tabela (encontro apagado que deixou leitura): pulado.
  const d50 = await dia(50)
  await cli.query(`insert into public.vessel_sessao_aberturas (codigo, peca, via) values ($1, 'prova', 'prova')`, [`PE-${d50}-CPS-01`])
  const pulou = await criarPE(novo.s, 50)
  conferir(pulou.codigo === `PE-${d50}-CPS-02`, `código com rastro de um encontro apagado não é reusado: nasce ${pulou.codigo}`, pulou)
  // Beauty Session: código já usado (inclusive só no rastro) é recusado com a frase de sempre.
  const bsLivre = `BS-${d50}-CPS-91`, bsRastro = `BS-${d50}-CPS-92`
  const bs1 = await r(`public.vessel_beauty_session_criar($1, (now() at time zone 'America/Sao_Paulo')::date + 50, 'CPS', 'iguatemi')`, [bsLivre])
  const bs2 = await r(`public.vessel_beauty_session_criar($1, (now() at time zone 'America/Sao_Paulo')::date + 50, 'CPS', 'iguatemi')`, [bsLivre])
  await cli.query(`insert into public.vessel_sessao_aberturas (codigo, peca, via) values ($1, 'mesa', 'prova')`, [bsRastro])
  const bs3 = await r(`public.vessel_beauty_session_criar($1, (now() at time zone 'America/Sao_Paulo')::date + 50, 'CPS', 'iguatemi')`, [bsRastro])
  conferir(bs1.ok && bs2.ok === false && /Já existe uma sessão/.test(bs2.erro) && bs3.ok === false && /Já existe uma sessão/.test(bs3.erro),
    'Beauty Session: código livre cria; repetido recusa; o de uma sessão apagada (só com as leituras do QR) também recusa', { bs1, bs2, bs3 })
  await cli.query(`select set_config('request.jwt.claims', '', true)`)
  const anon = await criarPE(novo.s, 60)
  conferir(anon.situacao === 'sem_permissao', 'sem sessão: recusa', anon)
  await cli.query('rollback to savepoint depois')

  const depoisDaProva = await uma(IMPRESSAO)
  conferir(igual(depoisDaProva, antes), 'a prova não deixou rastro: os códigos de hoje, iguais', { antes, depoisDaProva })

  if (falhas.length) throw new Error(`${falhas.length} conferência(s) falharam`)
  if (GRAVAR) {
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

{
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  const agora = (await outra.query(IMPRESSAO)).rows[0]
  const reg = (await outra.query(`select 1 from public.schema_migrations where name = $1`, [ARQUIVO])).rowCount
  const fn = (await outra.query(`select count(*)::int as n from pg_proc where proname = 'vessel_codigo_de_evento_usado'`)).rows[0].n
  await outra.end()
  const esperado = GRAVAR && !process.exitCode ? 1 : 0
  if (!igual(agora, antes) || reg !== esperado || fn !== esperado) {
    console.error('❌ conexão nova: o banco não está como devia', { antes, agora, reg, fn }); process.exitCode = 1
  } else console.log(`  ✓ conexão nova: códigos de hoje intactos; ${esperado ? 'migration registrada' : 'nada gravado (sem função nova, sem registro)'}`)
}
