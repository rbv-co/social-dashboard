// APLICA, REGISTRA e PROVA o funil configurável da stylist.
//
//   node coletor/aplicar-vessel-stylist-funil-configuravel.mjs            → ensaio: prova tudo e DESFAZ
//   node coletor/aplicar-vessel-stylist-funil-configuravel.mjs --gravar   → prova tudo e só então grava
//
//   … --ensaiar-com-scorecard <arquivo.sql>   (SÓ NO ENSAIO) enquanto o scorecard
//     ainda não foi gravado, aplica o arquivo dele DENTRO da mesma transação
//     desfeita, antes desta migration — é a ordem em que as duas vão ao ar.
//
// ⚠️ ORDEM: `2026-09-24-vessel-stylist-scorecard-e-qualificacao.sql` VAI PRIMEIRO
// (ela refatorou o placar). Com `--gravar`, este aplicador PARA se o scorecard
// não estiver registrado no banco — a checagem espelho da que o aplicador do
// scorecard faz. Esta migration NÃO recria o placar: "prospectadas" continua
// contado por `prospectado_em`, e o que muda é quem preenche a data.
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar, provar e só então `commit`,
// conferido (`.command === 'COMMIT'`). As provas moram em savepoints desfeitos,
// falam como gente de verdade (perfis de mentira + `request.jwt.claims`) e a
// impressão das tabelas reais é conferida antes, depois do desfazer e, quando
// grava, numa conexão nova.
//
// ⚠️ A PROVA DO PLACAR: o MESMO cenário (três stylists, dois encontros
// realizados, um agendado, uma convidada) é montado ANTES da migration, com o
// banco de hoje, e DEPOIS, com o banco novo. Todos os números do placar têm de
// bater, exceto "prospectadas" (e a turma dela), que segue a regra nova.
//
// DATABASE_URL: coletor/.env OU o ambiente (`node --env-file=<.env> …`).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-24-vessel-stylist-funil-configuravel.sql'
const SCORECARD = '2026-09-24-vessel-stylist-scorecard-e-qualificacao.sql'
const ANTERIORES = ['2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql', '2026-09-24-vessel-stylist-etapa-identificada.sql']
const args = process.argv.slice(2)
const GRAVAR = args.includes('--gravar')
const iSc = args.indexOf('--ensaiar-com-scorecard')
const SCORECARD_NO_ENSAIO = iSc >= 0 ? args[iSc + 1] : null
if (GRAVAR && SCORECARD_NO_ENSAIO) { console.error('❌ --ensaiar-com-scorecard é só para o ensaio.'); process.exit(1) }

const PORTAS = {
  vessel_stylist_criar: 'vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date,text)',
  vessel_stylist_editar: 'vessel_stylist_editar(text,text,text,text,text,text,text,text,text,text,text,date,text,date,boolean,text)',
  vessel_stylist_registrar_contato: 'vessel_stylist_registrar_contato(text,text,text,text,text,date)',
  vessel_rastreio_dos_stylists: 'vessel_rastreio_dos_stylists(integer,boolean)',
  vessel_stylist_mover_de_etapa: 'vessel_stylist_mover_de_etapa(text,bigint)',
  vessel_stylist_historico_de_etapas: 'vessel_stylist_historico_de_etapas(text)',
  vessel_stylist_etapas: 'vessel_stylist_etapas()',
  vessel_stylist_etapa_criar: 'vessel_stylist_etapa_criar(text,integer,text)',
  vessel_stylist_etapa_renomear: 'vessel_stylist_etapa_renomear(bigint,text)',
  vessel_stylist_etapa_mover: 'vessel_stylist_etapa_mover(bigint,text)',
  vessel_stylist_etapa_tipo: 'vessel_stylist_etapa_tipo(bigint,text)',
  vessel_stylist_etapa_marcar_prospectada: 'vessel_stylist_etapa_marcar_prospectada(bigint)',
  vessel_stylist_etapa_excluir: 'vessel_stylist_etapa_excluir(bigint,bigint)',
}
const MIOLO = [
  'vessel_so_acrescenta()', 'vessel_etapa_conta_como_prospectada(bigint)', 'vessel_stylists_etapa_antes()',
  'vessel_stylists_etapa_depois()', 'vessel_stylist_seguir_os_encontros(bigint)',
  'vessel_stylist_etapas_anotar(bigint,text,jsonb,jsonb)', 'vessel_stylist_etapas_renumerar()',
]
const TABELAS_NOVAS = ['vessel_stylist_etapas', 'vessel_stylist_etapas_trilha', 'vessel_stylist_etapas_historico']

const IMPRESSAO = `
  select (select count(*) from public.vessel_stylists)::int as stylists,
         (select count(*) from public.vessel_private_edits)::int as private_edits,
         (select count(*) from public.vessel_stylist_contatos)::int as contatos,
         (select count(*) from public.vessel_consentimentos where stylist_id is not null)::int as consentimentos,
         (select count(*) from public.vessel_pessoas where telefone like '55199900024%')::int as pessoas_de_prova,
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
            from (select id, pessoa_id, loja, quando, status, rsvp, evento_codigo, teste
                    from public.vessel_atendimentos) t) as atendimentos`

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
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r
const rpc = async (fn, corpo = {}) => {
  const ks = Object.keys(corpo)
  return r(`public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, ks.map((k) => corpo[k]))
}
const iso = (d) => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d)
const registrada = async (nome) =>
  (await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ok`, [nome])).ok

// ── as travas de antes ──────────────────────────────────────────────────────
if (await registrada(ARQUIVO)) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }
for (const a of ANTERIORES) {
  if (!(await registrada(a))) { console.error(`❌ falta ${a} antes desta.`); process.exit(1) }
}
const scorecardNoBanco = await registrada(SCORECARD)
if (!scorecardNoBanco && !SCORECARD_NO_ENSAIO) {
  console.error(`❌ ${SCORECARD} não está no banco. Ela vai PRIMEIRO (refatorou o placar).`
    + (GRAVAR ? '' : ' Para ensaiar antes dela: --ensaiar-com-scorecard <caminho do .sql dela>.'))
  process.exit(1)
}
const { n: jaTem } = await uma(`select count(*)::int as n from public.vessel_stylists`)
if (jaTem !== 0) { console.error(`❌ vessel_stylists tem ${jaTem} linha(s): esta migration só roda com a base vazia.`); process.exit(1) }

const antes = await uma(IMPRESSAO)

await cli.query('begin')
try {
  if (!scorecardNoBanco) {
    console.log(`\n(ensaio) aplicando ${SCORECARD} dentro da transação, antes desta`)
    await cli.query(readFileSync(SCORECARD_NO_ENSAIO, 'utf8'))
  }
  const { hoje } = await uma(`select ((now() at time zone 'America/Sao_Paulo')::date)::text as hoje`)

  // ── perfis de mentira, sessão de verdade ──
  const perfil = async (features, permissions, nome) => {
    const id = randomUUID(), email = `prova-funil-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin)
                     values ($1, $2, $3, $4, $5::jsonb, false)`, [id, email, nome, features, JSON.stringify(permissions)])
    return id
  }
  const falarComo = async (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])

  // O cenário do placar: o mesmo, antes e depois. `mover` é chamado só no
  // banco novo (no de hoje não existe etapa para mover).
  const cenario = async (mover) => {
    const a = await rpc('vessel_stylist_criar', { p_nome: 'Cenário A', p_whatsapp: '(19) 99000-2461', p_origem_contato: 'pesquisa' })
    const b = await rpc('vessel_stylist_criar', { p_nome: 'Cenário B', p_whatsapp: '(19) 99000-2462', p_origem_contato: 'pesquisa' })
    const c = await rpc('vessel_stylist_criar', { p_nome: 'Cenário C', p_whatsapp: '(19) 99000-2463', p_origem_contato: 'pesquisa' })
    if (mover) await mover(a.codigo, b.codigo)
    // A porta não aceita encontro no passado: nasce no futuro e a data é
    // recuada à mão (igual nos dois bancos), para poder virar "realizado".
    const e1 = await r(`public.vessel_criar_private_edit($1, now() + interval '2 days', null, 'CPS', 'iguatemi', 8)`, [a.codigo])
    const e2 = await r(`public.vessel_criar_private_edit($1, now() + interval '3 days', null, 'CPS', 'iguatemi', 8)`, [a.codigo])
    await cli.query(`update public.vessel_private_edits set quando = now() - interval '20 days' where codigo = $1`, [e1.codigo])
    await cli.query(`update public.vessel_private_edits set quando = now() - interval '10 days' where codigo = $1`, [e2.codigo])
    const e3 = await r(`public.vessel_criar_private_edit($1, now() + interval '5 days', null, 'CPS', 'iguatemi', 8)`, [b.codigo])
    await r(`public.vessel_convidar_para_encontro($1, 'Convidada da Prova', '(19) 99000-2469')`, [e1.codigo])
    await r(`public.vessel_private_edit_situacao($1, 'realizado', current_date - 20)`, [e1.codigo])
    await r(`public.vessel_private_edit_situacao($1, 'realizado', current_date - 10)`, [e2.codigo])
    const tudo = await r(`public.vessel_placar_do_stylist_circle(null, null, 14)`)
    const mes = await r(`public.vessel_placar_do_stylist_circle(current_date - 30, current_date, 14)`)
    return { codigos: [a.codigo, b.codigo, c.codigo], encontros: [e1, e2, e3].map((e) => e?.ok), tudo, mes }
  }

  console.log('\n── antes da migration: o cenário no banco de hoje, e a trava da base vazia')
  await cli.query('savepoint antes_da_migration')
  const mexeVelho = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] }, 'Prova Funil')
  await falarComo(mexeVelho)
  const velho = await cenario(null)
  conferir(velho.encontros.every(Boolean) && velho.tudo.prospectadas === 3, 'cenário montado no banco de hoje (3 prospectadas)', velho)
  // A trava: com uma stylist na base, a migration aborta.
  await cli.query('savepoint trava')
  try {
    await cli.query(sql)
    conferir(false, 'com stylist na base, a migration aborta', 'passou')
  } catch (e) {
    conferir(/nao esta vazia/.test(e.message), 'com stylist na base, a migration aborta', e.message)
  }
  await cli.query('rollback to savepoint trava')
  await cli.query('rollback to savepoint antes_da_migration')
  await falarComo(null)

  console.log('\n── aplicar e registrar')
  await cli.query(sql)
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-stylist-funil-configuravel.mjs'])

  console.log('\n── as portas')
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
  const sug = await uma(`select count(*)::int as n from pg_proc where proname = 'vessel_stylist_sugestao_de_etapa'`)
  conferir(sug.n === 0, 'a sugestão de etapa saiu do banco', sug)
  const col = await uma(`select count(*)::int as n from information_schema.columns
    where table_schema = 'public' and table_name = 'vessel_stylists' and column_name = 'estagio'`)
  conferir(col.n === 0, 'a coluna estagio (e a lista fechada dela) saiu', col)

  // ⚠️ CONFERIDO CONTRA A IRMÃ (`vessel_stylist_contatos`): RLS ligada, nenhuma
  // política, nenhum grant a anon/authenticated.
  const irma = await uma(`select c.relrowsecurity as rls,
      (select count(*) from pg_policies where tablename = 'vessel_stylist_contatos')::int as politicas,
      (select count(*) from information_schema.role_table_grants
        where table_name = 'vessel_stylist_contatos' and grantee in ('anon', 'authenticated'))::int as grants
      from pg_class c where c.relname = 'vessel_stylist_contatos'`)
  for (const t of TABELAS_NOVAS) {
    const x = await uma(`select c.relrowsecurity as rls,
        (select count(*) from pg_policies where tablename = $1)::int as politicas,
        (select count(*) from information_schema.role_table_grants
          where table_name = $1 and grantee in ('anon', 'authenticated'))::int as grants
        from pg_class c where c.relname = $1`, [t])
    conferir(JSON.stringify(x) === JSON.stringify(irma), `${t}: igual à irmã vessel_stylist_contatos (RLS, 0 políticas, 0 grants)`, { x, irma })
  }
  const etapas0 = (await cli.query(`select nome, ordem, tipo, conta_como_prospectada from public.vessel_stylist_etapas order by ordem`)).rows
  conferir(etapas0.map((e) => `${e.ordem}:${e.nome}:${e.tipo}${e.conta_como_prospectada ? '*' : ''}`).join(' | ')
    === '1:Identificado:funil | 2:Classificação:funil | 3:Prospectado:funil* | 4:Convidado:funil | 5:Confirmado:funil | 6:Presença Confirmada:funil | 7:Desclassificado:saida',
    'as etapas iniciais, na ordem, com Prospectado marcada e Desclassificado como saída', etapas0)

  await cli.query('savepoint prova')
  const soVe = await perfil(['atendimentos'], { atendimentos: ['ver'] }, 'Só Vê')
  const mexe = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] }, 'Prova Funil')
  const id = async (nome) => (await uma(`select id from public.vessel_stylist_etapas where ativa and nome = $1`, [nome]))?.id
  const E = {}
  for (const n of ['Identificado', 'Classificação', 'Prospectado', 'Convidado', 'Confirmado', 'Presença Confirmada', 'Desclassificado']) E[n] = Number(await id(n))
  const stylist = (codigo) => uma(`select s.*, e.nome as etapa from public.vessel_stylists s
    join public.vessel_stylist_etapas e on e.id = s.etapa_id where s.codigo = $1`, [codigo])
  const historico = async (codigo) => (await cli.query(`select h.motivo, de.nome as de, pa.nome as para, h.por, h.por_nome
     from public.vessel_stylist_etapas_historico h left join public.vessel_stylist_etapas de on de.id = h.de_etapa_id
     join public.vessel_stylist_etapas pa on pa.id = h.para_etapa_id
     join public.vessel_stylists s on s.id = h.stylist_id where s.codigo = $1 order by h.id`, [codigo])).rows

  console.log('\n── a permissão')
  await falarComo(null)
  for (const f of ['vessel_stylist_etapas()', `vessel_stylist_historico_de_etapas('STY-0001')`]) {
    await cli.query('savepoint sem_sessao')
    try { await r(`public.${f}`); conferir(false, `${f} sem sessão: 42501`, 'respondeu') } catch (e) {
      conferir(e.code === '42501', `${f} sem sessão: 42501`, e.code)
    }
    await cli.query('rollback to savepoint sem_sessao')
  }
  await falarComo(soVe)
  const leitura = await rpc('vessel_stylist_etapas')
  conferir(Array.isArray(leitura) && leitura.length === 7, 'quem só vê LÊ as etapas', leitura?.length)
  const escritas = {
    vessel_stylist_etapa_criar: { p_nome: 'Não Devia' },
    vessel_stylist_etapa_renomear: { p_id: E.Classificação, p_nome: 'X' },
    vessel_stylist_etapa_mover: { p_id: E.Classificação, p_direcao: 'descer' },
    vessel_stylist_etapa_tipo: { p_id: E.Classificação, p_tipo: 'saida' },
    vessel_stylist_etapa_marcar_prospectada: { p_id: E.Classificação },
    vessel_stylist_etapa_excluir: { p_id: E.Classificação },
    vessel_stylist_mover_de_etapa: { p_codigo: 'STY-0001', p_etapa_id: E.Convidado },
    vessel_stylist_criar: { p_nome: 'Não Devia', p_whatsapp: '(19) 99000-2470', p_origem_contato: 'pesquisa' },
  }
  for (const [fn, corpo] of Object.entries(escritas)) {
    const x = await rpc(fn, corpo)
    conferir(x?.situacao === 'sem_permissao', `quem só vê não escreve: ${fn}`, x)
  }
  const nada = await uma(`select (select count(*) from public.vessel_stylists)::int as s,
    (select count(*) from public.vessel_stylist_etapas_trilha)::int as t`)
  conferir(nada.s === 0 && nada.t === 0, '…e nada foi gravado', nada)

  console.log('\n── a Central que está no ar hoje (corpos da tela antiga)')
  await falarComo(mexe)
  const velha = await rpc('vessel_stylist_criar', { p_nome: 'Prova Central de Hoje', p_whatsapp: '(19) 99000-2471',
    p_cidade: 'Campinas', p_instagram: null, p_atuacao: null, p_praca: 'CPS', p_loja: 'iguatemi',
    p_origem_contato: 'indicacao', p_responsavel: 'Fulana', p_prospectado_em: hoje, p_proxima_acao: null, p_proxima_acao_em: null })
  let s = velha.ok ? await stylist(velha.codigo) : null
  conferir(velha.ok && s.etapa === 'Identificado' && s.prospectado_em === null,
    'criar com o corpo antigo funciona; entra em Identificado e a data mandada é ignorada', { velha, s })
  const ed = await rpc('vessel_stylist_editar', { p_codigo: velha.codigo, p_nome: 'Prova Central de Hoje',
    p_whatsapp: '(19) 99000-2471', p_cidade: 'Campinas', p_instagram: null, p_atuacao: null, p_estagio: null,
    p_praca: 'CPS', p_loja: 'iguatemi', p_origem_contato: 'indicacao', p_responsavel: 'Fulana', p_prospectado_em: hoje,
    p_proxima_acao: 'Ligar', p_proxima_acao_em: null, p_sem_proxima_acao: false })
  conferir(ed.ok === true, 'corrigir com o corpo antigo funciona', ed)
  const mvVelho = await rpc('vessel_stylist_editar', { p_codigo: velha.codigo, p_estagio: 'contatado' })
  conferir(mvVelho.ok === false && mvVelho.situacao === 'etapa_pela_ficha', 'o "Avançar" antigo é recusado com etapa_pela_ficha', mvVelho)
  const lista0 = await rpc('vessel_rastreio_dos_stylists', { p_dias: 14, p_incluir_desativadas: false })
  const naLista = lista0.find((x) => x.codigo === velha.codigo)
  conferir(naLista && naLista.etapa === 'Identificado' && naLista.etapa_tipo === 'funil' && !('estagio' in naLista),
    'a lista devolve a etapa (nome, tipo, ordem) no lugar do estágio', naLista)

  console.log('\n── a etapa da stylist e a data da prospecção')
  let h = await historico(velha.codigo)
  conferir(h.length === 1 && h[0].motivo === 'cadastro' && h[0].de === null && h[0].para === 'Identificado'
    && h[0].por === mexe && h[0].por_nome === 'Prova Funil', 'o cadastro grava a entrada no histórico, com quem', h)
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: velha.codigo, p_etapa_id: E.Classificação })
  s = await stylist(velha.codigo)
  conferir(s.etapa === 'Classificação' && s.prospectado_em === null, 'antes da etapa marcada: continua sem data', s)
  const mv = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: velha.codigo, p_etapa_id: E.Convidado })
  s = await stylist(velha.codigo)
  conferir(mv.ok && s.etapa === 'Convidado' && iso(s.prospectado_em) === hoje,
    'pulando a marcada (direto para Convidado, posterior): a data vira hoje', { mv, s })
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: velha.codigo, p_etapa_id: E.Identificado })
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: velha.codigo, p_etapa_id: E.Prospectado })
  s = await stylist(velha.codigo)
  conferir(iso(s.prospectado_em) === hoje, 'voltar e chegar de novo não muda a data (uma vez só)', s)
  const saida = await rpc('vessel_stylist_criar', { p_nome: 'Prova Saída', p_whatsapp: '(19) 99000-2472', p_origem_contato: 'pesquisa' })
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: saida.codigo, p_etapa_id: E.Desclassificado })
  s = await stylist(saida.codigo)
  conferir(s.etapa === 'Desclassificado' && s.prospectado_em === null, 'saída não conta como prospectada', s)
  const ruim = await rpc('vessel_stylist_mover_de_etapa', { p_codigo: saida.codigo, p_etapa_id: 999999 })
  conferir(ruim.situacao === 'etapa_invalida', 'mover para etapa que não existe é recusado', ruim)
  h = await historico(velha.codigo)
  conferir(h.map((x) => `${x.motivo}:${x.de ?? '-'}>${x.para}`).join(' ') ===
    'cadastro:->Identificado mudanca:Identificado>Classificação mudanca:Classificação>Convidado mudanca:Convidado>Identificado mudanca:Identificado>Prospectado',
    'cada mudança é uma linha do histórico, na ordem', h)
  const hRpc = await rpc('vessel_stylist_historico_de_etapas', { p_codigo: velha.codigo })
  conferir(hRpc.length === 5 && hRpc[0].para === 'Prospectado' && hRpc[0].por_nome === 'Prova Funil', 'a ficha lê o histórico (mais novo primeiro)', hRpc)
  for (const [op, frase] of [[`update public.vessel_stylist_etapas_historico set motivo = 'mudanca'`, 'histórico: update recusado'],
    ['delete from public.vessel_stylist_etapas_historico', 'histórico: delete recusado'],
    ['delete from public.vessel_stylist_etapas_trilha', 'trilha: delete recusado']]) {
    await cli.query('savepoint so_acrescenta')
    try { await cli.query(op); conferir(op.includes('trilha') ? (await uma('select count(*)::int n from public.vessel_stylist_etapas_trilha')).n === 0 : false, frase, 'passou') } catch (e) {
      conferir(e.code === '42501' && /so-acrescenta/.test(e.message), frase, e.message)
    }
    await cli.query('rollback to savepoint so_acrescenta')
  }

  console.log('\n── nenhum movimento automático')
  const auto = await rpc('vessel_stylist_criar', { p_nome: 'Prova Encontro', p_whatsapp: '(19) 99000-2473', p_origem_contato: 'pesquisa' })
  const enc = await r(`public.vessel_criar_private_edit($1, now() + interval '3 days', null, 'CPS', 'iguatemi', 8)`, [auto.codigo])
  s = await stylist(auto.codigo)
  conferir(enc.ok && s.etapa === 'Identificado' && s.ativada_em !== null && s.prospectado_em === null,
    'encontro agendado NÃO muda a etapa (só congela ativada_em)', { enc, s })
  await r(`public.vessel_private_edit_situacao($1, 'realizado', current_date)`, [enc.codigo]).catch(() => null)
  s = await stylist(auto.codigo)
  conferir(s.etapa === 'Identificado', 'nem encontro realizado', s)
  const cont = await r(`public.vessel_stylist_registrar_contato($1, 'whatsapp', 'conversou')`, [auto.codigo])
  s = await stylist(auto.codigo)
  conferir(cont.ok && !('sugestao' in cont) && s.etapa === 'Identificado', 'registrar contato não sugere nem move etapa', { cont, s })
  const score = await r(`public.vessel_scorecard_da_stylist($1)`, [auto.codigo])
  conferir(score && score.ok !== false, 'o scorecard da stylist continua respondendo', score)
  await falarComo(null)
  await r(`public.vessel_pedido_do_stylist('Prova Landing', '(19) 99000-2474')`)
  s = await uma(`select e.nome as etapa, s.prospectado_em from public.vessel_stylists s
    join public.vessel_stylist_etapas e on e.id = s.etapa_id where s.whatsapp = '5519990002474'`)
  conferir(s && s.etapa === 'Identificado' && s.prospectado_em === null, 'inscrição pela landing entra em Identificado', s)
  await falarComo(mexe)

  console.log('\n── mexer nas etapas')
  const nova = await rpc('vessel_stylist_etapa_criar', { p_nome: '  Qualificada ', p_posicao: 3 })
  let ord = (await cli.query(`select nome from public.vessel_stylist_etapas where ativa order by ordem`)).rows.map((x) => x.nome)
  conferir(nova.ok && ord.join('|') === 'Identificado|Classificação|Qualificada|Prospectado|Convidado|Confirmado|Presença Confirmada|Desclassificado',
    'adicionar na posição 3 empurra as de baixo', ord)
  const rep = await rpc('vessel_stylist_etapa_criar', { p_nome: 'QUALIFICADA' })
  conferir(rep.situacao === 'nome_repetido', 'nome repetido sem diferença de maiúscula é recusado', rep)
  const ren = await rpc('vessel_stylist_etapa_renomear', { p_id: nova.id, p_nome: 'Qualificação' })
  const renRep = await rpc('vessel_stylist_etapa_renomear', { p_id: nova.id, p_nome: 'prospectado' })
  conferir(ren.ok && renRep.situacao === 'nome_repetido', 'renomear; e renomear para um nome que já existe é recusado', { ren, renRep })
  const sobe = await rpc('vessel_stylist_etapa_mover', { p_id: nova.id, p_direcao: 'subir' })
  const topo = await rpc('vessel_stylist_etapa_mover', { p_id: E.Identificado, p_direcao: 'subir' })
  ord = (await cli.query(`select nome, ordem from public.vessel_stylist_etapas where ativa order by ordem`)).rows
  conferir(sobe.ok && topo.situacao === 'no_limite' && ord[1].nome === 'Qualificação'
    && ord.every((x, i) => x.ordem === i + 1), 'subir troca com a vizinha; a primeira não sobe; ordem sem buracos', { sobe, topo, ord })
  const marcadaSaida = await rpc('vessel_stylist_etapa_tipo', { p_id: E.Prospectado, p_tipo: 'saida' })
  conferir(marcadaSaida.situacao === 'etapa_marcada', 'a etapa marcada não vira saída', marcadaSaida)
  const saidaMarca = await rpc('vessel_stylist_etapa_marcar_prospectada', { p_id: E.Desclassificado })
  conferir(saidaMarca.situacao === 'saida_nao_conta', 'uma saída não pode ser a marcada', saidaMarca)
  const virouSaida = await rpc('vessel_stylist_etapa_tipo', { p_id: nova.id, p_tipo: 'saida' })
  const voltouFunil = await rpc('vessel_stylist_etapa_tipo', { p_id: nova.id, p_tipo: 'funil' })
  conferir(virouSaida.ok && voltouFunil.ok, 'marcar e desmarcar como saída', { virouSaida, voltouFunil })

  // A marca muda: quem chega depois segue a nova; as datas gravadas ficam.
  const x1 = await rpc('vessel_stylist_criar', { p_nome: 'Prova Marca', p_whatsapp: '(19) 99000-2475', p_origem_contato: 'pesquisa' })
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: x1.codigo, p_etapa_id: E.Classificação })
  const antesDaMarca = await stylist(velha.codigo)
  const marca = await rpc('vessel_stylist_etapa_marcar_prospectada', { p_id: E.Classificação })
  const umaSo = await uma(`select count(*)::int as n from public.vessel_stylist_etapas where conta_como_prospectada`)
  s = await stylist(x1.codigo)
  const depoisDaMarca = await stylist(velha.codigo)
  conferir(marca.ok && umaSo.n === 1 && s.prospectado_em === null && iso(depoisDaMarca.prospectado_em) === iso(antesDaMarca.prospectado_em),
    'trocar a marca: só uma marcada; quem já estava na nova etapa não ganha data retroativa; datas gravadas ficam', { marca, umaSo, s })
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: x1.codigo, p_etapa_id: E.Identificado })
  await rpc('vessel_stylist_mover_de_etapa', { p_codigo: x1.codigo, p_etapa_id: E.Classificação })
  s = await stylist(x1.codigo)
  conferir(iso(s.prospectado_em) === hoje, '…e quem chega nela depois da troca ganha a data', s)
  await rpc('vessel_stylist_etapa_marcar_prospectada', { p_id: E.Prospectado })

  // Excluir.
  const semDestino = await rpc('vessel_stylist_etapa_excluir', { p_id: E.Classificação })
  conferir(semDestino.situacao === 'precisa_destino' && semDestino.stylists === 1, 'excluir etapa com gente exige destino (e diz quantas)', semDestino)
  const destinoRuim = await rpc('vessel_stylist_etapa_excluir', { p_id: E.Classificação, p_destino: E.Classificação })
  conferir(destinoRuim.situacao === 'destino_invalido', 'o destino não pode ser a própria etapa', destinoRuim)
  const exc = await rpc('vessel_stylist_etapa_excluir', { p_id: E.Classificação, p_destino: E.Convidado })
  s = await stylist(x1.codigo)
  h = await historico(x1.codigo)
  ord = (await cli.query(`select nome, ordem from public.vessel_stylist_etapas where ativa order by ordem`)).rows
  conferir(exc.ok && exc.movidas === 1 && s.etapa === 'Convidado' && h.at(-1).motivo === 'etapa_excluida'
    && !ord.some((x) => x.nome === 'Classificação') && ord.every((x, i) => x.ordem === i + 1),
    'excluir com destino move todas, o histórico diz "etapa_excluida", a ordem fecha', { exc, s, ultimo: h.at(-1), ord })
  const deNovo = await rpc('vessel_stylist_etapa_criar', { p_nome: 'Classificação', p_posicao: 2 })
  conferir(deNovo.ok, 'o nome da excluída volta a ficar livre', deNovo)
  const marcadaExc = await rpc('vessel_stylist_etapa_excluir', { p_id: E.Prospectado, p_destino: E.Convidado })
  conferir(marcadaExc.situacao === 'etapa_marcada', 'a etapa marcada não se exclui (marque outra antes)', marcadaExc)
  await cli.query('savepoint ultima')
  const funis = (await cli.query(`select id from public.vessel_stylist_etapas where ativa and tipo = 'funil'
                                    and not conta_como_prospectada order by ordem`)).rows
  for (const f of funis) await rpc('vessel_stylist_etapa_excluir', { p_id: f.id, p_destino: E.Prospectado })
  const ultima = await rpc('vessel_stylist_etapa_excluir', { p_id: E.Prospectado, p_destino: E.Desclassificado })
  conferir(ultima.situacao === 'ultima_do_funil', 'a última etapa de funil não se exclui', ultima)
  await cli.query('rollback to savepoint ultima')
  const trilha = (await cli.query(`select acao, por, por_nome from public.vessel_stylist_etapas_trilha order by id`)).rows
  conferir(['criar', 'renomear', 'reordenar', 'tipo', 'marcar_prospectada', 'excluir'].every((a) => trilha.some((t) => t.acao === a))
    && trilha.every((t) => t.por === mexe && t.por_nome === 'Prova Funil'),
    'a trilha guarda cada ação, com quem', trilha.map((t) => t.acao))
  const alterada = await uma(`select alterado_por_nome from public.vessel_stylist_etapas where id = $1`, [nova.id])
  conferir(alterada.alterado_por_nome === 'Prova Funil', 'a etapa mostra quem mexeu por último', alterada)
  await cli.query('savepoint fk')
  try {
    await cli.query(`update public.vessel_stylists set etapa_id = $1 where codigo = $2`, [E.Classificação, x1.codigo])
    conferir(false, 'etapa excluída não recebe ninguém (nem por update direto)', 'passou')
  } catch (e) { conferir(e.code === '23503', 'etapa excluída não recebe ninguém (nem por update direto)', e.message) }
  await cli.query('rollback to savepoint fk')

  await cli.query('rollback to savepoint prova')

  console.log('\n── o placar: o mesmo cenário, antes e depois')
  await cli.query('savepoint cenario_novo')
  const mexeNovo = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] }, 'Prova Funil')
  await falarComo(mexeNovo)
  const E2 = Number(await id('Prospectado'))
  const novo = await cenario(async (a, b) => {
    await rpc('vessel_stylist_mover_de_etapa', { p_codigo: a, p_etapa_id: E2 })
    await rpc('vessel_stylist_mover_de_etapa', { p_codigo: b, p_etapa_id: E2 })
  })
  const resumo = (p) => ['encontros_agendados', 'encontros_realizados', 'convidadas', 'ativadas', 'recorrentes_ate_o_fim', 'intervalos', 'prospectadas']
    .map((k) => `${k}=${p[k]}`).join(' ')
  console.log(`    antes:  ${resumo(velho.tudo)}\n    depois: ${resumo(novo.tudo)}`)
  conferir(velho.tudo.encontros_realizados === 2 && velho.tudo.convidadas === 1 && velho.tudo.recorrentes_ate_o_fim === 1,
    'o cenário não é vazio (2 realizados, 1 convidada, 1 recorrente)', velho.tudo)
  const fora = ['prospectadas', 'prospectadas_ja_ativadas']
  for (const periodo of ['tudo', 'mes']) {
    const a = { ...velho[periodo] }, b = { ...novo[periodo] }
    for (const k of fora) { delete a[k]; delete b[k] }
    conferir(JSON.stringify(a) === JSON.stringify(b), `placar (${periodo}): todos os números iguais, fora "prospectadas"`, { a, b })
  }
  conferir(velho.tudo.prospectadas === 3 && novo.tudo.prospectadas === 2
    && velho.tudo.prospectadas_ja_ativadas === novo.tudo.prospectadas_ja_ativadas,
    '"prospectadas" segue a regra nova: 3 no banco de hoje (todas no cadastro), 2 no novo (a que ficou em Identificado não conta)',
    { velho: [velho.tudo.prospectadas, velho.tudo.prospectadas_ja_ativadas], novo: [novo.tudo.prospectadas, novo.tudo.prospectadas_ja_ativadas] })
  await cli.query('rollback to savepoint cenario_novo')
  await falarComo(null)

  const depoisDaProva = await uma(IMPRESSAO)
  conferir(JSON.stringify(depoisDaProva) === JSON.stringify(antes), 'a prova não deixou rastro', { antes, depoisDaProva })

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
  const et = (await outra.query(`select count(*)::int as n from public.vessel_stylist_etapas where ativa`)).rows[0]
  await outra.end()
  if (JSON.stringify(agora) !== JSON.stringify(antes) || reg !== 1 || et.n !== 7) {
    console.error('❌ depois do commit algo não bate', { antes, agora, reg, et })
    process.exitCode = 1
  } else {
    console.log('  ✓ depois do commit, numa conexão nova: tabelas intactas, 7 etapas e migration registrada')
  }
}
