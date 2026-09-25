// APLICA, REGISTRA e PROVA: o convite individual do Private Edit ganha teto de
// respostas (10/h por convidada, 60/h por endereço) e a abertura feita pela equipe
// deixa de contar.
//
//   node --env-file=<coletor/.env> coletor/aplicar-vessel-convite-da-convidada-teto-e-abertura-da-equipe.mjs            → ensaio: prova tudo e DESFAZ
//   node --env-file=<coletor/.env> coletor/aplicar-vessel-convite-da-convidada-teto-e-abertura-da-equipe.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ, provas em savepoints desfeitos, `commit` conferido
// (`.command === 'COMMIT'`), e as convidadas de hoje (resposta, aberturas) e as
// permissões conferidas antes, depois da migration, depois do desfazer e numa
// conexão nova. O encontro e as convidadas da prova nascem e morrem dentro de
// savepoints desfeitos.
//
// ⚠️ "O SITE CONTINUA FUNCIONANDO" é provado como o site chama: papel `anon`
// (`set local role anon`) e argumentos POR NOME (`p_chave => …`), que é o que o
// PostgREST faz com o corpo JSON da página. A assinatura de
// `vessel_convite_da_convidada` muda (2 → 3), e é isso que a prova cobre.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-25-vessel-convite-da-convidada-teto-e-abertura-da-equipe.sql'
const GRAVAR = process.argv.slice(2).includes('--gravar')

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const IMPRESSAO = `
  select (select count(*) from public.vessel_atendimentos)::int as atendimentos,
         (select md5(coalesce(string_agg(id || ':' || coalesce(rsvp, '-') || ':' || convite_aberturas || ':' || coalesce(convite_aberto_em::text, '-'), '|' order by id), ''))
            from public.vessel_atendimentos where evento_codigo is not null) as convidadas,
         (select count(*) from public.vessel_consentimentos)::int as consentimentos,
         (select count(*) from public.vessel_private_edits)::int as encontros`

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
const antes = await uma(IMPRESSAO)
console.log(`hoje: ${antes.atendimentos} atendimento(s), ${antes.encontros} encontro(s)`)

await cli.query('begin')
try {
  // ── quem fala: a equipe (Atendimentos), alguém da Central SEM Atendimentos, e a página (anon)
  const pessoa = async (rotulo, features, permissions) => {
    const id = randomUUID(), email = `prova-convite-${rotulo}-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin)
      values ($1, $2, $3, $4, $5::jsonb, false)`, [id, email, `Prova ${rotulo}`, features, JSON.stringify(permissions)])
    return id
  }
  const equipe = await pessoa('equipe', ['atendimentos'], { atendimentos: ['ver', 'editar'] })
  const outra = await pessoa('outra', ['patrimonio'], { patrimonio: ['ver'] })
  const falarComo = (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [id ? JSON.stringify({ sub: id, role: 'authenticated' }) : ''])
  const deOnde = (ip) => cli.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': ip })])
  /** Como a PÁGINA chama: papel anon, sem sessão, argumentos por nome. */
  const comoPagina = async (sql, a) => {
    await falarComo(null)
    await cli.query('set local role anon')
    try { return await r(sql, a) } finally { await cli.query('reset role') }
  }
  const abrir = (ch, extra = '') => comoPagina(`public.vessel_convite_da_convidada(p_chave => $1, p_convidada => $2${extra})`, [ch.chave_encontro, ch.chave])
  const responder = (ch, resp) => comoPagina(`public.vessel_rsvp_da_convidada(p_chave => $1, p_convidada => $2, p_resposta => $3, p_aceite_versao => 'prova')`, [ch.chave_encontro, ch.chave, resp])
  const linha = (id) => uma(`select rsvp, convite_aberturas, convite_aberto_em from public.vessel_atendimentos where id = $1`, [id])

  /** Um encontro de prova com duas convidadas. */
  const montar = async () => {
    await falarComo(equipe)
    const ativada = Number((await uma(`select id from public.vessel_stylist_etapas where ativa and libera_private_edit order by ordem limit 1`)).id)
    const s = await r(`public.vessel_stylist_criar('Prova Convite', '(19) 97300-2591', null, null, null, null, null, 'pesquisa')`)
    await r(`public.vessel_stylist_mover_de_etapa($1, $2)`, [s.codigo, ativada])
    const pe = await r(`public.vessel_criar_private_edit($1, (((now() at time zone 'America/Sao_Paulo')::date + 45)::timestamp + time '19:00') at time zone 'America/Sao_Paulo', null, 'CPS', 'iguatemi', 8, true)`, [s.codigo])
    const a = await r(`public.vessel_convidar_para_encontro($1, 'Ana da Prova', '(19) 97300-1101')`, [pe.codigo])
    const b = await r(`public.vessel_convidar_para_encontro($1, 'Bia da Prova', '(19) 97300-1102')`, [pe.codigo])
    const chA = await r(`public.vessel_chave_da_convidada($1)`, [a.id])
    const chB = await r(`public.vessel_chave_da_convidada($1)`, [b.id])
    await falarComo(null)
    if (!pe.ok || !chA?.ok || !chB?.ok) throw new Error(`não montei o encontro de prova: ${JSON.stringify({ s, pe, a, b })}`)
    return { a: a.id, b: b.id, chA, chB }
  }

  console.log('\n── ANTES: os dois defeitos, reproduzidos (encontro de prova, desfeito)')
  await cli.query('savepoint antes')
  {
    const m = await montar()
    await deOnde('203.0.113.7')
    for (let i = 0; i < 11; i++) await responder(m.chA, i % 2 ? 'falar-com-equipe' : 'sim')
    const ultima = await responder(m.chA, 'falar-com-equipe')
    conferir(ultima.situacao === 'recebido' && (await linha(m.a)).rsvp === 'falar-com-equipe',
      'a 12ª resposta seguida da mesma convidada ainda REESCREVE a resposta (sem teto)', await linha(m.a))
    await cli.query('set local role authenticated')
    await falarComo(equipe)
    await r(`public.vessel_convite_da_convidada($1, $2)`, [m.chB.chave_encontro, m.chB.chave])
    await cli.query('reset role')
    conferir((await linha(m.b)).convite_aberturas === 1, 'uma abertura feita com a sessão da equipe CONTA como abertura dela', await linha(m.b))
  }
  await cli.query('rollback to savepoint antes')

  console.log('\n── aplicar e registrar')
  await falarComo(null)
  await cli.query(ler(ARQUIVO))
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-convite-da-convidada-teto-e-abertura-da-equipe.mjs'])
  const depoisDaMigration = await uma(IMPRESSAO)
  conferir(igual(depoisDaMigration, antes), 'as convidadas de hoje (resposta, aberturas) e as permissões: intactas', { antes, depoisDaMigration })
  const fns = await uma(`select
      (select count(*)::int from pg_proc where proname = 'vessel_convite_da_convidada') as n_convite,
      (select count(*)::int from pg_proc where proname = 'vessel_rsvp_da_convidada') as n_rsvp,
      to_regprocedure('public.vessel_convite_da_convidada(text,text)') is null as dois_sumiu,
      has_function_privilege('anon', 'public.vessel_convite_da_convidada(text,text,boolean)', 'EXECUTE') as conv_anon,
      has_function_privilege('authenticated', 'public.vessel_convite_da_convidada(text,text,boolean)', 'EXECUTE') as conv_aut,
      has_function_privilege('service_role', 'public.vessel_convite_da_convidada(text,text,boolean)', 'EXECUTE') as conv_srv,
      has_function_privilege('anon', 'public.vessel_rsvp_da_convidada(text,text,text,boolean,text,text)', 'EXECUTE') as rsvp_anon,
      has_function_privilege('authenticated', 'public.vessel_rsvp_da_convidada(text,text,text,boolean,text,text)', 'EXECUTE') as rsvp_aut`)
  conferir(fns.n_convite === 1 && fns.n_rsvp === 1 && fns.dois_sumiu && fns.conv_anon && fns.conv_aut && fns.conv_srv && fns.rsvp_anon && fns.rsvp_aut,
    'uma assinatura de cada; a de 2 parâmetros sumiu; grants iguais aos de hoje (anon, authenticated, service_role)', fns)
  const tab = await uma(`select c.relrowsecurity as rls,
      (select count(*)::int from pg_policies where tablename = 'vessel_rsvp_tentativas') as politicas,
      (select count(*)::int from information_schema.role_table_grants where table_name = 'vessel_rsvp_tentativas' and grantee in ('anon', 'authenticated')) as grants
      from pg_class c where c.relname = 'vessel_rsvp_tentativas'`)
  conferir(tab.rls === true && tab.politicas === 0 && tab.grants === 0, 'vessel_rsvp_tentativas: RLS ligada, sem política, sem grant para anon/authenticated', tab)
  for (const papel of ['anon', 'authenticated']) {
    await cli.query(`set local role ${papel}`)
    const lida = await tentar(() => uma(`select count(*) from public.vessel_rsvp_tentativas`))
    await cli.query('reset role')
    conferir(lida.e?.code === '42501', `${papel} lendo vessel_rsvp_tentativas: RECUSADO (42501), não lista vazia`, lida.e?.message || lida.v)
  }

  console.log('\n── DEPOIS (a): o teto de respostas')
  await cli.query('savepoint depois')
  {
    const m = await montar()
    await deOnde('203.0.113.7')
    const respostas = []
    for (let i = 0; i < 10; i++) respostas.push(await responder(m.chA, i % 2 ? 'falar-com-equipe' : 'sim'))
    const depoisDe10 = await linha(m.a)
    conferir(respostas.every((x) => x.ok && x.situacao === 'recebido') && depoisDe10.rsvp === 'falar-com-equipe',
      'as 10 primeiras respostas da hora: gravadas como hoje', depoisDe10)
    const consAntes = Number((await uma(`select count(*)::int n from public.vessel_consentimentos where pessoa_id = (select pessoa_id from public.vessel_atendimentos where id = $1)`, [m.a])).n)
    const onze = await responder(m.chA, 'sim')
    const consDepois = Number((await uma(`select count(*)::int n from public.vessel_consentimentos where pessoa_id = (select pessoa_id from public.vessel_atendimentos where id = $1)`, [m.a])).n)
    conferir(igual(onze, { ok: true, situacao: 'recebido' }) && (await linha(m.a)).rsvp === 'falar-com-equipe' && consDepois === consAntes,
      'a 11ª da mesma convidada: responde "recebido" com calma e NÃO grava (resposta e permissões iguais)', { onze, linha: await linha(m.a), consAntes, consDepois })
    // o teto por endereço é 60/h (dono, 25/09: várias convidadas respondem pelo Wi-Fi da loja):
    // a Bia, do MESMO endereço, com 10 na hora ainda GRAVA; com 60 na hora, é segurada.
    const doMesmo = await responder(m.chB, 'sim')
    conferir(doMesmo.situacao === 'recebido' && (await linha(m.b)).rsvp === 'sim',
      'outra convidada do MESMO endereço com só 10 na hora: grava (o teto por endereço é 60)', await linha(m.b))
    const ip = (await uma(`select ip_hash from public.vessel_rsvp_tentativas where atendimento_id = $1 limit 1`, [m.a])).ip_hash
    await cli.query(`insert into public.vessel_rsvp_tentativas (atendimento_id, ip_hash, momento)
                     select $1, $2, now() from generate_series(1, 49)`, [m.a, ip])
    const noTeto = await responder(m.chB, 'falar-com-equipe')
    conferir(igual(noTeto, { ok: true, situacao: 'recebido' }) && (await linha(m.b)).rsvp === 'sim',
      'com 60 vindas do mesmo endereço na hora: "recebido" e NÃO grava', await linha(m.b))
    await deOnde('198.51.100.20')
    const deOutro = await responder(m.chB, 'falar-com-equipe')
    conferir(deOutro.situacao === 'recebido' && (await linha(m.b)).rsvp === 'falar-com-equipe', 'a mesma convidada de OUTRO endereço: grava', await linha(m.b))
    const n = Number((await uma(`select count(*)::int n from public.vessel_rsvp_tentativas where atendimento_id in ($1, $2)`, [m.a, m.b])).n)
    conferir(n === 61, `só as tentativas que gravaram ficam anotadas (${n} = 10 + 1 + 49 de preparo + 1; as seguradas não enchem a tabela)`, n)
    const errado = await comoPagina(`public.vessel_rsvp_da_convidada(p_chave => $1, p_convidada => 'ZZZZZZZZ', p_resposta => 'sim')`, [m.chA.chave_encontro])
    const invalida = await responder(m.chB, 'talvez')
    const robo = await comoPagina(`public.vessel_rsvp_da_convidada(p_chave => $1, p_convidada => $2, p_resposta => 'sim', p_armadilha => 'x')`, [m.chB.chave_encontro, m.chB.chave])
    conferir(errado.situacao === 'convite_invalido' && invalida.situacao === 'resposta_invalida' && robo.situacao === 'recebido',
      'as respostas de sempre: link errado, resposta inválida e a armadilha do robô', { errado, invalida, robo })
  }
  await cli.query('rollback to savepoint depois')

  console.log('\n── DEPOIS (b): a abertura da equipe não conta')
  await cli.query('savepoint depois')
  {
    const m = await montar()
    const pagina = await abrir(m.chA)
    conferir(pagina.ok === true && pagina.primeiro_nome === 'Ana' && (await linha(m.a)).convite_aberturas === 1 && (await linha(m.a)).convite_aberto_em,
      'a página (anon, por nome, sem marcador): conta a abertura, como hoje', { pagina, linha: await linha(m.a) })
    const prevEquipe = await abrir(m.chA, ', p_equipe => true')
    conferir(igual(prevEquipe, pagina) && (await linha(m.a)).convite_aberturas === 1,
      'com o marcador da equipe (?equipe=1 → p_equipe): a MESMA resposta, e a conta não mexe', { prevEquipe, linha: await linha(m.a) })
    const abertoEm = (await linha(m.b)).convite_aberto_em
    await cli.query('set local role authenticated'); await falarComo(equipe)
    const comSessao = await r(`public.vessel_convite_da_convidada($1, $2)`, [m.chB.chave_encontro, m.chB.chave])
    await cli.query('reset role')
    conferir(comSessao.ok && (await linha(m.b)).convite_aberturas === 0 && (await linha(m.b)).convite_aberto_em === abertoEm,
      'com a sessão de alguém de Atendimentos: não conta (nem o "abriu em")', await linha(m.b))
    await cli.query('set local role authenticated'); await falarComo(outra)
    await r(`public.vessel_convite_da_convidada($1, $2)`, [m.chB.chave_encontro, m.chB.chave])
    await cli.query('reset role'); await falarComo(null)
    conferir((await linha(m.b)).convite_aberturas === 1, 'sessão de alguém SEM Atendimentos: conta (só a equipe do convite é descontada)', await linha(m.b))
    const posicional = await r(`public.vessel_convite_da_convidada($1, $2)`, [m.chB.chave_encontro, m.chB.chave])
    conferir(posicional.ok && (await linha(m.b)).convite_aberturas === 2, 'chamada antiga com 2 argumentos (posicional): continua funcionando e contando', await linha(m.b))
  }
  await cli.query('rollback to savepoint depois')

  const depoisDaProva = await uma(IMPRESSAO)
  conferir(igual(depoisDaProva, antes), 'a prova não deixou rastro: convidadas, encontros e permissões iguais', { antes, depoisDaProva })

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
  const tabela = (await outra.query(`select count(*)::int as n from pg_class where relname = 'vessel_rsvp_tentativas'`)).rows[0].n
  const doisArgs = (await outra.query(`select (to_regprocedure('public.vessel_convite_da_convidada(text,text)') is not null)::int as n`)).rows[0].n
  await outra.end()
  const esperado = GRAVAR && !process.exitCode ? 1 : 0
  if (!igual(agora, antes) || reg !== esperado || tabela !== esperado || doisArgs !== 1 - esperado) {
    console.error('❌ conexão nova: o banco não está como devia', { antes, agora, reg, tabela, doisArgs }); process.exitCode = 1
  } else console.log(`  ✓ conexão nova: convidadas de hoje intactas; ${esperado ? 'migration registrada' : 'nada gravado (sem tabela nova, a função de 2 parâmetros de hoje continua)'}`)
}
