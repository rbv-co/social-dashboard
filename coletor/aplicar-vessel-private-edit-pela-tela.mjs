// APLICA, REGISTRA e PROVA a tela da Private Edit.
// ⚠️ As provas escrevem dado de verdade e sao desfeitas antes do commit.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-19-vessel-private-edit-pela-tela.sql'
const CRIAR = 'public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean)'
const ENCERRAR = 'public.vessel_private_edit_encerrar(text, boolean)'
const LISTA = 'public.vessel_stylists_para_escolher()'

// ⚠️⚠️ ESTE APLICADOR ENVELHECEU: RODAR DE NOVO DESFAZ COISA QUE VEIO DEPOIS.
//
// A migration deste arquivo faz `create or replace` em
// `vessel_private_edit_encerrar`, `vessel_stylists_para_escolher` e
// `vessel_criar_private_edit`. AS TRES foram mudadas por migrations
// POSTERIORES. Reaplicar a versao daqui devolve a versao VELHA das tres —
// sem erro nenhum, com a linha de sucesso impressa igual no fim. Medido com
// `pg_get_functiondef` antes e depois, numa transacao desfeita: sao
// exatamente estas tres voltas atras.
//
// ⚠️ A ORDEM DOS NOMES DE ARQUIVO MENTE AQUI. `...encerrar-exige-editar.sql`
// vem ANTES deste alfabeticamente e DEPOIS dele no relogio (23:09 contra
// 00:09, em `schema_migrations.applied_at`). Quem conferir so pelo nome conclui
// que este aqui e o mais novo — e e justamente o contrario.
//
// ⚠️ POR QUE A TRAVA E UMA CONSULTA, E NAO UM `process.exit` cravado: num banco
// NOVO, onde nenhuma das migrations posteriores foi aplicada, nao ha nada
// para desfazer e este aplicador tem de rodar normalmente. Uma recusa cravada
// seria indistinguivel de um script quebrado e travaria o replay legitimo.
const DEPOIS_DESTE = [
  {
    migration: '2026-09-19-vessel-encerrar-exige-editar.sql',
    estrago:
      'devolveria `vessel_private_edit_encerrar` para o portao de VER\n' +
      '       (`is_vessel_atendimentos()`) no lugar do portao de MEXER\n' +
      '       (`is_vessel_atendimentos_editar()`) — ou seja, quem so tem\n' +
      '       permissao de OLHAR o Comercial Vessel voltaria a poder encerrar\n' +
      '       um encontro.',
  },
  {
    migration: '2026-09-19-vessel-stylist-mexer.sql',
    estrago:
      'devolveria `vessel_stylists_para_escolher` para a versao SEM o filtro\n' +
      '       `and coalesce(s.ativa, true)` — as stylists DESATIVADAS voltariam,\n' +
      '       caladas, para a lista de escolher da tela.',
  },
  {
    migration: '2026-09-21-vessel-criar-exige-editar.sql',
    estrago:
      'devolveria `vessel_criar_private_edit` para o portao de VER\n' +
      '       (`is_vessel_atendimentos()`) no lugar do portao de MEXER\n' +
      '       (`is_vessel_atendimentos_editar()`) — ou seja, quem so tem\n' +
      '       permissao de OLHAR o Comercial Vessel voltaria a poder criar um\n' +
      '       encontro novo (B10 de docs/pendencias.md).',
  },
]

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
    `Esta migration faz \`create or replace\` em \`vessel_private_edit_encerrar\`,\n` +
    `\`vessel_stylists_para_escolher\` e \`vessel_criar_private_edit\`. Migration(s) mais nova(s)\n` +
    `JA APLICADA(S) mudaram essas funcoes, e rodar este aplicador agora voltaria atras sem\n` +
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
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-private-edit-pela-tela.mjs'])

  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
  const porta = async (f) => (await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])).rows[0]

  for (const [nome, f] of [['criar', CRIAR], ['encerrar', ENCERRAR], ['lista', LISTA]]) {
    const p = await porta(f)
    if (!p.autenticado) throw new Error(`a Central nao consegue usar ${nome}`)
    if (p.anon || p.qualquer_um) throw new Error(`${nome}: porta aberta para a pagina publica`)
  }

  await cli.query('savepoint prova')
  const fone = () => '5519' + String(900000000 + Math.floor(Math.random() * 9999999))

  // ⚠️ SEM A PERMISSAO, NADA. auth.uid() e nulo aqui => is_vessel_atendimentos() false.
  const semPerm = await uma(
    `select public.vessel_criar_private_edit('STY-0001', now() + interval '10 days',
            'Loja', 'CPS', 'iguatemi', 8, false) as r`)
  if (semPerm.r.ok) throw new Error('quem nao tem a permissao criou um encontro')
  if (semPerm.r.situacao !== 'sem_permissao') throw new Error('recusou por outro motivo: ' + JSON.stringify(semPerm.r))

  let barrou = false
  try {
    await cli.query('savepoint sp2')
    await cli.query('select public.vessel_stylists_para_escolher()')
  } catch (e) { barrou = e.code === '42501'; await cli.query('rollback to savepoint sp2') }
  if (!barrou) throw new Error('a lista de stylists vazou para quem nao tem permissao')

  // Daqui em diante, fingindo a permissao — o que a Central tera.
  await cli.query(`create or replace function public.is_vessel_atendimentos()
    returns boolean language sql stable as $f$ select true $f$`)

  // uma stylist de verdade, pela porta publica do Circle
  await uma(`select public.vessel_pedido_do_stylist($1,$2,$3,null,'stylist','sim','5-8','CPS',
                    true,'v3',null,null,false) as r`, ['Anfitria da Prova', fone(), 'Campinas'])
  const { codigo: sty } = await uma(`select codigo from vessel_stylists order by id desc limit 1`)

  // 1. stylist que nao existe
  const semSty = await uma(
    `select public.vessel_criar_private_edit('STY-9999', now() + interval '10 days',
            'Loja','CPS','iguatemi',8,false) as r`)
  if (semSty.r.ok) throw new Error('criou encontro para stylist inexistente')

  // 2. ⚠️ DATA NO PASSADO nao cria: o convite nasceria vencido
  const passado = await uma(
    `select public.vessel_criar_private_edit($1, now() - interval '10 days',
            'Loja','CPS','iguatemi',8,false) as r`, [sty])
  if (passado.r.ok) throw new Error('criou encontro com data no passado')
  if (passado.r.situacao !== 'data_no_passado') throw new Error('motivo errado: ' + JSON.stringify(passado.r))

  // 3. ⚠️ VAGAS e o DENOMINADOR da taxa de comparecimento — zero quebraria a conta
  for (const v of [0, -3, 999]) {
    const r = await uma(
      `select public.vessel_criar_private_edit($1, now() + interval '10 days',
              'Loja','CPS','iguatemi',$2,false) as r`, [sty, v])
    if (r.r.ok) throw new Error('passou vagas invalidas: ' + v)
  }

  // 4. praca torta
  const praca = await uma(
    `select public.vessel_criar_private_edit($1, now() + interval '10 days',
            'Loja','XXX','iguatemi',8,false) as r`, [sty])
  if (praca.r.ok) throw new Error('passou praca invalida')

  // 5. o caminho feliz, e a chave do convite
  const bom = await uma(
    `select public.vessel_criar_private_edit($1, now() + interval '10 days',
            'Loja Iguatemi','CPS','iguatemi',8,false) as r`, [sty])
  if (!bom.r.ok) throw new Error('nao criou o encontro bom: ' + JSON.stringify(bom.r))
  if (!/^PE-\d{8}-CPS-\d{2}$/.test(bom.r.codigo)) throw new Error('codigo torto: ' + bom.r.codigo)
  if (!/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/.test(bom.r.chave))
    throw new Error('chave torta: ' + bom.r.chave)

  // 6. a lista de stylists so devolve o necessario para preencher o campo
  const lista = (await uma(`select public.vessel_stylists_para_escolher() as r`)).r
  if (!Array.isArray(lista) || !lista.length) throw new Error('a lista de stylists veio vazia')
  // ⚠️ GANHOU `whatsapp` NA T11 (2026-09-22-vessel-t11-bases-do-stylist-circle.sql):
  // o cartão da convidada usa para "Mandar para a stylist". A trava de "só
  // estas chaves" continua — só a lista esperada cresceu de propósito.
  const chaves = Object.keys(lista[0]).sort().join(',')
  if (chaves !== 'cidade,codigo,nome,whatsapp')
    throw new Error('a lista de stylists devolve alem do necessario: ' + chaves)

  // 7. encerrar e reabrir
  const fechou = await uma(`select public.vessel_private_edit_encerrar($1,false) as r`, [bom.r.codigo])
  if (!fechou.r.ok) throw new Error('nao encerrou')
  const { ativa } = await uma(`select ativa from vessel_private_edits where codigo=$1`, [bom.r.codigo])
  if (ativa !== false) throw new Error('encerrar nao gravou')
  await uma(`select public.vessel_private_edit_encerrar($1,true) as r`, [bom.r.codigo])
  const dePovolta = await uma(`select ativa from vessel_private_edits where codigo=$1`, [bom.r.codigo])
  if (dePovolta.ativa !== true) throw new Error('reabrir nao gravou')

  // 8. a conta do encontro aparece, com a regua da venda dentro
  const painel = (await uma(`select public.vessel_conta_das_private_edits(7) as r`)).r
  const linha = painel.find((l) => l.codigo === bom.r.codigo)
  if (!linha) throw new Error('o encontro nao apareceu na conta')
  if (linha.vagas !== 8) throw new Error('vagas errado: ' + linha.vagas)
  if (linha.janela_de_venda_em_dias !== 7) throw new Error('a regua da venda nao viaja na resposta')

  await cli.query('rollback to savepoint prova')
  await cli.query('commit')
  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback')
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
