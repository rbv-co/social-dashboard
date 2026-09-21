// APLICA, REGISTRA e PROVA o MEXER na parceira do Stylist Circle: cadastrar,
// corrigir e desativar.
//
// ⚠️ TUDO NUMA TRANSACAO SO: aplicar, registrar, provar e so entao `commit`.
// DDL no Postgres e transacional — nao existe um instante em que a tela de
// alguem encontre uma funcao pela metade.
//
// ⚠️ ESTA PROVA NAO TROCA NENHUM PORTAO POR `select true`. O caminho e o da
// irma da Beauty Session: FABRICAR SESSAO DE VERDADE com
// `set_config('request.jwt.claims', ...)`, que e de onde `auth.uid()` le quem
// e. Assim as tres funcoes novas rodam com a TRAVA LIGADA, do jeito que a
// Central vai chamar — e nao ha um instante sequer em que
// `is_vessel_atendimentos()` (o `using` do RLS de SEIS tabelas) esteja aberto.
//
// ⚠️ `vessel_stylists` ESTA VAZIA HOJE (medido: 0 linhas), mas o resto do
// Comercial Vessel NAO: 457 pedidos, 1.126 itens e TRES Beauty Sessions com QR
// impresso e na mao de cliente. Por isso esta prova tira uma impressao dessas
// tabelas ANTES de escrever qualquer coisa e exige que ela volte identica
// depois do `rollback to savepoint` E DE NOVO depois do `commit`, numa conexao
// nova. Toda linha que a prova ve e linha que a prova fez.
//
// ⚠️ E CONFERE O QUE AS DUAS FUNCOES DE LEITURA PERDERAM NO CAMINHO. Recriar
// `vessel_rastreio_dos_stylists` e `vessel_stylists_para_escolher` "de
// memoria" e como se perdem a conta de `receita` (que soma cada pedido uma vez
// so) e a janela de venda. Aqui o `pg_get_functiondef` de ANTES e comparado com
// o de DEPOIS, linha a linha, e a UNICA diferenca aceita e o `and
// coalesce(s.ativa, true)` que esta tarefa acrescentou.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { conferirQueOPortaoVoltou } from './lib/o-portao-dos-atendimentos.mjs'

const ARQUIVO = '2026-09-19-vessel-stylist-mexer.sql'

const CRIAR     = 'public.vessel_stylist_criar(text, text, text, text, text, text)'
const EDITAR    = 'public.vessel_stylist_editar(text, text, text, text, text, text, text, text)'
const DESATIVAR = 'public.vessel_stylist_desativar(text, boolean)'
const RASTREIO  = 'public.vessel_rastreio_dos_stylists(integer)'
const ESCOLHER  = 'public.vessel_stylists_para_escolher()'

// ⚠️⚠️ ESTE APLICADOR ENVELHECEU PARA UMA DAS DUAS FUNCOES QUE RECRIA: a T12
// (a tela do Stylist Circle ganhar cadastrar, corrigir e desativar) precisou
// de um SEGUNDO parametro em `vessel_rastreio_dos_stylists`
// (`p_incluir_desativadas`) e por isso a migration dela comeca com `drop
// function if exists public.vessel_rastreio_dos_stylists(integer)` antes de
// criar a versao de dois parametros. Este arquivo faz `create or replace
// function public.vessel_rastreio_dos_stylists(p_dias integer default 7)` —
// a assinatura de UM parametro, sem `drop`. Reaplica-lo depois da T12
// ressuscita essa assinatura ao lado da nova: o banco fica com as DUAS, e uma
// chamada por nome de parametro (o jeito que a Central chama) responde
// "function is not unique" — a tela do Stylist Circle para de carregar. A
// outra funcao que este arquivo mexe, `vessel_stylists_para_escolher()`, nao
// muda de assinatura na T12 e nao entra nesta trava.
const DEPOIS_DESTE = [
  {
    migration: '2026-09-20-vessel-rastreio-devolve-ativa-e-contato.sql',
    estrago:
      'ressuscitaria `vessel_rastreio_dos_stylists(integer)` — a assinatura de\n' +
      '       UM parâmetro que aquela migration derrubou de propósito — ao lado da\n' +
      '       de dois parâmetros que ela criou (que também devolve `ativa`,\n' +
      '       `whatsapp`, `instagram` e `atuacao`, que a versão de um parâmetro\n' +
      '       nunca devolveu). Com as duas no banco, uma chamada por nome de\n' +
      '       parâmetro (o jeito que a Central chama) responde "function is not\n' +
      '       unique" e a tela do Stylist Circle para de carregar, sem erro nenhum\n' +
      '       até o clique de alguém.',
  },
]

// ⚠️ ANTES DE ABRIR TRANSAÇÃO E ANTES DE APLICAR QUALQUER COISA.
{
  const cliDeChecagem = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await cliDeChecagem.connect()
  const { rows: posteriores } = await cliDeChecagem.query(
    `select name from public.schema_migrations where name = any($1::text[]) order by name`,
    [DEPOIS_DESTE.map((x) => x.migration)])
  await cliDeChecagem.end()
  if (posteriores.length > 0) {
    console.error(
      `❌ nao aplicada: ${ARQUIVO} ja foi superada e reaplica-la ressuscitaria assinatura morta.\n\n` +
      `Este arquivo faz \`create or replace\` em ` +
      `\`vessel_rastreio_dos_stylists(integer)\`.\n` +
      `Migration(s) mais nova(s) JA APLICADA(S) trocaram essa assinatura, e rodar este\n` +
      `aplicador agora recriaria a versao antiga do lado da nova:\n\n` +
      posteriores.map(({ name }) =>
        `  · ${name}\n       ${DEPOIS_DESTE.find((x) => x.migration === name).estrago}`).join('\n\n') +
      `\n\nVa ler essa migration em db/migrations/ antes de qualquer coisa. Se voce PRECISA mesmo\n` +
      `reaplicar este arquivo, a saida NAO e apagar esta trava: e reaplicar a migration\n` +
      `posterior logo depois, pelo aplicador dela.\n`)
    process.exit(1)
  }
}

// Telefones INVENTADOS para esta prova, todos canonicos e todos diferentes.
const FONE_1 = '5519990000001'
const FONE_2 = '5519990000002'
const FONE_3 = '5519990000003'
const FONE_4 = '5519990000004'
const FONE_5 = '5519990000005'
const FONES  = [FONE_1, FONE_2, FONE_3, FONE_4, FONE_5]

// ⚠️ A UNICA MUDANCA PERMITIDA EM CADA UMA DAS DUAS FUNCOES DE LEITURA, escrita
// como o PEDACO DE TEXTO DE ANTES e o PEDACO DE TEXTO DE DEPOIS, com a
// indentacao exata. O aplicador aplica esta troca — e SO ela — ao texto de
// antes e exige que o resultado seja, caractere por caractere, o texto que
// ficou no banco. Assim "copiei verbatim e acrescentei uma linha" deixa de ser
// promessa e vira conta.
//
// ⚠️ NA `para_escolher` O PONTO E VIRGULA ANDA JUNTO: o `where` era a ultima
// linha do `select`, entao o `;` que a fechava passa para o fim da linha nova.
// Uma conferencia que so procurasse "uma linha acrescentada" reprovaria isto
// como se fosse uma segunda mudanca.
const A_TROCA = {
  vessel_rastreio_dos_stylists: {
    antes:  '      where not coalesce(s.teste, false)\n',
    depois: '      where not coalesce(s.teste, false)\n        and coalesce(s.ativa, true)\n',
  },
  vessel_stylists_para_escolher: {
    antes:  '   where not coalesce(s.teste, false);\n',
    depois: '   where not coalesce(s.teste, false)\n     and coalesce(s.ativa, true);\n',
  },
}

// ⚠️ A IMPRESSAO DO QUE E DE VERDADE, campo a campo. Nao e `count(*)`: trocar o
// `quando` de uma Beauty Session ja impressa em QR deixaria a contagem igual e
// a impressao diferente.
const IMPRESSAO = `
  select (select count(*) from public.vessel_pedidos)::int        as pedidos,
         (select count(*) from public.vessel_pedido_itens)::int   as itens,
         (select count(*) from public.vessel_pessoas)::int        as pessoas,
         (select count(*) from public.vessel_atendimentos)::int   as atendimentos,
         (select count(*) from public.vessel_private_edits)::int  as private_edits,
         (select count(*) from public.vessel_stylists)::int       as stylists,
         (select coalesce(string_agg(
                   b.codigo || '|' || coalesce(b.quando::text, '~') || '|' ||
                   coalesce(b.praca, '~') || '|' || b.loja || '|' ||
                   coalesce(b.parceiro, '~') || '|' || b.ativa::text || '|' ||
                   b.arquivada::text, E'\\n' order by b.codigo), '')
            from public.vessel_beauty_sessions b)                 as beauty_sessions`

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

  const definicao = async (c, proname) => (await c.query(
    `select pg_get_functiondef(p.oid) as d
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`, [proname])).rows[0]?.d

  // ── 0. COMO O MUNDO ESTA AGORA ───────────────────────────────────────────
  // ⚠️ ANTES DE ESCREVER QUALQUER COISA, inclusive antes do DDL.
  const antesDeTudo = await uma(IMPRESSAO)
  if (antesDeTudo.pedidos < 1)
    throw new Error('vessel_pedidos veio vazia: a impressao nao provaria nada')

  // ⚠️ E O TEXTO EXATO DAS DUAS FUNCOES DE LEITURA, COMO ESTAO HOJE. E contra
  // isto que o diff de depois e medido.
  const defAntes = {}
  for (const proname of Object.keys(A_TROCA)) {
    defAntes[proname] = await definicao(cli, proname)
    if (!defAntes[proname]) throw new Error(`${proname} nao existe no banco: nao ha o que recriar`)
  }

  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-stylist-mexer.mjs'])

  // ── 1. A COLUNA NOVA NASCEU DO JEITO CERTO ───────────────────────────────
  // ⚠️ `default true` NAO E DETALHE: sem ele, toda parceira ja cadastrada
  // nasceria desativada e sumiria da tela de uma vez — e `not null` num `alter
  // table` de tabela com linhas nem aplicaria.
  const col = await uma(
    `select data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = 'vessel_stylists' and column_name = 'ativa'`)
  if (!col) throw new Error('a coluna ativa nao entrou')
  if (col.data_type !== 'boolean') throw new Error(`ativa nasceu ${col.data_type}`)
  if (col.is_nullable !== 'NO') throw new Error('ativa nasceu aceitando nulo')
  if (col.column_default !== 'true') throw new Error(`ativa nasceu com default ${col.column_default}`)

  // ── 2. O DIFF DAS DUAS RECRIADAS: SO A LINHA NOVA MUDOU ──────────────────
  // ⚠️ ESTA E A CONFERENCIA QUE PEGA UMA REESCRITA DE MEMORIA. Tirar do texto
  // de DEPOIS as linhas que esta tarefa acrescentou tem de devolver o texto de
  // ANTES, caractere por caractere. Se a conta de `receita`, a janela de venda
  // ou a ordenacao tiverem sido mexidas — de proposito ou por descuido —, as
  // duas strings nao batem e nada e commitado.
  const diffs = {}
  const soATroca = (proname, texto) => {
    const { antes, depois } = A_TROCA[proname]
    const quantas = texto.split(antes).length - 1
    if (quantas !== 1)
      throw new Error(`${proname}: o pedaco de antes aparece ${quantas}x no texto original, esperava 1`)
    return texto.replace(antes, depois)
  }
  // ⚠️ RODAR DE NOVO NAO PODE QUEBRAR. Na SEGUNDA vez, o texto de "antes" ja e
  // o texto de depois — a troca ja esta no banco —, e insistir em aplica-la
  // outra vez acrescentaria o filtro DUAS vezes no esperado e reprovaria uma
  // migration correta. O que a conferencia quer saber e sempre a mesma coisa:
  // "o texto no banco e exatamente o original com esta troca, e so ela?".
  for (const proname of Object.keys(A_TROCA)) {
    const depois = await definicao(cli, proname)
    if (!depois) throw new Error(`${proname} sumiu depois da migration`)
    const jaEstava = defAntes[proname].includes(A_TROCA[proname].depois)
    const esperado = jaEstava ? defAntes[proname] : soATroca(proname, defAntes[proname])
    if (jaEstava) diffs[proname] = '(ja estava aplicado: o texto no banco nao mudou nesta rodada)'
    if (depois !== esperado)
      throw new Error(
        `${proname} mudou ALEM do filtro de desativada.\n` +
        `ESPERADO (o texto de antes com a troca, e so ela)\n${esperado}\n` +
        `NO BANCO\n${depois}`)
    if (!jaEstava) diffs[proname] = '+ and coalesce(s.ativa, true)   (1 troca, nada mais)'
  }

  // ── 3. SOBROU UMA SO DE CADA, com a assinatura combinada ─────────────────
  // ⚠️ `create or replace` NAO troca uma funcao por outra de assinatura
  // diferente: cria uma SEGUNDA, sobrecarregada. Com duas no banco, a chamada
  // da tela morreria com "function is not unique" — e morreria DEPOIS do
  // deploy, na mao do usuario.
  for (const [nome, tipos] of [
    ['vessel_stylist_criar',          '(text,text,text,text,text,text)'],
    ['vessel_stylist_editar',         '(text,text,text,text,text,text,text,text)'],
    ['vessel_stylist_desativar',      '(text,boolean)'],
    ['vessel_rastreio_dos_stylists',  '(integer)'],
    ['vessel_stylists_para_escolher', '()'],
  ]) {
    const { quantas, assinaturas } = await uma(
      `select count(*)::int as quantas,
              string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as assinaturas
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    if (quantas !== 1) throw new Error(`${nome} ficou com ${quantas} versoes: ${assinaturas}`)
    if (!assinaturas.endsWith(tipos))
      throw new Error(`${nome} nao ficou com ${tipos}: ${assinaturas}`)
  }

  // ── 4. O QUE `editar` NAO PODE NEM RECEBER ───────────────────────────────
  // ⚠️ A GARANTIA DE QUE O CODIGO E A ORIGEM NAO SE EDITAM E A AUSENCIA DELES
  // NA LISTA DE PARAMETROS. O codigo esta dentro de todo link de rastreio ja
  // colado por ai; a origem e primeiro toque. Um parametro que aparecesse num
  // refactor mataria os dois sem erro nenhum para denunciar — e esta
  // conferencia le os nomes NO BANCO, nao no arquivo.
  const { nomes } = await uma(
    `select coalesce(array_to_string(p.proargnames, ','), '') as nomes
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'vessel_stylist_editar'`)
  for (const proibido of ['p_codigo_novo', 'p_origem_canal', 'p_origem_campanha', 'p_origem_utm'])
    if (new RegExp(`(^|,)${proibido}(,|$)`).test(nomes))
      throw new Error(`vessel_stylist_editar aceita ${proibido}, que nao pode existir: ${nomes}`)
  if (!/(^|,)p_codigo(,|$)/.test(nomes)) throw new Error(`editar perdeu o p_codigo: ${nomes}`)
  // ⚠️ E A PRACA TEM DE ESTAR LA: ela esta na lista do que se corrige, e o
  // parametro e o unico cujo nome nao bate com o da coluna (`praca_preview`).
  if (!/(^|,)p_praca(,|$)/.test(nomes)) throw new Error(`editar nao recebe p_praca: ${nomes}`)

  // ── 4b. A TRAVA DE FILA E O CINTO DELA CONTINUAM NO CORPO ────────────────
  // ⚠️ POR QUE UMA CONFERENCIA DE TEXTO AQUI. A corrida de duas chamadas ao
  // mesmo tempo NAO da para provar por esta conexao: as duas transacoes
  // precisam estar abertas AO MESMO TEMPO, e este aplicador e uma so. A prova
  // de verdade foi feita com duas conexoes (esta no relatorio da tarefa, com o
  // `23505 duplicate key ... vessel_stylists_codigo_idx` de antes e as duas
  // respostas de contrato depois). O que sobra para cá é impedir que um
  // refactor leve embora, calado, qualquer uma das tres pecas — e e isso que
  // estas tres linhas fazem.
  const { corpo } = await uma(
    `select p.prosrc as corpo from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'vessel_stylist_criar'`)
  if (!corpo.includes('pg_advisory_xact_lock'))
    throw new Error('vessel_stylist_criar perdeu a trava de fila: duas chamadas juntas voltam a colidir')
  if (!corpo.includes('exception when unique_violation'))
    throw new Error('vessel_stylist_criar perdeu o cinto: a colisao volta a virar erro cru do Postgres')
  if (!corpo.includes("get stacked diagnostics"))
    throw new Error('vessel_stylist_criar deixou de separar o indice de codigo do de whatsapp')

  // ── 5. A PORTA: a Central usa, a pagina publica nao ──────────────────────
  // ⚠️ `revoke ... from public` NAO fecha `authenticated`, e um `create or
  // replace` sobre funcao nova nasce ABERTA para `public` — ou seja, para
  // `anon`, que e quem abre as paginas publicas do Vessel. Sao duas linhas por
  // funcao na migration, e e isto aqui que confere que as duas foram escritas.
  // As duas RECRIADAS entram nesta conta tambem: `create or replace` nao
  // devolve o grant de quem foi revogado antes.
  const conferirPorta = async (q, nome, f) => {
    const p = (await q(
      `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
              has_function_privilege('anon',$1,'EXECUTE') as anon,
              has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])).rows[0]
    if (p.autenticado !== true) throw new Error(`a Central nao consegue usar ${nome}`)
    if (p.anon !== false || p.qualquer_um !== false)
      throw new Error(`${nome}: porta aberta para a pagina publica (anon=${p.anon}, public=${p.qualquer_um})`)
  }
  for (const [nome, f] of [
    ['criar', CRIAR], ['editar', EDITAR], ['desativar', DESATIVAR],
    ['rastreio', RASTREIO], ['escolher', ESCOLHER],
  ]) await conferirPorta((s, a) => cli.query(s, a), nome, f)

  await cli.query('savepoint prova')

  // ── 6. SEM SESSAO NENHUMA, NADA. `auth.uid()` e nulo aqui ────────────────
  for (const [nome, chamada] of [
    ['criar',     `select public.vessel_stylist_criar('Prova','${FONE_1}',null,null,null,null) as r`],
    ['editar',    `select public.vessel_stylist_editar('STY-0001','Outro',null,null,null,null,null,null) as r`],
    ['desativar', `select public.vessel_stylist_desativar('STY-0001', false) as r`],
  ]) {
    const { r } = await uma(chamada)
    // ⚠️ `if (r.ok)` NAO BASTA: `pg` devolve SQL NULL como `null`, que e falsy
    // em JavaScript — um `ok` nulo passaria batido por um `if` solto, do mesmo
    // jeito que passa um `false`. As comparacoes sao estritas de proposito.
    if (r.ok !== false) throw new Error(`${nome} deixou passar quem nao tem sessao (ok=${JSON.stringify(r.ok)})`)
    if (r.situacao !== 'sem_permissao') throw new Error(`${nome} recusou por outro motivo: ${JSON.stringify(r)}`)
  }
  const { n: nadaEntrou } = await uma(`select count(*)::int as n from public.vessel_stylists`)
  if (nadaEntrou !== antesDeTudo.stylists)
    throw new Error(`quem nao tem sessao cadastrou parceira mesmo assim: ${nadaEntrou}`)

  // ── 7. PERFIS DE MENTIRA E SESSAO DE VERDADE ─────────────────────────────
  // ⚠️ `profiles.id` tem FK para `auth.users(id)` e `profiles.email` e NOT NULL
  // sem default: por isso cada perfil de mentira nasce em DOIS inserts. Nada
  // disto sobrevive ao `rollback to savepoint prova` mais abaixo.
  const perfil = async (features, permissions) => {
    const id = randomUUID()
    const email = `prova-stylist-mexer-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(
      `insert into public.profiles (id, email, features, permissions, is_superadmin)
       values ($1, $2, $3, $4::jsonb, false)`,
      [id, email, features, JSON.stringify(permissions)])
    return id
  }
  // ⚠️ E ASSIM QUE `auth.uid()` LE QUEM E: `request.jwt.claims -> sub`. Falar
  // como alguem aqui e mais honesto do que trocar a trava por `select true` — a
  // trava roda INTEIRA, com o portao de `features` e a acao de `permissions`,
  // exatamente como vai rodar na Central.
  const falarComo = async (id) => cli.query(
    `select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])

  const so_ve = await perfil(['atendimentos'], { atendimentos: ['ver'] })
  const mexe  = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] })

  const linha = async (cod) => await uma(
    `select codigo, nome, whatsapp, cidade, instagram, atuacao, estagio, praca_preview,
            ativa, origem_canal, origem_campanha, origem_utm,
            criado_em::text as criado_em, atualizado_em::text as atualizado_em
       from public.vessel_stylists where codigo = $1`, [cod])

  // ── 7a. QUEM SO VE CONTINUA SO VENDO ─────────────────────────────────────
  // ⚠️ ESTE E O CASO QUE SEPARA A TRAVA DE EDITAR DA TRAVA DE VER. O caso 6
  // nao consegue: sem sessao, `auth.uid()` e nulo e as duas travas dao falso
  // igual. Este perfil TEM `atendimentos` em `features` (passa pelo portao de
  // ver) e NAO tem `editar` em `permissions` — trocar
  // `is_vessel_atendimentos_editar()` por `is_vessel_atendimentos()` passa
  // batido la em cima e quebra aqui.
  await falarComo(so_ve)
  for (const [nome, chamada] of [
    ['criar',     `select public.vessel_stylist_criar('Nao Devia','${FONE_3}',null,null,null,null) as r`],
    ['editar',    `select public.vessel_stylist_editar('STY-0001','Nao Devia',null,null,null,null,null,null) as r`],
    ['desativar', `select public.vessel_stylist_desativar('STY-0001', false) as r`],
  ]) {
    const { r } = await uma(chamada)
    if (r.ok !== false) throw new Error(`${nome}: quem so ve passou (ok=${JSON.stringify(r.ok)})`)
    if (r.situacao !== 'sem_permissao') throw new Error(`${nome}: quem so ve recusado por outro motivo: ${JSON.stringify(r)}`)
  }
  // ⚠️ E RECUSAR NAO BASTA: recusar SEM TER ESCRITO e o que se prova aqui. Uma
  // funcao que gravasse e so depois devolvesse `sem_permissao` passaria pelas
  // asercoes de cima.
  const { n: nadaDeQuemSoVe } = await uma(`select count(*)::int as n from public.vessel_stylists`)
  if (nadaDeQuemSoVe !== antesDeTudo.stylists)
    throw new Error(`quem so ve cadastrou parceira: ${nadaDeQuemSoVe}`)

  // ── 7b. CADASTRAR DE VERDADE ─────────────────────────────────────────────
  await falarComo(mexe)

  const { r: c0 } = await uma(
    `select public.vessel_stylist_criar('  Marina da Prova  ', $1, ' Campinas ', ' @marina ', 'stylist', 'cps') as r`,
    [FONE_1])
  if (c0.ok !== true) throw new Error(`criar recusou quem pode: ${JSON.stringify(c0)}`)
  if (c0.situacao !== 'ok') throw new Error(`criar respondeu ${JSON.stringify(c0)}`)
  const STY = c0.codigo
  // ⚠️ O FORMATO E O QUE `FORMATO_STYLIST` (/^STY-\d{4}$/) exige para montar o
  // link `/s/STY-0001`. Um codigo fora dele faria `linkDaStylist()` devolver
  // string vazia: a parceira existiria e nao teria link nenhum, calada.
  if (!/^STY-\d{4}$/.test(STY)) throw new Error(`criar gerou codigo fora do formato: ${STY}`)

  const nova = await linha(STY)
  if (!nova) throw new Error('criar disse ok e nao gravou linha nenhuma')
  if (nova.nome !== 'Marina da Prova') throw new Error(`o nome nao entrou aparado: ${JSON.stringify(nova.nome)}`)
  if (nova.whatsapp !== FONE_1) throw new Error(`o telefone nao entrou canonico: ${JSON.stringify(nova.whatsapp)}`)
  if (nova.cidade !== 'Campinas') throw new Error(`a cidade nao entrou: ${JSON.stringify(nova.cidade)}`)
  if (nova.instagram !== '@marina') throw new Error(`o instagram nao entrou: ${JSON.stringify(nova.instagram)}`)
  if (nova.atuacao !== 'stylist') throw new Error(`a atuacao nao entrou: ${JSON.stringify(nova.atuacao)}`)
  // ⚠️ A PRACA ENTRA MAIUSCULA porque ela e chave de roteamento: o Private Edit
  // monta `PE-20260925-CPS-01` com ela dentro.
  if (nova.praca_preview !== 'CPS') throw new Error(`a praca nao entrou maiuscula: ${JSON.stringify(nova.praca_preview)}`)
  if (nova.estagio !== 'prospect') throw new Error(`o estagio nao caiu no padrao: ${JSON.stringify(nova.estagio)}`)
  if (nova.ativa !== true) throw new Error(`a parceira nova nasceu desativada: ${JSON.stringify(nova.ativa)}`)
  // ⚠️ E A ORIGEM NASCE NULA: ela nao chegou por campanha nenhuma, chegou pela
  // mao de alguem da casa. Inventar 'central' faria a atribuicao contar como
  // aquisicao uma pessoa que ninguem adquiriu.
  if (nova.origem_canal !== null) throw new Error(`criar inventou origem: ${JSON.stringify(nova.origem_canal)}`)

  // Telefone que nao da para usar, e telefone repetido: resposta, nao erro de
  // banco na cara de quem esta preenchendo o formulario.
  const { r: cRuim } = await uma(`select public.vessel_stylist_criar('Fone Torto','123',null,null,null,null) as r`)
  if (cRuim.ok !== false || cRuim.situacao !== 'whatsapp_invalido')
    throw new Error(`criar aceitou telefone impossivel: ${JSON.stringify(cRuim)}`)
  const { r: cRep } = await uma(
    `select public.vessel_stylist_criar('Repetida', $1, null, null, null, null) as r`, [FONE_1])
  if (cRep.ok !== false || cRep.situacao !== 'whatsapp_repetido')
    throw new Error(`criar deixou a mesma parceira virar duas: ${JSON.stringify(cRep)}`)
  if (cRep.codigo !== STY) throw new Error(`criar nao disse QUEM ja existe: ${JSON.stringify(cRep)}`)
  const { r: cPraca } = await uma(
    `select public.vessel_stylist_criar('Praca Inventada', $1, null, null, null, 'XYZ') as r`, [FONE_2])
  if (cPraca.ok !== false || cPraca.situacao !== 'praca_invalida')
    throw new Error(`criar aceitou praca inventada: ${JSON.stringify(cPraca)}`)

  // ⚠️ O SEGUNDO CODIGO E O SEGUINTE, NAO UM SORTEIO. O formulario publico
  // numera com `count(*) + 1`; um codigo sorteado daqui ocuparia um numero la
  // na frente e, no dia em que a contagem publica chegasse nele, o `insert` da
  // landing morreria no indice unico — do lado de fora, na cara de uma
  // parceira de verdade.
  const { r: c1 } = await uma(
    `select public.vessel_stylist_criar('Segunda da Prova', $1, null, null, null, null) as r`, [FONE_2])
  if (c1.ok !== true) throw new Error(`criar recusou a segunda: ${JSON.stringify(c1)}`)
  const STY2 = c1.codigo
  if (!/^STY-\d{4}$/.test(STY2)) throw new Error(`a segunda saiu fora do formato: ${STY2}`)
  if (STY2 === STY) throw new Error('criar repetiu o codigo')
  if (Number(STY2.slice(4)) !== Number(STY.slice(4)) + 1)
    throw new Error(`a numeracao nao e sequencial: ${STY} -> ${STY2}`)

  // ⚠️ E A VOLTA ALCANCA O `STY-0000`. A faixa e de 10.000 codigos, `STY-0000`
  // a `STY-9999`; uma volta que caisse em 1 deixaria o `STY-0000` inalcancavel
  // para sempre e o comentario da funcao estaria mentindo sobre o tamanho da
  // faixa. Com o topo ocupado, o proximo TEM de ser o `STY-0000`.
  await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp) values ('STY-9999','Topo da Faixa',$1)`,
    [FONE_4])
  const { r: cVolta } = await uma(
    `select public.vessel_stylist_criar('Depois da Volta', $1, null, null, null, null) as r`, [FONE_5])
  if (cVolta.ok !== true) throw new Error(`criar recusou depois da volta: ${JSON.stringify(cVolta)}`)
  if (cVolta.codigo !== 'STY-0000')
    throw new Error(`a volta nao alcancou o STY-0000: veio ${cVolta.codigo}`)
  await uma(`delete from public.vessel_stylists where whatsapp = any($1::text[])`, [[FONE_4, FONE_5]])

  // ── 7c. CORRIGIR: TODOS OS CAMPOS DE UMA VEZ, TODOS DIFERENTES ───────────
  // ⚠️ O `coalesce(p_x, x)` PROMETE DUAS COISAS e e facil provar so uma. Aqui
  // vem a que costuma faltar: "um valor de verdade LANDA". Um `set praca_preview
  // = praca_preview` com o parametro silenciosamente ignorado passaria por
  // qualquer asercao que so conferisse que o nulo nao apagou. E TODOS os campos
  // na MESMA chamada, que e como a tela manda o formulario inteiro — e todos
  // com valor DIFERENTE do que a linha tinha.
  // ⚠️ `atualizado_em` E EMPURRADO PARA TRAS A MAO ANTES DA PROVA. Dentro de
  // UMA transacao `now()` devolve sempre o MESMO instante — o do `begin` —,
  // entao a linha recem-criada ja tem `atualizado_em` igual ao `now()` que o
  // `update` vai gravar, e a comparacao aprovaria uma funcao que nem tocasse na
  // coluna. Com a data antiga plantada, so passa quem escreve de verdade.
  await uma(
    `update public.vessel_stylists set atualizado_em = timestamptz '2000-01-01 00:00:00-03'
      where codigo = $1`, [STY])
  const antesDeEditar = await linha(STY)
  const { r: e1 } = await uma(
    `select public.vessel_stylist_editar($1, 'Marina Corrigida', $2, 'Sao Paulo', '@marina.nova',
                                          'personal-shopper', 'qualificado', 'sao') as r`,
    [STY, FONE_3])
  if (e1.ok !== true) throw new Error(`editar recusou quem pode: ${JSON.stringify(e1)}`)
  if (e1.situacao !== 'ok') throw new Error(`editar respondeu ${JSON.stringify(e1)}`)
  if (e1.codigo !== STY) throw new Error(`editar nao devolveu o codigo: ${JSON.stringify(e1)}`)

  const d1 = await linha(STY)
  for (const [campo, esperado] of [
    ['nome', 'Marina Corrigida'],
    ['whatsapp', FONE_3],
    ['cidade', 'Sao Paulo'],
    ['instagram', '@marina.nova'],
    ['atuacao', 'personal-shopper'],
    ['estagio', 'qualificado'],
    ['praca_preview', 'SAO'],
  ]) {
    if (d1[campo] !== esperado)
      throw new Error(`editar NAO gravou ${campo}: ${JSON.stringify(d1[campo])}, esperava ${JSON.stringify(esperado)}`)
    if (d1[campo] === antesDeEditar[campo])
      throw new Error(`${campo} nao mudou: a asercao nao prova escrita nenhuma`)
  }
  // ⚠️ A TABELA NAO TEM TRIGGER NENHUM (conferido em `pg_trigger`): quem
  // atualiza `atualizado_em` e a mao, dentro do `update`. Sem a linha, a coluna
  // mentiria para sempre.
  if (d1.atualizado_em === antesDeEditar.atualizado_em)
    throw new Error('editar nao mexeu em atualizado_em')
  const { agoraMesmo } = await uma(
    `select (atualizado_em = now()) as "agoraMesmo" from public.vessel_stylists where codigo = $1`, [STY])
  if (agoraMesmo !== true) throw new Error('atualizado_em nao virou a hora de agora')
  if (d1.criado_em !== antesDeEditar.criado_em)
    throw new Error('editar mexeu em criado_em')

  // ⚠️ E AGORA A OUTRA METADE: nulo = "nao mexe neste campo", nunca "apaga o
  // que estava la". Todos os campos nulos de uma vez, que e o que chega quando
  // a tela manda so o codigo.
  const { r: e2 } = await uma(
    `select public.vessel_stylist_editar($1, null, null, null, null, null, null, null) as r`, [STY])
  if (e2.ok !== true) throw new Error(`editar so com nulos recusou: ${JSON.stringify(e2)}`)
  const d2 = await linha(STY)
  for (const campo of ['nome', 'whatsapp', 'cidade', 'instagram', 'atuacao', 'estagio', 'praca_preview'])
    if (d2[campo] !== d1[campo])
      throw new Error(`um nulo apagou ${campo}: ${JSON.stringify(d1[campo])} -> ${JSON.stringify(d2[campo])}`)

  // ── 7d. O QUE `editar` NAO PODE TOCAR, NAO TOCOU ─────────────────────────
  // ⚠️ AQUI A PROVA NAO E A LISTA DE PARAMETROS (isso e o caso 4), E O DADO.
  // A origem e escrita a mao nesta linha justamente para que haja o que
  // sobrescrever: um `update` que passasse por cima dela seria pego aqui.
  await uma(
    `update public.vessel_stylists
        set origem_canal = 'instagram', origem_campanha = 'circle-set',
            origem_utm = '{"utm_source":"ig"}'::jsonb
      where codigo = $1`, [STY])
  await uma(`select public.vessel_stylist_editar($1, 'Nome Outra Vez', null, null, null, null, null, null) as r`, [STY])
  const d3 = await linha(STY)
  if (d3.codigo !== STY) throw new Error('o codigo mudou e os links ja colados morreram')
  if (d3.origem_canal !== 'instagram') throw new Error(`a origem_canal foi sobrescrita: ${JSON.stringify(d3.origem_canal)}`)
  if (d3.origem_campanha !== 'circle-set') throw new Error(`a origem_campanha foi sobrescrita: ${JSON.stringify(d3.origem_campanha)}`)
  if (JSON.stringify(d3.origem_utm) !== JSON.stringify({ utm_source: 'ig' }))
    throw new Error(`a origem_utm foi sobrescrita: ${JSON.stringify(d3.origem_utm)}`)
  if (d3.ativa !== true) throw new Error('editar desativou a parceira de tabela')

  // Telefone repetido e praca inventada, pelo `editar`.
  const { r: eRep } = await uma(
    `select public.vessel_stylist_editar($1, null, $2, null, null, null, null, null) as r`, [STY, FONE_2])
  if (eRep.ok !== false || eRep.situacao !== 'whatsapp_repetido')
    throw new Error(`editar deixou duas parceiras com o mesmo telefone: ${JSON.stringify(eRep)}`)
  const { r: ePraca } = await uma(
    `select public.vessel_stylist_editar($1, null, null, null, null, null, null, 'ZZZ') as r`, [STY])
  if (ePraca.ok !== false || ePraca.situacao !== 'praca_invalida')
    throw new Error(`editar aceitou praca inventada: ${JSON.stringify(ePraca)}`)

  // ── 7e. O CODIGO TORTO: minusculas e espaco na ponta ─────────────────────
  // ⚠️ AS ACOES MORAM NA MESMA TELA, e as irmas ja normalizam com
  // `upper(nullif(trim(coalesce(p_codigo,'')),''))`. Sem a MESMA expressao, o
  // mesmo codigo faria um botao funcionar e o outro responder `nao_achei` — e
  // recusa pela metade a pessoa le como sistema quebrado.
  // ⚠️ E O PERIGO MAIOR E A NORMALIZACAO PELA METADE: um `exists` no codigo cru
  // com o `update` no normalizado responderia `nao_achei` sobre linha que
  // existe; o contrario responderia `ok` sem ter gravado. Foi esse buraco que,
  // na irma do Private Edit, apagou um encontro com gente dentro.
  const TORTO = `  ${STY.toLowerCase()}  `
  const { r: t1 } = await uma(
    `select public.vessel_stylist_editar($1, 'Pelo Codigo Torto', null, null, null, null, null, null) as r`, [TORTO])
  if (t1.ok !== true) throw new Error(`editar nao achou o codigo torto: ${JSON.stringify(t1)}`)
  if (t1.codigo !== STY) throw new Error(`editar devolveu o codigo sem normalizar: ${JSON.stringify(t1)}`)
  if ((await linha(STY)).nome !== 'Pelo Codigo Torto')
    throw new Error('editar com codigo torto disse ok e nao gravou')

  // ── 7f. DESATIVAR: SAI DA LISTA, NAO DO BANCO ────────────────────────────
  const antesDeDesativar = (await uma(`select count(*)::int as n from public.vessel_stylists`)).n
  const { r: dz1 } = await uma(`select public.vessel_stylist_desativar($1, false) as r`, [STY])
  if (dz1.ok !== true) throw new Error(`desativar recusou quem pode: ${JSON.stringify(dz1)}`)
  if (dz1.ativa !== false) throw new Error(`desativar nao devolveu ativa=false: ${JSON.stringify(dz1)}`)
  const dd = await linha(STY)
  // ⚠️ ESTA E A ASERCAO QUE IMPEDE UM `delete` DE ENTRAR AQUI NUM REFACTOR. As
  // aberturas de link e os atendimentos que ela trouxe estao pendurados pelo
  // codigo; apagar a linha deixaria tudo orfao e a conta de rastreio passaria a
  // somar sobre uma parceira que nao existe mais.
  if (dd === undefined) throw new Error('desativar APAGOU a parceira')
  if (dd.ativa !== false) throw new Error(`desativar nao gravou: ${JSON.stringify(dd.ativa)}`)
  if ((await uma(`select count(*)::int as n from public.vessel_stylists`)).n !== antesDeDesativar)
    throw new Error('desativar mexeu no numero de linhas da tabela')

  // ⚠️ E `desativar(codigo, null)` DESATIVA. Quando a tela manda so o codigo —
  // ou quando o PostgREST deixa o segundo parametro de fora —, "desativar" tem
  // de significar DESATIVAR. Sem o `coalesce`, a coluna e `not null` e a
  // chamada morreria com erro de banco na cara da pessoa.
  await uma(`select public.vessel_stylist_desativar($1, true) as r`, [STY])
  const { r: dzNulo } = await uma(`select public.vessel_stylist_desativar($1, null) as r`, [STY])
  if (dzNulo.ok !== true) throw new Error(`desativar com nulo recusou: ${JSON.stringify(dzNulo)}`)
  if (dzNulo.ativa !== false) throw new Error(`desativar com nulo nao caiu no padrao false: ${JSON.stringify(dzNulo)}`)
  if ((await linha(STY)).ativa !== false) throw new Error('desativar com nulo nao gravou')

  // ── 7g. A DESATIVADA SAI DAS DUAS LISTAS ─────────────────────────────────
  const escolher = async () => (await uma(`select public.vessel_stylists_para_escolher() as r`)).r
  const rastreio = async () => (await uma(`select public.vessel_rastreio_dos_stylists(7) as r`)).r

  const listaSem = await escolher()
  if (listaSem.some((s) => s.codigo === STY))
    throw new Error('a desativada continua na lista de escolher')
  if (!listaSem.some((s) => s.codigo === STY2))
    throw new Error('a lista de escolher perdeu quem esta ativa')
  const rastSem = await rastreio()
  if (rastSem.some((s) => s.codigo === STY))
    throw new Error('a desativada continua no rastreio')
  if (!rastSem.some((s) => s.codigo === STY2))
    throw new Error('o rastreio perdeu quem esta ativa')

  // ⚠️ E A LISTA DE ESCOLHER CONTINUA DEVOLVENDO EXATAMENTE TRES CHAVES. Ha
  // prova COMMITADA que quebra se a resposta crescer:
  // `coletor/aplicar-vessel-private-edit-pela-tela.mjs` compara
  // `Object.keys(lista[0]).sort().join(',')` com 'cidade,codigo,nome'. Esta
  // linha e a MESMA asercao, rodando aqui antes do commit para que o estrago
  // nao chegue a ser publicado.
  const chaves = Object.keys(listaSem[0]).sort().join(',')
  if (chaves !== 'cidade,codigo,nome')
    throw new Error('a lista de stylists devolve alem do necessario: ' + chaves)

  // ⚠️ E O RASTREIO CONTINUA CONTANDO O QUE CONTAVA. As chaves de cada linha
  // sao a prova barata de que a copia verbatim nao perdeu nenhuma conta.
  const chavesRastreio = Object.keys(rastSem.find((s) => s.codigo === STY2)).sort().join(',')
  const esperadoRastreio = [
    'aberturas', 'cidade', 'clientes', 'codigo', 'compareceram', 'confirmados',
    'estagio', 'janela_de_venda_em_dias', 'nome', 'pedidos', 'praca_preview', 'receita',
  ].join(',')
  if (chavesRastreio !== esperadoRastreio)
    throw new Error(`o rastreio perdeu ou ganhou conta: ${chavesRastreio}`)

  // Reativar tem de ter volta, senao o botao de reativar e codigo morto.
  const { r: dz2 } = await uma(`select public.vessel_stylist_desativar($1, true) as r`, [STY])
  if (dz2.ok !== true || dz2.ativa !== true) throw new Error(`reativar falhou: ${JSON.stringify(dz2)}`)
  if ((await escolher()).some((s) => s.codigo === STY) !== true)
    throw new Error('a reativada nao voltou para a lista de escolher')

  // E pelo codigo torto tambem.
  const { r: dzT } = await uma(`select public.vessel_stylist_desativar($1, false) as r`, [TORTO])
  if (dzT.ok !== true) throw new Error(`desativar nao achou o codigo torto: ${JSON.stringify(dzT)}`)
  if (dzT.codigo !== STY) throw new Error(`desativar devolveu o codigo sem normalizar: ${JSON.stringify(dzT)}`)
  if ((await linha(STY)).ativa !== false) throw new Error('desativar com codigo torto nao gravou')
  await uma(`select public.vessel_stylist_desativar($1, true) as r`, [STY])

  // ── 7h. QUEM NAO EXISTE: `nao_achei`, nao um `ok` sobre zero linhas ──────
  // ⚠️ `update` que nao acha nada NAO levanta erro no Postgres.
  for (const [nome, chamada] of [
    ['editar',    `select public.vessel_stylist_editar('STY-9999','Fantasma',null,null,null,null,null,null) as r`],
    ['desativar', `select public.vessel_stylist_desativar('STY-9999', false) as r`],
  ]) {
    const { r } = await uma(chamada)
    if (r.ok !== false) throw new Error(`${nome} disse ok sobre parceira que nao existe: ${JSON.stringify(r)}`)
    if (r.situacao !== 'nao_achei') throw new Error(`${nome} sobre inexistente: ${JSON.stringify(r)}`)
  }

  // ── 8. NADA DISSO FICA ───────────────────────────────────────────────────
  await falarComo(null)
  await cli.query('rollback to savepoint prova')

  // ⚠️ DEPOIS DO ROLLBACK, ANTES DO COMMIT e antes de qualquer linha de
  // sucesso: a sessao de mentira tem de ter ido embora junto.
  const { u } = await uma(`select auth.uid() as u`)
  if (u !== null) throw new Error(`a sessao de mentira sobreviveu ao rollback: ${u}`)

  // ⚠️ E OS DOIS PORTOES CONTINUAM INTEIROS. Esta prova nao troca nenhum por
  // `select true` em momento nenhum — mas a conferencia fica, porque e barata e
  // porque o dia em que alguem trouxer um stub para dentro deste arquivo ela e
  // quem avisa, ANTES do commit. O portao de ver e o `using` do RLS de SEIS
  // tabelas.
  await conferirQueOPortaoVoltou(cli)

  // ⚠️ E O MUNDO DE VERDADE VOLTOU IDENTICO.
  const depoisDoRollback = await uma(IMPRESSAO)
  for (const [campo, antes] of Object.entries(antesDeTudo))
    if (depoisDoRollback[campo] !== antes)
      throw new Error(`${campo} nao voltou: ${JSON.stringify(antes)} -> ${JSON.stringify(depoisDoRollback[campo])}`)

  // E NENHUMA LINHA DE PROVA PODE TER ESCAPADO DO SAVEPOINT.
  // ⚠️ Procura-se pela MARCA de cada linha inventada aqui — os telefones e o
  // prefixo do email — e nao por "a tabela esta vazia": `vessel_stylists` esta
  // vazia HOJE, e uma conferencia escrita assim reprovaria esta mesma migration
  // no dia em que a primeira parceira de verdade entrar.
  const sobrou = await uma(
    `select (select count(*) from public.vessel_stylists where whatsapp = any($1::text[]))::int as parceiras,
            (select count(*) from public.profiles where email like 'prova-stylist-mexer-%')::int as perfis,
            (select count(*) from auth.users where email like 'prova-stylist-mexer-%')::int as contas`,
    [FONES])
  for (const [onde, n] of Object.entries(sobrou))
    if (n !== 0) throw new Error(`sobrou dado de prova em ${onde}: ${n} linha(s)`)

  await cli.query('commit')

  // ── 9. E DE NOVO, DEPOIS DO COMMIT, NUMA CONEXAO NOVA ────────────────────
  // ⚠️ UM `COMMIT` DEPOIS DE ERRO VIRA `ROLLBACK` CALADO, e o script imprime
  // sucesso do mesmo jeito. Conferir na mesma conexao tambem nao resolve: ela
  // pode estar num estado que a proxima nao tera. Por isso a conferencia final
  // abre outra conexao e pergunta ao banco do zero.
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  try {
    const dela = async (s, a = []) => (await outra.query(s, a)).rows[0]

    for (const [nome, tipos, f] of [
      ['vessel_stylist_criar',          '(text,text,text,text,text,text)',          CRIAR],
      ['vessel_stylist_editar',         '(text,text,text,text,text,text,text,text)', EDITAR],
      ['vessel_stylist_desativar',      '(text,boolean)',                            DESATIVAR],
      ['vessel_rastreio_dos_stylists',  '(integer)',                                 RASTREIO],
      ['vessel_stylists_para_escolher', '()',                                        ESCOLHER],
    ]) {
      const { quantas, assinaturas } = await dela(
        `select count(*)::int as quantas,
                string_agg(p.oid::regprocedure::text, ' | ') as assinaturas
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`, [nome])
      if (quantas !== 1 || !assinaturas.endsWith(tipos))
        throw new Error(`depois do commit, ${nome} esta ${quantas}x como ${assinaturas}`)
      await conferirPorta((s, a) => outra.query(s, a), nome, f)
    }

    // ⚠️ O DIFF, DE NOVO, JA PUBLICADO: e a ultima chance de descobrir que uma
    // conta se perdeu no caminho.
    for (const proname of Object.keys(A_TROCA)) {
      const depois = await definicao(outra, proname)
      const jaEstava = defAntes[proname].includes(A_TROCA[proname].depois)
      if (depois !== (jaEstava ? defAntes[proname] : soATroca(proname, defAntes[proname])))
        throw new Error(`depois do commit, ${proname} mudou alem do filtro de desativada`)
      // ⚠️ E, DE QUALQUER JEITO, O FILTRO TEM DE ESTAR LA. A comparacao acima
      // aprova "nada mudou"; esta aqui e a que exige que o que nao mudou seja
      // a versao COM o filtro, e nao a velha.
      if (!depois.includes(A_TROCA[proname].depois))
        throw new Error(`depois do commit, ${proname} esta SEM o filtro de desativada`)
    }

    // ⚠️ OS DOIS PORTOES, JA PUBLICADOS.
    await conferirQueOPortaoVoltou(outra)

    const agora = await dela(IMPRESSAO)
    for (const [campo, antes] of Object.entries(antesDeTudo))
      if (agora[campo] !== antes)
        throw new Error(`depois do commit, ${campo} esta diferente: ${JSON.stringify(antes)} -> ${JSON.stringify(agora[campo])}`)

    const { n: sobrouDepois } = await dela(
      `select count(*)::int as n from public.vessel_stylists where whatsapp = any($1::text[])`, [FONES])
    if (sobrouDepois !== 0) throw new Error(`depois do commit sobraram ${sobrouDepois} parceira(s) de prova`)

    const { registrada } = await dela(
      `select exists (select 1 from public.schema_migrations where name = $1) as registrada`, [ARQUIVO])
    if (registrada !== true) throw new Error('a migration nao ficou registrada: o commit nao pegou')

    console.log(`   diff verbatim: vessel_rastreio_dos_stylists ${diffs.vessel_rastreio_dos_stylists}`)
    console.log(`   diff verbatim: vessel_stylists_para_escolher ${diffs.vessel_stylists_para_escolher}`)
    console.log(`   escolher devolve exatamente: cidade,codigo,nome`)
    console.log(`   intactos: ${agora.pedidos} pedidos, ${agora.itens} itens, ` +
                `${agora.beauty_sessions.split('\n').length} Beauty Sessions, ` +
                `${agora.stylists} stylists`)
  } finally { await outra.end() }

  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
