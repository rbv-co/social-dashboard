// APLICA, REGISTRA e PROVA o `arquivada` do Comercial Vessel.
// ⚠️ As provas escrevem dado de verdade e sao desfeitas antes do commit.
//
// ⚠️ ESTA MIGRATION MEXE EM FUNCAO QUE TELA NO AR CHAMA AGORA. Por isso TUDO
// mora numa transacao so: derrubar as antigas, criar as novas, registrar,
// provar e so entao `commit`. DDL no Postgres e transacional — nao existe um
// instante em que a tela de alguem encontre a funcao faltando.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { conferirQueOPortaoVoltou } from './lib/o-portao-dos-atendimentos.mjs'

const ARQUIVO = '2026-09-19-vessel-arquivar.sql'
const PE = 'PE-20260919-CPS-Z9'
const BS = 'BS-20260919-CPS-Z9'

// ⚠️⚠️ ESTE APLICADOR ENVELHECEU: RODAR DE NOVO APAGA CAMPO QUE VEIO DEPOIS.
//
// A migration deste arquivo faz `create or replace` em
// `vessel_conta_das_private_edits(int, boolean)`. Uma migration POSTERIOR
// acrescentou `ativa`, `arquivada`, `praca` e `loja` ao `json_build_object`
// dela (mesma assinatura, sem `drop`). Reaplicar a versão daqui devolve a
// função para o SELECT de antes — sem esses quatro campos, sem erro nenhum,
// com a linha de sucesso impressa igual no fim. Medido com
// `pg_get_functiondef` antes e depois, numa transação desfeita: é exatamente
// esta volta atrás.
//
// Na prática, para quem usa a tela do Private Edit: "Só arquivadas" e
// "Só encerradas" voltam a ficar sempre vazios (o filtro de tela não teria
// mais `arquivada`/`ativa` para ler), o filtro de Loja para de achar
// qualquer coisa além de "Todas", e o formulário de editar perde a praça e a
// loja atuais para pré-preencher — tudo isso calado, sem nenhum erro na tela.
//
// ⚠️ POR QUE A TRAVA É UMA CONSULTA, E NÃO UM `process.exit` cravado: num
// banco NOVO, onde a migration posterior não foi aplicada, não há nada para
// desfazer e este aplicador tem de rodar normalmente. Uma recusa cravada
// seria indistinguível de um script quebrado e travaria o replay legítimo.
const DEPOIS_DESTE = [
  {
    migration: '2026-09-19-vessel-private-edit-lista-devolve-ativa-e-arquivada.sql',
    estrago:
      'devolveria `vessel_conta_das_private_edits` para o SELECT sem `ativa`,\n' +
      '       `arquivada`, `praca` e `loja` — o filtro "Situação" (Só arquivadas /\n' +
      '       Só encerradas) e o filtro de Loja da tela do Private Edit voltariam a\n' +
      '       ficar sempre vazios, e o formulário de editar perderia a praça/loja\n' +
      '       atuais para pré-preencher, tudo sem erro nenhum na tela.',
  },
  {
    // ⚠️ T11 (a tela de Beauty Sessions ganhar tudo): a mesma volta atrás,
    // pelo mesmo motivo, na irmã. Reaplicar este arquivo faria
    // `create or replace` em `vessel_conta_das_beauty_sessions(int, boolean)`
    // devolvendo-a para o SELECT SEM `arquivada` — a migration posterior só
    // acrescentou esse UM campo (`ativa` já vinha desde 18/09).
    migration: '2026-09-19-vessel-beauty-sessions-lista-devolve-arquivada.sql',
    estrago:
      'devolveria `vessel_conta_das_beauty_sessions` para o SELECT sem\n' +
      '       `arquivada` por linha (`ativa` continuaria, essa é anterior a esta\n' +
      '       migration) — o filtro "Situação" (Só arquivadas) da tela de Beauty\n' +
      '       Sessions voltaria a ficar sempre vazio, e o botão "Desarquivar" não\n' +
      '       teria como saber quando aparecer no lugar de "Arquivar…", tudo sem\n' +
      '       erro nenhum na tela.',
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
    `❌ nao aplicada: ${ARQUIVO} ja foi superada e reaplica-la apagaria campo posterior.\n\n` +
    `Esta migration faz \`create or replace\` em \`vessel_conta_das_private_edits\`.\n` +
    `Migration(s) mais nova(s) JA APLICADA(S) mudaram essa funcao, e rodar este aplicador\n` +
    `agora voltaria atras sem erro nenhum:\n\n` +
    posteriores.map(({ name }) =>
      `  · ${name}\n       ${DEPOIS_DESTE.find((x) => x.migration === name).estrago}`).join('\n\n') +
    `\n\nVa ler essa migration em db/migrations/ antes de qualquer coisa. Se voce PRECISA mesmo\n` +
    `reaplicar este arquivo, a saida NAO e apagar esta trava: e reaplicar a migration\n` +
    `posterior logo depois, pelo aplicador dela.\n`)
  await cli.end()
  process.exit(1)
}

await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-arquivar.mjs'])

  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

  // ── 1. SOBROU UMA SO DE CADA, E COM DOIS ARGUMENTOS ──────────────────────
  // ⚠️ ESTA E A PROVA QUE PROTEGE A TELA NO AR. `create or replace` nao troca
  // uma funcao por outra de assinatura diferente: cria uma SEGUNDA,
  // sobrecarregada. Com duas no banco, a chamada da tela (um argumento so)
  // morreria com "function is not unique". Se o `drop` da migration falhar ou
  // for removido, e aqui que isso aparece — antes do commit.
  for (const nome of ['vessel_conta_das_private_edits', 'vessel_conta_das_beauty_sessions']) {
    const { quantas, assinaturas } = await uma(
      `select count(*)::int as quantas,
              string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as assinaturas
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    if (quantas !== 1) throw new Error(`${nome} ficou com ${quantas} versoes: ${assinaturas}`)
    // ⚠️ `regprocedure` escreve os tipos SEM espaco: `(integer,boolean)`.
    if (!/\(integer,boolean\)$/.test(assinaturas))
      throw new Error(`${nome} nao ficou com (integer,boolean): ${assinaturas}`)
  }

  // ── 2. A PORTA E EXATAMENTE A DE ANTES: so `authenticated` ───────────────
  // ⚠️ O `drop` DESTROI os grants. Sem o par revoke/grant repetido na
  // migration, a funcao renasceria aberta para `public` — e portanto para a
  // pagina publica, via `anon`.
  for (const f of ['public.vessel_conta_das_private_edits(int, boolean)',
                   'public.vessel_conta_das_beauty_sessions(int, boolean)']) {
    const p = await uma(
      `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
              has_function_privilege('anon',$1,'EXECUTE') as anon,
              has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])
    if (!p.autenticado) throw new Error(`a Central perdeu o acesso a ${f}`)
    if (p.anon || p.qualquer_um) throw new Error(`porta aberta para a pagina publica em ${f}`)
  }

  // ── 3. A PROVA DE VERDADE, com dado de mentira e rollback ────────────────
  await cli.query('savepoint prova')

  // ⚠️ A PERMISSAO E CONFERIDA DENTRO DAS DUAS FUNCOES, e `auth.uid()` e nulo
  // numa conexao `pg` pura: sem sessao, as duas levantam 42501 e nao da para
  // provar conta nenhuma. Primeiro provamos que a tranca esta la; depois
  // trocamos `is_vessel_atendimentos()` por `select true` — DENTRO do
  // savepoint, exatamente como as migrations anteriores destas mesmas funcoes
  // ja faziam. O `rollback to savepoint prova` no fim devolve a funcao
  // original; um erro no meio cai no `rollback` do catch, que faz o mesmo.
  for (const chamada of ['public.vessel_conta_das_private_edits(30)',
                         'public.vessel_conta_das_beauty_sessions(30)']) {
    let barrou = false
    try {
      await cli.query('savepoint sem_permissao')
      await cli.query(`select ${chamada}`)
    } catch (e) {
      // ⚠️ SO 42501 SERVE. Um 42883 ("function does not exist") ou um 42725
      // ("function is not unique") tambem cairiam aqui e passariam por
      // "barrou" se a comparacao fosse solta — e seriam justamente o defeito
      // que quebra a tela no ar.
      barrou = e.code === '42501'
      await cli.query('rollback to savepoint sem_permissao')
    }
    if (!barrou) throw new Error(`a tranca de permissao nao respondeu em ${chamada}`)
  }

  await cli.query(`create or replace function public.is_vessel_atendimentos()
    returns boolean language sql stable as $f$ select true $f$`)

  // ── 3a. o encontro (Private Edit) ────────────────────────────────────────
  const { id: sty } = await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp)
     values ('STY-9999','Prova','5519999999999') returning id`)
  await uma(
    `insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, loja, vagas)
     values ($1,'ZZZZZZZZ',$2, now() + interval '3 days','CPS','iguatemi',8)`, [PE, sty])

  const conta = async (incluir = null) => (await uma(
    incluir === null
      ? `select public.vessel_conta_das_private_edits(30) as r`
      : `select public.vessel_conta_das_private_edits(30, $1) as r`,
    incluir === null ? [] : [incluir])).r
  const achar = (lista) => (lista || []).find((l) => l.codigo === PE)

  if (!achar(await conta())) throw new Error('o encontro novo nao apareceu na conta')

  // ⚠️ ARQUIVADA SAI DAS CONTAS. Se continuasse contando, arquivar uma
  // duplicata deixaria a receita somada DUAS VEZES — que e o que arquivar
  // existe para resolver.
  await uma(`update public.vessel_private_edits set arquivada = true where codigo = $1`, [PE])
  if (achar(await conta())) throw new Error('a arquivada continuou contando')

  // ⚠️ MAS PRECISA DAR PARA ACHAR DE NOVO: uma linha que nunca mais aparece
  // nunca mais pode ser DESARQUIVADA, e o botao de desarquivar viraria codigo
  // morto. Por isso o segundo parametro existe — e por isso ele nasce `false`.
  if (!achar(await conta(true))) throw new Error('nem pedindo explicitamente a arquivada apareceu')
  if (achar(await conta(false))) throw new Error('pedir false trouxe a arquivada de volta')

  // ⚠️ ENCERRADA NAO E ARQUIVADA: encerrada CONTINUA contando.
  await uma(
    `update public.vessel_private_edits set arquivada = false, ativa = false where codigo = $1`, [PE])
  if (!achar(await conta())) throw new Error('encerrar sumiu com o encontro do historico')

  // O padrao: ninguem nasce arquivado.
  const { arquivada } = await uma(
    `select arquivada from public.vessel_private_edits where codigo = $1`, [PE])
  if (arquivada !== false) throw new Error('o padrao da coluna nao e false')

  // ── 3b. a sessao (Beauty Session) ────────────────────────────────────────
  // ⚠️ `vessel_beauty_sessions` NAO TEM coluna `teste` e a consulta de fora da
  // funcao nao tinha `where` nenhum — o filtro de arquivada nasceu la, no
  // mesmo lugar onde o de `vessel_private_edits` mora. E por isso esta metade
  // da prova existe separada: nao da para concluir uma da outra.
  await uma(
    `insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro)
     values ($1, current_date + 3, 'CPS', 'iguatemi', null)`, [BS])

  const contaBS = async (incluir = null) => (await uma(
    incluir === null
      ? `select public.vessel_conta_das_beauty_sessions(30) as r`
      : `select public.vessel_conta_das_beauty_sessions(30, $1) as r`,
    incluir === null ? [] : [incluir])).r
  const acharBS = (lista) => (lista || []).find((l) => l.codigo === BS)

  if (!acharBS(await contaBS())) throw new Error('a sessao nova nao apareceu na conta')
  await uma(`update public.vessel_beauty_sessions set arquivada = true where codigo = $1`, [BS])
  if (acharBS(await contaBS())) throw new Error('a sessao arquivada continuou contando')
  if (!acharBS(await contaBS(true))) throw new Error('nem pedindo explicitamente a sessao arquivada apareceu')
  await uma(
    `update public.vessel_beauty_sessions set arquivada = false, ativa = false where codigo = $1`, [BS])
  if (!acharBS(await contaBS())) throw new Error('encerrar sumiu com a sessao do historico')
  const bs = await uma(`select arquivada from public.vessel_beauty_sessions where codigo = $1`, [BS])
  if (bs.arquivada !== false) throw new Error('o padrao da coluna de sessoes nao e false')

  // ── 3c. COMO A TELA NO AR CHAMA: um parametro so, e pelo NOME ────────────
  // ⚠️ E assim que o PostgREST manda `{ "p_dias": 7 }`. Se a antiga tivesse
  // sobrado ao lado da nova, esta linha morreria com "function is not unique".
  const comoATela = (await uma(`select public.vessel_conta_das_private_edits(p_dias => 7) as r`)).r
  if (!Array.isArray(comoATela)) throw new Error('a chamada da tela nao devolveu lista')
  if (achar(comoATela) === undefined) throw new Error('a chamada da tela perdeu o encontro')
  const comoATelaBS = (await uma(`select public.vessel_conta_das_beauty_sessions(p_dias => 7) as r`)).r
  if (!Array.isArray(comoATelaBS)) throw new Error('a chamada da tela de sessoes nao devolveu lista')

  // ⚠️ E O `p_dias` CONTINUA SENDO SO A JANELA DE VENDA: ele nunca filtrou
  // quais linhas aparecem, e nao passa a filtrar agora.
  if (comoATela[0].janela_de_venda_em_dias !== 7)
    throw new Error('a regua da venda parou de viajar na resposta')

  await cli.query('rollback to savepoint prova')

  // ── 4. O PORTAO VOLTOU? ─────────────────────────────────────────────────
  // ⚠️ A LINHA MAIS PERIGOSA DESTE SCRIPT E A DE CIMA. O `select true` que
  // substituiu `is_vessel_atendimentos()` la em cima nao e desfeito por nada
  // automatico: e desfeito pela ORDEM DE DUAS LINHAS — aquele
  // `rollback to savepoint prova` tendo de vir antes do `commit`. Ordem de
  // linha nao e garantia: basta alguem mover, editar ou engolir aquela linha
  // num refactor para o `commit` PUBLICAR o portao aberto.
  //
  // ⚠️ E o portao nao guarda so estas contas: ele e o `using` das politicas de
  // RLS de SEIS tabelas — vessel_pessoas, vessel_atendimentos,
  // vessel_convite_aberturas, vessel_client_advisors, vessel_pedidos e
  // vessel_pedido_itens. Um `select true` no lugar dele abriria as seis de uma
  // vez, para qualquer pessoa logada, sem erro nenhum para denunciar. O stub
  // ainda larga pelo caminho o `security definer` e o `search_path`.
  //
  // Por isso a conferencia e AQUI: depois do rollback, ANTES do commit e antes
  // de qualquer linha de sucesso. Dizer no relatorio que se conferiu depois
  // nao vale — depois do commit o estrago ja esta publicado.
  await conferirQueOPortaoVoltou(cli)

  await cli.query('commit')
  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback')
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
