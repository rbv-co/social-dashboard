// APLICA, REGISTRA e PROVA a porta da LP Personal Atelier (T04).
//
// ⚠️⚠️ ESTE APLICADOR ENVELHECEU: RODAR DE NOVO DESFAZ COISA QUE VEIO DEPOIS
// (B11 de docs/pendencias.md).
//
// Este arquivo aceita a COLEÇÃO INTEIRA como modelo do Personal Atelier — "a
// equipe confirma o modelo elegível" resolvia na conversa. O dono decidiu, em
// 17/09, restringir a TRÊS modelos (Nerea, Cyrène e Astrea):
// `2026-09-18-vessel-atelier-so-tres-modelos.sql` trocou só a lista aceita,
// mesma assinatura, resto do corpo intocado. Reaplicar este arquivo hoje
// devolve a lista aberta, calado: a página voltaria a aceitar um pedido de
// personalização para um modelo que a Vessel não personaliza, e a cliente só
// descobre isso numa conversa depois, não na hora do formulário.
//
// ⚠️ POR QUE A TRAVA É UMA CONSULTA, E NÃO UM `process.exit` cravado: num
// banco NOVO, onde a migration posterior não foi aplicada, não há nada para
// desfazer e este aplicador tem de rodar normalmente.
const DEPOIS_DESTE = [
  {
    migration: '2026-09-18-vessel-atelier-so-tres-modelos.sql',
    estrago:
      'devolveria `vessel_pedido_de_personal_atelier` para a lista de\n' +
      '       modelos ABERTA — a página voltaria a aceitar um pedido de\n' +
      '       personalização para um modelo que a Vessel não personaliza\n' +
      '       (fora Nerea, Cyrène e Astrea), e ninguém descobre isso na hora\n' +
      '       do formulário, só numa conversa depois.',
  },
]

import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-18-vessel-personal-atelier.sql'
const A = 'public.vessel_pedido_de_personal_atelier(text, text, text, text, text, text, text, text, boolean, text, jsonb, text, boolean)'
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
    `Este arquivo cria \`vessel_pedido_de_personal_atelier\`. Migration(s) mais nova(s) JA\n` +
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
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-personal-atelier.mjs'])

  const { rows: [porta] } = await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [A])
  if (!porta.anon) throw new Error('a pagina publica nao consegue chamar')
  if (porta.autenticado || porta.qualquer_um) throw new Error('a porta ficou aberta alem do necessario')

  await cli.query('savepoint prova')
  const fone = () => '5519' + String(900000000 + Math.floor(Math.random() * 9999999))
  const pedir = async (a) => (await cli.query(
    `select public.vessel_pedido_de_personal_atelier($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,true) as r`,
    a)).rows[0].r

  const ok = await pedir(['Beatriz Almeida', fone(), 'iguatemi', 'cyrene', 'canvas', 'onix',
    'tarde', 'Gosto de alca mais curta.', false, 'v3', null, null])
  if (!ok.ok || ok.situacao !== 'solicitado') throw new Error('o caminho bom foi recusado: ' + JSON.stringify(ok))

  const { rows: [a] } = await cli.query(
    `select status, quando, origem_registro, momento_de_uso, interesse,
            modelo_de_interesse, atelier_tecido, atelier_ferragem, periodo_preferido, recado
       from vessel_atendimentos order by id desc limit 1`)
  if (a.status !== 'solicitado') throw new Error('entrou como ' + a.status)
  if (a.quando !== null) throw new Error('um pedido de atelier nao marca horario')
  if (a.origem_registro !== 'lp-personal-atelier') throw new Error('o canal ficou errado')
  if (a.modelo_de_interesse !== 'cyrene' || a.atelier_tecido !== 'canvas' || a.atelier_ferragem !== 'onix')
    throw new Error('a configuracao nao foi gravada: ' + JSON.stringify(a))
  if (a.momento_de_uso !== 'personalizacao' || a.interesse !== 'personal-atelier')
    throw new Error('o pedido nao ficou marcado como personalizacao')
  if (a.recado !== 'Gosto de alca mais curta.') throw new Error('a observacao se perdeu')

  // As permissoes vieram do miolo, separadas por finalidade.
  const { rows: [perm] } = await cli.query(
    `select count(*) filter (where finalidade='atendimento')::int as at,
            count(*) filter (where finalidade='marketing')::int as m
       from vessel_consentimentos c join vessel_pessoas p on p.id=c.pessoa_id
      where p.nome='Beatriz Almeida'`)
  if (perm.at !== 1 || perm.m !== 0) throw new Error('as permissoes sairam erradas: ' + JSON.stringify(perm))

  // ⚠️ Tecido e ferragem sao OPCIONAIS: ela ainda nao viu os materiais.
  const semEscolha = await pedir(['Marina Sampaio', fone(), 'iguatemi', null, null, null,
    null, null, false, 'v3', null, null])
  if (!semEscolha.ok) throw new Error('quem nao escolheu acabamento foi recusada')

  for (const [caso, args] of [
    ['tecido inventado', ['x y', fone(), 'iguatemi', null, 'veludo', null, null, null, false, 'v3', null, null]],
    ['ferragem inventada', ['x y', fone(), 'iguatemi', null, null, 'prata', null, null, false, 'v3', null, null]],
    ['modelo inventado', ['x y', fone(), 'iguatemi', 'mochila', null, null, null, null, false, 'v3', null, null]],
    ['loja inventada', ['x y', fone(), 'shopping-da-lua', null, null, null, null, null, false, 'v3', null, null]],
    ['sem nome', ['   ', fone(), 'iguatemi', null, null, null, null, null, false, 'v3', null, null]],
    ['observacao enorme', ['x y', fone(), 'iguatemi', null, null, null, null, 'a'.repeat(301), false, 'v3', null, null]],
  ]) {
    const r = await pedir(args)
    if (r.ok !== false) throw new Error(`"${caso}" respondeu sucesso: ` + JSON.stringify(r))
  }

  const robo = await pedir(['Robo', fone(), 'iguatemi', null, null, null, null, null, false, 'v3', null, 'caiu'])
  if (robo.ok !== true) throw new Error('a armadilha deixou de ser muda')

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query(`select count(*)::int as n from vessel_pessoas`)
  if (sobrou.n !== 0) throw new Error('a prova deixou sujeira')

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  porta: anon SIM; authenticated e public NAO')
  console.log('  entra SOLICITADO e SEM horario — a pagina comeca conversa, nao fecha encomenda')
  console.log('  modelo, tecido e ferragem gravados; a observacao tambem')
  console.log('  o pedido fica marcado como personalizacao, pelo miolo compartilhado')
  console.log('  as permissoes saem separadas por finalidade')
  console.log('  tecido e ferragem sao OPCIONAIS; inventados sao recusados')
  console.log('  seis entradas invalidas viram erro tratado; a armadilha continua muda')
  console.log('  prova desfeita                              ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
