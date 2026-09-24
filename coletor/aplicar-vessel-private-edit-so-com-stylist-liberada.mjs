// APLICA, REGISTRA e PROVA: Private Edit só com stylist liberada (a saída
// "Ativada"), os motivos das saídas, e a ativação como fato do funil.
//
//   node --env-file=<coletor/.env> coletor/aplicar-vessel-private-edit-so-com-stylist-liberada.mjs            → ensaio: prova tudo e DESFAZ
//   node --env-file=<coletor/.env> coletor/aplicar-vessel-private-edit-so-com-stylist-liberada.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar, provar e só então `commit`,
// conferido (`.command === 'COMMIT'`). As provas moram em savepoints desfeitos,
// falam como gente de verdade (perfis de mentira + `request.jwt.claims`), e a
// impressão das tabelas reais é conferida antes, depois da migration (as 51
// stylists intactas), depois do desfazer e, quando grava, numa conexão nova.
// Nenhum `.catch` engole erro DENTRO da transação sem savepoint em volta.
//
// ⚠️ A PROVA DO PLACAR: o MESMO cenário é montado ANTES da migration, com o
// banco de hoje, e DEPOIS, com o banco novo. Tudo tem de bater, fora
// "ativadas" (e o que deriva dela), que muda pela regra nova; cada diferença é
// listada com o motivo. E o número de antes ("ativadas" = primeiro encontro)
// tem de reaparecer igual em "com_private_edit_agendado".
//
// DATABASE_URL: coletor/.env OU o ambiente (`node --env-file=<.env> …`).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql'
const ANTERIORES = ['2026-09-24-vessel-stylist-funil-configuravel.sql', '2026-09-24-vessel-stylist-scorecard-e-qualificacao.sql']
const GRAVAR = process.argv.slice(2).includes('--gravar')

const PORTAS = {
  vessel_stylist_mover_de_etapa: 'vessel_stylist_mover_de_etapa(text,bigint,bigint,text)',
  vessel_stylist_etapa_excluir: 'vessel_stylist_etapa_excluir(bigint,bigint,bigint,text)',
  vessel_stylist_etapa_liberar_private_edit: 'vessel_stylist_etapa_liberar_private_edit(bigint,boolean)',
  vessel_stylist_motivo_criar: 'vessel_stylist_motivo_criar(bigint,text,boolean)',
  vessel_stylist_motivo_renomear: 'vessel_stylist_motivo_renomear(bigint,text)',
  vessel_stylist_motivo_mover: 'vessel_stylist_motivo_mover(bigint,text)',
  vessel_stylist_motivo_ativar: 'vessel_stylist_motivo_ativar(bigint,boolean)',
  vessel_stylist_motivo_exigir_nota: 'vessel_stylist_motivo_exigir_nota(bigint,boolean)',
  vessel_stylist_etapas: 'vessel_stylist_etapas()',
  vessel_stylist_historico_de_etapas: 'vessel_stylist_historico_de_etapas(text)',
  vessel_stylists_para_escolher: 'vessel_stylists_para_escolher()',
  vessel_rastreio_dos_stylists: 'vessel_rastreio_dos_stylists(integer,boolean)',
  vessel_criar_private_edit: 'vessel_criar_private_edit(text,timestamp with time zone,text,text,text,integer,boolean)',
  vessel_private_edit_editar: 'vessel_private_edit_editar(text,timestamp with time zone,text,text,text,integer,text)',
  vessel_scorecard_da_stylist: 'vessel_scorecard_da_stylist(text,date,date,integer)',
  vessel_placar_do_stylist_circle: 'vessel_placar_do_stylist_circle(date,date,integer)',
}
const MIOLO = [
  'vessel_motivo_de_saida_nao_se_apaga()', 'vessel_stylist_saida_atual(bigint)', 'vessel_stylists_etapa_antes()',
  'vessel_stylists_etapa_depois()', 'vessel_stylist_conferir_motivo(bigint,bigint,text)',
  'vessel_stylist_motivos_renumerar(bigint)', 'vessel_stylist_motivo_anotar(bigint,text,jsonb,jsonb)',
  'vessel_etapas_que_liberam_private_edit()', 'vessel_stylist_ativada_em(bigint)',
  'vessel_numeros_do_stylist_circle(date,date,integer,bigint)',
]
const MOTIVOS_DO_DESCLASSIFICADO = ['Desinteresse', 'Não conecta com a marca', 'Não retornou os contatos',
  'Carteira fora do perfil', 'Portfólio / estética não alinhados', 'Fora da praça (logística)',
  'Não aceitou as condições (Professional Fee)', 'Exclusividade com outra marca', 'Outro']

// ⚠️ A IMPRESSÃO DAS TABELAS REAIS: as 51 stylists linha a linha (todas as
// colunas), e o resto por contagem e assinatura.
const IMPRESSAO = `
  select (select count(*) from public.vessel_stylists)::int as stylists,
         (select md5(coalesce(string_agg(row_to_json(s)::text, '|' order by s.id), '')) from public.vessel_stylists s) as stylists_md5,
         (select count(*) from public.vessel_private_edits)::int as private_edits,
         (select md5(coalesce(string_agg(row_to_json(e)::text, '|' order by e.id), '')) from public.vessel_private_edits e) as private_edits_md5,
         (select count(*) from public.vessel_stylist_etapas_historico)::int as historico,
         (select count(*) from public.vessel_stylist_etapas_trilha)::int as trilha,
         (select count(*) from public.vessel_stylist_contatos)::int as contatos,
         (select count(*) from public.vessel_pessoas where telefone like '55199900025%')::int as pessoas_de_prova,
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
            from (select id, pessoa_id, loja, quando, status, rsvp, evento_codigo, teste
                    from public.vessel_atendimentos) t) as atendimentos`
const IMPRESSAO_DAS_ETAPAS = `select md5(coalesce(string_agg(row_to_json(e)::text, '|' order by e.id), '')) as m
  from (select id, nome, ordem, tipo, conta_como_prospectada, ativa from public.vessel_stylist_etapas) e`

const PERIODOS = [
  ['desde o início', 'null, null'],
  ['este mês', `date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date`],
  ['de ontem em diante', 'current_date - 1, null'],
  ['só o passado (90 a 30 dias)', 'current_date - 90, current_date - 30'],
  ['um futuro vazio', 'current_date + 30, current_date + 60'],
]
// Os números do placar que são SOMA de stylist por stylist (a ficha de cada
// uma somada dá o placar). Contagens de gente entram (cada ficha conta 0 ou 1).
const SOMA = ['prospectadas', 'ativadas', 'prospectadas_ja_ativadas', 'ativadas_ate_o_fim',
  'com_private_edit_agendado', 'com_private_edit_realizado', 'prospectadas_com_private_edit_agendado',
  'prospectadas_com_private_edit_realizado', 'prospectadas_recorrentes', 'ativadas_por_encontro_antigo',
  'encontros_agendados', 'encontros_realizados', 'encontros_cancelados', 'convidadas', 'confirmadas',
  'confirmadas_em_realizados', 'presentes', 'presentes_em_realizados', 'recorrentes_no_periodo',
  'recorrentes_ate_o_fim', 'intervalos', 'stylists_com_contatos_ate_ativar', 'vendas', 'pecas', 'receita']
const NOVAS_DO_PLACAR = ['com_private_edit_agendado', 'com_private_edit_realizado', 'prospectadas_com_private_edit_agendado',
  'prospectadas_com_private_edit_realizado', 'prospectadas_recorrentes', 'ativadas_por_encontro_antigo']
// O que PODE mudar entre o banco de hoje e o novo, e por quê.
const MUDA_PELA_REGRA = {
  ativadas: 'a ativação agora é a chegada numa etapa que libera Private Edit (a D foi para Ativada sem encontro)',
  ativadas_ate_o_fim: 'a mesma ativação nova, contada até o fim do período',
  stylists_com_contatos_ate_ativar: 'a base da média é quem ativou no período — a régua nova tem uma a mais',
  contatos_ate_ativar: 'a média de contatos antes de ativar muda de base junto',
}

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

if (!process.env.DATABASE_URL) { console.error('❌ sem DATABASE_URL'); process.exit(1) }
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r
const rpc = async (fn, corpo = {}) => {
  const ks = Object.keys(corpo)
  return r(`public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, ks.map((k) => corpo[k]))
}
const registrada = async (nome) =>
  (await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ok`, [nome])).ok
/** Roda dentro de um savepoint e devolve o erro (ou nulo): a transação não aborta. */
const tentar = async (fn) => {
  await cli.query('savepoint tentativa')
  try { await fn(); await cli.query('release savepoint tentativa'); return null } catch (e) {
    await cli.query('rollback to savepoint tentativa'); return e
  }
}

// ── as travas de antes ──────────────────────────────────────────────────────
if (await registrada(ARQUIVO)) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }
for (const a of ANTERIORES) {
  if (!(await registrada(a))) { console.error(`❌ falta ${a} antes desta.`); process.exit(1) }
}

const antes = await uma(IMPRESSAO)
const etapasAntes = (await uma(IMPRESSAO_DAS_ETAPAS)).m
console.log(`impressão de hoje: ${antes.stylists} stylists, ${antes.private_edits} encontros, ${antes.historico} linhas de histórico`)

await cli.query('begin')
try {
  // ── perfis de mentira, sessão de verdade ──
  const perfil = async (features, permissions, nome) => {
    const id = randomUUID(), email = `prova-pe-ativada-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin)
                     values ($1, $2, $3, $4, $5::jsonb, false)`, [id, email, nome, features, JSON.stringify(permissions)])
    return id
  }
  const falarComo = async (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])
  const mexe = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] }, 'Prova Ativada')
  const soVe = await perfil(['atendimentos'], { atendimentos: ['ver'] }, 'Só Vê')
  const etapaId = async (nome) => Number((await uma(`select id from public.vessel_stylist_etapas where ativa and nome = $1`, [nome]))?.id)
  const placares = async () => {
    const saida = {}
    for (const [nome, args] of PERIODOS) saida[nome] = await r(`public.vessel_placar_do_stylist_circle(${args}, 14)`)
    return saida
  }

  /** O cenário, igual nos dois bancos. `novo` = os passos que só existem no
   * banco novo (mover para a Ativada, a marca temporária da E). */
  const cenario = async (novo) => {
    const criar = async (nome, fone) => (await rpc('vessel_stylist_criar', { p_nome: nome, p_whatsapp: fone, p_origem_contato: 'pesquisa' })).codigo
    const A = await criar('Cenário A', '(19) 99000-2561')
    const B = await criar('Cenário B', '(19) 99000-2562')
    const C = await criar('Cenário C', '(19) 99000-2563')
    const D = await criar('Cenário D', '(19) 99000-2564')
    const E = await criar('Cenário E', '(19) 99000-2565')
    await r(`public.vessel_stylist_registrar_contato($1, 'whatsapp', 'conversou')`, [A])
    await rpc('vessel_stylist_mover_de_etapa', { p_codigo: A, p_etapa_id: await etapaId('Prospectado') })
    if (novo) await novo.antesDosEncontros({ A, B, C, D, E })
    const pe = async (cod, dias) => r(`public.vessel_criar_private_edit($1, now() + make_interval(days => $2::int), null, 'CPS', 'iguatemi', 8)`, [cod, dias])
    const e1 = await pe(A, 2), e2 = await pe(A, 3), e3 = await pe(B, 5)
    if (novo) await novo.antesDaE({ E })
    const e4 = await pe(E, 6)
    if (novo) await novo.depoisDaE({ E })
    // A porta não aceita encontro no passado: nasce no futuro e a data é
    // recuada à mão (igual nos dois bancos), para poder virar "realizado".
    await cli.query(`update public.vessel_private_edits set quando = now() - interval '20 days' where codigo = $1`, [e1.codigo])
    await cli.query(`update public.vessel_private_edits set quando = now() - interval '10 days' where codigo = $1`, [e2.codigo])
    await r(`public.vessel_convidar_para_encontro($1, 'Convidada da Prova', '(19) 99000-2569')`, [e1.codigo])
    await r(`public.vessel_private_edit_situacao($1, 'realizado', current_date - 20)`, [e1.codigo])
    await r(`public.vessel_private_edit_situacao($1, 'realizado', current_date - 10)`, [e2.codigo])
    return { codigos: { A, B, C, D, E }, encontros: [e1, e2, e3, e4].map((e) => e?.ok === true), placar: await placares() }
  }
  const fichasBatem = async (rotulo) => {
    const codigos = (await cli.query(`select codigo from public.vessel_stylists where not coalesce(teste, false) order by codigo`))
      .rows.map((x) => x.codigo)
    for (const [nome, args] of PERIODOS) {
      const pl = await r(`public.vessel_placar_do_stylist_circle(${args}, 14)`)
      const fichas = []
      for (const c of codigos) fichas.push(await r(`public.vessel_scorecard_da_stylist($1, ${args}, 14)`, [c]))
      const soma = Object.fromEntries(SOMA.map((k) => [k, fichas.reduce((a, f) => a + Number(f[k]), 0)]))
      const doPlacar = Object.fromEntries(SOMA.map((k) => [k, Number(pl[k])]))
      conferir(igual(soma, doPlacar), `${rotulo}, ${nome}: a soma das ${codigos.length} fichas = o placar (${SOMA.length} números)`, { soma, doPlacar })
      const porStylist = pl.por_stylist.every((p) => {
        const f = fichas.find((x) => x.codigo === p.codigo)
        return f && f.encontros_realizados === p.encontros_realizados && f.vendas === p.vendas && Number(f.receita) === Number(p.receita)
      })
      conferir(porStylist, `${rotulo}, ${nome}: cada ficha bate com a linha dela em "por_stylist"`, pl.por_stylist)
    }
  }

  console.log('\n── antes da migration: o placar dos dados reais e o cenário, no banco de hoje')
  await falarComo(soVe)
  const realAntes = await placares()
  await cli.query('savepoint antes_da_migration')
  await falarComo(mexe)
  const velho = await cenario(null)
  conferir(velho.encontros.every(Boolean), 'cenário montado no banco de hoje (4 encontros)', velho.encontros)
  await falarComo(soVe)
  await cli.query('rollback to savepoint antes_da_migration')
  await falarComo(null)

  console.log('\n── aplicar e registrar')
  await cli.query(sql)
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-private-edit-so-com-stylist-liberada.mjs'])
  const depoisDaMigration = await uma(IMPRESSAO)
  conferir(depoisDaMigration.stylists_md5 === antes.stylists_md5 && depoisDaMigration.stylists === antes.stylists
    && depoisDaMigration.private_edits_md5 === antes.private_edits_md5 && depoisDaMigration.historico === antes.historico,
    `as ${antes.stylists} stylists reais, os encontros e o histórico: intactos linha a linha depois da migration`,
    { antes, depoisDaMigration })
  await falarComo(soVe)
  const realDepois = await placares()
  for (const [nome] of PERIODOS) {
    const a = realAntes[nome], b = { ...realDepois[nome] }
    for (const k of NOVAS_DO_PLACAR) delete b[k]
    conferir(igual(a, b), `dados reais, ${nome}: o placar de antes idêntico (só ganhou ${NOVAS_DO_PLACAR.length} chaves)`, { a, b })
  }
  await falarComo(null)

  console.log('\n── as portas e a estrutura')
  for (const [nome, assinatura] of Object.entries(PORTAS)) {
    const { quantas, lista } = await uma(
      `select count(*)::int as quantas, string_agg(p.oid::regprocedure::text, ' | ') as lista
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    const pr = await uma(`select has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
                                 has_function_privilege('anon', $1, 'EXECUTE') as anon,
                                 (select prosecdef from pg_proc where oid = $1::regprocedure) as definer`, [`public.${assinatura}`])
    conferir(quantas === 1 && lista === assinatura && pr.aut === true && pr.anon === false && pr.definer === true,
      `${nome}: uma assinatura, security definer, authenticated sim, anon não`, { lista, pr })
  }
  for (const f of MIOLO) {
    const pr = await uma(`select has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
                                 has_function_privilege('anon', $1, 'EXECUTE') as anon`, [`public.${f}`])
    conferir(pr.aut === false && pr.anon === false, `${f}: miolo fechado`, pr)
  }
  // ⚠️ CONFERIDO CONTRA A IRMÃ (`vessel_stylist_etapas`): RLS ligada, nenhuma
  // política, nenhum grant a anon/authenticated.
  const desenho = (t) => uma(`select c.relrowsecurity as rls,
      (select count(*) from pg_policies where tablename = $1)::int as politicas,
      (select count(*) from information_schema.role_table_grants
        where table_name = $1 and grantee in ('anon', 'authenticated'))::int as grants
      from pg_class c where c.relname = $1`, [t])
  const irma = await desenho('vessel_stylist_etapas')
  const nova = await desenho('vessel_stylist_motivos_de_saida')
  conferir(igual(nova, irma) && irma.rls === true && irma.politicas === 0 && irma.grants === 0,
    'vessel_stylist_motivos_de_saida: igual à irmã vessel_stylist_etapas (RLS, 0 políticas, 0 grants)', { nova, irma })
  const etapas0 = (await cli.query(`select nome, ordem, tipo, conta_como_prospectada, libera_private_edit
    from public.vessel_stylist_etapas where ativa order by ordem`)).rows
  // ⚠️ OS NOMES SÃO DA OPERAÇÃO (ela já renomeou etapas pela tela): a prova
  // confere a POSIÇÃO, não os nomes de hoje.
  const ordemDe = (n) => etapas0.find((e) => e.nome === n)?.ordem
  const antesDaMigration = (await cli.query(`select nome from public.vessel_stylist_etapas where ativa and nome <> 'Ativada' order by ordem`)).rows.map((x) => x.nome)
  conferir(etapas0.find((e) => e.nome === 'Ativada')?.tipo === 'saida' && ordemDe('Ativada') === ordemDe('Desclassificado') - 1
    && etapas0.filter((e) => e.tipo === 'saida')[0]?.nome === 'Ativada'
    && etapas0.filter((e) => e.libera_private_edit).map((e) => e.nome).join() === 'Ativada'
    && etapas0.filter((e) => e.conta_como_prospectada).length === 1
    && etapas0.every((e, i) => e.ordem === i + 1) && antesDaMigration.length === etapas0.length - 1,
    `a Ativada entrou como a PRIMEIRA saída (antes do Desclassificado), a única que libera Private Edit; uma só "conta como prospectada"; ordem sem buracos — ${etapas0.map((e) => e.nome).join(' › ')}`, etapas0)
  const motivos0 = (await cli.query(`select m.nome, m.ordem, m.exige_nota, m.ativo from public.vessel_stylist_motivos_de_saida m
    join public.vessel_stylist_etapas e on e.id = m.etapa_id where e.nome = 'Desclassificado' order by m.ordem`)).rows
  conferir(igual(motivos0.map((m) => m.nome), MOTIVOS_DO_DESCLASSIFICADO) && motivos0.every((m, i) => m.ordem === i + 1 && m.ativo)
    && motivos0.filter((m) => m.exige_nota).map((m) => m.nome).join() === 'Outro',
    'os nove motivos do Desclassificado, na ordem; só "Outro" exige nota', motivos0)
  const daAtivada = await uma(`select count(*)::int as n from public.vessel_stylist_motivos_de_saida m
    join public.vessel_stylist_etapas e on e.id = m.etapa_id where e.nome = 'Ativada'`)
  conferir(daAtivada.n === 0, 'a Ativada nasce sem motivos', daAtivada)
  const trilha0 = (await cli.query(`select t.acao, t.por_nome from public.vessel_stylist_etapas_trilha t
    join public.vessel_stylist_etapas e on e.id = t.etapa_id where e.nome = 'Ativada' order by t.id`)).rows
  conferir(trilha0.map((t) => t.acao).join() === 'criar,libera_private_edit' && trilha0.every((t) => /migration/.test(t.por_nome)),
    'a trilha diz que a migration criou a Ativada e marcou a liberação', trilha0)

  await cli.query('savepoint prova')
  const E = {}
  for (const n of ['Identificado', 'Prospectado', 'Ativada', 'Desclassificado']) E[n] = await etapaId(n)
  const motivo = async (nome) => Number((await uma(`select id from public.vessel_stylist_motivos_de_saida where etapa_id = $1 and nome = $2`, [E.Desclassificado, nome])).id)
  const M = { naoConecta: await motivo('Não conecta com a marca'), outro: await motivo('Outro'), desinteresse: await motivo('Desinteresse') }
  const stylist = (codigo) => uma(`select s.*, e.nome as etapa from public.vessel_stylists s
    join public.vessel_stylist_etapas e on e.id = s.etapa_id where s.codigo = $1`, [codigo])
  const ultimaDoHistorico = (codigo) => uma(`select h.*, pa.nome as para, m.nome as motivo_nome from public.vessel_stylist_etapas_historico h
    join public.vessel_stylists s on s.id = h.stylist_id join public.vessel_stylist_etapas pa on pa.id = h.para_etapa_id
    left join public.vessel_stylist_motivos_de_saida m on m.id = h.motivo_id where s.codigo = $1 order by h.id desc limit 1`, [codigo])
  const nova0 = async (nome, n) => (await rpc('vessel_stylist_criar', { p_nome: nome, p_whatsapp: `(19) 99000-25${n}`, p_origem_contato: 'pesquisa' })).codigo
  // ⚠️ CADA ENCONTRO NUM DIA DIFERENTE: o código é "PE-dia-praça-(quantos já há
  // naquele dia + 1)", e um encontro que MUDOU de dia deixa o número dele livre
  // no dia de origem — criar outro lá repete o código (defeito de antes desta
  // migration, anotado na entrega). A prova não tropeça nele.
  let diaDoProximo = 11
  const criarPE = (codigo, dias = diaDoProximo++) => r(`public.vessel_criar_private_edit($1, now() + make_interval(days => $2::int), null, 'CPS', 'iguatemi', 8)`, [codigo, dias])
  const quantosPE = async () => (await uma(`select count(*)::int as n from public.vessel_private_edits`)).n
  const doEncontro = (codigo) => uma(`select codigo, stylist_id, quando, local, praca, loja, vagas, status, ativa, arquivada
    from public.vessel_private_edits where codigo = $1`, [codigo])
  const escolher = async (codigo) => (await rpc('vessel_stylists_para_escolher')).find((x) => x.codigo === codigo)

  console.log('\n── Private Edit só com stylist liberada')
  await falarComo(mexe)
  const S1 = await nova0('Prova Liberada', '01')
  let n0 = await quantosPE()
  let pe = await criarPE(S1)
  conferir(pe.ok === false && pe.situacao === 'stylist_nao_liberada' && /Identificado/.test(pe.erro) && /Ativada/.test(pe.erro)
    && (await quantosPE()) === n0, 'stylist em Identificado: encontro RECUSADO (stylist_nao_liberada), a frase diz a etapa dela e a que libera, nada gravado', pe)
  let esc = await escolher(S1)
  conferir(esc && esc.libera_private_edit === false && esc.etapa === 'Identificado' && 'whatsapp' in esc,
    'a base do Private Edit diz que ela ainda não está liberada (e continua com o WhatsApp)', esc)
  const paraAtivada = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: S1, p_etapa_id: E.Ativada })
  conferir(paraAtivada.ok && paraAtivada.libera_private_edit === true && paraAtivada.etapa === 'Ativada',
    'mover para a Ativada não pede motivo (a Ativada não tem) e avisa que libera Private Edit', paraAtivada)
  esc = await escolher(S1)
  conferir(esc.libera_private_edit === true && esc.etapa === 'Ativada', '…e na mesma hora ela aparece liberada na base do Private Edit (sem cache)', esc)
  pe = await criarPE(S1)
  conferir(pe.ok === true && /^PE-/.test(pe.codigo), 'na Ativada: o encontro é criado', pe)
  const P1 = pe.codigo
  let ed = await rpc('vessel_private_edit_editar', { p_codigo: P1, p_stylist: S1, p_local: 'Loja da Prova' })
  conferir(ed.ok, 'editar mandando a MESMA anfitriã passa', ed)
  const antesDeSair = await doEncontro(P1)
  const volta = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: S1, p_etapa_id: E.Identificado })
  const depoisDeSair = await doEncontro(P1)
  conferir(volta.ok && igual(antesDeSair, depoisDeSair), 'ela sai da Ativada: o encontro que ela já tem fica intacto, campo por campo', { antesDeSair, depoisDeSair })
  pe = await criarPE(S1)
  conferir(pe.situacao === 'stylist_nao_liberada', '…e um encontro NOVO com ela volta a ser recusado', pe)
  ed = await rpc('vessel_private_edit_editar', { p_codigo: P1, p_quando: new Date(Date.now() + 5 * 864e5).toISOString() })
  const ed2 = await rpc('vessel_private_edit_editar', { p_codigo: P1, p_stylist: S1, p_vagas: 9 })
  conferir(ed.ok && ed2.ok, 'editar o encontro dela (sem trocar a anfitriã, ou mandando a mesma) continua passando fora da Ativada', { ed, ed2 })
  const S2 = await nova0('Prova Troca', '02')
  ed = await rpc('vessel_private_edit_editar', { p_codigo: P1, p_stylist: S2 })
  conferir(ed.situacao === 'stylist_nao_liberada' && (await doEncontro(P1)).stylist_id === depoisDeSair.stylist_id,
    'TROCAR a anfitriã por uma em Identificado: recusado, e o encontro não muda', ed)
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: S2, p_etapa_id: E.Ativada })
  ed = await rpc('vessel_private_edit_editar', { p_codigo: P1, p_stylist: S2 })
  conferir(ed.ok && (await doEncontro(P1)).stylist_id === (await stylist(S2)).id, '…trocar por uma que está na Ativada passa', ed)

  console.log('\n── a marca "libera Private Edit" (quem pode, e o que ela faz)')
  await falarComo(soVe)
  let lib = await rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: E.Identificado, p_libera: true })
  conferir(lib.situacao === 'sem_permissao', 'quem só vê não marca a etapa', lib)
  await falarComo(mexe)
  const S3 = await nova0('Prova Marca', '03')
  lib = await rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: E.Identificado, p_libera: true })
  pe = await criarPE(S3)
  conferir(lib.ok && pe.ok, 'marcar Identificado como liberadora: quem está nela já pode ter encontro', { lib, pe })
  const trilhaLib = await uma(`select acao, por, por_nome, antes, depois from public.vessel_stylist_etapas_trilha
    where etapa_id = $1 order by id desc limit 1`, [E.Identificado])
  conferir(trilhaLib.acao === 'libera_private_edit' && trilhaLib.por === mexe && trilhaLib.por_nome === 'Prova Ativada'
    && trilhaLib.depois.libera_private_edit === true, 'a trilha guarda quem marcou', trilhaLib)
  lib = await rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: E.Identificado, p_libera: false })
  pe = await criarPE(S3)
  conferir(lib.ok && pe.situacao === 'stylist_nao_liberada', 'desmarcar: encontro novo volta a ser recusado', { lib, pe })
  const semNenhuma = await rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: E.Ativada, p_libera: false })
  pe = await criarPE(S2)
  const lista0 = await rpc('vessel_stylist_etapas')
  conferir(semNenhuma.ok && pe.situacao === 'stylist_nao_liberada' && /nenhuma etapa libera/.test(pe.erro) && pe.etapas_que_liberam === null
    && lista0.every((e) => e.libera_private_edit === false), 'nenhuma etapa marcada é permitido: ninguém recebe encontro novo, e a frase diz como liberar', pe)
  await rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: E.Ativada, p_libera: true })
  lib = await rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: E.Ativada, p_libera: true })
  conferir(lib.situacao === 'sem_mudanca', 'marcar o que já está marcado: sem_mudanca', lib)

  console.log('\n── os motivos da saída')
  const D = await nova0('Prova Desclassificada', '04')
  let mv = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: D, p_etapa_id: E.Desclassificado })
  conferir(mv.situacao === 'motivo_obrigatorio' && (await stylist(D)).etapa === 'Identificado',
    'mover para o Desclassificado SEM motivo: recusado, e ela fica onde estava', mv)
  mv = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: D, p_etapa_id: E.Desclassificado, p_motivo_id: 999999999 })
  conferir(mv.situacao === 'motivo_invalido', 'motivo que não é desta saída: recusado', mv)
  mv = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: D, p_etapa_id: E.Desclassificado, p_motivo_id: M.outro, p_nota: '   ' })
  conferir(mv.situacao === 'nota_obrigatoria', '"Outro" sem nota (ou só espaço): recusado', mv)
  mv = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: D, p_etapa_id: E.Desclassificado, p_motivo_id: M.naoConecta, p_nota: 'x'.repeat(501) })
  conferir(mv.situacao === 'nota_longa', 'nota de mais de 500 letras: recusada', mv)
  mv = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: D, p_etapa_id: E.Desclassificado, p_motivo_id: M.naoConecta, p_nota: ' Estética muito diferente. ' })
  let h = await ultimaDoHistorico(D)
  conferir(mv.ok && h.para === 'Desclassificado' && Number(h.motivo_id) === M.naoConecta && h.nota === 'Estética muito diferente.'
    && h.motivo === 'mudanca' && h.por === mexe, 'com motivo: passa, e o histórico grava o motivo e a nota (limpa), com quem', h)
  const rast = async (codigo) => (await rpc('vessel_rastreio_dos_stylists', { p_dias: 14, p_incluir_desativadas: true })).find((x) => x.codigo === codigo)
  let linha = await rast(D)
  conferir(linha.saida_motivo === 'Não conecta com a marca' && linha.saida_nota === 'Estética muito diferente.' && linha.etapa_libera_private_edit === false,
    'a lista da tela traz o motivo atual (para o cartão das Saídas e a ficha)', linha)
  const hRpc = await rpc('vessel_stylist_historico_de_etapas', { p_codigo: D })
  conferir(hRpc[0].motivo_de_saida === 'Não conecta com a marca' && hRpc[0].nota === 'Estética muito diferente.', 'o histórico da ficha mostra o motivo e a nota', hRpc[0])
  let lista = await rpc('vessel_stylist_etapas')
  let des = lista.find((e) => e.nome === 'Desclassificado')
  conferir(des.motivos.find((m) => m.id === M.naoConecta).stylists === 1 && des.stylists_sem_motivo === 0 && des.motivos.length === 9,
    'as etapas contam quem está hoje em cada motivo (o bloco "Saídas por motivo")', des)
  const Dout = await nova0('Prova Outro', '05')
  mv = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: Dout, p_etapa_id: E.Desclassificado, p_motivo_id: M.outro, p_nota: 'Mudou de cidade' })
  conferir(mv.ok && (await ultimaDoHistorico(Dout)).nota === 'Mudou de cidade', '"Outro" com nota: passa', mv)
  const Ddir = await nova0('Prova Update Direto', '06')
  const erroDireto = await tentar(() => cli.query(`update public.vessel_stylists set etapa_id = $1 where codigo = $2`, [E.Desclassificado, Ddir]))
  conferir(erroDireto?.code === '23514', 'o cinto: um update direto para o Desclassificado sem motivo levanta erro (23514)', erroDireto?.message)
  const soAtivada = await tentar(() => cli.query(`update public.vessel_stylists set etapa_id = $1 where codigo = $2`, [E.Ativada, Ddir]))
  conferir(soAtivada === null, '…e para a Ativada (sem motivos) o update direto passa', soAtivada?.message)

  // Desativar o motivo: some da escolha, fica no histórico.
  let at = await rpc('vessel_stylist_motivo_ativar', { p_id: M.naoConecta, p_ativo: false })
  lista = await rpc('vessel_stylist_etapas'); des = lista.find((e) => e.nome === 'Desclassificado')
  const ativos = des.motivos.filter((m) => m.ativo).map((m) => m.nome)
  conferir(at.ok && !ativos.includes('Não conecta com a marca') && des.motivos.at(-1).nome === 'Não conecta com a marca'
    && des.motivos.at(-1).ativo === false && des.motivos.filter((m) => m.ativo).every((m, i) => m.ordem === i + 1),
    'desativar: some dos ativos (vai para o fim da lista, marcado inativo) e os ativos renumeram sem buraco', des.motivos)
  const hDepois = await rpc('vessel_stylist_historico_de_etapas', { p_codigo: D })
  linha = await rast(D)
  conferir(hDepois[0].motivo_de_saida === 'Não conecta com a marca' && linha.saida_motivo === 'Não conecta com a marca',
    '…mas continua no histórico e na lista de quem já saiu por ele', { h: hDepois[0], linha: linha.saida_motivo })
  const Dx = await nova0('Prova Motivo Desativado', '07')
  mv = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: Dx, p_etapa_id: E.Desclassificado, p_motivo_id: M.naoConecta })
  conferir(mv.situacao === 'motivo_invalido', '…e não serve para uma saída nova', mv)
  at = await rpc('vessel_stylist_motivo_ativar', { p_id: M.naoConecta, p_ativo: true })
  lista = await rpc('vessel_stylist_etapas'); des = lista.find((e) => e.nome === 'Desclassificado')
  conferir(at.ok && des.motivos.find((m) => m.id === M.naoConecta).ordem === 9 && des.motivos.every((m) => m.ativo),
    'reativar: volta, no fim da lista', des.motivos.map((m) => `${m.ordem}:${m.nome}`))

  // Mexer nos motivos.
  let mc = await rpc('vessel_stylist_motivo_criar', { p_etapa_id: E.Identificado, p_nome: 'Não devia' })
  conferir(mc.situacao === 'so_saida', 'motivo só existe em SAÍDA', mc)
  mc = await rpc('vessel_stylist_motivo_criar', { p_etapa_id: E.Desclassificado, p_nome: '  DESINTERESSE ' })
  conferir(mc.situacao === 'nome_repetido', 'nome repetido (sem diferença de maiúscula) é recusado', mc)
  mc = await rpc('vessel_stylist_motivo_criar', { p_etapa_id: E.Desclassificado, p_nome: 'Mudou de área', p_exige_nota: true })
  const ren = await rpc('vessel_stylist_motivo_renomear', { p_id: mc.id, p_nome: 'Mudou de profissão' })
  const sobe = await rpc('vessel_stylist_motivo_mover', { p_id: mc.id, p_direcao: 'subir' })
  const topo = await rpc('vessel_stylist_motivo_mover', { p_id: M.desinteresse, p_direcao: 'subir' })
  const semNota = await rpc('vessel_stylist_motivo_exigir_nota', { p_id: mc.id, p_exige: false })
  const m1 = await uma(`select nome, ordem, exige_nota, alterado_por_nome from public.vessel_stylist_motivos_de_saida where id = $1`, [mc.id])
  conferir(mc.ok && ren.ok && sobe.ok && topo.situacao === 'no_limite' && semNota.ok && m1.nome === 'Mudou de profissão'
    && m1.ordem === 9 && m1.exige_nota === false && m1.alterado_por_nome === 'Prova Ativada',
    'adicionar, renomear, subir (o primeiro não sobe), pedir/não pedir nota — com quem mexeu por último', { mc, ren, sobe, topo, m1 })
  const trilhaM = (await cli.query(`select acao from public.vessel_stylist_etapas_trilha where etapa_id = $1 and acao like 'motivo_%'`, [E.Desclassificado])).rows.map((x) => x.acao)
  conferir(['motivo_criar', 'motivo_renomear', 'motivo_reordenar', 'motivo_ativar', 'motivo_exige_nota'].every((a) => trilhaM.includes(a)),
    'a trilha guarda cada gesto nos motivos (a lista fechada aceitou as ações novas)', trilhaM)
  const apagar = await tentar(() => cli.query(`delete from public.vessel_stylist_motivos_de_saida where id = $1`, [mc.id]))
  conferir(apagar?.code === '42501', 'motivo não se apaga (nem por delete direto)', apagar?.message)
  await falarComo(soVe)
  const escritasM = {
    vessel_stylist_motivo_criar: { p_etapa_id: E.Desclassificado, p_nome: 'Não devia' },
    vessel_stylist_motivo_renomear: { p_id: mc.id, p_nome: 'X' },
    vessel_stylist_motivo_mover: { p_id: mc.id, p_direcao: 'descer' },
    vessel_stylist_motivo_ativar: { p_id: mc.id, p_ativo: false },
    vessel_stylist_motivo_exigir_nota: { p_id: mc.id, p_exige: true },
    vessel_stylist_mover_de_etapa: { p_codigo: Dx, p_etapa_id: E.Desclassificado, p_motivo_id: M.desinteresse },
  }
  const trilhaAntes = (await uma(`select count(*)::int as n from public.vessel_stylist_etapas_trilha`)).n
  for (const [fn, corpo] of Object.entries(escritasM)) {
    const x = await rpc(fn, corpo)
    conferir(x?.situacao === 'sem_permissao', `quem só vê não mexe: ${fn}`, x)
  }
  conferir((await uma(`select count(*)::int as n from public.vessel_stylist_etapas_trilha`)).n === trilhaAntes
    && (await stylist(Dx)).etapa === 'Identificado', '…e nada foi gravado', null)
  const leVe = await rpc('vessel_stylist_etapas')
  conferir(Array.isArray(leVe) && leVe.some((e) => e.motivos.length), 'quem só vê LÊ as etapas e os motivos', leVe?.length)

  // Excluir etapa com destino numa saída com motivos.
  await falarComo(mexe)
  const tmp = await rpc('vessel_stylist_etapa_criar', { p_nome: 'Temporária da Prova', p_posicao: 2 })
  const F = await nova0('Prova Exclusão', '08')
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: F, p_etapa_id: tmp.id })
  let ex = await rpc('vessel_stylist_etapa_excluir', { p_id: tmp.id, p_destino: E.Desclassificado })
  conferir(ex.situacao === 'motivo_obrigatorio' && ex.stylists === 1 && (await stylist(F)).etapa === 'Temporária da Prova',
    'excluir etapa mandando gente para o Desclassificado SEM motivo: recusado, nada muda', ex)
  ex = await rpc('vessel_stylist_etapa_excluir', { p_id: tmp.id, p_destino: E.Desclassificado, p_motivo_id: M.desinteresse })
  h = await ultimaDoHistorico(F)
  conferir(ex.ok && ex.movidas === 1 && h.para === 'Desclassificado' && h.motivo === 'etapa_excluida' && Number(h.motivo_id) === M.desinteresse,
    '…com motivo: todas vão, e o histórico diz "etapa excluída" E o motivo', h)
  mv = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: F, p_etapa_id: E.Identificado, p_motivo_id: M.desinteresse, p_nota: 'ignorada' })
  h = await ultimaDoHistorico(F)
  linha = await rast(F)
  conferir(mv.ok && h.motivo_id === null && h.nota === null && linha.saida_motivo === null,
    'voltar ao funil: o motivo não se aplica (fica nulo no histórico e some da lista)', { h, linha: linha.saida_motivo })

  console.log('\n── sem sessão (a chave pública)')
  await falarComo(null)
  for (const [fn, corpo] of Object.entries({
    vessel_criar_private_edit: null, vessel_stylist_etapa_liberar_private_edit: { p_id: E.Ativada, p_libera: false },
    vessel_stylist_motivo_criar: { p_etapa_id: E.Desclassificado, p_nome: 'Anon' },
    vessel_stylist_mover_de_etapa: { p_codigo: S1, p_etapa_id: E.Ativada },
    vessel_private_edit_editar: { p_codigo: P1, p_local: 'anon' },
  })) {
    const x = corpo ? await rpc(fn, corpo) : await criarPE(S2)
    conferir(x?.situacao === 'sem_permissao', `sem sessão: ${fn} recusa`, x)
  }
  for (const f of ['vessel_stylist_etapas()', 'vessel_stylists_para_escolher()', `vessel_rastreio_dos_stylists(14, false)`]) {
    const e = await tentar(() => r(`public.${f}`))
    conferir(e?.code === '42501', `sem sessão: ${f} recusa (42501)`, e?.code)
  }

  console.log('\n── a ativação (uma função só)')
  await falarComo(mexe)
  const S4 = await nova0('Prova Ativação', '09')
  const semAtivar = await r(`public.vessel_stylist_ativada_em((select id from public.vessel_stylists where codigo = $1))`, [S4])
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: S4, p_etapa_id: E.Ativada })
  const chegada = (await ultimaDoHistorico(S4)).em
  const ativou = await r(`public.vessel_stylist_ativada_em((select id from public.vessel_stylists where codigo = $1))`, [S4])
  const sc = await r(`public.vessel_scorecard_da_stylist($1)`, [S4])
  conferir(semAtivar === null && +ativou === +chegada && +new Date(sc.ativada_em) === +chegada && sc.private_edit_agendado_em === null
    && sc.ativada_por_encontro_antigo === false, 'sem etapa liberadora: nula; ao chegar na Ativada, a data é a da chegada (e a ficha diz a mesma)', { semAtivar, ativou, chegada, sc: sc.ativada_em })
  await rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: E.Ativada, p_libera: false })
  const aindaAtivou = await r(`public.vessel_stylist_ativada_em((select id from public.vessel_stylists where codigo = $1))`, [S4])
  await rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: E.Ativada, p_libera: true })
  conferir(+aindaAtivou === +chegada, 'desmarcar a etapa depois NÃO reescreve a data de ativação (a foto da chegada)', aindaAtivou)
  const pe4 = await criarPE(S4)
  const sc4 = await r(`public.vessel_scorecard_da_stylist($1)`, [S4])
  conferir(pe4.ok && +new Date(sc4.ativada_em) === +chegada && sc4.private_edit_agendado_em !== null,
    'o encontro agendado depois não muda a ativação; ele vai para "Private Edit agendado em"', sc4)
  // A turma de antes: encontro sem nunca ter passado por etapa liberadora.
  const S5 = await nova0('Prova Turma Antiga', '10')
  await rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: E.Identificado, p_libera: true })
  await criarPE(S5)
  await rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: E.Identificado, p_libera: false })
  const sc5 = await r(`public.vessel_scorecard_da_stylist($1)`, [S5])
  conferir(sc5.ativada_em !== null && sc5.ativada_em === sc5.private_edit_agendado_em && sc5.ativada_por_encontro_antigo === true,
    'quem tem encontro mas nunca chegou numa etapa liberadora ativa na data do primeiro encontro (a turma antiga não some)', sc5)
  const linha5 = await rast(S5)
  conferir(linha5.ativada_em === sc5.ativada_em && linha5.private_edit_agendado_em === sc5.private_edit_agendado_em,
    'a lista da tela usa a MESMA ativação da ficha', linha5)

  await cli.query('rollback to savepoint prova')

  console.log('\n── o placar: o mesmo cenário, antes e depois')
  await cli.query('savepoint cenario_novo')
  await falarComo(mexe)
  const Enovo = { Ativada: await etapaId('Ativada'), Identificado: await etapaId('Identificado') }
  const novo = await cenario({
    antesDosEncontros: async ({ A, B, D }) => {
      for (const c of [A, B, D]) await rpc('vessel_stylist_mover_de_etapa', { p_codigo: c, p_etapa_id: Enovo.Ativada })
    },
    // A E é a turma de antes: o encontro sai sem ela nunca ter CHEGADO numa
    // etapa liberadora (a marca é ligada com ela já dentro, e desligada depois).
    antesDaE: () => rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: Enovo.Identificado, p_libera: true }),
    depoisDaE: () => rpc('vessel_stylist_etapa_liberar_private_edit', { p_id: Enovo.Identificado, p_libera: false }),
  })
  conferir(novo.encontros.every(Boolean), 'cenário montado no banco novo (4 encontros)', novo.encontros)
  for (const [nome] of PERIODOS) {
    const a = velho.placar[nome], b = novo.placar[nome]
    const diferentes = Object.keys(a).filter((k) => !igual(a[k], b[k]))
    const semMotivo = diferentes.filter((k) => !(k in MUDA_PELA_REGRA))
    console.log(`    ${nome}: ${diferentes.length ? diferentes.map((k) => `${k} ${JSON.stringify(a[k])}→${JSON.stringify(b[k])} (${MUDA_PELA_REGRA[k] || '???'})`).join('; ') : 'nenhuma diferença'}`)
    conferir(semMotivo.length === 0, `placar (${nome}): tudo bate, fora a ativação nova e o que deriva dela`, { semMotivo, a, b })
    conferir(b.com_private_edit_agendado === a.ativadas,
      `placar (${nome}): o número de antes não sumiu — "ativadas" de antes (${a.ativadas}) = "com Private Edit agendado" de agora`, { antes: a.ativadas, agora: b.com_private_edit_agendado })
    conferir(igual(a.por_stylist, b.por_stylist) && a.receita === b.receita && a.vendas === b.vendas,
      `placar (${nome}): receita e vendas por stylist iguais às de antes`, { a: a.por_stylist, b: b.por_stylist })
  }
  const tudoVelho = velho.placar['desde o início'], tudoNovo = novo.placar['desde o início']
  // O que o cenário SOMOU aos dados reais (a base de hoje já tem uma prospectada).
  const real = realDepois['desde o início']
  const soma = (k) => Number(tudoNovo[k]) - Number(real[k])
  conferir(tudoNovo.ativadas === tudoVelho.ativadas + 1 && soma('ativadas_por_encontro_antigo') === 1
    && soma('com_private_edit_realizado') === 1 && soma('prospectadas') === 1 && soma('prospectadas_ja_ativadas') === 1
    && soma('prospectadas_com_private_edit_agendado') === 1 && soma('prospectadas_com_private_edit_realizado') === 1
    && soma('prospectadas_recorrentes') === 1,
    `desde o início: ativadas ${tudoVelho.ativadas}→${tudoNovo.ativadas} (a D, na Ativada sem encontro), 1 pela turma antiga (a E), e a turma da A passa pelas cinco etapas`, tudoNovo)
  await fichasBatem('banco novo com o cenário')
  // A B sai da Ativada: os encontros dela continuam contando.
  const antesDeTirar = await r(`public.vessel_placar_do_stylist_circle(null, null, 14)`)
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: novo.codigos.B, p_etapa_id: Enovo.Identificado })
  const depoisDeTirar = await r(`public.vessel_placar_do_stylist_circle(null, null, 14)`)
  conferir(igual(antesDeTirar, depoisDeTirar),
    'a B sai da Ativada: o placar inteiro fica igual — o encontro dela conta, e a ativação (o histórico) não se reescreve', { antesDeTirar, depoisDeTirar })
  await cli.query('rollback to savepoint cenario_novo')
  await falarComo(soVe)
  await fichasBatem('dados reais no banco novo')
  await falarComo(null)

  const depoisDaProva = await uma(IMPRESSAO)
  const { m: etapasDepois } = await uma(IMPRESSAO_DAS_ETAPAS)
  conferir(igual({ ...depoisDaProva, trilha: 0 }, { ...antes, trilha: 0 }) && depoisDaProva.trilha === antes.trilha + 2,
    'a prova não deixou rastro (fora as duas linhas da trilha que a própria migration escreve)', { antes, depoisDaProva })
  console.log(`    etapas: antes ${etapasAntes} · agora ${etapasDepois} (a Ativada entrou; o Desclassificado desceu uma posição)`)

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

// ⚠️ CONFERIDO DE FORA, numa conexão nova: no ensaio, o banco tem de estar
// IGUAL ao de antes (nem a coluna nova, nem a Ativada); gravando, tem de ter as duas.
{
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  const agora = (await outra.query(IMPRESSAO)).rows[0]
  const reg = (await outra.query(`select 1 from public.schema_migrations where name = $1`, [ARQUIVO])).rowCount
  const col = (await outra.query(`select count(*)::int as n from information_schema.columns
    where table_schema = 'public' and table_name = 'vessel_stylist_etapas' and column_name = 'libera_private_edit'`)).rows[0].n
  await outra.end()
  const stylistsIguais = agora.stylists_md5 === antes.stylists_md5 && agora.private_edits_md5 === antes.private_edits_md5
  if (GRAVAR && !process.exitCode) {
    if (!stylistsIguais || reg !== 1 || col !== 1) { console.error('❌ depois do commit algo não bate', { antes, agora, reg, col }); process.exitCode = 1 }
    else console.log('  ✓ depois do commit, numa conexão nova: stylists e encontros intactos, coluna nova e migration registrada')
  } else if (!GRAVAR) {
    if (!stylistsIguais || reg !== 0 || col !== 0 || agora.historico !== antes.historico || agora.trilha !== antes.trilha) {
      console.error('❌ O ENSAIO DEIXOU RASTRO', { antes, agora, reg, col }); process.exitCode = 1
    } else console.log(`  ✓ conexão nova depois do ensaio: banco idêntico ao de antes (${agora.stylists} stylists, sem coluna nova, sem registro)`)
  }
}
