// APLICA, REGISTRA e PROVA a anotação de qual anúncio trouxe cada cadastro.
//
// ⚠️ A PROVA CHAMA A FUNÇÃO DE VERDADE, com cadastro de mentira, dentro de um
// `savepoint` que é desfeito antes do `commit`. Conferir o texto da migration
// provaria que eu escrevi o `insert`; só chamando é que se sabe se a campanha
// chega na linha — e se a SEGUNDA visita não apaga a primeira.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-22-lp-anota-de-qual-anuncio-veio.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const ASSINATURA = 'text,text,text,text,text,text,jsonb'
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-atribuicao-da-lp.mjs'])

  // ── só existe UMA função com este nome ────────────────────────────────────
  // ⚠️ Duas sobrecargas fariam o PostgREST não saber qual chamar, e a LP
  // quebraria com um erro que não fala de sobrecarga nenhuma.
  const { rows: assinaturas } = await cli.query(
    `select pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='vessel_entrar_na_lista'`)
  if (assinaturas.length !== 1) {
    throw new Error(`ficaram ${assinaturas.length} funcoes com o mesmo nome: `
      + JSON.stringify(assinaturas.map((a) => a.args)))
  }
  if (!assinaturas[0].args.includes('p_rastreio jsonb')) {
    throw new Error('a funcao nao recebeu o p_rastreio: ' + assinaturas[0].args)
  }

  // ── a porta: anon entra, authenticated e public NÃO ───────────────────────
  const porta = async (papel) => (await cli.query(
    `select has_function_privilege($1, 'public.vessel_entrar_na_lista(${ASSINATURA})', 'EXECUTE') as pode`,
    [papel])).rows[0].pode
  if (!await porta('anon')) throw new Error('⚠️ a LP NAO consegue mais chamar a funcao')
  if (await porta('authenticated')) throw new Error('authenticated continua com a porta aberta')
  if (!await porta('service_role')) throw new Error('service_role perdeu a porta')

  await cli.query('savepoint prova')

  const chamar = (email, rastreio, nome = 'Prova do Aplicador') => cli.query(
    `select public.vessel_entrar_na_lista($1,$2,$3,$4,null,'prova-do-aplicador',$5::jsonb) as r`,
    [nome, email, '19999990000', 'prova', rastreio ? JSON.stringify(rastreio) : null])
  const linha = (email) => cli.query(
    `select utm_source, utm_medium, utm_campaign, utm_content, utm_term, clique_meta
       from public.vessel_lista_espera where lower(email) = lower($1)`, [email])

  // 1 · a campanha CHEGA na linha
  const email = `prova-${Date.now()}@exemplo.invalido`
  const r1 = (await chamar(email, {
    utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'lancamento-set',
    utm_content: 'video-01', utm_term: 'bolsa', clique_meta: 'IwAR0-um-clique',
  })).rows[0].r
  if (!r1.ok) throw new Error('o cadastro de prova foi recusado: ' + JSON.stringify(r1))
  const { rows: [g1] } = await linha(email)
  if (!g1) throw new Error('o cadastro nao entrou')
  if (g1.utm_campaign !== 'lancamento-set' || g1.utm_source !== 'facebook'
      || g1.clique_meta !== 'IwAR0-um-clique') {
    throw new Error('a campanha nao chegou na linha: ' + JSON.stringify(g1))
  }

  // 2 · ⚠️ A SEGUNDA VISITA NÃO REESCREVE A PRIMEIRA (first touch)
  await chamar(email, { utm_campaign: 'OUTRA-CAMPANHA', utm_source: 'google' })
  const { rows: [g2] } = await linha(email)
  if (g2.utm_campaign !== 'lancamento-set' || g2.utm_source !== 'facebook') {
    throw new Error('a segunda visita sobrescreveu o first touch: ' + JSON.stringify(g2))
  }

  // 3 · campo VAZIO é preenchido depois (completar não é sobrescrever)
  const email2 = `prova2-${Date.now()}@exemplo.invalido`
  await chamar(email2, null)                                  // entra sem campanha
  await chamar(email2, { utm_campaign: 'chegou-depois' })      // volta com campanha
  const { rows: [g3] } = await linha(email2)
  if (g3.utm_campaign !== 'chegou-depois') {
    throw new Error('campo vazio nao foi preenchido na volta: ' + JSON.stringify(g3))
  }

  // 4 · texto gigante é aparado, e o campo não vira depósito
  const email3 = `prova3-${Date.now()}@exemplo.invalido`
  await chamar(email3, { utm_campaign: 'x'.repeat(5000), clique_meta: 'y'.repeat(5000) })
  const { rows: [g4] } = await linha(email3)
  if (g4.utm_campaign.length !== 200) throw new Error('utm nao foi aparado: ' + g4.utm_campaign.length)
  if (g4.clique_meta.length !== 500) throw new Error('clique nao foi aparado: ' + g4.clique_meta.length)

  // 5 · quem chama SEM o parâmetro novo continua funcionando (é o site de hoje)
  const email4 = `prova4-${Date.now()}@exemplo.invalido`
  const r5 = (await cli.query(
    `select public.vessel_entrar_na_lista($1,$2,$3,$4,null,'prova-do-aplicador') as r`,
    ['Sem rastreio', email4, '19999990000', 'prova'])).rows[0].r
  if (!r5.ok) throw new Error('a chamada ANTIGA (sem rastreio) quebrou: ' + JSON.stringify(r5))

  // 6 · a armadilha continua muda
  const r6 = (await cli.query(
    `select public.vessel_entrar_na_lista($1,$2,$3,$4,'sou um robo','prova-do-aplicador',null) as r`,
    ['Robo', `robo-${Date.now()}@exemplo.invalido`, '19999990000', 'prova'])).rows[0].r
  if (r6.ok !== true || r6.situacao !== 'reservado') {
    throw new Error('a armadilha mudou de comportamento: ' + JSON.stringify(r6))
  }

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query(
    `select count(*)::int n from public.vessel_lista_espera where origem = 'prova-do-aplicador'`)
  if (sobrou.n !== 0) throw new Error(`a prova deixou ${sobrou.n} cadastro(s) para tras`)

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  uma funcao so, agora com p_rastreio')
  console.log('  a porta: anon SIM · authenticated NAO · service_role SIM')
  console.log('  a campanha chega na linha do cadastro')
  console.log('  ⚠️ a segunda visita NAO reescreve a primeira (first touch)')
  console.log('  campo vazio E preenchido na volta (completar != sobrescrever)')
  console.log('  texto gigante e aparado em 200 (utm) e 500 (clique)')
  console.log('  a chamada ANTIGA, sem rastreio, continua funcionando')
  console.log('  a armadilha continua muda')
  console.log('  prova desfeita, nenhum cadastro de mentira ficou')
} catch (e) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + e.message)
  process.exitCode = 1
} finally { await cli.end() }
