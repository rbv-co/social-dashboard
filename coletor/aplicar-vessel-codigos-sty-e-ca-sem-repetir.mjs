// APLICA, REGISTRA e PROVA: os códigos STY (inscrição da página do Stylist
// Circle) e CA (a Client Advisor se identifica) nunca se repetem.
//
//   node --env-file=<coletor/.env> coletor/aplicar-vessel-codigos-sty-e-ca-sem-repetir.mjs            → ensaio: prova tudo e DESFAZ
//   node --env-file=<coletor/.env> coletor/aplicar-vessel-codigos-sty-e-ca-sem-repetir.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ ORDEM: `2026-09-24-vessel-stylist-sem-contato.sql` tem de estar no banco
// (ela é a versão de hoje de `vessel_stylist_criar`, que esta NÃO toca, mas que
// divide a trava com a inscrição). Sem ela, este aplicador PARA.
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ, provas em savepoints desfeitos, `commit` conferido
// (`.command === 'COMMIT'`), e os códigos que já existem conferidos antes,
// depois da migration, depois do desfazer e numa conexão nova. As provas só
// criam e apagam linhas de TESTE, dentro de savepoints desfeitos.
//
// ⚠️ A CORRIDA DE DUAS CONEXÕES NÃO É PROVÁVEL NO ENSAIO (a função nova só
// existe dentro desta transação). A prova é a da FILA (a trava aparece em
// `pg_locks`) e a do "maior + 1" depois de uma exclusão.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-25-vessel-codigos-sty-e-ca-sem-repetir.sql'
const ANTES_DESTA = '2026-09-24-vessel-stylist-sem-contato.sql'
const GRAVAR = process.argv.slice(2).includes('--gravar')

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const IMPRESSAO = `
  select (select count(*) from public.vessel_stylists)::int as stylists,
         (select md5(coalesce(string_agg(id || ':' || codigo, '|' order by id), '')) from public.vessel_stylists) as codigos_sty,
         (select md5(coalesce(string_agg(row_to_json(s)::text, '|' order by s.id), '')) from public.vessel_stylists s) as stylists_inteiras,
         (select count(*) from public.vessel_client_advisors)::int as cas,
         (select md5(coalesce(string_agg(row_to_json(c)::text, '|' order by c.id), '')) from public.vessel_client_advisors c) as cas_inteiras,
         (select count(*) from public.vessel_consentimentos)::int as consentimentos`
const FUNCOES = [
  ['vessel_pedido_do_stylist(text,text,text,text,text,text,text,text,boolean,text,jsonb,text,boolean)', { anon: true, aut: false }],
  ['vessel_identificar_client_advisor(text,text,boolean)', { anon: true, aut: true }],
  ['vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date,text,boolean)', { anon: false, aut: true }],
]

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
const privilegios = async () => {
  const out = {}
  for (const [f] of FUNCOES) {
    out[f] = await uma(`select has_function_privilege('anon', $1, 'EXECUTE') as anon,
      has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
      (select count(*)::int from pg_proc where proname = $2) as n`, [`public.${f}`, f.split('(')[0]])
  }
  return out
}

if (await registrada(ARQUIVO)) { console.error(`❌ ${ARQUIVO} já está registrada.`); process.exit(1) }
if (!(await registrada(ANTES_DESTA))) { console.error(`❌ ${ANTES_DESTA} vai primeiro e não está no banco.`); process.exit(1) }
const antes = await uma(IMPRESSAO)
const privAntes = await privilegios()
console.log(`hoje: ${antes.stylists} stylist(s), ${antes.cas} Client Advisor(s)`)

await cli.query('begin')
try {
  // números de telefone de prova, que não existem na base
  const fone = (n) => `(19) 9${String(7100 + n).padStart(4, '0')}-${String(2500 + n).padStart(4, '0')}`
  const inscrever = (n) => r(`public.vessel_pedido_do_stylist($1, $2, null, null, null, null, null, null, false, 'prova', null, null, true)`,
    [`Prova Código ${n}`, fone(n)])
  const codigoDe = async (n) => (await uma(`select codigo from public.vessel_stylists where whatsapp = public.vessel_telefone_canonico($1)`, [fone(n)]))?.codigo
  const maiorSty = async () => Number((await uma(`select coalesce(max((substring(codigo from '^STY-([0-9]{4})$'))::int), 0) as n from public.vessel_stylists where codigo ~ '^STY-[0-9]{4}$'`)).n)
  const sty = (n) => `STY-${String(n).padStart(4, '0')}`
  const nomeCA = (s) => `Prova Advisor ${s} ${randomUUID().slice(0, 6)}`
  const identificar = (nome) => r(`public.vessel_identificar_client_advisor($1, 'iguatemi', true)`, [nome])
  const maiorCA = async () => Number((await uma(`select coalesce(max(n), 0) as n from (
      select (substring(codigo from '^CA-([0-9]{1,6})$'))::int n from public.vessel_client_advisors
      union all select (substring(client_advisor from '^CA-([0-9]{1,6})$'))::int from public.vessel_atendimentos
      union all select (substring(client_advisor from '^CA-([0-9]{1,6})$'))::int from public.vessel_convite_aberturas) u`)).n)
  const ca = (n) => `CA-${String(n).padStart(2, '0')}`

  /** O caso do defeito: um BURACO abaixo do maior número (é o que uma stylist
   *  apagada deixa). ⚠️ Apagar de verdade não dá para provar: o histórico de
   *  etapas é só-acrescenta e segura a stylist pela chave. Então o buraco é
   *  feito ao contrário — uma stylist de prova nasce com o número "count + 2",
   *  e a inscrição seguinte, que conta "count + 1", cai em cima dela. */
  const cenarioSty = async () => {
    const n = Number((await uma(`select count(*)::int n from public.vessel_stylists`)).n)
    const buraco = sty(n + 2)
    await cli.query(`insert into public.vessel_stylists (codigo, nome, whatsapp, teste) values ($1, 'Prova Buraco', public.vessel_telefone_canonico($2), true)`, [buraco, fone(9)])
    const m = await maiorSty()
    const terceira = await tentar(() => inscrever(3))
    return { n, buraco, m, terceira, c3: terceira.v ? await codigoDe(3) : null }
  }
  const cenarioCa = async () => {
    const m = await maiorCA()
    const a = await identificar(nomeCA('A')), b = await identificar(nomeCA('B'))
    await cli.query(`delete from public.vessel_client_advisors where codigo = $1`, [a.codigo])
    const terceira = await tentar(() => identificar(nomeCA('C')))
    return { m, a: a.codigo, b: b.codigo, terceira }
  }

  console.log('\n── ANTES: os dois defeitos, reproduzidos (só linhas de prova, desfeitas)')
  await cli.query('savepoint antes')
  const velhoS = await cenarioSty()
  conferir(velhoS.terceira.e?.code === '23505' && /vessel_stylists_codigo_idx/.test(velhoS.terceira.e?.message || ''),
    `com o ${velhoS.buraco} já dado acima da conta, a inscrição seguinte QUEBRA com chave duplicada (o defeito)`, velhoS.terceira.e?.message || velhoS.terceira.v)
  await cli.query('rollback to savepoint antes')
  await cli.query('savepoint antes')
  const velhoC = await cenarioCa()
  conferir(velhoC.a === ca(velhoC.m + 1) && velhoC.b === ca(velhoC.m + 2), `duas Client Advisors de prova nascem ${velhoC.a} e ${velhoC.b}`, velhoC)
  conferir(velhoC.terceira.e?.code === '23505' && /vessel_client_advisors_codigo_idx/.test(velhoC.terceira.e?.message || ''),
    'apagada a primeira, a terceira QUEBRA com chave duplicada (o defeito)', velhoC.terceira.e?.message || velhoC.terceira.v)
  await cli.query('rollback to savepoint antes')

  console.log('\n── aplicar e registrar')
  await cli.query(ler(ARQUIVO))
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-codigos-sty-e-ca-sem-repetir.mjs'])
  const depoisDaMigration = await uma(IMPRESSAO)
  conferir(igual(depoisDaMigration, antes), 'os códigos que já existem (stylists e Client Advisors): intactos', { antes, depoisDaMigration })
  const privDepois = await privilegios()
  for (const [f, esperado] of FUNCOES) {
    const p = privDepois[f]
    conferir(igual(p, privAntes[f]) && p.anon === esperado.anon && p.aut === esperado.aut && p.n === 1,
      `${f.split('(')[0]}: grants de hoje (anon ${esperado.anon ? 'sim' : 'não'}, authenticated ${esperado.aut ? 'sim' : 'não'}), uma assinatura`, { antes: privAntes[f], depois: p })
  }

  console.log('\n── DEPOIS: o mesmo caso dá o próximo número livre')
  await cli.query('savepoint depois')
  const novoS = await cenarioSty()
  conferir(novoS.terceira.v?.ok === true && novoS.terceira.v.situacao === 'recebido' && novoS.c3 === sty(novoS.m + 1),
    `com o ${novoS.buraco} acima da conta, a inscrição nasce ${novoS.c3} — maior + 1, sem repetir`, novoS)
  conferir(!Object.prototype.hasOwnProperty.call(novoS.terceira.v || {}, 'codigo'), 'a página continua sem receber o código (resposta igual à de hoje)', novoS.terceira.v)
  const travaS = await uma(`select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
    and objid = (hashtext('public.vessel_stylists.codigo') & 4294967295)::oid`)
  conferir(travaS.n >= 1, 'a FILA: a inscrição pega a MESMA trava do cadastro da equipe (um espera o outro)', travaS)
  // a volta da mesma pessoa não cria outra stylist nem muda o código
  await inscrever(3)
  conferir((await codigoDe(3)) === novoS.c3 && Number((await uma(`select count(*)::int n from public.vessel_stylists where whatsapp = public.vessel_telefone_canonico($1)`, [fone(3)])).n) === 1,
    'a mesma pessoa voltando: continua uma stylist só, com o mesmo código', await codigoDe(3))
  // o cadastro pela equipe (a porta que já era certa, NÃO tocada) continua depois dela
  const id = randomUUID(), email = `prova-sty-${id}@teste.invalido`
  await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
  await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin)
    values ($1, $2, 'Prova STY', $3, $4::jsonb, false)`, [id, email, ['atendimentos'], JSON.stringify({ atendimentos: ['ver', 'editar'] })])
  await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })])
  const pelaEquipe = await tentar(() => r(`public.vessel_stylist_criar('Prova Equipe', '(19) 97199-2599', null, null, null, null, null, 'pesquisa')`))
  await cli.query(`select set_config('request.jwt.claims', '', true)`)
  conferir(pelaEquipe.v?.ok === true && pelaEquipe.v.codigo === sty(novoS.m + 2),
    `o cadastro pela equipe (vessel_stylist_criar, sem mudança) segue a mesma conta: ${pelaEquipe.v?.codigo || pelaEquipe.v?.situacao || pelaEquipe.e?.message}`, pelaEquipe)
  await cli.query('rollback to savepoint depois')

  await cli.query('savepoint depois')
  const novoC = await cenarioCa()
  conferir(novoC.terceira.v?.ok === true && novoC.terceira.v.codigo === ca(novoC.m + 3),
    `apagada a primeira (${novoC.a}), a terceira Client Advisor nasce ${novoC.terceira.v?.codigo} — sem repetir ${novoC.b}`, novoC)
  const travaC = await uma(`select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
    and objid = (hashtext('public.vessel_client_advisors.codigo') & 4294967295)::oid`)
  conferir(travaC.n >= 1, 'a FILA da Client Advisor: a trava está presa até o fim da transação', travaC)
  const mesma = await identificar((await uma(`select nome from public.vessel_client_advisors where codigo = $1`, [novoC.b])).nome)
  conferir(mesma.ok && mesma.codigo === novoC.b, 'a mesma Client Advisor se identificando de novo: o mesmo código', mesma)
  // o CA que só ficou nas aberturas (Client Advisor apagada) não é reusado
  const rastro = ca(novoC.m + 4)
  await cli.query(`insert into public.vessel_convite_aberturas (client_advisor, via, teste) values ($1, 'prova', true)`, [rastro])
  const pulou = await identificar(nomeCA('D'))
  conferir(pulou.codigo === ca(novoC.m + 5), `o ${rastro} que só ficou nas aberturas não é reusado: nasce ${pulou.codigo}`, pulou)
  // mais de 99: o código cresce, não é cortado
  await cli.query(`insert into public.vessel_client_advisors (codigo, nome, chave, teste) values ('CA-99', 'Prova 99', $1, true)`, [`prova-99-${randomUUID()}`])
  const cem = await identificar(nomeCA('E'))
  conferir(cem.codigo === 'CA-100', `depois do CA-99 vem ${cem.codigo} (o lpad antigo cortaria para CA-10)`, cem)
  const vazio = await identificar(' ')
  conferir(vazio.ok === false && /Escreva o seu nome/.test(vazio.erro), 'nome vazio: a mesma recusa de hoje', vazio)
  await cli.query('rollback to savepoint depois')

  const depoisDaProva = await uma(IMPRESSAO)
  conferir(igual(depoisDaProva, antes), 'a prova não deixou rastro: stylists, Client Advisors e permissões iguais', { antes, depoisDaProva })

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
  const nova = (await outra.query(`select count(*)::int as n from pg_proc where proname = 'vessel_identificar_client_advisor'
    and prosrc like '%vessel_client_advisors.codigo%'`)).rows[0].n
  await outra.end()
  const esperado = GRAVAR && !process.exitCode ? 1 : 0
  if (!igual(agora, antes) || reg !== esperado || nova !== esperado) {
    console.error('❌ conexão nova: o banco não está como devia', { antes, agora, reg, nova }); process.exitCode = 1
  } else console.log(`  ✓ conexão nova: códigos de hoje intactos; ${esperado ? 'migration registrada' : 'nada gravado (função de hoje, sem registro)'}`)
}
