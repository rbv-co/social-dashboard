// APLICA, REGISTRA e PROVA a VESSEL Private Edit — "Hosted by [stylist]".
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-18-vessel-private-edit.sql'
const CONVITE = 'public.vessel_convite_da_private_edit(text)'
const RSVP = 'public.vessel_rsvp_da_private_edit(text, text, text, text, boolean, text, text, boolean)'
const CRIAR = 'public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean)'
const CONTA = 'public.vessel_conta_das_private_edits(integer)'

// ⚠️⚠️ ESTE APLICADOR ENVELHECEU EM DUAS FUNÇÕES DIFERENTES.
//
// (1) Este arquivo cria `vessel_criar_private_edit` SEM `is_vessel_atendimentos()`
//     por dentro e termina com `revoke all ... from public, anon, authenticated`
//     na função — a versão "no ar sem poder ser chamada" que
//     `2026-09-19-vessel-private-edit-pela-tela.sql` veio corrigir (portão por
//     dentro + grant para `authenticated`). Reaplicar este arquivo hoje
//     devolveria o portão para fora da função E revogaria de novo o acesso de
//     `authenticated` — ninguém mais conseguiria criar encontro pela Central,
//     sem erro nenhum na hora de aplicar.
//
// (2) Este arquivo cria `vessel_conta_das_private_edits(int)` — UM argumento.
//     `2026-09-19-vessel-arquivar.sql` fez `drop function` desta versão antes
//     de criar a de DOIS argumentos (`int, boolean`), exatamente para não
//     conviverem (ver R2 do plano: `create or replace` não troca assinatura).
//     Reaplicar este arquivo hoje RESSUSCITA a versão de um argumento AO LADO
//     da de dois — medido ao vivo, numa transação desfeita: qualquer chamada
//     que mande só `p_dias` (sem `p_incluir_arquivadas`) para de funcionar com
//     `function ... is not unique`, porque as duas assinaturas aceitam a
//     chamada.
//
// ⚠️ POR QUE A TRAVA É UMA CONSULTA, E NÃO UM `process.exit` cravado: num
// banco NOVO, onde nenhuma das duas migrations posteriores foi aplicada, não
// há nada para desfazer e este aplicador tem de rodar normalmente.
const DEPOIS_DESTE = [
  {
    migration: '2026-09-19-vessel-private-edit-pela-tela.sql',
    estrago:
      'devolveria `vessel_criar_private_edit` para a versão SEM\n' +
      '       `is_vessel_atendimentos()` por dentro e, ao revogar tudo de novo no\n' +
      '       fim da migration, ninguém — nem authenticated — conseguiria mais\n' +
      '       criar um encontro pela Central.',
  },
  {
    migration: '2026-09-19-vessel-arquivar.sql',
    estrago:
      'ressuscitaria `vessel_conta_das_private_edits(integer)` — a versão de UM\n' +
      '       argumento que aquela migration tinha derrubado de propósito — ao\n' +
      '       lado da versão de DOIS que está no ar hoje. Qualquer chamada que\n' +
      '       mande só `p_dias` passaria a falhar com "function ... is not\n' +
      '       unique", em vez de escolher uma das duas.',
  },
]

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()

// ⚠️ ANTES DE ABRIR TRANSAÇÃO E ANTES DE APLICAR QUALQUER COISA.
const { rows: posteriores } = await cli.query(
  `select name from public.schema_migrations where name = any($1::text[]) order by name`,
  [DEPOIS_DESTE.map((x) => x.migration)])
if (posteriores.length > 0) {
  console.error(
    `❌ nao aplicada: ${ARQUIVO} ja foi superada e reaplica-la desfaria trabalho posterior.\n\n` +
    `Este arquivo cria \`vessel_criar_private_edit\` e \`vessel_conta_das_private_edits(int)\`.\n` +
    `Migration(s) mais nova(s) JA APLICADA(S) mudaram essas funcoes, e rodar este aplicador\n` +
    `agora voltaria atras sem erro nenhum:\n\n` +
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
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-private-edit.mjs'])

  const { rows: [t] } = await cli.query(
    `select c.relrowsecurity as trava,
            (select count(*)::int from pg_policies p
              where p.schemaname='public' and p.tablename='vessel_private_edits') as politicas
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='vessel_private_edits'`)
  if (!t?.trava) throw new Error('vessel_private_edits: RLS desligada')
  if (t.politicas !== 1) throw new Error('vessel_private_edits: ' + t.politicas + ' politicas')

  const porta = async (f) => (await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])).rows[0]

  for (const [nome, f] of [['convite', CONVITE], ['rsvp', RSVP]]) {
    const p = await porta(f)
    if (!p.anon) throw new Error(`a convidada nao consegue abrir o ${nome}`)
    if (p.autenticado || p.qualquer_um) throw new Error(`a porta do ${nome} ficou aberta alem do necessario`)
  }
  const pc = await porta(CRIAR)
  if (pc.anon || pc.autenticado || pc.qualquer_um)
    throw new Error('vessel_criar_private_edit ficou aberta: qualquer um criaria encontro')
  const pk = await porta(CONTA)
  if (pk.anon || pk.qualquer_um) throw new Error('a conta das Private Edits ficou aberta para a pagina publica')
  if (!pk.autenticado) throw new Error('a Central nao consegue ler a conta')

  // ── as provas ───────────────────────────────────────────────────────────
  await cli.query('savepoint prova')
  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
  const fone = () => '5519' + String(900000000 + Math.floor(Math.random() * 9999999))

  await uma(`select public.vessel_pedido_do_stylist($1,$2,'Campinas',null,'stylist','sim',
                    '5-8','CPS',true,'v3',null,null,false) as r`, ['Raissa Herculano', fone()])
  const { codigo: sty } = await uma('select codigo from vessel_stylists order by id desc limit 1')

  const criado = (await uma(
    `select public.vessel_criar_private_edit($1, timestamptz '2026-10-15 19:00-03',
            'Loja do Iguatemi Campinas', 'CPS', 'iguatemi', 8, false) as r`, [sty])).r
  if (!criado.ok) throw new Error('nao criou o encontro: ' + JSON.stringify(criado))
  if (criado.codigo !== 'PE-20261015-CPS-01')
    throw new Error('o codigo do CRM saiu ' + criado.codigo)
  if (!/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/.test(criado.chave))
    throw new Error('a chave do link saiu fora do alfabeto: ' + criado.chave)

  // 1. ⚠️ O CODIGO DO CRM NAO ABRE O CONVITE. Se abrisse, a chave sorteada nao
  //    serviria para nada: bastaria adivinhar a data.
  const pelaAdivinhacao = (await uma(
    `select public.vessel_convite_da_private_edit('PE-20261015-CPS-01') as r`)).r
  if (pelaAdivinhacao.ok)
    throw new Error('o codigo adivinhavel abriu o convite — a chave nao protege nada')

  // 2. a chave abre, e mostra o que o convite diz.
  const convite = (await uma('select public.vessel_convite_da_private_edit($1) as r', [criado.chave])).r
  if (!convite.ok) throw new Error('a chave boa nao abriu: ' + JSON.stringify(convite))
  if (convite.anfitria !== 'Raissa Herculano') throw new Error('sem o "Hosted by": ' + JSON.stringify(convite))
  if (convite.data_por_extenso !== '15 de outubro')
    throw new Error('a data saiu "' + convite.data_por_extenso + '" — um dia de diferenca leva a convidada no dia errado')
  if (convite.horario !== '19h') throw new Error('o horario saiu ' + convite.horario)
  if (convite.local !== 'Loja do Iguatemi Campinas') throw new Error('sem o local')

  // 3. ⚠️ NENHUMA CONVIDADA VAZA. "Sem lista publica de convidadas" (modulo 03).
  const texto = JSON.stringify(convite)
  for (const proibido of ['convidada', 'telefone', 'whatsapp', 'pessoa', 'PE-', 'responderam'])
    if (texto.includes(proibido))
      throw new Error(`o convite devolveu "${proibido}" para o navegador: ` + texto)

  // 4. o RSVP: entra como SOLICITADO, nunca confirmado.
  const f1 = fone()
  const r1 = (await uma(
    `select public.vessel_rsvp_da_private_edit($1,'Ana Lima',$2,'sim',true,'v3',null,false) as r`,
    [criado.chave, f1])).r
  if (!r1.ok) throw new Error('o RSVP bom foi recusado: ' + JSON.stringify(r1))
  const a1 = await uma(
    `select t.status, t.rsvp, t.evento_codigo, t.quando, t.loja, t.origem_registro
       from vessel_atendimentos t join vessel_pessoas p on p.id = t.pessoa_id
      where p.telefone = $1`, [f1])
  if (a1.status !== 'solicitado')
    throw new Error('a convidada entrou como ' + a1.status + ' — vaga nao foi bloqueada por ninguem')
  if (a1.rsvp !== 'sim' || a1.evento_codigo !== criado.codigo)
    throw new Error('a resposta nao ficou ligada ao encontro: ' + JSON.stringify(a1))
  if (!a1.quando) throw new Error('o atendimento ficou SEM hora: o encontro nao ocupa a agenda da loja')

  // 5. ⚠️ UMA CONVIDADA, UMA CADEIRA. Responder de novo corrige, nao duplica.
  await uma(`select public.vessel_rsvp_da_private_edit($1,'Ana Lima',$2,'falar-com-equipe',
                    false,'v3',null,false) as r`, [criado.chave, f1])
  const { rows: cadeiras } = await cli.query(
    `select t.rsvp from vessel_atendimentos t join vessel_pessoas p on p.id = t.pessoa_id
      where p.telefone = $1`, [f1])
  if (cadeiras.length !== 1)
    throw new Error('a mesma convidada virou ' + cadeiras.length + ' cadeiras no mesmo encontro')
  if (cadeiras[0].rsvp !== 'falar-com-equipe') throw new Error('a segunda resposta nao corrigiu a primeira')

  // 6. a origem: canal e anfitria cravados no servidor.
  const o1 = await uma(
    `select o.canal, o.evento_id, o.stylist_id, o.utm_campaign from vessel_origens o
       join vessel_pessoas p on p.id = o.pessoa_id where p.telefone = $1 order by o.id limit 1`, [f1])
  if (o1.canal !== 'private_edit' || o1.evento_id !== criado.codigo || o1.stylist_id !== sty)
    throw new Error('a origem nao aponta para o encontro e a anfitria: ' + JSON.stringify(o1))
  if (o1.utm_campaign !== 'pe_20261015_cps_01')
    throw new Error('a UTM nao foi derivada do codigo: ' + o1.utm_campaign)

  // 7. chave inventada NAO grava nada.
  const antes = (await uma('select count(*)::int as n from vessel_atendimentos')).n
  const rInv = (await uma(
    `select public.vessel_rsvp_da_private_edit('AAAAAAAA','Fulana',$1,'sim',false,'v3',null,false) as r`,
    [fone()])).r
  if (rInv.ok) throw new Error('chave inventada foi aceita: ' + JSON.stringify(rInv))
  const depois = (await uma('select count(*)::int as n from vessel_atendimentos')).n
  if (depois !== antes) throw new Error('a chave inventada gravou alguma coisa')

  // 8. a armadilha responde igual a um envio bom, e nao grava.
  const rBot = (await uma(
    `select public.vessel_rsvp_da_private_edit($1,'Robo',$2,'sim',false,'v3','isca',false) as r`,
    [criado.chave, fone()])).r
  if (!rBot.ok) throw new Error('a armadilha denunciou que pegou o robo')
  if ((await uma('select count(*)::int as n from vessel_atendimentos')).n !== antes)
    throw new Error('o robo gravou uma cadeira')

  // 9. a conta por encontro — e a permissao conferida DENTRO da funcao.
  let barrou = false
  try {
    await cli.query('savepoint sem_permissao')
    await cli.query('select public.vessel_conta_das_private_edits(14)')
  } catch (e) {
    barrou = e.code === '42501'
    await cli.query('rollback to savepoint sem_permissao')
  }
  if (!barrou) throw new Error('quem nao tem a permissao leu a agenda de encontros da marca')

  await cli.query(`create or replace function public.is_vessel_atendimentos()
    returns boolean language sql stable as $f$ select true $f$`)
  const conta = (await uma('select public.vessel_conta_das_private_edits(14) as r')).r
  const linha = conta.find((l) => l.codigo === criado.codigo)
  if (!linha) throw new Error('o encontro nao apareceu na conta')
  if (linha.anfitria !== 'Raissa Herculano' || linha.stylist !== sty)
    throw new Error('a conta perdeu a anfitria')
  if (linha.responderam !== 1) throw new Error('responderam: ' + linha.responderam)
  if (linha.disseram_sim !== 0) throw new Error('a correcao para "falar com a equipe" nao contou')
  if (linha.confirmadas !== 0 || linha.compareceram !== 0)
    throw new Error('RSVP virou presenca: ' + JSON.stringify(linha))
  if (linha.janela_de_venda_em_dias !== 14) throw new Error('a regua da venda nao viaja na resposta')

  await cli.query('rollback to savepoint prova')
  const sobrou = (await uma(
    `select count(*)::int as n from vessel_private_edits`)).n
  if (sobrou !== 0) throw new Error('a prova deixou encontro no banco')

  await cli.query('commit')
  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback')
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally {
  await cli.end()
}
