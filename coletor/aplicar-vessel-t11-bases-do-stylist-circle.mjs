// APLICA, REGISTRA e PROVA a T11 — as bases de controle do Stylist Circle.
//
//   node coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs            → ensaio: prova tudo e DESFAZ
//   node coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar em `schema_migrations`, provar
// e só então `commit`. Sem `--gravar` o fim é `rollback` — o ensaio roda o
// arquivo inteiro de verdade e não deixa nada.
//
// ⚠️ A PROVA FALA COMO GENTE DE VERDADE, com a trava ligada: perfis de mentira
// em `auth.users`/`profiles` e `request.jwt.claims` com o `sub` deles, que é de
// onde `auth.uid()` lê. Nenhum portão é trocado por `select true`.
//
// ⚠️ E A PROVA INTEIRA MORA DENTRO DE `savepoint prova` … `rollback to
// savepoint prova`. Toda linha que ela vê é linha que ela fez: a impressão das
// tabelas reais é tirada antes e conferida depois do desfazer E, quando grava,
// de novo numa conexão nova depois do `commit`.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-22-vessel-t11-bases-do-stylist-circle.sql'
const GRAVAR = process.argv.includes('--gravar')

// As funções que a Central chama, com a assinatura que tem de sobrar — uma só.
const PORTAS = {
  vessel_stylist_criar: 'vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date)',
  vessel_stylist_editar: 'vessel_stylist_editar(text,text,text,text,text,text,text,text,text,text,text,date,text,date,boolean)',
  vessel_criar_private_edit: 'vessel_criar_private_edit(text,timestamp with time zone,text,text,text,integer,boolean)',
  vessel_private_edit_editar: 'vessel_private_edit_editar(text,timestamp with time zone,text,text,text,integer,text)',
  vessel_private_edit_situacao: 'vessel_private_edit_situacao(text,text,date,text,text)',
  vessel_convidar_para_encontro: 'vessel_convidar_para_encontro(text,text,text,text)',
  vessel_convite_marcar: 'vessel_convite_marcar(bigint,text)',
  vessel_conta_das_private_edits: 'vessel_conta_das_private_edits(integer,boolean)',
  vessel_convidadas_do_encontro: 'vessel_convidadas_do_encontro(text,integer)',
  vessel_rastreio_dos_stylists: 'vessel_rastreio_dos_stylists(integer,boolean)',
  vessel_placar_do_stylist_circle: 'vessel_placar_do_stylist_circle(date,date,integer)',
  vessel_stylist_registrar_contato: 'vessel_stylist_registrar_contato(text,text,text,text,text,date)',
  vessel_stylist_contatos: 'vessel_stylist_contatos(text)',
}
// O miolo: ninguém de fora chama.
const MIOLO = [
  'vessel_vendas_dos_encontros(integer)',
  'vessel_stylist_seguir_os_encontros(bigint)',
]

// ⚠️ A IMPRESSÃO DO QUE É DE VERDADE, campo a campo — não `count(*)`: mexer
// num valor deixaria a contagem igual e a impressão diferente.
const IMPRESSAO = `
  select (select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) from public.vessel_pedidos p) as pedidos,
         (select md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.vessel_pessoas x) as pessoas,
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
            from (select id, pessoa_id, loja, quando, status, rsvp, evento_codigo, presenca_em, teste
                    from public.vessel_atendimentos) t) as atendimentos,
         (select count(*) from public.vessel_origens)::int as origens,
         (select count(*) from public.vessel_stylists)::int as stylists,
         (select count(*) from public.vessel_private_edits)::int as private_edits,
         (select count(*) from public.vessel_beauty_sessions)::int as beauty_sessions`

const FONE_STY = '5519990001101'
const FONE_A = '5519990001102'
const FONE_B = '5519990001103'

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r

const antes = await uma(IMPRESSAO)
const { ja } = await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ja`, [ARQUIVO])
if (ja) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }

await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs'])

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

  await cli.query('savepoint prova')

  // ── perfis de mentira e sessão de verdade ──
  const perfil = async (features, permissions) => {
    const id = randomUUID()
    const email = `prova-t11-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(
      `insert into public.profiles (id, email, features, permissions, is_superadmin)
       values ($1, $2, $3, $4::jsonb, false)`, [id, email, features, JSON.stringify(permissions)])
    return id
  }
  const falarComo = async (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])
  const soVe = await perfil(['atendimentos'], { atendimentos: ['ver'] })
  const mexe = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] })

  console.log('\n── sem sessão e só vendo: nada passa')
  await falarComo(null)
  try {
    await cli.query('savepoint sem_sessao')
    await r(`public.vessel_placar_do_stylist_circle(null, null, 14)`)
    conferir(false, 'placar sem sessão levanta 42501', 'respondeu')
  } catch (e) {
    await cli.query('rollback to savepoint sem_sessao')
    conferir(e.code === '42501', 'placar sem sessão levanta 42501', e.code)
  }
  await falarComo(soVe)
  const recusa1 = await r(`public.vessel_stylist_criar('Nao Devia', $1, p_origem_contato => 'indicacao')`, [FONE_STY])
  conferir(recusa1.situacao === 'sem_permissao', 'quem só vê não cadastra stylist', recusa1)
  const { n: nenhuma } = await uma(`select count(*)::int as n from public.vessel_stylists`)
  conferir(nenhuma === antes.stylists, '…e nada foi gravado', nenhuma)

  console.log('\n── a stylist')
  await falarComo(mexe)
  const semOrigem = await r(`public.vessel_stylist_criar('Marina da Prova', $1)`, [FONE_STY])
  conferir(semOrigem.situacao === 'origem_invalida', 'cadastrar sem dizer a origem é recusado', semOrigem)
  const lojaRuim = await r(`public.vessel_stylist_criar('Marina da Prova', $1, p_origem_contato => 'indicacao', p_loja => 'shopping-x')`, [FONE_STY])
  conferir(lojaRuim.situacao === 'loja_invalida', 'loja fora da lista é recusada', lojaRuim)
  const criada = await r(
    `public.vessel_stylist_criar(' Marina da Prova ', '(19) 99000-1101', p_cidade => 'Campinas', p_praca => 'cps',
       p_loja => 'Iguatemi', p_origem_contato => 'indicacao', p_responsavel => 'Ionara',
       p_proxima_acao => 'Ligar', p_proxima_acao_em => current_date + 2)`)
  conferir(criada.ok === true, 'cadastrar com a origem funciona', criada)
  const STY = criada.codigo
  let s = await uma(`select * from public.vessel_stylists where codigo = $1`, [STY])
  conferir(s.estagio === 'prospectado' && s.whatsapp === FONE_STY && s.loja === 'iguatemi'
    && s.origem_contato === 'indicacao' && s.ativada_em === null && s.prospectado_em !== null,
    'nasce prospectada, telefone canônico, loja em minúsculas, sem ativação', s)

  const auto = await r(`public.vessel_stylist_editar($1, p_estagio => 'recorrente')`, [STY])
  conferir(auto.situacao === 'estagio_automatico', '"recorrente" não se escolhe à mão', auto)
  const inv = await r(`public.vessel_stylist_editar($1, p_estagio => 'ativa')`, [STY])
  conferir(inv.situacao === 'estagio_invalido', 'estágio antigo ("ativa") é recusado', inv)
  const mudou = await r(`public.vessel_stylist_editar($1, p_estagio => 'em_negociacao')`, [STY])
  s = await uma(`select estagio, proxima_acao from public.vessel_stylists where codigo = $1`, [STY])
  conferir(mudou.ok === true && s.estagio === 'em_negociacao' && s.proxima_acao === 'Ligar',
    'mudar o estágio não apaga a próxima ação', s)
  await r(`public.vessel_stylist_editar($1, p_sem_proxima_acao => true)`, [STY])
  s = await uma(`select proxima_acao, proxima_acao_em from public.vessel_stylists where codigo = $1`, [STY])
  conferir(s.proxima_acao === null && s.proxima_acao_em === null, '"feita" apaga a próxima ação e a data', s)

  console.log('\n── o CRM: contatos')
  await falarComo(soVe)
  const naoPode = await r(`public.vessel_stylist_registrar_contato($1, 'whatsapp', 'conversou')`, [STY])
  conferir(naoPode.situacao === 'sem_permissao', 'quem só vê não registra contato', naoPode)
  await falarComo(mexe)
  const canalRuim = await r(`public.vessel_stylist_registrar_contato($1, 'telegrama', 'conversou')`, [STY])
  conferir(canalRuim.situacao === 'canal_invalido', 'canal fora da lista é recusado', canalRuim)
  const resRuim = await r(`public.vessel_stylist_registrar_contato($1, 'whatsapp', 'talvez')`, [STY])
  conferir(resRuim.situacao === 'resultado_invalido', 'resultado fora da lista é recusado', resRuim)
  const longa = await r(`public.vessel_stylist_registrar_contato($1, 'whatsapp', 'conversou', repeat('x', 501))`, [STY])
  conferir(longa.situacao === 'nota_longa', 'nota de 501 caracteres é recusada', longa)
  const c1 = await r(`public.vessel_stylist_registrar_contato($1, 'ligacao', 'proposta', 'Quer ver a coleção',
                        'Mandar a proposta', current_date + 1)`, [STY])
  // ⚠️ ESTE CONTATO E A ATIVAÇÃO DO PRIMEIRO ENCONTRO (mais abaixo) NASCEM NO
  // MESMO `now()` da transação — sem recuar o relógio deste contato, o placar
  // veria `criado_em = ativada_em` (não "<") e "contatos_ate_ativar" contaria
  // zero, não um. É o único jeito de simular o tempo passando dentro da prova.
  await cli.query(`update public.vessel_stylist_contatos set criado_em = now() - interval '1 minute' where id = $1`,
    [c1.id])
  s = await uma(`select estagio, proxima_acao from public.vessel_stylists where codigo = $1`, [STY])
  conferir(c1.ok && c1.sugestao === null && s.estagio === 'em_negociacao' && s.proxima_acao === 'Mandar a proposta',
    'em negociação, "pediu proposta" não sugere nada; a próxima ação foi trocada; a etapa NÃO mudou', { c1, s })
  const hist = await r(`public.vessel_stylist_contatos($1)`, [STY])
  conferir(hist.length === 1 && hist[0].canal === 'ligacao' && hist[0].criado_por_nome,
    'o histórico traz o contato com quem registrou', hist)
  const raC = (await r(`public.vessel_rastreio_dos_stylists(14, true)`)).find((x) => x.codigo === STY)
  conferir(raC.contatos === 1 && raC.ultimo_contato_em, 'o rastreio conta os contatos', raC)
  const sug = await uma(`select public.vessel_stylist_sugestao_de_etapa('conversou', 'prospectado', null) as a,
                                public.vessel_stylist_sugestao_de_etapa('conversou', 'interessado', null) as b,
                                public.vessel_stylist_sugestao_de_etapa('recusou', 'contatado', null) as c,
                                public.vessel_stylist_sugestao_de_etapa('conversou', 'pausado', null) as d`)
  conferir(sug.a === 'contatado' && sug.b === null && sug.c === 'nao_interessado' && sug.d === null,
    'a sugestão do banco segue a tabela do desenho', sug)

  console.log('\n── o encontro')
  const seis = await r(`public.vessel_criar_private_edit($1, now() - interval '12 hours', null, 'CPS', 'iguatemi', 6)`, [STY])
  conferir(seis.situacao === 'vagas_invalidas', 'capacidade 6 é recusada (7 a 10)', seis)
  const onze = await r(`public.vessel_criar_private_edit($1, now() - interval '12 hours', null, 'CPS', 'iguatemi', 11)`, [STY])
  conferir(onze.situacao === 'vagas_invalidas', 'capacidade 11 é recusada (7 a 10)', onze)
  const pe1 = await r(`public.vessel_criar_private_edit($1, now() - interval '12 hours', 'Loja', 'CPS', 'iguatemi', 8)`, [STY])
  conferir(pe1.ok === true, 'capacidade 8 cria o encontro', pe1)
  const PE1 = pe1.codigo
  const e1 = await uma(`select status from public.vessel_private_edits where codigo = $1`, [PE1])
  s = await uma(`select estagio, ativada_em from public.vessel_stylists where codigo = $1`, [STY])
  conferir(e1.status === 'agendado' && s.estagio === 'ativado' && s.ativada_em !== null,
    'encontro nasce agendado e a stylist vira ATIVADA sozinha', { e1, s })
  const volta = await r(`public.vessel_stylist_editar($1, p_estagio => 'contatado')`, [STY])
  conferir(volta.situacao === 'estagio_contradiz_encontro', 'quem já teve encontro não volta para "contatado"', volta)
  const ed = await r(`public.vessel_private_edit_editar($1, p_vagas => 3)`, [PE1])
  conferir(ed.situacao === 'vagas_invalidas', 'editar também respeita 7 a 10', ed)

  console.log('\n── as convidadas')
  const semNome = await r(`public.vessel_convidar_para_encontro($1, '', $2)`, [PE1, FONE_A])
  conferir(semNome.situacao === 'sem_nome', 'convidada sem nome é recusada', semNome)
  const foneRuim = await r(`public.vessel_convidar_para_encontro($1, 'Ana', '123')`, [PE1])
  conferir(foneRuim.situacao === 'whatsapp_invalido', 'WhatsApp sem DDD é recusado', foneRuim)
  const mailRuim = await r(`public.vessel_convidar_para_encontro($1, 'Ana', $2, 'ana@')`, [PE1, FONE_A])
  conferir(mailRuim.situacao === 'email_invalido', 'e-mail quebrado é recusado', mailRuim)
  const ca = await r(`public.vessel_convidar_para_encontro($1, 'Ana da Prova', '(19) 99000-1102', 'Ana@Prova.test')`, [PE1])
  const cb = await r(`public.vessel_convidar_para_encontro($1, 'Bia da Prova', $2)`, [PE1, FONE_B])
  const caDeNovo = await r(`public.vessel_convidar_para_encontro($1, 'Ana outra vez', $2)`, [PE1, FONE_A])
  conferir(ca.ok && cb.ok && caDeNovo.situacao === 'ja_estava' && caDeNovo.id === ca.id,
    'a mesma pessoa no mesmo encontro é UMA cadeira', { ca, caDeNovo })
  const pessoaA = await uma(`select telefone, email from public.vessel_pessoas where id = $1`, [ca.pessoa_id])
  conferir(pessoaA.telefone === FONE_A && pessoaA.email === 'ana@prova.test',
    'a ficha de cliente nasce no convite, telefone 55+DDD e e-mail', pessoaA)

  const situacoes = async () => Object.fromEntries(
    (await r(`public.vessel_convidadas_do_encontro($1, 14)`, [PE1])).map((c) => [c.id, c.situacao]))
  // O encontro 1 é de 12 horas atrás: quem não respondeu, não respondeu.
  let sit = await situacoes()
  conferir(sit[ca.id] === 'nao_respondeu', 'encontro que passou sem resposta: "não respondeu"', sit)
  await r(`public.vessel_convite_marcar($1, 'sim')`, [ca.id])
  sit = await situacoes()
  conferir(sit[ca.id] === 'confirmada', 'resposta "sim": confirmada', sit)
  await falarComo(soVe)
  const pres = await r(`public.vessel_situacao_do_atendimento($1, 'realizado')`, [ca.id])
  const falta = await r(`public.vessel_situacao_do_atendimento($1, 'no_show')`, [cb.id])
  sit = await situacoes()
  conferir(pres.ok && falta.ok && sit[ca.id] === 'presente' && sit[cb.id] === 'nao_compareceu',
    'a presença, marcada por quem só vê (a mesma porta da Central)', sit)
  await falarComo(mexe)

  console.log('\n── a situação do encontro')
  const semMotivo = await r(`public.vessel_private_edit_situacao($1, 'cancelado')`, [PE1])
  conferir(semMotivo.situacao === 'sem_motivo', 'cancelar sem motivo é recusado', semMotivo)
  const futuro = await r(`public.vessel_private_edit_situacao($1, 'realizado', current_date + 3)`, [PE1])
  conferir(futuro.situacao === 'realizado_no_futuro', 'realizado com data no futuro é recusado', futuro)
  const feito = await r(`public.vessel_private_edit_situacao($1, 'realizado')`, [PE1])
  const e1b = await uma(`select status, realizado_em, ativa from public.vessel_private_edits where codigo = $1`, [PE1])
  s = await uma(`select estagio from public.vessel_stylists where codigo = $1`, [STY])
  conferir(feito.ok && e1b.status === 'realizado' && e1b.realizado_em !== null && e1b.ativa === false
    && s.estagio === 'evento_realizado',
    'realizado: ganha a data, fecha o convite e a stylist vira "evento realizado"', { e1b, s })

  const pe2 = await r(`public.vessel_criar_private_edit($1, now() - interval '1 hour', 'Loja', 'CPS', 'iguatemi', 10)`, [STY])
  const PE2 = pe2.codigo
  await r(`public.vessel_convidar_para_encontro($1, 'Ana da Prova', $2)`, [PE2, FONE_A])
  const ca2 = (await r(`public.vessel_convidadas_do_encontro($1, 14)`, [PE2]))[0]
  await r(`public.vessel_situacao_do_atendimento($1, 'realizado')`, [ca2.id])
  await r(`public.vessel_private_edit_situacao($1, 'realizado')`, [PE2])
  s = await uma(`select estagio from public.vessel_stylists where codigo = $1`, [STY])
  conferir(s.estagio === 'recorrente', 'segundo encontro realizado: RECORRENTE sozinha', s)

  const pausa = await r(`public.vessel_stylist_editar($1, p_estagio => 'pausado')`, [STY])
  s = await uma(`select estagio from public.vessel_stylists where codigo = $1`, [STY])
  conferir(pausa.ok && s.estagio === 'pausado', 'pausar é decisão de gente, e fica', s)
  await r(`public.vessel_private_edit_situacao($1, 'realizado')`, [PE2])
  s = await uma(`select estagio from public.vessel_stylists where codigo = $1`, [STY])
  conferir(s.estagio === 'pausado', 'o gatilho não passa por cima de "pausado"', s)
  await r(`public.vessel_stylist_editar($1, p_estagio => 'sem_retorno')`, [STY])
  s = await uma(`select estagio from public.vessel_stylists where codigo = $1`, [STY])
  conferir(s.estagio === 'recorrente', 'sair de "pausado" devolve o funil ao fato', s)

  console.log('\n── a venda: primeiro encontro, só pedido atendido')
  // A Ana foi aos DOIS encontros e comprou hoje: a compra cai na janela dos dois.
  const ped = await uma(
    `insert into public.vessel_pedidos (bling_pedido_id, numero, pessoa_id, data_do_pedido, situacao_id, receita_liquida)
     values (-990001, 'PROVA-1', $1, (now() at time zone 'America/Sao_Paulo')::date, 9, 1500) returning id`, [ca.pessoa_id])
  await cli.query(`insert into public.vessel_pedido_itens (pedido_id, quantidade) values ($1, 2)`, [ped.id])
  await cli.query(
    `insert into public.vessel_pedidos (bling_pedido_id, numero, pessoa_id, data_do_pedido, situacao_id, receita_liquida)
     values (-990002, 'PROVA-2', $1, (now() at time zone 'America/Sao_Paulo')::date, 12, 999)`, [ca.pessoa_id])
  const conta = Object.fromEntries((await r(`public.vessel_conta_das_private_edits(14, false)`))
    .map((e) => [e.codigo, e]))
  conferir(Number(conta[PE1].receita) === 1500 && Number(conta[PE2].receita) === 0,
    'a venda vai para o PRIMEIRO encontro, e o cancelado (12) não entra', { pe1: conta[PE1].receita, pe2: conta[PE2].receita })
  conferir(conta[PE1].convidadas === 2 && conta[PE1].confirmadas === 2 && conta[PE1].compareceram === 1,
    'encontro 1: 2 convidadas, 2 confirmadas (inclui quem faltou), 1 veio', conta[PE1])
  const lista1 = await r(`public.vessel_convidadas_do_encontro($1, 14)`, [PE1])
  const lista2 = await r(`public.vessel_convidadas_do_encontro($1, 14)`, [PE2])
  conferir(lista1.find((c) => c.id === ca.id).comprou === true && lista2[0].comprou === false,
    '"Comprou" segue a mesma regra: sim no primeiro, — no segundo', { lista1, lista2 })

  const pl = await r(`public.vessel_placar_do_stylist_circle(null, null, 14)`)
  const esperado = { prospectadas: 1, ativadas: 1, encontros_agendados: 2, encontros_realizados: 2,
    convidadas: 3, confirmadas: 3, presentes: 2, recorrentes_no_periodo: 1, compradoras: 1, vendas: 1,
    stylists_com_contatos_ate_ativar: 1 }
  const bate = Object.entries(esperado).every(([k, v]) => pl[k] === v)
  conferir(bate && Number(pl.receita) === 1500 && Number(pl.pecas) === 2 && pl.por_stylist.length === 1
    && Number(pl.contatos_ate_ativar) === 1,
    'o placar fecha com o que foi feito, sem digitar nada (o contato foi registrado antes do primeiro encontro)', pl)
  const pvazio = await r(`public.vessel_placar_do_stylist_circle(current_date + 30, current_date + 60, 14)`)
  conferir(pvazio.encontros_agendados === 0 && pvazio.prospectadas === 0 && Number(pvazio.receita) === 0,
    'um período sem nada devolve zeros, não erro', pvazio)
  const ra = (await r(`public.vessel_rastreio_dos_stylists(14, true)`)).find((x) => x.codigo === STY)
  conferir(ra.encontros_realizados === 2 && Number(ra.receita_dos_encontros) === 1500
    && ra.proxima_data_permitida !== null && ra.loja === 'iguatemi',
    'a ficha da stylist traz encontros, última PE + 45 e receita dos encontros', ra)

  console.log('\n── o que cai não conta como feito')
  const pe3 = await r(`public.vessel_criar_private_edit($1, now() + interval '3 days', null, 'CPS', 'iguatemi', 7)`, [STY])
  const canc = await r(`public.vessel_private_edit_situacao($1, 'cancelado', null, 'Chuva forte')`, [pe3.codigo])
  const pl2 = await r(`public.vessel_placar_do_stylist_circle(null, null, 14)`)
  conferir(canc.ok && pl2.encontros_agendados === 3 && pl2.encontros_realizados === 2 && pl2.encontros_cancelados === 1,
    'cancelado entra em "agendados" e não em "realizados"', pl2)
  const fechado = await r(`public.vessel_convidar_para_encontro($1, 'Cris', '5519990001104')`, [pe3.codigo])
  conferir(fechado.situacao === 'encontro_fechado', 'não se convida para encontro cancelado', fechado)

  await cli.query('rollback to savepoint prova')
  const { n: contatosSobrando } = await uma(`select count(*)::int as n from public.vessel_stylist_contatos`)
  conferir(contatosSobrando === 0, 'a prova não deixou contato para trás', contatosSobrando)
  const depoisDaProva = await uma(IMPRESSAO)
  conferir(JSON.stringify(depoisDaProva) === JSON.stringify(antes), 'a prova não deixou rastro nas tabelas reais',
    { antes, depoisDaProva })

  if (falhas.length) throw new Error(`${falhas.length} conferência(s) falharam`)

  if (GRAVAR) {
    await cli.query('commit')
    console.log(`\n✅ ${ARQUIVO} aplicada e registrada.`)
  } else {
    await cli.query('rollback')
    console.log(`\n✅ ensaio limpo: tudo passou e NADA foi gravado. Rode com --gravar para valer.`)
  }
} catch (e) {
  await cli.query('rollback')
  console.error(`\n❌ nada foi gravado: ${e.message}`)
  process.exitCode = 1
} finally {
  await cli.end()
}

if (GRAVAR && !process.exitCode) {
  // ⚠️ DE NOVO NUMA CONEXÃO NOVA: é o que o resto do mundo vê.
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  const agora = (await outra.query(IMPRESSAO)).rows[0]
  const reg = (await outra.query(`select 1 from public.schema_migrations where name = $1`, [ARQUIVO])).rowCount
  await outra.end()
  if (JSON.stringify(agora) !== JSON.stringify(antes) || reg !== 1) {
    console.error('❌ depois do commit a impressão mudou ou o registro sumiu', { antes, agora, reg })
    process.exitCode = 1
  } else {
    console.log('  ✓ depois do commit, numa conexão nova: tabelas reais intactas e migration registrada')
  }
}
