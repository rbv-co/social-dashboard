// APLICA, REGISTRA e PROVA o MEXER no encontro (Private Edit): editar, apagar
// e arquivar.
// ⚠️ As provas escrevem dado de verdade e sao desfeitas antes do commit.
//
// ⚠️ TUDO NUMA TRANSACAO SO: aplicar, registrar, provar e so entao `commit`.
// DDL no Postgres e transacional — nao existe um instante em que a tela de
// alguem encontre uma funcao pela metade.
//
// ⚠️ ESTA PROVA NAO TROCA NENHUM PORTAO POR `select true`. As provas irmas
// precisaram disso porque `auth.uid()` e nulo numa conexao `pg` pura; aqui o
// caminho e outro e melhor: FABRICAR SESSAO DE VERDADE com
// `set_config('request.jwt.claims', ...)`, como `auth.uid()` le de fato (ver
// `docs/provar-portao-das-duas-funcoes.sql`). Assim as tres funcoes novas sao
// exercitadas com a TRAVA LIGADA, do jeito que a Central vai chamar — e nao ha
// um instante sequer em que `is_vessel_atendimentos()` (o `using` do RLS de
// SEIS tabelas) esteja aberto. A conferencia do portao no fim continua, mesmo
// assim, como rede: se algum dia alguem trouxer um stub para dentro deste
// arquivo, ela denuncia antes do `commit`.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { conferirQueOPortaoVoltou } from './lib/o-portao-dos-atendimentos.mjs'

const ARQUIVO = '2026-09-19-vessel-private-edit-mexer.sql'
const PE = 'PE-20260919-CPS-Y8'          // o encontro da prova
const PE_SUMIU = 'PE-20260919-CPS-NAOEXISTE'

const EDITAR   = 'public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text)'
const APAGAR   = 'public.vessel_private_edit_apagar(text)'
const ARQUIVAR = 'public.vessel_private_edit_arquivar(text, boolean)'

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-private-edit-mexer.mjs'])

  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

  // ── 1. SOBROU UMA SO DE CADA, com a assinatura combinada ─────────────────
  // ⚠️ `create or replace` NAO troca uma funcao por outra de assinatura
  // diferente: cria uma SEGUNDA, sobrecarregada. Com duas no banco, a chamada
  // da tela morreria com "function is not unique" — e morreria DEPOIS do
  // deploy, na mao do usuario. Por isso conta-se aqui, antes do commit.
  for (const [nome, tipos] of [
    ['vessel_private_edit_editar',   '(text,timestamp with time zone,text,text,text,integer,text)'],
    ['vessel_private_edit_apagar',   '(text)'],
    ['vessel_private_edit_arquivar', '(text,boolean)'],
  ]) {
    const { quantas, assinaturas } = await uma(
      `select count(*)::int as quantas,
              string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as assinaturas
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    if (quantas !== 1) throw new Error(`${nome} ficou com ${quantas} versoes: ${assinaturas}`)
    if (!assinaturas.endsWith(tipos))
      throw new Error(`${nome} nao ficou com ${tipos}: ${assinaturas}`)

    // ⚠️ `codigo` e `chave` NUNCA se editam, e a garantia disso e a AUSENCIA
    // deles na lista de parametros. Um `p_chave` que aparecesse num refactor
    // mataria todo convite ja enviado (a `chave` esta dentro do link). Esta
    // conferencia le os nomes dos argumentos no banco, nao no arquivo.
    const { nomes } = await uma(
      `select coalesce(array_to_string(p.proargnames, ','), '') as nomes
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    if (/(^|,)p_chave(,|$)/.test(nomes))
      throw new Error(`${nome} ganhou um parametro p_chave: ${nomes}`)
    if (nome === 'vessel_private_edit_editar' && /(^|,)p_codigo_novo(,|$)/.test(nomes))
      throw new Error(`${nome} ganhou como trocar o codigo: ${nomes}`)
  }

  // ── 2. A PORTA: a Central usa, a pagina publica nao ──────────────────────
  // ⚠️ `revoke ... from public` NAO fecha `authenticated`, e um `create or
  // replace` sobre funcao nova nasce ABERTA para `public` — ou seja, para
  // `anon`, que e a pagina publica do convite. Sao duas linhas por funcao na
  // migration, e e isto aqui que confere que as duas foram escritas.
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
    ['editar',   `select public.vessel_private_edit_editar('PE-X', now(), null, null, null, null, null) as r`],
    ['apagar',   `select public.vessel_private_edit_apagar('PE-X') as r`],
    ['arquivar', `select public.vessel_private_edit_arquivar('PE-X', true) as r`],
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
    const email = `prova-private-edit-mexer-${id}@teste.invalido`
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

  // O encontro da prova, e uma stylist para ele apontar.
  const { id: sty } = await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp)
     values ('STY-9998','Prova','5519988888888') returning id`)
  const { id: sty2 } = await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp)
     values ('STY-9997','Prova Dois','5519988888887') returning id`)
  await uma(
    `insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, local, praca, loja, vagas)
     values ($1,'YYYYYYYY',$2, now() + interval '5 days','Piso L3','CPS','iguatemi',8)`, [PE, sty])

  const linha = async () => await uma(
    `select codigo, chave, stylist_id, quando, local, praca, loja, vagas, ativa, arquivada
       from public.vessel_private_edits where codigo = $1`, [PE])
  const temGente = async (cod) => (await uma(
    `select exists (select 1 from public.vessel_atendimentos where evento_codigo = $1) as r`, [cod])).r
  const quantasGente = async (cod) => (await uma(
    `select count(*)::int as n from public.vessel_atendimentos where evento_codigo = $1`, [cod])).n

  // ── 4a. QUEM SO VE CONTINUA SO VENDO, inclusive por fora da tela ────────
  // ⚠️ ESTE E O CASO QUE FAZ A TRAVA VALER ALGUMA COISA. Ele bate num codigo
  // que EXISTE: se a chamada a `is_vessel_atendimentos_editar()` sumir das
  // funcoes, a resposta deixa de ser `sem_permissao` e vira `ok` — e a
  // asercao quebra. Com um codigo inexistente (como no caso 3) a mesma
  // remocao passaria despercebida, escondida atras de `nao_achei`.
  await falarComo(so_ve)
  const antesDeVer = await linha()
  for (const [nome, chamada, args] of [
    ['editar',   `select public.vessel_private_edit_editar($1, null, 'MEXIDO', null, null, 99, null) as r`, [PE]],
    ['apagar',   `select public.vessel_private_edit_apagar($1) as r`, [PE]],
    ['arquivar', `select public.vessel_private_edit_arquivar($1, true) as r`, [PE]],
  ]) {
    const { r } = await uma(chamada, args)
    if (r.ok !== false) throw new Error(`${nome}: quem so ve passou (ok=${JSON.stringify(r.ok)})`)
    if (r.situacao !== 'sem_permissao') throw new Error(`${nome}: quem so ve recusado por outro motivo: ${JSON.stringify(r)}`)
  }
  // ⚠️ E RECUSAR NAO BASTA: recusar SEM TER MEXIDO e o que se prova aqui. Uma
  // funcao que escrevesse e so depois devolvesse `sem_permissao` passaria
  // pelas tres asercoes de cima.
  const depoisDeVer = await linha()
  if (depoisDeVer === undefined) throw new Error('quem so ve apagou o encontro')
  if (JSON.stringify(antesDeVer) !== JSON.stringify(depoisDeVer))
    throw new Error(`quem so ve mexeu na linha: ${JSON.stringify(antesDeVer)} -> ${JSON.stringify(depoisDeVer)}`)

  // ── 4b. QUEM PODE EDITAR, EDITA ─────────────────────────────────────────
  await falarComo(mexe)

  // Nulo = "nao mexe neste campo", nunca "apaga o que estava la".
  const { r: ed1 } = await uma(
    `select public.vessel_private_edit_editar($1, null, null, null, null, 12, null) as r`, [PE])
  if (ed1.ok !== true) throw new Error(`editar recusou quem pode: ${JSON.stringify(ed1)}`)
  if (ed1.situacao !== 'ok') throw new Error(`editar respondeu ${JSON.stringify(ed1)}`)
  const d1 = await linha()
  if (d1.vagas !== 12) throw new Error(`as vagas nao mudaram: ${JSON.stringify(d1)}`)
  // ⚠️ AS DUAS METADES DO `coalesce`: nao basta o campo passado ter mudado, os
  // NAO passados tem de continuar iguais. Um `set local = p_local` sem
  // `coalesce` apagaria o local a cada edicao de vagas — e ninguem veria isso
  // olhando so para as vagas.
  if (d1.local !== 'Piso L3') throw new Error(`o local foi apagado por um nulo: ${JSON.stringify(d1)}`)
  if (d1.praca !== 'CPS') throw new Error(`a praca foi apagada por um nulo: ${JSON.stringify(d1)}`)
  if (d1.loja !== 'iguatemi') throw new Error(`a loja foi apagada por um nulo: ${JSON.stringify(d1)}`)
  if (d1.stylist_id !== sty) throw new Error(`a stylist foi apagada por um nulo: ${JSON.stringify(d1)}`)
  if (d1.quando === null) throw new Error(`o quando foi apagado por um nulo: ${JSON.stringify(d1)}`)

  // ⚠️ `codigo` e `chave` NAO SE MEXEM — nem por dentro, sem querer. A `chave`
  // esta em todo convite JA ENVIADO e o `codigo` e o identificador do CRM.
  if (d1.codigo !== PE) throw new Error(`o codigo mudou: ${JSON.stringify(d1)}`)
  if (d1.chave !== 'YYYYYYYY') throw new Error(`a chave mudou: ${JSON.stringify(d1)}`)

  // A stylist entra pelo CODIGO dela, nao pelo id.
  const { r: ed2 } = await uma(
    `select public.vessel_private_edit_editar($1, null, null, null, null, null, 'STY-9997') as r`, [PE])
  if (ed2.ok !== true) throw new Error(`trocar a stylist falhou: ${JSON.stringify(ed2)}`)
  if ((await linha()).stylist_id !== sty2) throw new Error('a stylist nao trocou')

  // Stylist que nao existe nao vira nulo calado: vira recusa com nome.
  const { r: ed3 } = await uma(
    `select public.vessel_private_edit_editar($1, null, null, null, null, null, 'STY-NAO-EXISTE') as r`, [PE])
  if (ed3.ok !== false) throw new Error(`stylist inexistente passou: ${JSON.stringify(ed3)}`)
  if (ed3.situacao !== 'stylist_nao_achei') throw new Error(`stylist inexistente: ${JSON.stringify(ed3)}`)
  if ((await linha()).stylist_id !== sty2) throw new Error('a stylist inexistente ainda assim mexeu na linha')

  // Encontro que nao existe: `nao_achei`, e nao um `ok` sobre zero linhas.
  for (const [nome, chamada] of [
    ['editar',   `select public.vessel_private_edit_editar($1, null, null, null, null, 1, null) as r`],
    ['apagar',   `select public.vessel_private_edit_apagar($1) as r`],
    ['arquivar', `select public.vessel_private_edit_arquivar($1, true) as r`],
  ]) {
    const { r } = await uma(chamada, [PE_SUMIU])
    if (r.ok !== false) throw new Error(`${nome} disse ok sobre encontro que nao existe: ${JSON.stringify(r)}`)
    if (r.situacao !== 'nao_achei') throw new Error(`${nome} sobre inexistente: ${JSON.stringify(r)}`)
  }

  // ── 4c. ARQUIVAR E DESARQUIVAR ──────────────────────────────────────────
  // ⚠️ ARQUIVAR TEM DE TER VOLTA. Uma linha que some para sempre nunca mais
  // pode ser desarquivada, e o botao de desarquivar viraria codigo morto.
  const { r: ar1 } = await uma(`select public.vessel_private_edit_arquivar($1, true) as r`, [PE])
  if (ar1.ok !== true) throw new Error(`arquivar recusou quem pode: ${JSON.stringify(ar1)}`)
  if (ar1.arquivada !== true) throw new Error(`arquivar nao devolveu arquivada=true: ${JSON.stringify(ar1)}`)
  if ((await linha()).arquivada !== true) throw new Error('arquivar nao gravou')

  const { r: ar2 } = await uma(`select public.vessel_private_edit_arquivar($1, false) as r`, [PE])
  if (ar2.ok !== true) throw new Error(`desarquivar recusou: ${JSON.stringify(ar2)}`)
  if (ar2.arquivada !== false) throw new Error(`desarquivar nao devolveu arquivada=false: ${JSON.stringify(ar2)}`)
  if ((await linha()).arquivada !== false) throw new Error('desarquivar nao gravou')

  // ⚠️ ARQUIVAR NAO E ENCERRAR: `ativa` nao pode ter sido tocada no caminho.
  if ((await linha()).ativa !== true) throw new Error('arquivar encerrou o encontro de tabela')

  // ── 4d. O CODIGO TORTO: minusculas e espaco na ponta ────────────────────
  // ⚠️ AS QUATRO ACOES MORAM NA MESMA TELA. A irma `vessel_private_edit_encerrar`
  // normaliza o codigo com `upper(nullif(trim(coalesce(p_codigo,'')),''))`; as
  // tres daqui copiam a MESMA expressao, na MESMA ordem. Sem isso, o mesmo
  // codigo faria o botao "Encerrar" funcionar e os outros tres responderem
  // `nao_achei` — e recusa pela metade a pessoa le como sistema quebrado, nao
  // como codigo errado.
  const PE_TORTO = `  ${PE.toLowerCase()}  `

  const { r: t1 } = await uma(`select public.vessel_private_edit_arquivar($1, true) as r`, [PE_TORTO])
  if (t1.ok !== true) throw new Error(`arquivar nao achou o codigo torto: ${JSON.stringify(t1)}`)
  if (t1.codigo !== PE) throw new Error(`arquivar devolveu o codigo sem normalizar: ${JSON.stringify(t1)}`)
  if ((await linha()).arquivada !== true) throw new Error('arquivar com codigo torto nao gravou')

  const { r: t2 } = await uma(`select public.vessel_private_edit_arquivar($1, false) as r`, [PE_TORTO])
  if (t2.ok !== true) throw new Error(`desarquivar nao achou o codigo torto: ${JSON.stringify(t2)}`)
  if ((await linha()).arquivada !== false) throw new Error('desarquivar com codigo torto nao gravou')

  const { r: t3 } = await uma(
    `select public.vessel_private_edit_editar($1, null, null, null, null, 7, null) as r`, [PE_TORTO])
  if (t3.ok !== true) throw new Error(`editar nao achou o codigo torto: ${JSON.stringify(t3)}`)
  if (t3.codigo !== PE) throw new Error(`editar devolveu o codigo sem normalizar: ${JSON.stringify(t3)}`)
  if ((await linha()).vagas !== 7) throw new Error('editar com codigo torto nao gravou')

  // ── 4e. APAGAR SO QUANDO NAO TEM NINGUEM PENDURADO ──────────────────────
  if (await temGente(PE) !== false) throw new Error('o encontro de prova ja nasceu com gente')

  const { id: pes } = await uma(
    `insert into public.vessel_pessoas (nome, telefone) values ('Convidada de prova','5519977777777') returning id`)
  await uma(
    `insert into public.vessel_atendimentos (pessoa_id, loja, origem_registro, evento_codigo, rsvp)
     values ($1,'iguatemi','private-edit',$2,'sim')`, [pes, PE])
  if (await temGente(PE) !== true) throw new Error('a convidada nao pendurou')

  // ⚠️ ESTE E O CASO QUE PRECISA QUEBRAR se a conferencia de convidadas sair
  // da funcao: com sessao de quem PODE editar, a unica coisa que separa `ok`
  // de `tem_gente` e aquele `exists`. Sem ele, o `delete` roda e a resposta
  // vira `ok` — e as tres asercoes abaixo caem, uma a uma.
  const antes = await quantasGente(PE)
  const { r: ap1 } = await uma(`select public.vessel_private_edit_apagar($1) as r`, [PE])
  if (ap1.ok !== false) throw new Error(`apagou encontro com gente: ${JSON.stringify(ap1)}`)
  if (ap1.situacao !== 'tem_gente') throw new Error(`recusa por outro motivo: ${JSON.stringify(ap1)}`)
  if ((await linha()) === undefined) throw new Error('o encontro com gente sumiu mesmo assim')
  // ⚠️ E A LINHA DA CONVIDADA TEM DE CONTINUAR LA: apagar o encontro deixaria
  // linhas ORFAS em vessel_atendimentos e a receita passaria a somar sobre um
  // encontro que nao existe mais.
  const depois = await quantasGente(PE)
  if (antes !== depois) throw new Error(`a tentativa de apagar mexeu nas convidadas: ${antes} -> ${depois}`)

  // ⚠️ E COM O CODIGO TORTO A RECUSA TEM DE SER A MESMA. Este caso mira a
  // fresta mais perigosa da normalizacao: se a conferencia de convidadas lesse
  // `p_codigo` cru enquanto o `delete` le o normalizado, este `apagar` nao
  // acharia ninguem pendurado, responderia `ok` e levaria embora um encontro
  // COM GENTE — deixando linhas orfas em vessel_atendimentos.
  const { r: ap1t } = await uma(`select public.vessel_private_edit_apagar($1) as r`, [PE_TORTO])
  if (ap1t.situacao !== 'tem_gente')
    throw new Error(`codigo torto furou a conferencia de convidadas: ${JSON.stringify(ap1t)}`)
  if ((await linha()) === undefined) throw new Error('o encontro com gente sumiu pelo codigo torto')
  if ((await quantasGente(PE)) !== antes) throw new Error('o codigo torto mexeu nas convidadas')

  // Sem ninguem pendurado, apaga.
  await uma(`delete from public.vessel_atendimentos where evento_codigo = $1`, [PE])
  if (await temGente(PE) !== false) throw new Error('a convidada nao saiu para o proximo caso')
  // ⚠️ E VAI PELO CODIGO TORTO de proposito: se o `exists` normalizasse e o
  // `delete` lesse o cru, a resposta seria `ok` e a linha CONTINUARIA LA — um
  // "apaguei" que nao apagou nada, que so a ultima asercao abaixo denuncia.
  const { r: ap2 } = await uma(`select public.vessel_private_edit_apagar($1) as r`, [PE_TORTO])
  if (ap2.ok !== true) throw new Error(`apagar recusou encontro vazio: ${JSON.stringify(ap2)}`)
  if (ap2.situacao !== 'ok') throw new Error(`apagar vazio respondeu: ${JSON.stringify(ap2)}`)
  if (ap2.codigo !== PE) throw new Error(`apagar devolveu o codigo sem normalizar: ${JSON.stringify(ap2)}`)
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

  // E NENHUMA LINHA DE PROVA PODE TER ESCAPADO DO SAVEPOINT.
  // ⚠️ Procura-se pela MARCA de cada linha inventada aqui, nao por "a tabela
  // esta vazia". Hoje as quatro tabelas tem zero linhas, mas amanha terao
  // linhas de verdade — e uma conferencia escrita como `count(*) = 0`
  // comecaria a reprovar migration correta no dia em que o Comercial Vessel
  // entrasse em uso.
  const sobrou = await uma(
    `select (select count(*) from public.vessel_private_edits where codigo in ($1,$2))::int as pe,
            (select count(*) from public.vessel_stylists where codigo in ('STY-9998','STY-9997'))::int as sty,
            (select count(*) from public.vessel_pessoas where telefone = '5519977777777')::int as pes,
            (select count(*) from public.vessel_atendimentos where evento_codigo in ($1,$2))::int as at,
            (select count(*) from public.profiles where email like 'prova-private-edit-mexer-%')::int as perfis,
            (select count(*) from auth.users where email like 'prova-private-edit-mexer-%')::int as contas`,
    [PE, PE_SUMIU])
  for (const [onde, n] of Object.entries(sobrou))
    if (n !== 0) throw new Error(`sobrou dado de prova em ${onde}: ${n} linha(s)`)

  await cli.query('commit')
  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback')
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
