// APLICA, REGISTRA e PROVA o scorecard da stylist e a nota de qualificação.
//
//   node coletor/aplicar-vessel-stylist-scorecard.mjs            → ensaio: prova tudo e DESFAZ
//   node coletor/aplicar-vessel-stylist-scorecard.mjs --gravar   → prova tudo e só então grava
//
// Num worktree (sem `coletor/.env`), aponte para o do checkout principal SEM
// copiar: `COLETOR_ENV=/Users/erickmartins/iamundi/coletor/.env node …`.
//
// ⚠️ O MESMO PADRÃO DE `aplicar-vessel-t11-bases-do-stylist-circle.mjs`:
//   · TUDO NUMA TRANSAÇÃO SÓ — aplicar, registrar em `schema_migrations`,
//     provar e só então `commit`. Sem `--gravar` o fim é `rollback`;
//   · a prova fala como gente de verdade, com a trava ligada: perfis de
//     mentira em `auth.users`/`profiles` e `request.jwt.claims` com o `sub`
//     deles. Nenhum portão é trocado por `select true`;
//   · toda linha que a prova vê é linha que ela fez, dentro de `savepoint`, e
//     a impressão das tabelas reais é conferida antes e depois do desfazer.
//
// ⚠️ O PLACAR FOI REESCRITO (virou portão + miolo, para o scorecard usar a
// MESMA conta). Por isso a primeira prova é a mais cara: a mesma cena de
// mentira é montada DUAS vezes — uma com o placar de 22/09, antes de aplicar,
// e outra com o de agora — e as respostas, em cinco períodos, têm de ser
// IDÊNTICAS. E o mesmo com os dados reais, sem cena nenhuma.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-24-vessel-stylist-scorecard-e-qualificacao.sql'
const GRAVAR = process.argv.includes('--gravar')

// As funções que a Central chama, com a assinatura que tem de sobrar — uma só.
const PORTAS = {
  vessel_placar_do_stylist_circle: 'vessel_placar_do_stylist_circle(date,date,integer)',
  vessel_scorecard_da_stylist: 'vessel_scorecard_da_stylist(text,date,date,integer)',
  vessel_stylist_avaliar: 'vessel_stylist_avaliar(text,integer,integer,integer,integer,integer,text)',
  vessel_stylist_qualificacoes: 'vessel_stylist_qualificacoes(text)',
  vessel_qualificacoes_vigentes: 'vessel_qualificacoes_vigentes()',
}
// O miolo: ninguém de fora chama.
const MIOLO = [
  'vessel_numeros_do_stylist_circle(date,date,integer,bigint)',
  'vessel_faixa_da_nota(integer)',
  'vessel_stylist_qualificacoes_so_acrescenta()',
]

// ⚠️ TELEFONES SINTÉTICOS, de uma faixa que nenhuma prova anterior usou.
const FONES = {
  styA: '5519990002401', styB: '5519990002402', styC: '5519990002403',
  ana: '5519990002411', bia: '5519990002412', cris: '5519990002413', duda: '5519990002414',
}
const FONES_DE_CONVIDADA = [FONES.ana, FONES.bia, FONES.cris, FONES.duda]

// A impressão do que é de verdade (mesma tolerância da T11 para o que o robô
// do Bling mexe sozinho), mais a tabela nova — que não existe antes.
const IMPRESSAO = `
  select (select count(*) from public.vessel_pedidos)::int as pedidos,
         (select count(*) from public.vessel_pedidos where bling_pedido_id < 0)::int as pedidos_de_prova,
         (select count(*) from public.vessel_pedido_itens)::int as itens,
         (select count(*) from public.vessel_pedido_itens i
            join public.vessel_pedidos p on p.id = i.pedido_id
           where p.bling_pedido_id < 0)::int as itens_de_prova,
         (select count(*) from public.vessel_pessoas)::int as pessoas,
         (select count(*) from public.vessel_pessoas
           where telefone in (${FONES_DE_CONVIDADA.map((f) => `'${f}'`).join(', ')}))::int as pessoas_de_prova,
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
            from (select id, pessoa_id, loja, quando, status, rsvp, evento_codigo, presenca_em, teste
                    from public.vessel_atendimentos) t) as atendimentos,
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
            from (select id, codigo, nome, estagio, ativa, ativada_em, teste
                    from public.vessel_stylists) t) as stylists,
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
            from (select id, codigo, stylist_id, quando, status, realizado_em, arquivada, teste
                    from public.vessel_private_edits) t) as private_edits,
         (select count(*) from public.vessel_stylist_contatos)::int as contatos,
         (select count(*) from public.vessel_origens)::int as origens`

const falhas = []
let provas = 0
const conferir = (ok, frase, detalhe) => {
  provas++
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

if (!process.env.DATABASE_URL) {
  console.error('❌ sem DATABASE_URL. Num worktree: COLETOR_ENV=/Users/erickmartins/iamundi/coletor/.env')
  process.exit(1)
}

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r

const antes = await uma(IMPRESSAO)
const { ja } = await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ja`, [ARQUIVO])
if (ja) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }
const { tabelaJaExiste } = await uma(`select to_regclass('public.vessel_stylist_qualificacoes') is not null as "tabelaJaExiste"`)
if (tabelaJaExiste) { console.error('❌ vessel_stylist_qualificacoes já existe sem registro — pare e descubra quem criou.'); process.exit(1) }

// ⚠️ A ÚNICA FUNÇÃO QUE ESTA MIGRATION SUBSTITUI É O PLACAR — e o miolo novo é
// uma cópia do corpo de 22/09. Se alguém recriou o placar depois disso (outra
// branch, outra etapa do funil), aplicar por cima APAGARIA a mudança dela sem
// erro nenhum. Então: o corpo que está no ar tem de ser, letra por letra
// (espaços à parte), o do arquivo da T11. Se não for, pare e refaça o miolo a
// partir do que está no ar.
{
  const T11 = readFileSync(new URL('../db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql', import.meta.url), 'utf8')
  const achatar = (t) => t.replace(/\s+/g, ' ').trim()
  const noAr = (await cli.query(
    `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'vessel_placar_do_stylist_circle'`)).rows
  const igualAoDe22 = noAr.length === 1 && achatar(T11).includes(achatar(noAr[0].prosrc))
  conferir(igualAoDe22, 'o placar que está no ar é o de 22/09 (o que o miolo copia) — nada de outra branch seria apagado',
    { versoes: noAr.length })
  if (!igualAoDe22) { console.error('❌ o placar no ar não é o da T11. Nada foi feito.'); await cli.end(); process.exit(1) }
}

// ── os ajudantes que falam como gente ─────────────────────────────────────
async function perfil(features, permissions) {
  const id = randomUUID()
  const email = `prova-scorecard-${id}@teste.invalido`
  await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
  await cli.query(
    `insert into public.profiles (id, email, name, features, permissions, is_superadmin)
     values ($1, $2, $3, $4, $5::jsonb, false)`,
    [id, email, 'Avaliadora da Prova', features, JSON.stringify(permissions)])
  return id
}
const falarComo = (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
  [id === null ? '' : JSON.stringify({ sub: id })])

// Os cinco períodos em que o placar tem de dar a mesma coisa, antes e depois.
const PERIODOS = [
  ['desde o início', 'null, null'],
  ['este mês', `date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date`],
  ['de ontem em diante', 'current_date - 1, null'],
  ['só o passado (90 a 30 dias)', 'current_date - 90, current_date - 30'],
  ['um futuro vazio', 'current_date + 30, current_date + 60'],
]
async function placares() {
  const saida = {}
  for (const [nome, args] of PERIODOS) saida[nome] = await r(`public.vessel_placar_do_stylist_circle(${args}, 14)`)
  return saida
}

/**
 * A CENA DE MENTIRA — montada pelas funções da Central, como a Ionara faria.
 * ⚠️ DETERMINÍSTICA: rodada duas vezes na mesma transação (uma desfeita), dá
 * os mesmos códigos (STY por máximo+1, PE por dia+praça) e o mesmo `now()`.
 *   A (Marina da Prova): contato antes de ativar; PE1 há 12h (Ana veio, Bia
 *     faltou, Cris não respondeu) e PE2 há 1h (Ana veio de novo) — recorrente;
 *     um encontro daqui a 3 dias (o próximo marcado).
 *   B (Paula da Prova): PE-B há 6h (Ana e Duda vieram); um encontro daqui a 2
 *     dias que é CANCELADO, e um contato sem resposta depois de ativar.
 *   C (Renata da Prova): nenhum encontro.
 *   Venda: Ana compra hoje R$ 1.500 (2 peças) → cai no PE1 da A (o PRIMEIRO,
 *   mesmo tendo ido ao da B); um pedido cancelado (12) dela não entra; Duda
 *   compra R$ 800 (1 peça) → é da B.
 */
async function montarCena(mexe) {
  await falarComo(mexe)
  const criar = async (nome, fone) => (await r(
    `public.vessel_stylist_criar($1, $2, p_cidade => 'Campinas', p_praca => 'CPS', p_loja => 'iguatemi',
       p_origem_contato => 'indicacao')`, [nome, fone])).codigo
  const A = await criar('Marina da Prova', FONES.styA)
  const B = await criar('Paula da Prova', FONES.styB)
  const C = await criar('Renata da Prova', FONES.styC)
  const cA = await r(`public.vessel_stylist_registrar_contato($1, 'ligacao', 'proposta')`, [A])
  // ⚠️ O contato nasce no mesmo `now()` da ativação; sem recuar, não seria "antes".
  await cli.query(`update public.vessel_stylist_contatos set criado_em = now() - interval '1 minute' where id = $1`, [cA.id])

  const pe = async (sty, quando, vagas = 8) => (await r(
    `public.vessel_criar_private_edit($1, ${quando}, 'Loja', 'CPS', 'iguatemi', ${vagas})`, [sty])).codigo
  const convidar = async (codigo, nome, fone) => (await r(
    `public.vessel_convidar_para_encontro($1, $2, $3)`, [codigo, nome, fone])).id
  const marcar = (id, m) => r(`public.vessel_convite_marcar($1, $2)`, [id, m])
  const presenca = (id, s) => r(`public.vessel_situacao_do_atendimento($1, $2)`, [id, s])
  const realizar = (codigo) => r(`public.vessel_private_edit_situacao($1, 'realizado')`, [codigo])

  const PE1 = await pe(A, `now() - interval '12 hours'`)
  const ana1 = await convidar(PE1, 'Ana da Prova', FONES.ana)
  const bia1 = await convidar(PE1, 'Bia da Prova', FONES.bia)
  await convidar(PE1, 'Cris da Prova', FONES.cris)
  await marcar(ana1, 'sim'); await marcar(bia1, 'sim')
  await presenca(ana1, 'realizado'); await presenca(bia1, 'no_show')
  await realizar(PE1)

  const PEB = await pe(B, `now() - interval '6 hours'`, 9)
  const anaB = await convidar(PEB, 'Ana da Prova', FONES.ana)
  const dudaB = await convidar(PEB, 'Duda da Prova', FONES.duda)
  await marcar(anaB, 'sim'); await marcar(dudaB, 'sim')
  await presenca(anaB, 'realizado'); await presenca(dudaB, 'realizado')
  await realizar(PEB)

  const PE2 = await pe(A, `now() - interval '1 hour'`, 10)
  const ana2 = await convidar(PE2, 'Ana da Prova', FONES.ana)
  await marcar(ana2, 'sim'); await presenca(ana2, 'realizado')
  await realizar(PE2)

  const PE3 = await pe(A, `now() + interval '3 days'`, 7)
  const PEB2 = await pe(B, `now() + interval '2 days'`, 7)
  await r(`public.vessel_private_edit_situacao($1, 'cancelado', null, 'Chuva forte')`, [PEB2])
  await r(`public.vessel_stylist_registrar_contato($1, 'whatsapp', 'sem_resposta')`, [B])

  const pessoa = async (fone) => (await uma(`select id from public.vessel_pessoas where telefone = $1`, [fone])).id
  const pedido = async (bling, fone, situacao, valor, pecas) => {
    const p = await uma(
      `insert into public.vessel_pedidos (bling_pedido_id, numero, pessoa_id, data_do_pedido, situacao_id, receita_liquida)
       values ($1, $2, $3, (now() at time zone 'America/Sao_Paulo')::date, $4, $5) returning id`,
      [bling, `PROVA-SC-${-bling}`, await pessoa(fone), situacao, valor])
    if (pecas) await cli.query(`insert into public.vessel_pedido_itens (pedido_id, quantidade) values ($1, $2)`, [p.id, pecas])
  }
  await pedido(-992401, FONES.ana, 9, 1500, 2)
  await pedido(-992402, FONES.ana, 12, 999, 1)
  await pedido(-992403, FONES.duda, 9, 800, 1)
  return { A, B, C, PE1, PE2, PE3, PEB, PEB2 }
}

await cli.query('begin')
try {
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── a fotografia do placar de 22/09 (antes de aplicar; desfeita em seguida)')
  await cli.query('savepoint fotografia')
  const soVe0 = await perfil(['atendimentos'], { atendimentos: ['ver'] })
  const mexe0 = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] })
  await falarComo(soVe0)
  const realAntes = await placares()
  const cenaAntes = await montarCena(mexe0)
  await falarComo(soVe0)
  const comCenaAntes = await placares()
  console.log(`  (cena montada: ${cenaAntes.A}, ${cenaAntes.B}, ${cenaAntes.C})`)
  await cli.query('rollback to savepoint fotografia')

  // ════════════════════════════════════════════════════════════════════════
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-stylist-scorecard.mjs'])

  console.log('\n── idempotente: o arquivo roda de novo por cima sem erro')
  await cli.query('savepoint de_novo')
  let deNovo = null
  try { await cli.query(sql) } catch (e) { deNovo = e.message }
  await cli.query('rollback to savepoint de_novo')
  conferir(deNovo === null, 'aplicar duas vezes não quebra', deNovo)

  console.log('\n── as portas')
  for (const [nome, assinatura] of Object.entries(PORTAS)) {
    const { quantas, lista } = await uma(
      `select count(*)::int as quantas, string_agg(p.oid::regprocedure::text, ' | ') as lista
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    conferir(quantas === 1 && lista === assinatura, `${nome}: uma assinatura só`, lista)
    const pr = await uma(
      `select has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
              has_function_privilege('anon', $1, 'EXECUTE') as anon`, [`public.${assinatura}`])
    conferir(pr.aut === true && pr.anon === false, `${nome}: a Central entra, a página pública não`, pr)
  }
  for (const f of MIOLO) {
    const pr = await uma(
      `select has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
              has_function_privilege('anon', $1, 'EXECUTE') as anon`, [`public.${f}`])
    conferir(pr.aut === false && pr.anon === false, `${f}: miolo fechado para todo mundo`, pr)
  }

  console.log('\n── a tabela nova confere com a irmã (vessel_stylist_contatos)')
  const irmas = await uma(
    `select (select relrowsecurity from pg_class where oid = 'public.vessel_stylist_qualificacoes'::regclass) as rls_nova,
            (select relrowsecurity from pg_class where oid = 'public.vessel_stylist_contatos'::regclass) as rls_irma,
            (select count(*)::int from pg_policies where tablename = 'vessel_stylist_qualificacoes') as pol_nova,
            (select count(*)::int from pg_policies where tablename = 'vessel_stylist_contatos') as pol_irma,
            (select count(*)::int from information_schema.role_table_grants
              where table_name = 'vessel_stylist_qualificacoes' and grantee in ('anon', 'authenticated')) as grants_nova,
            (select count(*)::int from information_schema.role_table_grants
              where table_name = 'vessel_stylist_contatos' and grantee in ('anon', 'authenticated')) as grants_irma`)
  conferir(irmas.rls_nova === true && irmas.rls_nova === irmas.rls_irma && irmas.pol_nova === irmas.pol_irma
      && irmas.grants_nova === 0 && irmas.grants_nova === irmas.grants_irma,
    'trava ligada, nenhuma política e nada concedido a anon/authenticated — igual à irmã', irmas)

  await cli.query('savepoint prova')
  const soVe = await perfil(['atendimentos'], { atendimentos: ['ver'] })
  const mexe = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] })
  const semNada = await perfil([], {})

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── o placar não mudou (mesma transação, mesmos dados, antes e depois)')
  await falarComo(soVe)
  const realDepois = await placares()
  for (const [nome] of PERIODOS) {
    conferir(igual(realDepois[nome], realAntes[nome]), `dados reais, ${nome}: resposta idêntica à de 22/09`,
      { antes: realAntes[nome], depois: realDepois[nome] })
  }
  const cena = await montarCena(mexe)
  conferir(igual(cena, cenaAntes), 'a cena de mentira saiu com os mesmos códigos das duas vezes', { cena, cenaAntes })
  await falarComo(soVe)
  const comCenaDepois = await placares()
  for (const [nome] of PERIODOS) {
    conferir(igual(comCenaDepois[nome], comCenaAntes[nome]), `com a cena, ${nome}: resposta idêntica à de 22/09`,
      { antes: comCenaAntes[nome], depois: comCenaDepois[nome] })
  }
  const { A, B, C, PE1 } = cena
  const doIni = comCenaDepois['desde o início']
  const pA = doIni.por_stylist.find((x) => x.codigo === A)
  const pB = doIni.por_stylist.find((x) => x.codigo === B)
  conferir(pA && pB && Number(pA.receita) === 1500 && pA.vendas === 1 && Number(pB.receita) === 800 && pB.vendas === 1,
    'a cena é a que se pretendia: a venda da Ana foi para o PRIMEIRO encontro (da A), a da Duda para a B', { pA, pB })

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── o scorecard: portão e forma')
  await falarComo(null)
  try {
    await cli.query('savepoint sem_sessao')
    await r(`public.vessel_scorecard_da_stylist($1)`, [A])
    conferir(false, 'scorecard sem sessão levanta 42501', 'respondeu')
  } catch (e) {
    await cli.query('rollback to savepoint sem_sessao')
    conferir(e.code === '42501', 'scorecard sem sessão levanta 42501', e.code)
  }
  await falarComo(semNada)
  try {
    await cli.query('savepoint sem_chave')
    await r(`public.vessel_scorecard_da_stylist($1)`, [A])
    conferir(false, 'scorecard para quem não tem Atendimentos levanta 42501', 'respondeu')
  } catch (e) {
    await cli.query('rollback to savepoint sem_chave')
    conferir(e.code === '42501', 'scorecard para quem não tem Atendimentos levanta 42501', e.code)
  }
  await falarComo(soVe)
  const naoAchei = await r(`public.vessel_scorecard_da_stylist('STY-NAOEXISTE')`)
  conferir(igual(naoAchei, { ok: false, situacao: 'nao_achei' }), 'código que não existe: "nao_achei", não erro', naoAchei)

  const scA = await r(`public.vessel_scorecard_da_stylist($1, null, null, 14)`, [` ${A.toLowerCase()} `])
  conferir(scA.ok === true && scA.codigo === A && scA.encontros_agendados === 3 && scA.encontros_realizados === 2
      && scA.convidadas === 4 && scA.confirmadas === 3 && scA.confirmadas_em_realizados === 3
      && scA.presentes === 2 && scA.presentes_em_realizados === 2 && scA.compradoras === 1 && scA.vendas === 1
      && Number(scA.pecas) === 2 && Number(scA.receita) === 1500 && !('por_stylist' in scA),
    'A: 3 agendados, 2 realizados, 4 convidadas, 3 confirmadas, 2 presentes, 1 venda de R$ 1.500 (código aceita espaço e minúscula)', scA)
  conferir(scA.recorrente === true && scA.realizados_desde_o_inicio === 2 && scA.dias_desde_o_ultimo === 0
      && scA.proximo_encontro_codigo === cena.PE3 && scA.proximo_encontro_em && scA.contatos === 1
      && scA.contatos_antes_de_ativar === 1 && scA.contatos_sem_resposta_depois_de_ativar === 0
      && scA.intervalos === 1 && scA.intervalo_medio_em_dias !== null,
    'A: recorrente, último encontro hoje, o próximo é o de daqui a 3 dias, 1 contato antes de ativar', scA)
  const scB = await r(`public.vessel_scorecard_da_stylist($1)`, [B])
  conferir(scB.ok && scB.encontros_agendados === 2 && scB.encontros_realizados === 1 && scB.encontros_cancelados === 1
      && scB.presentes === 2 && scB.compradoras === 1 && Number(scB.receita) === 800 && scB.recorrente === false
      && scB.proximo_encontro_codigo === null && scB.contatos_sem_resposta_depois_de_ativar === 1
      && scB.contatos_antes_de_ativar === 0,
    'B: 1 realizado, 1 cancelado, a Ana presente sem venda (a dela é da A), R$ 800 da Duda, 1 sem resposta depois de ativar', scB)
  const scC = await r(`public.vessel_scorecard_da_stylist($1)`, [C])
  conferir(scC.ok === true && scC.encontros_agendados === 0 && scC.encontros_realizados === 0 && scC.convidadas === 0
      && scC.vendas === 0 && Number(scC.receita) === 0 && scC.recorrente === false && scC.ultimo_realizado_em === null
      && scC.dias_desde_o_ultimo === null && scC.proximo_encontro_em === null && scC.contatos_antes_de_ativar === null,
    'C, sem encontro nenhum: zeros e nulos, não erro', scC)

  console.log('\n── o scorecard respeita o período')
  const scAFuturo = await r(`public.vessel_scorecard_da_stylist($1, current_date + 30, current_date + 60, 14)`, [A])
  conferir(scAFuturo.ok && scAFuturo.encontros_agendados === 0 && scAFuturo.vendas === 0 && Number(scAFuturo.receita) === 0,
    'um período futuro vazio: zeros', scAFuturo)
  const scAProximos = await r(`public.vessel_scorecard_da_stylist($1, current_date + 1, current_date + 5, 14)`, [A])
  conferir(scAProximos.encontros_agendados === 1 && scAProximos.encontros_realizados === 0 && scAProximos.presentes === 0
      && Number(scAProximos.receita) === 0,
    'de amanhã a daqui a 5 dias: só o encontro marcado, sem venda', scAProximos)

  console.log('\n── o scorecard bate com o placar')
  const SOMA = ['encontros_agendados', 'encontros_realizados', 'encontros_cancelados', 'convidadas', 'confirmadas',
    'confirmadas_em_realizados', 'presentes', 'presentes_em_realizados', 'vendas', 'pecas', 'receita']
  const codigos = (await cli.query(`select codigo from public.vessel_stylists where not coalesce(teste, false) order by codigo`))
    .rows.map((x) => x.codigo)
  for (const [nome, args] of PERIODOS) {
    const pl = await r(`public.vessel_placar_do_stylist_circle(${args}, 14)`)
    const fichas = []
    for (const c of codigos) fichas.push(await r(`public.vessel_scorecard_da_stylist($1, ${args}, 14)`, [c]))
    const soma = Object.fromEntries(SOMA.map((k) => [k, fichas.reduce((a, f) => a + Number(f[k]), 0)]))
    const doPlacar = Object.fromEntries(SOMA.map((k) => [k, Number(pl[k])]))
    conferir(igual(soma, doPlacar), `${nome}: a soma das ${codigos.length} fichas = o placar (${SOMA.length} números)`,
      { soma, doPlacar })
    const porStylistBate = pl.por_stylist.every((p) => {
      const f = fichas.find((x) => x.codigo === p.codigo)
      return f && f.encontros_realizados === p.encontros_realizados && f.vendas === p.vendas
        && Number(f.receita) === Number(p.receita)
    })
    conferir(porStylistBate, `${nome}: cada ficha bate com a linha dela em "por_stylist"`, pl.por_stylist)
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── avaliar: quem pode, quem não pode')
  const avaliar = (cod, n, obs = null) => r(
    `public.vessel_stylist_avaliar($1, $2, $3, $4, $5, $6, $7)`, [cod, ...n, obs])
  const quantas = async () => (await uma(`select count(*)::int as n from public.vessel_stylist_qualificacoes`)).n
  await falarComo(null)
  const semSessao = await avaliar(A, [5, 5, 5, 5, 5])
  conferir(semSessao.situacao === 'sem_permissao', 'sem sessão (a chave pública) não avalia', semSessao)
  await falarComo(semNada)
  const semChave = await avaliar(A, [5, 5, 5, 5, 5])
  conferir(semChave.situacao === 'sem_permissao', 'logada sem Atendimentos não avalia', semChave)
  await falarComo(soVe)
  const soVendo = await avaliar(A, [5, 5, 5, 5, 5])
  conferir(soVendo.situacao === 'sem_permissao', 'quem só VÊ o Stylist Circle não avalia', soVendo)
  conferir(await quantas() === 0, '…e nenhuma das três gravou nada', await quantas())

  await falarComo(mexe)
  const naoExiste = await avaliar('STY-NAOEXISTE', [3, 3, 3, 3, 3])
  conferir(naoExiste.situacao === 'nao_achei', 'stylist que não existe: "nao_achei"', naoExiste)

  console.log('\n── nível fora de 1..5 é recusado')
  for (const [rotulo, niveis] of [['zero', [0, 3, 3, 3, 3]], ['seis', [3, 6, 3, 3, 3]], ['negativo', [3, 3, -1, 3, 3]],
    ['faltando', [3, 3, 3, null, 3]], ['todos nulos', [null, null, null, null, null]]]) {
    const rr = await avaliar(A, niveis)
    conferir(rr.situacao === 'nivel_invalido', `nível ${rotulo}: "nivel_invalido"`, rr)
  }
  const longa = await avaliar(A, [3, 3, 3, 3, 3], 'x'.repeat(281))
  conferir(longa.situacao === 'observacao_longa', 'observação de 281 caracteres é recusada', longa)
  conferir(await quantas() === 0, '…e nenhuma recusa gravou linha', await quantas())
  // ⚠️ E O `CHECK` DA TABELA TAMBÉM RECUSA, para quem escrever por outro caminho.
  const idA = (await uma(`select id from public.vessel_stylists where codigo = $1`, [A])).id
  let checkRecusou = null
  try {
    await cli.query('savepoint check_nivel')
    await cli.query(`insert into public.vessel_stylist_qualificacoes (stylist_id, carteira, portfolio, mobilizacao, acesso, confiabilidade)
                     values ($1, 6, 1, 1, 1, 1)`, [idA])
  } catch (e) { checkRecusou = e.code }
  await cli.query('rollback to savepoint check_nivel')
  conferir(checkRecusou === '23514', 'a tabela recusa nível 6 mesmo sem passar pela função (CHECK)', checkRecusou)

  console.log('\n── a nota e a faixa, nas bordas')
  const bordas = [
    [[1, 1, 1, 1, 1], 20, 'C'], [[1, 1, 5, 5, 4], 54, 'C'], [[1, 2, 4, 5, 4], 55, 'B'],
    [[1, 5, 5, 5, 4], 74, 'B'], [[2, 4, 5, 5, 4], 75, 'A'], [[5, 5, 5, 5, 5], 100, 'A'],
  ]
  // As bordas vão na C (a que não tem encontro): o histórico da A fica limpo para a prova seguinte.
  for (const [niveis, nota, faixa] of bordas) {
    const rr = await avaliar(C, niveis)
    conferir(rr.ok && rr.nota === nota && rr.faixa === faixa, `${niveis.join('·')} → ${nota} · Faixa ${faixa}`, rr)
  }
  const fx = await uma(`select public.vessel_faixa_da_nota(54) as a, public.vessel_faixa_da_nota(55) as b,
                               public.vessel_faixa_da_nota(74) as c, public.vessel_faixa_da_nota(75) as d,
                               public.vessel_faixa_da_nota(null) as e`)
  conferir(fx.a === 'C' && fx.b === 'B' && fx.c === 'B' && fx.d === 'A' && fx.e === null,
    'a faixa pela própria régua: 54 C · 55 B · 74 B · 75 A · sem nota, sem faixa', fx)

  console.log('\n── reavaliar guarda o histórico')
  const av1 = await avaliar(A, [3, 3, 3, 3, 3], '  Primeira conversa.  ')
  // ⚠️ As duas nascem no MESMO `now()` da transação: a ordem cai no desempate
  // por id, que é o que a tela também faz. (Recuar o relógio da primeira não
  // dá: a tabela só acrescenta, e o `update` seria recusado — prova abaixo.)
  const av2 = await avaliar(A, [5, 4, 4, 3, 5], 'Depois do segundo encontro.')
  conferir(av1.ok && av1.nota === 60 && av1.faixa === 'B' && av2.ok && av2.nota === 85 && av2.faixa === 'A',
    'duas avaliações: 60 · B e depois 85 · A', { av1, av2 })
  await falarComo(soVe)
  const hist = await r(`public.vessel_stylist_qualificacoes($1)`, [A])
  conferir(hist.length === 2 && hist[0].id === av2.id && hist[1].id === av1.id && hist[1].observacao === 'Primeira conversa.'
      && hist[0].avaliado_por_nome === 'Avaliadora da Prova' && hist[0].carteira === 5 && hist[0].portfolio === 4,
    'quem só vê lê o histórico inteiro, a mais recente primeiro, com quem avaliou', hist)
  const vig = await r(`public.vessel_qualificacoes_vigentes()`)
  const vigA = vig.find((x) => x.codigo === A)
  const vigC = vig.find((x) => x.codigo === C)
  conferir(vigA && vigA.nota === 85 && vigA.faixa === 'A' && vigC && vigC.nota === 100 && !vig.some((x) => x.codigo === B),
    'a vigente é a mais recente; quem nunca foi avaliada não aparece (a tela escreve "Sem nota")', vig)
  const quem = await uma(`select avaliado_por from public.vessel_stylist_qualificacoes where id = $1`, [av2.id])
  conferir(quem.avaliado_por === mexe, 'guarda QUEM avaliou (o `sub` da sessão)', quem)

  let naoEdita = null, naoApaga = null
  try { await cli.query('savepoint edita'); await cli.query(`update public.vessel_stylist_qualificacoes set carteira = 1 where id = $1`, [av2.id]) }
  catch (e) { naoEdita = e.code }
  await cli.query('rollback to savepoint edita')
  try { await cli.query('savepoint apaga'); await cli.query(`delete from public.vessel_stylist_qualificacoes where id = $1`, [av1.id]) }
  catch (e) { naoApaga = e.code }
  await cli.query('rollback to savepoint apaga')
  conferir(naoEdita === '42501' && naoApaga === '42501', 'nem o dono do banco edita ou apaga uma avaliação (gatilho)', { naoEdita, naoApaga })
  let naoSomeStylist = null
  try { await cli.query('savepoint apaga_sty'); await cli.query(`delete from public.vessel_stylists where id = $1`, [idA]) }
  catch (e) { naoSomeStylist = e.code }
  await cli.query('rollback to savepoint apaga_sty')
  conferir(naoSomeStylist === '23503', 'stylist com avaliação não se apaga por baixo (restrict)', naoSomeStylist)

  console.log('\n── ler a nota: quem não vê')
  await falarComo(semNada)
  const histSem = await r(`public.vessel_stylist_qualificacoes($1)`, [A])
  conferir(igual(histSem, []), 'o histórico para quem não tem Atendimentos: lista vazia (bloco dentro de ficha)', histSem)
  try {
    await cli.query('savepoint vig_sem')
    await r(`public.vessel_qualificacoes_vigentes()`)
    conferir(false, 'as vigentes para quem não vê levantam 42501 (vazio pintaria "Sem nota" em todo mundo)', 'respondeu')
  } catch (e) {
    await cli.query('rollback to savepoint vig_sem')
    conferir(e.code === '42501', 'as vigentes para quem não vê levantam 42501 (vazio pintaria "Sem nota" em todo mundo)', e.code)
  }

  console.log('\n── a nota não trava etapa nenhuma')
  await falarComo(mexe)
  const pausa = await r(`public.vessel_stylist_editar($1, p_estagio => 'pausado')`, [C])
  const volta = await r(`public.vessel_stylist_editar($1, p_estagio => 'contatado')`, [C])
  const pe = await r(`public.vessel_criar_private_edit($1, now() + interval '4 days', null, 'CPS', 'iguatemi', 8)`, [C])
  conferir(pausa.ok && volta.ok && pe.ok, 'com avaliações na história (de 20 a 100), ela muda de etapa e ganha encontro normalmente', { pausa, volta, pe })

  await falarComo(soVe)
  const plFinal = await r(`public.vessel_placar_do_stylist_circle(null, null, 14)`)
  conferir(!('nota' in plFinal) && !('faixa' in plFinal) && Number(plFinal.receita) === Number(doIni.receita),
    'avaliar não mexe em número nenhum do placar', { antes: doIni.receita, depois: plFinal.receita })

  await cli.query('rollback to savepoint prova')
  const sobrou = await quantas()
  conferir(sobrou === 0, 'a prova não deixou avaliação para trás', sobrou)
  const depoisDaProva = await uma(IMPRESSAO)
  for (const chave of ['pedidos_de_prova', 'itens_de_prova', 'pessoas_de_prova']) {
    conferir(antes[chave] === 0 && depoisDaProva[chave] === 0,
      `${chave}: nenhum resquício de teste, nem antes nem depois`, { antes: antes[chave], depois: depoisDaProva[chave] })
  }
  const { pedidos: _p1, itens: _i1, ...antesEstavel } = antes
  const { pedidos: _p2, itens: _i2, ...depoisEstavel } = depoisDaProva
  conferir(igual(depoisEstavel, antesEstavel),
    'a prova não deixou rastro nas tabelas reais (fora do que o robô do Bling mexe por conta própria)',
    { antes: antesEstavel, depois: depoisEstavel })

  if (falhas.length) throw new Error(`${falhas.length} de ${provas} conferência(s) falharam`)

  if (GRAVAR) {
    const fim = await cli.query('commit')
    // ⚠️ COMMIT DEPOIS DE ERRO VOLTA "ROLLBACK" SEM LANÇAR NADA.
    if (fim.command !== 'COMMIT') throw new Error(`o commit voltou ${fim.command}`)
    console.log(`\n✅ ${ARQUIVO} aplicada e registrada (${provas} provas).`)
  } else {
    await cli.query('rollback')
    console.log(`\n✅ ensaio limpo: ${provas} provas, todas passaram, e NADA foi gravado. Rode com --gravar para valer.`)
  }
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error(`\n❌ nada foi gravado: ${e.message}`)
  process.exitCode = 1
} finally {
  await cli.end()
}

if (!GRAVAR && !process.exitCode) {
  // ⚠️ O ENSAIO TAMBÉM SE CONFERE POR FORA: numa conexão nova, nem a tabela
  // nem o registro podem existir — "desfeito" é o que o banco diz, não o script.
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  const fora = (await outra.query(
    `select to_regclass('public.vessel_stylist_qualificacoes') is null as sem_tabela,
            to_regprocedure('public.vessel_scorecard_da_stylist(text,date,date,integer)') is null as sem_funcao,
            not exists (select 1 from public.schema_migrations where name = $1) as sem_registro`, [ARQUIVO])).rows[0]
  await outra.end()
  if (!fora.sem_tabela || !fora.sem_funcao || !fora.sem_registro) {
    console.error('❌ o ensaio deixou coisa no banco!', fora)
    process.exitCode = 1
  } else {
    console.log('  ✓ conferido numa conexão nova: sem tabela, sem função nova e sem registro — o banco está como estava')
  }
}

if (GRAVAR && !process.exitCode) {
  // ⚠️ DE NOVO NUMA CONEXÃO NOVA: é o que o resto do mundo vê.
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  const agora = (await outra.query(IMPRESSAO)).rows[0]
  const reg = (await outra.query(`select 1 from public.schema_migrations where name = $1`, [ARQUIVO])).rowCount
  const fn = (await outra.query(`select to_regprocedure('public.vessel_scorecard_da_stylist(text,date,date,integer)') is not null as ok`)).rows[0].ok
  await outra.end()
  const { pedidos: _p3, itens: _i3, ...antesEstavel2 } = antes
  const { pedidos: _p4, itens: _i4, ...agoraEstavel } = agora
  if (!igual(agoraEstavel, antesEstavel2) || reg !== 1 || !fn) {
    console.error('❌ depois do commit a impressão mudou, o registro sumiu ou a função não está lá', { antes, agora, reg, fn })
    process.exitCode = 1
  } else {
    console.log('  ✓ depois do commit, numa conexão nova: tabelas reais intactas, função no ar e migration registrada')
  }
}
