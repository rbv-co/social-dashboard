// APLICA, REGISTRA e PROVA a porta da LP Private Appointment (T03).
// As provas seguem os testes de aceite do modulo 10 do Growth Plan.
//
// ⚠️⚠️ ESTE APLICADOR ENVELHECEU: RODAR DE NOVO DESFAZ COISA QUE VEIO DEPOIS
// (B11 de docs/pendencias.md).
//
// Este é o arquivo que CRIOU `vessel_solicitar_atendimento` — a porta que a
// LP inteira usa. Três migrations, na mesma assinatura, foram por cima dela
// para acrescentar o que faltava: a Beauty Session (`vessel-beauty-sessions`),
// a stylist (`vessel-rastreio-por-stylist`) e o cruzamento das duas
// (`vessel-contar-as-beauty-sessions`, a mais nova das três). `create or
// replace` reaplica sem erro nenhum: reaplicar este arquivo hoje devolveria a
// função para a versão de 17/09, que não sabe nem de Beauty Session nem de
// stylist — toda cliente que chegou por um QR de sessão ou por um link de
// stylist passaria a entrar como se tivesse vindo do nada, e a marca perderia
// o rastro de quem trouxe quem.
//
// ⚠️ POR QUE A TRAVA É UMA CONSULTA, E NÃO UM `process.exit` cravado: num
// banco NOVO, onde nenhuma das migrations posteriores foi aplicada, não há
// nada para desfazer e este aplicador tem de rodar normalmente.
const DEPOIS_DESTE = [
  {
    migration: '2026-09-18-vessel-contar-as-beauty-sessions.sql',
    estrago:
      'devolveria `vessel_solicitar_atendimento` para a versão de 17/09,\n' +
      '       que não cruza Beauty Session nem stylist na origem da cliente.\n' +
      '       Toda cliente vinda de um QR de sessão ou de um link de stylist\n' +
      '       entraria como se tivesse vindo do nada, calada — o painel de\n' +
      '       rastreio por parceira e o painel de Beauty Sessions ficam sem\n' +
      '       tráfego nenhum, mesmo com pedidos entrando.',
  },
]

import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-18-vessel-pedido-de-atendimento.sql'
const ASSINATURA = 'public.vessel_solicitar_atendimento(text, text, text, text, text, text, boolean, text, jsonb, text, boolean)'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()

// ⚠️ ANTES DE ABRIR TRANSACAO E ANTES DE APLICAR QUALQUER COISA.
const { rows: posteriores } = await cli.query(
  `select name from public.schema_migrations where name = any($1::text[]) order by name`,
  [DEPOIS_DESTE.map((x) => x.migration)])
if (posteriores.length > 0) {
  console.error(
    `❌ nao aplicada: ${ARQUIVO} ja foi superada e reaplica-la desfaria trabalho posterior.\n\n` +
    `Este arquivo cria \`vessel_solicitar_atendimento\`. Migration(s) mais nova(s) JA\n` +
    `APLICADA(S) mudaram essa funcao, e rodar este aplicador agora voltaria atras sem\n` +
    `erro nenhum:\n\n` +
    posteriores.map(({ name }) =>
      `  · ${name}\n       ${DEPOIS_DESTE.find((x) => x.migration === name).estrago}`).join('\n\n') +
    `\n\nVa ler essa(s) migration(s) em db/migrations/ antes de qualquer coisa. Se voce PRECISA\n` +
    `mesmo reaplicar este arquivo, a saida NAO e apagar esta trava: e reaplicar a(s)\n` +
    `migration(s) posterior(es) logo depois, pelo aplicador de cada uma.\n`)
  await cli.end()
  process.exit(1)
}

await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-pedido-de-atendimento.mjs'])

  const { rows: [t] } = await cli.query(
    `select c.relrowsecurity as trava,
            (select count(*)::int from pg_policies p
              where p.schemaname='public' and p.tablename='vessel_consentimentos') as politicas
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='vessel_consentimentos'`)
  if (!t?.trava) throw new Error('vessel_consentimentos: RLS desligada')
  if (t.politicas !== 0) throw new Error('vessel_consentimentos: tem politica')

  const { rows: [porta] } = await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [ASSINATURA])
  if (!porta.anon) throw new Error('a pagina publica nao consegue chamar')
  if (porta.autenticado || porta.qualquer_um) throw new Error('a porta ficou aberta alem do necessario')

  await cli.query('savepoint prova')
  const pedir = async (extra = {}) => (await cli.query(
    `select public.vessel_solicitar_atendimento($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,true) as r`,
    [extra.nome ?? 'Beatriz Almeida', extra.fone ?? '5519996170272', extra.loja ?? 'iguatemi',
     extra.momento ?? 'trabalho', extra.periodo ?? 'tarde', extra.recado ?? null,
     extra.marketing ?? false, extra.versao ?? 'v3',
     extra.origem === undefined ? JSON.stringify({ canal: 'meta', utm_campaign: 'vessel_cps_lead_202609',
       clique_meta: 'fb.1.1789000000.ABC123' }) : extra.origem, extra.armadilha ?? null])).rows[0].r

  // ── QA01: um envio valido cria UMA pessoa e UMA oportunidade ─────────────
  const um = await pedir()
  if (!um.ok || um.situacao !== 'solicitado') throw new Error('QA01 falhou: ' + JSON.stringify(um))
  const conta = async () => (await cli.query(
    `select (select count(*)::int from vessel_pessoas) as pessoas,
            (select count(*)::int from vessel_atendimentos) as atendimentos,
            (select count(*)::int from vessel_origens) as origens,
            (select count(*)::int from vessel_consentimentos) as permissoes`)).rows[0]
  let c = await conta()
  if (c.pessoas !== 1 || c.atendimentos !== 1) throw new Error('QA01: ' + JSON.stringify(c))

  // ── QA09: entrou SOLICITADO, nao confirmado, e sem horario ───────────────
  const { rows: [a] } = await cli.query(
    `select status, quando, momento_de_uso, periodo_preferido, origem_registro
       from vessel_atendimentos order by id desc limit 1`)
  if (a.status !== 'solicitado') throw new Error('QA09: entrou como ' + a.status)
  if (a.quando !== null) throw new Error('QA09: pedido nasceu com horario reservado')
  if (a.momento_de_uso !== 'trabalho' || a.periodo_preferido !== 'tarde')
    throw new Error('o que ela contou nao foi gravado')

  // ── QA02: duplo clique nao duplica ───────────────────────────────────────
  const dois = await pedir()
  if (!dois.ok) throw new Error('QA02: o segundo envio deu erro')
  c = await conta()
  if (c.atendimentos !== 1) throw new Error('QA02: duplo clique criou ' + c.atendimentos + ' atendimentos')

  // ── QA03: pessoa que volta preserva a ORIGEM INICIAL ─────────────────────
  const { rows: origens } = await cli.query(
    `select canal, utm_campaign, clique_meta from vessel_origens order by id`)
  if (origens.length !== 2) throw new Error('QA03: a origem deveria ACRESCENTAR, achei ' + origens.length)
  if (origens[0].utm_campaign !== 'vessel_cps_lead_202609')
    throw new Error('QA03: a primeira origem foi alterada')
  if (origens[0].clique_meta !== 'fb.1.1789000000.ABC123')
    throw new Error('a etiqueta do clique do anuncio nao foi guardada')

  // ── QA05: recusar marketing NAO bloqueia o atendimento ───────────────────
  const outra = await pedir({ nome: 'Marina Sampaio', fone: '5519987654321', marketing: false })
  if (!outra.ok) throw new Error('QA05: quem recusou marketing foi bloqueada')
  const { rows: [perm] } = await cli.query(
    `select count(*) filter (where finalidade='atendimento')::int as atendimento,
            count(*) filter (where finalidade='marketing')::int as marketing
       from vessel_consentimentos c
       join vessel_pessoas p on p.id = c.pessoa_id where p.nome = 'Marina Sampaio'`)
  if (perm.atendimento !== 1) throw new Error('QA05: faltou a permissao de atendimento')
  if (perm.marketing !== 0) throw new Error('QA05: gravou marketing sem ela ter marcado')

  const comMarketing = await pedir({ nome: 'Helena Prates', fone: '5511988887777', marketing: true })
  if (!comMarketing.ok) throw new Error('quem aceitou marketing foi recusada')
  const { rows: [perm2] } = await cli.query(
    `select count(*) filter (where finalidade='marketing')::int as marketing
       from vessel_consentimentos c join vessel_pessoas p on p.id = c.pessoa_id
      where p.nome = 'Helena Prates'`)
  if (perm2.marketing !== 1) throw new Error('quem marcou marketing nao teve a permissao gravada')

  // ── QA08: o que e invalido vira erro TRATADO, nunca sucesso falso ────────
  for (const [caso, args] of [
    ['sem nome', { nome: '   ' }],
    ['telefone torto', { fone: '123' }],
    ['loja inventada', { loja: 'shopping-da-lua' }],
    ['momento inventado', { momento: 'colecionar' }],
    ['periodo inventado', { periodo: 'madrugada' }],
    ['recado enorme', { recado: 'a'.repeat(301) }],
  ]) {
    const r = await pedir(args)
    if (r.ok !== false) throw new Error(`QA08: "${caso}" respondeu sucesso: ` + JSON.stringify(r))
  }

  // ── A armadilha continua MUDA ────────────────────────────────────────────
  const antes = (await conta()).pessoas
  const robo = await pedir({ nome: 'Robo', fone: '5519900000000', armadilha: 'preencheu' })
  if (robo.ok !== true) throw new Error('a armadilha deixou de ser muda')
  if ((await conta()).pessoas !== antes) throw new Error('a armadilha GRAVOU alguma coisa')

  // ── O pedido entra na trava de horario do gerador ────────────────────────
  // ⚠️ `solicitado` conta como ocupado: assim que a loja aceitar, a hora vale.
  await cli.query(
    `update vessel_atendimentos set quando = now() + interval '2 days' where status = 'solicitado' and loja='iguatemi'`)
  const { rows: [{ n }] } = await cli.query(
    `select public.vessel_visitas_no_horario('iguatemi', now() + interval '2 days') as n`)
  if (n < 1) throw new Error('um pedido com horario deveria contar na trava de conflito')

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query(
    `select (select count(*)::int from vessel_pessoas) as p,
            (select count(*)::int from vessel_consentimentos) as c`)
  if (sobrou.p !== 0 || sobrou.c !== 0) throw new Error('a prova deixou sujeira')

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  vessel_consentimentos: trava ligada, 0 politicas')
  console.log('  porta: anon SIM; authenticated e public NAO')
  console.log('  QA01 um envio = uma pessoa e uma oportunidade')
  console.log('  QA02 duplo clique NAO duplica')
  console.log('  QA03 a origem ACRESCENTA; a primeira nunca e sobrescrita')
  console.log('  QA05 recusar marketing nao bloqueia o atendimento')
  console.log('  QA08 seis entradas invalidas viram erro tratado, nenhuma sucesso falso')
  console.log('  QA09 entrou SOLICITADO e SEM horario reservado')
  console.log('  a etiqueta do clique do anuncio (_fbc) foi guardada')
  console.log('  a armadilha anti-robo continua muda e nao grava')
  console.log('  pedido com horario CONTA na trava de conflito do gerador')
  console.log('  prova desfeita                              ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
