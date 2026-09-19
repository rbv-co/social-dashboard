// APLICA, REGISTRA e PROVA o MEXER na Beauty Session: editar, apagar e
// arquivar.
//
// ⚠️ TUDO NUMA TRANSACAO SO: aplicar, registrar, provar e so entao `commit`.
// DDL no Postgres e transacional — nao existe um instante em que a tela de
// alguem encontre uma funcao pela metade.
//
// ⚠️⚠️ ESTA TABELA TEM DADO DE VERDADE, ao contrario das irmas deste plano.
// `vessel_beauty_sessions` guarda HOJE as tres sessoes do negocio, com QR ja
// impresso e na mao de cliente. Por isso esta prova:
//   · fabrica a PROPRIA linha e so mexe nela;
//   · tira uma IMPRESSAO das linhas de verdade ANTES de escrever qualquer
//     coisa, e exige que ela volte identica depois do `rollback to savepoint`
//     E DE NOVO depois do `commit`, numa conexao nova;
//   · nunca edita, arquiva ou apaga uma linha que nao foi ela quem criou.
// Uma prova que so contasse "sao tres linhas" nao pegaria uma sessao editada
// no lugar de outra — por isso a impressao leva campo a campo.
//
// ⚠️ ESTA PROVA NAO TROCA NENHUM PORTAO POR `select true`. O caminho e o mesmo
// da irma do Private Edit: FABRICAR SESSAO DE VERDADE com
// `set_config('request.jwt.claims', ...)`, que e de onde `auth.uid()` le quem
// e. Assim as tres funcoes novas sao exercitadas com a TRAVA LIGADA, do jeito
// que a Central vai chamar — e nao ha um instante sequer em que
// `is_vessel_atendimentos()` (o `using` do RLS de SEIS tabelas) esteja aberto.
//
// ⚠️ `quando` NA BEAUTY SESSION E `date`, NAO `timestamptz`. A irma
// `vessel_beauty_session_criar(text, date, text, text, text)` ja recebe `date`
// porque a coluna e `date` (medido no banco, nao suposto). Receber
// `timestamptz` aqui faria o Postgres converter o instante para dia NO FUSO DA
// SESSAO na hora de gravar — a mesma sessao gravaria dia 25 ou dia 26
// dependendo de quem chamou.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { conferirQueOPortaoVoltou } from './lib/o-portao-dos-atendimentos.mjs'

const ARQUIVO = '2026-09-19-vessel-beauty-session-mexer.sql'
const BS = 'BS-20260919-PROVA-01'          // a sessao INVENTADA por esta prova
const BS_SUMIU = 'BS-20260919-PROVA-NAOEXISTE'

const EDITAR   = 'public.vessel_beauty_session_editar(text, date, text)'
const APAGAR   = 'public.vessel_beauty_session_apagar(text)'
const ARQUIVAR = 'public.vessel_beauty_session_arquivar(text, boolean)'

// ⚠️ A IMPRESSAO DAS SESSOES DE VERDADE, campo a campo e em ordem fixa. Nao e
// `count(*)`: trocar o `quando` de uma sessao impressa em QR deixaria a
// contagem igual e a impressao diferente.
const IMPRESSAO = `
  select count(*)::int as quantas,
         coalesce(string_agg(
           t.codigo || '|' || coalesce(t.quando::text, '~') || '|' ||
           coalesce(t.praca, '~') || '|' || t.loja || '|' ||
           coalesce(t.parceiro, '~') || '|' || t.ativa::text || '|' ||
           t.arquivada::text || '|' || t.criado_em::text,
           E'\\n' order by t.codigo), '') as impressao
    from public.vessel_beauty_sessions t`

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

  // ── 0. COMO AS SESSOES DE VERDADE ESTAO AGORA ────────────────────────────
  // ⚠️ ANTES DE ESCREVER QUALQUER COISA, inclusive antes do DDL.
  const antesDeTudo = await uma(IMPRESSAO)
  if (antesDeTudo.quantas < 1)
    throw new Error('vessel_beauty_sessions veio vazia: a impressao nao provaria nada')

  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-beauty-session-mexer.mjs'])

  // ── 1. SOBROU UMA SO DE CADA, com a assinatura combinada ─────────────────
  // ⚠️ `create or replace` NAO troca uma funcao por outra de assinatura
  // diferente: cria uma SEGUNDA, sobrecarregada. Com duas no banco, a chamada
  // da tela morreria com "function is not unique" — e morreria DEPOIS do
  // deploy, na mao do usuario. Por isso conta-se aqui, antes do commit.
  for (const [nome, tipos] of [
    ['vessel_beauty_session_editar',   '(text,date,text)'],
    ['vessel_beauty_session_apagar',   '(text)'],
    ['vessel_beauty_session_arquivar', '(text,boolean)'],
  ]) {
    const { quantas, assinaturas } = await uma(
      `select count(*)::int as quantas,
              string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as assinaturas
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    if (quantas !== 1) throw new Error(`${nome} ficou com ${quantas} versoes: ${assinaturas}`)
    if (!assinaturas.endsWith(tipos))
      throw new Error(`${nome} nao ficou com ${tipos}: ${assinaturas}`)

    // ⚠️ `codigo` NUNCA se edita, e a garantia disso e a AUSENCIA dele na
    // lista de parametros. O codigo esta dentro dos DOIS links ja copiados
    // desta sessao — o QR da mesa e o QR do cartao — e os dois estao
    // IMPRESSOS. Um `p_codigo_novo` que aparecesse num refactor mataria os
    // dois de uma vez, sem erro nenhum para denunciar. Esta conferencia le os
    // nomes dos argumentos NO BANCO, nao no arquivo.
    const { nomes } = await uma(
      `select coalesce(array_to_string(p.proargnames, ','), '') as nomes
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    if (/(^|,)p_codigo_novo(,|$)/.test(nomes))
      throw new Error(`${nome} ganhou como trocar o codigo: ${nomes}`)
    if (!/(^|,)p_codigo(,|$)/.test(nomes))
      throw new Error(`${nome} perdeu o p_codigo: ${nomes}`)
  }

  // ── 2. A PORTA: a Central usa, a pagina publica nao ──────────────────────
  // ⚠️ `revoke ... from public` NAO fecha `authenticated`, e um `create or
  // replace` sobre funcao nova nasce ABERTA para `public` — ou seja, para
  // `anon`, que e quem abre a pagina do QR da Beauty Session. Sao duas linhas
  // por funcao na migration, e e isto aqui que confere que as duas foram
  // escritas.
  for (const [nome, f] of [['editar', EDITAR], ['apagar', APAGAR], ['arquivar', ARQUIVAR]]) {
    const p = await uma(
      `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
              has_function_privilege('anon',$1,'EXECUTE') as anon,
              has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])
    if (p.autenticado !== true) throw new Error(`a Central nao consegue usar ${nome}`)
    if (p.anon !== false || p.qualquer_um !== false)
      throw new Error(`${nome}: porta aberta para a pagina publica (anon=${p.anon}, public=${p.qualquer_um})`)
  }

  await cli.query('savepoint prova')

  // ── 3. SEM SESSAO NENHUMA, NADA. `auth.uid()` e nulo aqui ───────────────
  for (const [nome, chamada] of [
    ['editar',   `select public.vessel_beauty_session_editar('BS-X', null, null) as r`],
    ['apagar',   `select public.vessel_beauty_session_apagar('BS-X') as r`],
    ['arquivar', `select public.vessel_beauty_session_arquivar('BS-X', true) as r`],
  ]) {
    const { r } = await uma(chamada)
    // ⚠️ `if (r.ok)` NAO BASTA: `pg` devolve SQL NULL como `null`, que e falsy
    // em JavaScript — um `ok` nulo passaria batido por um `if` solto, do mesmo
    // jeito que passa um `false`. As comparacoes sao estritas de proposito.
    if (r.ok !== false) throw new Error(`${nome} deixou passar quem nao tem sessao (ok=${JSON.stringify(r.ok)})`)
    if (r.situacao !== 'sem_permissao') throw new Error(`${nome} recusou por outro motivo: ${JSON.stringify(r)}`)
  }

  // ── 4. PERFIS DE MENTIRA E SESSAO DE VERDADE ────────────────────────────
  // ⚠️ `profiles.id` tem FK para `auth.users(id)` e `profiles.email` e NOT
  // NULL sem default: por isso cada perfil de mentira nasce em DOIS inserts.
  // Nada disto sobrevive ao `rollback to savepoint prova` mais abaixo.
  const perfil = async (features, permissions) => {
    const id = randomUUID()
    const email = `prova-beauty-session-mexer-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(
      `insert into public.profiles (id, email, features, permissions, is_superadmin)
       values ($1, $2, $3, $4::jsonb, false)`,
      [id, email, features, JSON.stringify(permissions)])
    return id
  }
  // ⚠️ E ASSIM QUE `auth.uid()` LE QUEM E: `request.jwt.claims -> sub`. Falar
  // como alguem aqui e mais honesto do que trocar a trava por `select true` —
  // a trava roda INTEIRA, com o portao de `features` e a acao de
  // `permissions`, exatamente como vai rodar na Central.
  const falarComo = async (id) => cli.query(
    `select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])

  const so_ve = await perfil(['atendimentos'], { atendimentos: ['ver'] })
  const mexe  = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] })

  // ⚠️ A SESSAO DA PROVA E INVENTADA AQUI, E SO NELA SE MEXE. Nenhuma das tres
  // sessoes de verdade e citada em lugar nenhum deste arquivo.
  await uma(
    `insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro)
     values ($1, date '2027-05-20', 'SBO', 'tivoli', 'Salao da Prova')`, [BS])

  const linha = async () => await uma(
    `select codigo, quando::text as quando, praca, loja, parceiro, ativa, arquivada
       from public.vessel_beauty_sessions where codigo = $1`, [BS])
  const temLeitura = async (cod) => (await uma(
    `select exists (select 1 from public.vessel_sessao_aberturas where codigo = $1) as r`, [cod])).r
  const quantasLeituras = async (cod) => (await uma(
    `select count(*)::int as n from public.vessel_sessao_aberturas where codigo = $1`, [cod])).n

  // ── 4a. QUEM SO VE CONTINUA SO VENDO, inclusive por fora da tela ────────
  // ⚠️ ESTE E O CASO QUE SEPARA A TRAVA DE EDITAR DA TRAVA DE VER.
  //
  // Nao e que o caso 3 seja cego ao sumico da trava: ele exige `sem_permissao`
  // em cheio, e uma funcao destravada responderia `nao_achei` para o `BS-X`
  // inexistente. O que o caso 3 NAO consegue e distinguir UMA trava da OUTRA:
  // sem sessao, `auth.uid()` e nulo e `is_vessel_atendimentos()` e
  // `is_vessel_atendimentos_editar()` dao falso igual.
  //
  // O perfil daqui e o que morde essa diferenca: ele TEM `atendimentos` em
  // `features` (passa pelo portao de ver) e NAO tem `editar` em `permissions`.
  // Trocar `is_vessel_atendimentos_editar()` por `is_vessel_atendimentos()` —
  // o erro mais facil de cometer neste arquivo, porque a irma `encerrar` usa
  // justamente a de ver — passa batido pelo caso 3 e quebra aqui.
  await falarComo(so_ve)
  const antesDeVer = await linha()
  for (const [nome, chamada, args] of [
    ['editar',   `select public.vessel_beauty_session_editar($1, date '2099-01-01', 'MEXIDO') as r`, [BS]],
    ['apagar',   `select public.vessel_beauty_session_apagar($1) as r`, [BS]],
    ['arquivar', `select public.vessel_beauty_session_arquivar($1, true) as r`, [BS]],
  ]) {
    const { r } = await uma(chamada, args)
    if (r.ok !== false) throw new Error(`${nome}: quem so ve passou (ok=${JSON.stringify(r.ok)})`)
    if (r.situacao !== 'sem_permissao') throw new Error(`${nome}: quem so ve recusado por outro motivo: ${JSON.stringify(r)}`)
  }
  // ⚠️ E RECUSAR NAO BASTA: recusar SEM TER MEXIDO e o que se prova aqui. Uma
  // funcao que escrevesse e so depois devolvesse `sem_permissao` passaria
  // pelas tres asercoes de cima.
  const depoisDeVer = await linha()
  if (depoisDeVer === undefined) throw new Error('quem so ve apagou a sessao')
  if (JSON.stringify(antesDeVer) !== JSON.stringify(depoisDeVer))
    throw new Error(`quem so ve mexeu na linha: ${JSON.stringify(antesDeVer)} -> ${JSON.stringify(depoisDeVer)}`)

  // ── 4b. QUEM PODE EDITAR, EDITA — E O VALOR ENTRA DE VERDADE ────────────
  await falarComo(mexe)

  // ⚠️ O `coalesce(p_x, x)` PROMETE DUAS COISAS e e facil provar so uma. Aqui
  // vem a que costuma faltar: "um valor de verdade LANDA". Um `set loja = loja`
  // com o parametro silenciosamente ignorado passaria por qualquer asercao que
  // so conferisse que o nulo nao apagou. E os DOIS campos na MESMA chamada,
  // que e como a tela manda o formulario inteiro.
  //
  // ⚠️ E OS DOIS VALORES SAO DIFERENTES DO QUE A LINHA TINHA: conferir que um
  // campo continua igual ao que ja era nao prova escrita nenhuma.
  const { r: ed1 } = await uma(
    `select public.vessel_beauty_session_editar($1, date '2028-01-07', 'iguatemi') as r`, [BS])
  if (ed1.ok !== true) throw new Error(`editar recusou quem pode: ${JSON.stringify(ed1)}`)
  if (ed1.situacao !== 'ok') throw new Error(`editar respondeu ${JSON.stringify(ed1)}`)
  if (ed1.codigo !== BS) throw new Error(`editar nao devolveu o codigo: ${JSON.stringify(ed1)}`)
  const d1 = await linha()
  if (d1.loja !== 'iguatemi') throw new Error(`a loja NAO entrou: ${JSON.stringify(d1)}`)
  // ⚠️ O `quando` e comparado NO BANCO, nao em JavaScript: `pg` devolve `date`
  // como objeto `Date` no fuso local, e comparar Date com string passa por
  // qualquer coisa. Quem sabe se dois dias sao o mesmo dia e o Postgres.
  const { entrou } = await uma(
    `select (quando = date '2028-01-07') as entrou
       from public.vessel_beauty_sessions where codigo = $1`, [BS])
  if (entrou !== true) throw new Error(`o quando NAO entrou: ${JSON.stringify(d1.quando)}`)

  // ⚠️ E AGORA A OUTRA METADE: nulo = "nao mexe neste campo", nunca "apaga o
  // que estava la". Um `set loja = p_loja` sem `coalesce` nem chegaria a
  // apagar: `loja` e `not null` e a chamada morreria com erro de banco na cara
  // da pessoa. Ja o `quando` aceita nulo — e sumiria calado.
  const { r: ed2 } = await uma(
    `select public.vessel_beauty_session_editar($1, null, null) as r`, [BS])
  if (ed2.ok !== true) throw new Error(`editar so com nulos recusou: ${JSON.stringify(ed2)}`)
  const d2 = await linha()
  if (d2.loja !== 'iguatemi') throw new Error(`a loja foi apagada por um nulo: ${JSON.stringify(d2)}`)
  if (d2.quando === null) throw new Error(`o quando foi apagado por um nulo: ${JSON.stringify(d2)}`)
  if (d2.quando !== d1.quando) throw new Error(`o quando mudou com nulo: ${JSON.stringify(d2)}`)

  // ⚠️ E O QUE `editar` NAO PODE TOCAR continua intocado. `praca` e `parceiro`
  // nao sao parametros desta funcao — se um dia virarem, e melhor que quebre
  // aqui do que na tela.
  if (d2.codigo !== BS) throw new Error(`o codigo mudou: ${JSON.stringify(d2)}`)
  if (d2.praca !== 'SBO') throw new Error(`a praca mudou sozinha: ${JSON.stringify(d2)}`)
  if (d2.parceiro !== 'Salao da Prova') throw new Error(`o parceiro mudou sozinho: ${JSON.stringify(d2)}`)
  if (d2.ativa !== true) throw new Error(`editar encerrou a sessao: ${JSON.stringify(d2)}`)
  if (d2.arquivada !== false) throw new Error(`editar arquivou a sessao: ${JSON.stringify(d2)}`)

  // Sessao que nao existe: `nao_achei`, e nao um `ok` sobre zero linhas.
  // ⚠️ `update`/`delete` que nao acham nada NAO levantam erro no Postgres.
  for (const [nome, chamada] of [
    ['editar',   `select public.vessel_beauty_session_editar($1, null, 'tivoli') as r`],
    ['apagar',   `select public.vessel_beauty_session_apagar($1) as r`],
    ['arquivar', `select public.vessel_beauty_session_arquivar($1, true) as r`],
  ]) {
    const { r } = await uma(chamada, [BS_SUMIU])
    if (r.ok !== false) throw new Error(`${nome} disse ok sobre sessao que nao existe: ${JSON.stringify(r)}`)
    if (r.situacao !== 'nao_achei') throw new Error(`${nome} sobre inexistente: ${JSON.stringify(r)}`)
  }

  // ── 4c. ARQUIVAR E DESARQUIVAR ──────────────────────────────────────────
  // ⚠️ ARQUIVAR TEM DE TER VOLTA. Uma linha que some da lista para sempre
  // nunca mais pode ser desarquivada, e o botao de desarquivar viraria codigo
  // morto.
  const { r: ar1 } = await uma(`select public.vessel_beauty_session_arquivar($1, true) as r`, [BS])
  if (ar1.ok !== true) throw new Error(`arquivar recusou quem pode: ${JSON.stringify(ar1)}`)
  if (ar1.arquivada !== true) throw new Error(`arquivar nao devolveu arquivada=true: ${JSON.stringify(ar1)}`)
  if ((await linha()).arquivada !== true) throw new Error('arquivar nao gravou')

  const { r: ar2 } = await uma(`select public.vessel_beauty_session_arquivar($1, false) as r`, [BS])
  if (ar2.ok !== true) throw new Error(`desarquivar recusou: ${JSON.stringify(ar2)}`)
  if (ar2.arquivada !== false) throw new Error(`desarquivar nao devolveu arquivada=false: ${JSON.stringify(ar2)}`)
  if ((await linha()).arquivada !== false) throw new Error('desarquivar nao gravou')

  // ⚠️ E `arquivar(codigo, null)` ARQUIVA. O `coalesce(p_arquivada, true)`
  // existe para isso: quando a tela manda so o codigo — ou quando o PostgREST
  // deixa o segundo parametro de fora e ele chega nulo — "arquivar" tem de
  // significar ARQUIVAR. Sem o `coalesce`, `arquivada` receberia NULL e a
  // coluna e `not null`: a chamada morreria com erro de banco na cara da
  // pessoa. E se a coluna um dia aceitasse nulo, seria pior — silenciosamente
  // nem arquivada nem desarquivada.
  const { r: ar3 } = await uma(`select public.vessel_beauty_session_arquivar($1, null) as r`, [BS])
  if (ar3.ok !== true) throw new Error(`arquivar com nulo recusou: ${JSON.stringify(ar3)}`)
  if (ar3.arquivada !== true) throw new Error(`arquivar com nulo nao caiu no padrao true: ${JSON.stringify(ar3)}`)
  const d3 = await linha()
  if (d3.arquivada !== true) throw new Error('arquivar com nulo nao gravou')
  // ⚠️ ARQUIVAR NAO E ENCERRAR: `ativa` nao pode ter sido tocada no caminho.
  // Sao duas ideias diferentes e duas contas diferentes — encerrada continua
  // somando no historico, arquivada sai das contas.
  if (d3.ativa !== true) throw new Error('arquivar encerrou a sessao de tabela')
  await uma(`select public.vessel_beauty_session_arquivar($1, false) as r`, [BS])

  // ── 4d. O CODIGO TORTO: minusculas e espaco na ponta ────────────────────
  // ⚠️ AS QUATRO ACOES MORAM NA MESMA TELA. A irma
  // `vessel_beauty_session_encerrar` normaliza o codigo com
  // `upper(nullif(trim(coalesce(p_codigo,'')),''))`; as tres daqui copiam a
  // MESMA expressao, na MESMA ordem. Sem isso, o mesmo codigo faria o botao
  // "Encerrar" funcionar e os outros tres responderem `nao_achei` — e recusa
  // pela metade a pessoa le como sistema quebrado, nao como codigo errado.
  const BS_TORTO = `  ${BS.toLowerCase()}  `

  const { r: t1 } = await uma(`select public.vessel_beauty_session_arquivar($1, true) as r`, [BS_TORTO])
  if (t1.ok !== true) throw new Error(`arquivar nao achou o codigo torto: ${JSON.stringify(t1)}`)
  if (t1.codigo !== BS) throw new Error(`arquivar devolveu o codigo sem normalizar: ${JSON.stringify(t1)}`)
  if ((await linha()).arquivada !== true) throw new Error('arquivar com codigo torto nao gravou')

  const { r: t2 } = await uma(`select public.vessel_beauty_session_arquivar($1, false) as r`, [BS_TORTO])
  if (t2.ok !== true) throw new Error(`desarquivar nao achou o codigo torto: ${JSON.stringify(t2)}`)
  if ((await linha()).arquivada !== false) throw new Error('desarquivar com codigo torto nao gravou')

  const { r: t3 } = await uma(
    `select public.vessel_beauty_session_editar($1, date '2029-02-03', null) as r`, [BS_TORTO])
  if (t3.ok !== true) throw new Error(`editar nao achou o codigo torto: ${JSON.stringify(t3)}`)
  if (t3.codigo !== BS) throw new Error(`editar devolveu o codigo sem normalizar: ${JSON.stringify(t3)}`)
  const { entrou: entrouTorto } = await uma(
    `select (quando = date '2029-02-03') as entrou
       from public.vessel_beauty_sessions where codigo = $1`, [BS])
  if (entrouTorto !== true) throw new Error('editar com codigo torto nao gravou na linha certa')

  // ── 4e. APAGAR SO A SESSAO QUE NINGUEM LEU ──────────────────────────────
  // ⚠️ "TER GENTE" NA BEAUTY SESSION E LEITURA DO QR, nao convidada: a sessao
  // nao tem lista de convidadas. A tabela e `vessel_sessao_aberturas`, LIGADA
  // PELA COLUNA `codigo` — exatamente a mesma ligacao que a funcao de conta ja
  // usa (`2026-09-18-vessel-contar-as-beauty-sessions.sql`, `a.codigo =
  // s.codigo`). Nao existe coluna `sessao_codigo` nessa tabela.
  if (await temLeitura(BS) !== false) throw new Error('a sessao de prova ja nasceu com leitura')

  // ⚠️ A PRIMEIRA LEITURA VAI COM `peca = 'cartao'`, DE PROPOSITO. A funcao de
  // conta separa 'mesa' e 'cartao' porque quer saber qual peca funciona
  // melhor; para "alguem ja leu este QR?", QUALQUER peca conta. Uma
  // conferencia que copiasse o `and a.peca = 'mesa'` da conta apagaria uma
  // sessao lida so pelo cartao — e este caso e o que denuncia isso.
  await uma(
    `insert into public.vessel_sessao_aberturas (codigo, peca, via) values ($1,'cartao','qr')`, [BS])
  if (await temLeitura(BS) !== true) throw new Error('a leitura de cartao nao pendurou')

  // ⚠️ ESTE E O CASO QUE PRECISA QUEBRAR se a conferencia de leitura sair da
  // funcao: com sessao de quem PODE editar, a unica coisa que separa `ok` de
  // `tem_gente` e aquele `exists`. Sem ele, o `delete` roda e a resposta vira
  // `ok` — e as asercoes abaixo caem, uma a uma.
  const antesLeituras = await quantasLeituras(BS)
  const { r: ap1 } = await uma(`select public.vessel_beauty_session_apagar($1) as r`, [BS])
  if (ap1.ok !== false) throw new Error(`apagou sessao com leitura de cartao: ${JSON.stringify(ap1)}`)
  if (ap1.situacao !== 'tem_gente') throw new Error(`recusa por outro motivo: ${JSON.stringify(ap1)}`)
  if ((await linha()) === undefined) throw new Error('a sessao com leitura sumiu mesmo assim')
  // ⚠️ E A LEITURA TEM DE CONTINUAR LA: apagar a sessao deixaria as leituras
  // ORFAS e a conta passaria a somar sobre uma sessao que nao existe mais.
  if ((await quantasLeituras(BS)) !== antesLeituras)
    throw new Error('a tentativa de apagar mexeu nas leituras')

  // ⚠️ E COM O CODIGO TORTO A RECUSA TEM DE SER A MESMA. Este caso mira a
  // fresta mais perigosa da normalizacao: se a conferencia de leitura lesse
  // `p_codigo` cru enquanto o `delete` le o normalizado, este `apagar` nao
  // acharia leitura nenhuma, responderia `ok` e levaria embora uma sessao JA
  // LIDA — deixando aberturas orfas. Foi exatamente esse buraco que, na irma
  // do Private Edit, apagou um encontro com gente dentro devolvendo `ok`.
  const { r: ap1t } = await uma(`select public.vessel_beauty_session_apagar($1) as r`, [BS_TORTO])
  if (ap1t.situacao !== 'tem_gente')
    throw new Error(`codigo torto furou a conferencia de leitura: ${JSON.stringify(ap1t)}`)
  if ((await linha()) === undefined) throw new Error('a sessao com leitura sumiu pelo codigo torto')
  if ((await quantasLeituras(BS)) !== antesLeituras) throw new Error('o codigo torto mexeu nas leituras')

  // ⚠️ E COM `peca` NULO TAMBEM. A coluna aceita nulo (nao e `not null`), e
  // uma conferencia escrita como `peca in ('mesa','cartao')` deixaria passar a
  // linha de `peca` nula — que continua sendo uma leitura.
  await uma(`delete from public.vessel_sessao_aberturas where codigo = $1`, [BS])
  await uma(`insert into public.vessel_sessao_aberturas (codigo, peca, via) values ($1,null,'texto')`, [BS])
  const { r: ap1n } = await uma(`select public.vessel_beauty_session_apagar($1) as r`, [BS])
  if (ap1n.situacao !== 'tem_gente')
    throw new Error(`leitura de peca nula furou a conferencia: ${JSON.stringify(ap1n)}`)
  if ((await linha()) === undefined) throw new Error('a sessao sumiu por causa de peca nula')

  // ⚠️ E O CAMINHO QUE SOBRA para uma sessao ja lida: arquivar, que funciona
  // mesmo com leitura. Sem isto, "nao devia estar ali" nao teria saida nenhuma.
  const { r: arComLeitura } = await uma(`select public.vessel_beauty_session_arquivar($1, true) as r`, [BS])
  if (arComLeitura.ok !== true) throw new Error(`arquivar recusou sessao com leitura: ${JSON.stringify(arComLeitura)}`)
  if ((await linha()).arquivada !== true) throw new Error('arquivar a sessao com leitura nao gravou')
  await uma(`select public.vessel_beauty_session_arquivar($1, false) as r`, [BS])

  // Sem leitura nenhuma, apaga.
  await uma(`delete from public.vessel_sessao_aberturas where codigo = $1`, [BS])
  if (await temLeitura(BS) !== false) throw new Error('a leitura nao saiu para o proximo caso')
  // ⚠️ E VAI PELO CODIGO TORTO de proposito: se o `exists` normalizasse e o
  // `delete` lesse o cru, a resposta seria `ok` e a linha CONTINUARIA LA — um
  // "apaguei" que nao apagou nada, que so a ultima asercao abaixo denuncia.
  const { r: ap2 } = await uma(`select public.vessel_beauty_session_apagar($1) as r`, [BS_TORTO])
  if (ap2.ok !== true) throw new Error(`apagar recusou sessao sem leitura: ${JSON.stringify(ap2)}`)
  if (ap2.situacao !== 'ok') throw new Error(`apagar sem leitura respondeu: ${JSON.stringify(ap2)}`)
  if (ap2.codigo !== BS) throw new Error(`apagar devolveu o codigo sem normalizar: ${JSON.stringify(ap2)}`)
  if ((await linha()) !== undefined) throw new Error('apagar disse ok e a linha ficou')

  // ── 5. NADA DISSO FICA ──────────────────────────────────────────────────
  await falarComo(null)
  await cli.query('rollback to savepoint prova')

  // ⚠️ DEPOIS DO ROLLBACK, ANTES DO COMMIT e antes de qualquer linha de
  // sucesso: a sessao de mentira tem de ter ido embora junto. Se
  // `request.jwt.claims` sobrevivesse ate o `commit`, nada quebraria aqui —
  // mas a proxima linha deste arquivo estaria rodando como um perfil que nao
  // existe mais.
  const { u } = await uma(`select auth.uid() as u`)
  if (u !== null) throw new Error(`a sessao de mentira sobreviveu ao rollback: ${u}`)

  // ⚠️ E O PORTAO CONTINUA INTEIRO. Esta prova nao troca
  // `is_vessel_atendimentos()` por `select true` em momento nenhum — mas a
  // conferencia fica, porque ela e barata e porque o dia em que alguem
  // trouxer um stub para dentro deste arquivo ela e quem avisa, antes do
  // commit. O portao e o `using` do RLS de SEIS tabelas.
  await conferirQueOPortaoVoltou(cli)

  // ⚠️⚠️ E AS SESSOES DE VERDADE VOLTARAM IDENTICAS. Esta e a asercao que esta
  // tarefa tem e as irmas deste plano nao tinham: a tabela ja estava em uso
  // quando esta migration foi escrita.
  const depoisDoRollback = await uma(IMPRESSAO)
  if (depoisDoRollback.quantas !== antesDeTudo.quantas)
    throw new Error(`o numero de Beauty Sessions mudou: ${antesDeTudo.quantas} -> ${depoisDoRollback.quantas}`)
  if (depoisDoRollback.impressao !== antesDeTudo.impressao)
    throw new Error(
      `as Beauty Sessions de verdade NAO voltaram como estavam:\nANTES\n${antesDeTudo.impressao}\nDEPOIS\n${depoisDoRollback.impressao}`)

  // E NENHUMA LINHA DE PROVA PODE TER ESCAPADO DO SAVEPOINT.
  // ⚠️ Procura-se pela MARCA de cada linha inventada aqui, nao por "a tabela
  // esta vazia": `vessel_beauty_sessions` TEM linhas de verdade, e
  // `vessel_sessao_aberturas` tera assim que o primeiro QR for lido. Uma
  // conferencia escrita como `count(*) = 0` reprovaria migration correta.
  const sobrou = await uma(
    `select (select count(*) from public.vessel_beauty_sessions where codigo in ($1,$2))::int as bs,
            (select count(*) from public.vessel_sessao_aberturas where codigo in ($1,$2))::int as leituras,
            (select count(*) from public.profiles where email like 'prova-beauty-session-mexer-%')::int as perfis,
            (select count(*) from auth.users where email like 'prova-beauty-session-mexer-%')::int as contas`,
    [BS, BS_SUMIU])
  for (const [onde, n] of Object.entries(sobrou))
    if (n !== 0) throw new Error(`sobrou dado de prova em ${onde}: ${n} linha(s)`)

  await cli.query('commit')

  // ── 6. E DE NOVO, DEPOIS DO COMMIT, NUMA CONEXAO NOVA ───────────────────
  // ⚠️ UM `COMMIT` DEPOIS DE ERRO VIRA `ROLLBACK` CALADO, e o script imprime
  // sucesso do mesmo jeito. Conferir na mesma conexao tambem nao resolve: ela
  // pode estar num estado que a proxima nao terá. Por isso a conferencia final
  // abre outra conexao e pergunta ao banco do zero.
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  try {
    const dela = async (s, a = []) => (await outra.query(s, a)).rows[0]

    for (const [nome, tipos, f] of [
      ['vessel_beauty_session_editar',   '(text,date,text)',  EDITAR],
      ['vessel_beauty_session_apagar',   '(text)',            APAGAR],
      ['vessel_beauty_session_arquivar', '(text,boolean)',    ARQUIVAR],
    ]) {
      const { quantas, assinaturas } = await dela(
        `select count(*)::int as quantas,
                string_agg(p.oid::regprocedure::text, ' | ') as assinaturas
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`, [nome])
      if (quantas !== 1 || !assinaturas.endsWith(tipos))
        throw new Error(`depois do commit, ${nome} esta ${quantas}x como ${assinaturas}`)
      const p = await dela(
        `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
                has_function_privilege('anon',$1,'EXECUTE') as anon,
                has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])
      if (p.autenticado !== true || p.anon !== false || p.qualquer_um !== false)
        throw new Error(`depois do commit, a porta de ${nome} esta ${JSON.stringify(p)}`)
    }

    // ⚠️ O PORTAO, DE NOVO, JA PUBLICADO. E a ultima chance de descobrir que
    // alguma coisa foi ao ar aberta.
    await conferirQueOPortaoVoltou(outra)

    // ⚠️⚠️ E AS TRES SESSOES DE VERDADE, DEPOIS DE TUDO COMMITADO.
    const agora = await dela(IMPRESSAO)
    if (agora.impressao !== antesDeTudo.impressao)
      throw new Error(
        `depois do commit, as Beauty Sessions de verdade estao diferentes:\nANTES\n${antesDeTudo.impressao}\nAGORA\n${agora.impressao}`)

    const { n: leiturasDaProva } = await dela(
      `select count(*)::int as n from public.vessel_sessao_aberturas where codigo in ($1,$2)`, [BS, BS_SUMIU])
    if (leiturasDaProva !== 0)
      throw new Error(`depois do commit sobraram ${leiturasDaProva} leitura(s) da prova`)

    const { registrada } = await dela(
      `select exists (select 1 from public.schema_migrations where name = $1) as registrada`, [ARQUIVO])
    if (registrada !== true) throw new Error('a migration nao ficou registrada: o commit nao pegou')

    console.log(`   ${agora.quantas} Beauty Sessions de verdade, identicas as de antes da prova`)
  } finally { await outra.end() }

  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
