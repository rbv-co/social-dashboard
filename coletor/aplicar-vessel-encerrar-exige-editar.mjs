// APLICA, REGISTRA e PROVA que ENCERRAR passou a exigir a trava de EDITAR.
//
// ⚠️ TUDO NUMA TRANSACAO SO: aplicar, registrar, provar e so entao `commit`.
// DDL no Postgres e transacional — nao existe um instante em que a tela de
// alguem encontre uma funcao pela metade.
//
// ⚠️⚠️ `vessel_beauty_sessions` TEM DADO DE VERDADE: as tres sessoes do
// negocio, com QR ja impresso e na mao de cliente. Esta prova fabrica a
// PROPRIA sessao e o PROPRIO encontro e so mexe neles; tira uma IMPRESSAO
// campo a campo das linhas de verdade ANTES de escrever qualquer coisa e exige
// que ela volte identica depois do `rollback to savepoint` E DE NOVO depois do
// `commit`, numa conexao nova. Uma prova que so contasse "sao tres linhas" nao
// pegaria uma sessao encerrada no lugar de outra — e ENCERRAR e exatamente o
// que este arquivo exercita.
//
// ⚠️ ESTA PROVA NAO TROCA NENHUM PORTAO POR `select true`. O caminho e o das
// irmas: FABRICAR SESSAO DE VERDADE com `set_config('request.jwt.claims', ...)`,
// que e de onde `auth.uid()` le quem e. Assim as duas funcoes rodam com a
// TRAVA LIGADA, do jeito que a Central vai chamar — e nao ha um instante
// sequer em que `is_vessel_atendimentos()` (o `using` do RLS de SEIS tabelas)
// esteja aberto.
//
// ⚠️ A PROVA TEM DE PROVAR A MUDANCA, NAO SO O ESTADO FINAL. Um perfil que so
// tem `ver` recusado hoje nao diz nada sozinho: ele seria recusado igual se a
// funcao ja fosse assim. Por isso o bloco "ANTES" recoloca, DENTRO de um
// savepoint proprio, a definicao VELHA lida do banco com `pg_get_functiondef`
// antes de qualquer DDL — e exige que o MESMO perfil receba `ok` la. E a
// diferenca entre as duas respostas que mede o que esta migration fez.
//
// ⚠️ MUTANTES, E TODOS DENTRO DE SAVEPOINT. Nao existe `commit` em nenhum
// caminho deste arquivo alem do unico `commit` final, e cada mutante vive
// entre um `savepoint` e o `rollback to savepoint` correspondente — inclusive
// quando o caso passa, porque o `rollback` fica no `finally`.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { conferirQueOPortaoVoltou } from './lib/o-portao-dos-atendimentos.mjs'

const ARQUIVO = '2026-09-19-vessel-encerrar-exige-editar.sql'

const PE_F = 'public.vessel_private_edit_encerrar(text, boolean)'
const BS_F = 'public.vessel_beauty_session_encerrar(text, boolean)'

const PE = 'PE-20260919-ENCERRAR-01'      // o encontro INVENTADO por esta prova
const BS = 'BS-20260919-ENCERRAR-01'      // a sessao INVENTADA por esta prova
const SUMIU = 'XX-20260919-NAOEXISTE'

const ERRO_PE = 'Você não tem a permissão de Atendimentos para mexer nos encontros.'
const ERRO_BS = 'Você não tem a permissão de Atendimentos para mexer nas sessões.'

// ⚠️ A IMPRESSAO DAS SESSOES DE VERDADE, campo a campo e em ordem fixa. Nao e
// `count(*)`: encerrar uma sessao impressa em QR deixaria a contagem igual e a
// impressao diferente — e `ativa` esta ai dentro de proposito.
const IMPRESSAO = `
  select count(*)::int as quantas,
         coalesce(string_agg(
           t.codigo || '|' || coalesce(t.quando::text, '~') || '|' ||
           coalesce(t.praca, '~') || '|' || t.loja || '|' ||
           coalesce(t.parceiro, '~') || '|' || t.ativa::text || '|' ||
           t.arquivada::text || '|' || t.criado_em::text,
           E'\\n' order by t.codigo), '') as impressao
    from public.vessel_beauty_sessions t`

// A mesma ideia para os encontros — que hoje sao ZERO, mas a impressao nao
// depende disso: ela compara o que havia com o que sobrou, seja qual for.
const IMPRESSAO_PE = `
  select count(*)::int as quantas,
         coalesce(string_agg(
           t.codigo || '|' || t.quando::text || '|' || t.ativa::text || '|' ||
           t.arquivada::text, E'\\n' order by t.codigo), '') as impressao
    from public.vessel_private_edits t`

const DEFINICOES = `
  select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('vessel_private_edit_encerrar', 'vessel_beauty_session_encerrar')`

const PORTAS = `
  select has_function_privilege('authenticated', $1, 'EXECUTE') as autenticado,
         has_function_privilege('anon', $1, 'EXECUTE') as anon,
         has_function_privilege('public', $1, 'EXECUTE') as qualquer_um,
         has_function_privilege('service_role', $1, 'EXECUTE') as service_role`

/**
 * O diff de duas definicoes, LINHA A LINHA e alinhado pela posicao.
 *
 * ⚠️ NAO E UM DIFF ESPERTO DE PROPOSITO. Alinhar por posicao so funciona se o
 * numero de linhas nao mudou — e e exatamente isso que esta migration promete:
 * uma linha trocada por outra, nada inserido e nada removido. Se alguem
 * acrescentar ou apagar uma linha, o alinhamento estoura e TODAS as linhas
 * dali para baixo aparecem como diferentes. A asercao de "exatamente 1 linha"
 * quebra, que e o desfecho certo.
 */
function diffDeLinhas(antes, depois) {
  const a = antes.split('\n'), d = depois.split('\n')
  const saida = []
  for (let i = 0; i < Math.max(a.length, d.length); i++)
    if (a[i] !== d[i]) saida.push({ linha: i + 1, antes: a[i], depois: d[i] })
  return saida
}

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
  const todas = async (s, a = []) => (await cli.query(s, a)).rows

  // ── 0. COMO O BANCO ESTA AGORA, ANTES DE QUALQUER DDL ────────────────────

  // 0a. As sessoes e os encontros de verdade.
  const bsAntes = await uma(IMPRESSAO)
  if (bsAntes.quantas < 1)
    throw new Error('vessel_beauty_sessions veio vazia: a impressao nao provaria nada')
  const peAntes = await uma(IMPRESSAO_PE)

  // 0b. AS DEFINICOES VELHAS, lidas do BANCO e nao do repositorio.
  // ⚠️ VARIAS MIGRATIONS DEFINEM ESTES DOIS NOMES e a mais nova e que vale. Um
  // `grep` em `db/migrations/*.sql` responderia com a primeira que aparecesse —
  // que pode ser uma versao que nao esta no ar ha semanas. Quem sabe o que esta
  // rodando e `pg_get_functiondef`.
  const defAntes = Object.fromEntries((await todas(DEFINICOES)).map(r => [r.proname, r.def]))
  for (const nome of ['vessel_private_edit_encerrar', 'vessel_beauty_session_encerrar']) {
    if (!defAntes[nome]) throw new Error(`${nome} nao existe no banco: nada a apertar`)
    if (!defAntes[nome].includes('public.is_vessel_atendimentos()'))
      throw new Error(`${nome} ja nao chama a trava de ver — o alvo desta migration mudou:\n${defAntes[nome]}`)
  }

  // 0c. AS PORTAS COMO ESTAO HOJE. Esta migration NAO mexe nelas — nem aperta
  // nem afrouxa. Sao guardadas aqui para exigir, depois, que sejam as MESMAS.
  const portasAntes = {}
  for (const f of [PE_F, BS_F]) portasAntes[f] = await uma(PORTAS, [f])

  // 0d. ⚠️ A MEDIDA QUE AUTORIZA APERTAR. Apertar um portao so e seguro se
  // ninguem estiver passando pelo frouxo. Isto e MEDIDO aqui, na hora, e nao
  // copiado de uma medicao de ontem: se alguem tiver ganho a permissao de VER
  // sem a de EDITAR entre a medicao e este `node`, este arquivo PARA — porque
  // ai o aperto tiraria da pessoa uma coisa que ela usa.
  const conta = await uma(`
    select count(*)::int as perfis,
           count(*) filter (where p.features @> array['atendimentos'])::int as com_ver_por_features,
           count(*) filter (where coalesce((p.permissions -> 'atendimentos') ? 'editar', false))::int as com_editar,
           count(*) filter (where p.is_superadmin)::int as superadmins,
           count(*) filter (where p.features @> array['atendimentos']
                              and not coalesce((p.permissions -> 'atendimentos') ? 'editar', false)
                              and not p.is_superadmin)::int as perderiam_acesso
      from public.profiles p`)
  console.log(`   perfis: ${conta.perfis} | com atendimentos em features: ${conta.com_ver_por_features}` +
              ` | com editar em permissions: ${conta.com_editar} | superadmins: ${conta.superadmins}`)
  if (conta.perderiam_acesso !== 0)
    throw new Error(
      `PARANDO: ${conta.perderiam_acesso} perfil(s) hoje passam pela trava de VER e NAO pela de EDITAR. ` +
      'Apertar ENCERRAR agora TIRARIA acesso de gente que o usa. Falar com o dono antes.')

  // ── 1. APLICAR E REGISTRAR ───────────────────────────────────────────────
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-encerrar-exige-editar.mjs'])

  // ── 2. SO A LINHA DO PORTAO MUDOU ────────────────────────────────────────
  // ⚠️ ESTA E A ASERCAO CENTRAL DE UMA MIGRATION DE SEGURANCA. Um `create or
  // replace` reescreve a funcao INTEIRA: sem este diff, uma normalizacao
  // perdida, um `coalesce` a menos ou uma mensagem reescrita entrariam de
  // carona com a mudanca de portao — e nenhuma prova de permissao veria.
  const defDepois = Object.fromEntries((await todas(DEFINICOES)).map(r => [r.proname, r.def]))
  console.log('   ── diff das definicoes (banco antes -> banco depois) ──')
  for (const nome of ['vessel_private_edit_encerrar', 'vessel_beauty_session_encerrar']) {
    const d = diffDeLinhas(defAntes[nome], defDepois[nome])
    for (const l of d) {
      console.log(`   ${nome} linha ${l.linha}`)
      console.log(`     - ${l.antes}`)
      console.log(`     + ${l.depois}`)
    }
    if (d.length !== 1)
      throw new Error(`${nome}: ${d.length} linha(s) mudaram, e so uma podia:\n${JSON.stringify(d, null, 2)}`)
    if (!d[0].antes.includes('public.is_vessel_atendimentos()'))
      throw new Error(`${nome}: a linha que mudou nao era a da trava de ver: ${d[0].antes}`)
    if (!d[0].depois.includes('public.is_vessel_atendimentos_editar()'))
      throw new Error(`${nome}: a linha nova nao chama a trava de editar: ${d[0].depois}`)
    // ⚠️ E `_editar` NAO PODE TER SOBRADO A DE VER NA MESMA LINHA: o nome da
    // trava de ver e PREFIXO do nome da de editar, entao um `includes` sozinho
    // aprovaria `is_vessel_atendimentos() and is_vessel_atendimentos_editar()`.
    if (/is_vessel_atendimentos\(\)/.test(d[0].depois))
      throw new Error(`${nome}: a trava de ver ficou na linha nova: ${d[0].depois}`)
  }

  // ── 3. UMA SO DE CADA, com a assinatura combinada ────────────────────────
  // ⚠️ `create or replace` NAO troca uma funcao por outra de assinatura
  // diferente: cria uma SEGUNDA, sobrecarregada. Com duas no banco, a chamada
  // da tela morreria com "function is not unique" — DEPOIS do deploy, na mao
  // do usuario.
  for (const nome of ['vessel_private_edit_encerrar', 'vessel_beauty_session_encerrar']) {
    const { quantas, assinaturas } = await uma(
      `select count(*)::int as quantas,
              string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as assinaturas
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    if (quantas !== 1) throw new Error(`${nome} ficou com ${quantas} versoes: ${assinaturas}`)
    if (!assinaturas.endsWith('(text,boolean)'))
      throw new Error(`${nome} nao ficou com (text,boolean): ${assinaturas}`)
  }

  // ── 4. A PORTA CONTINUA A MESMA ──────────────────────────────────────────
  // ⚠️ ESTA MIGRATION APERTA O PORTAO DE DENTRO DA FUNCAO, NAO A PORTA DE FORA.
  // Trocar a porta de carona seria mudar duas coisas com uma prova so — e a
  // porta aqui tambem nao pode ter AFROUXADO: `revoke ... from public` nao
  // fecha `authenticated`, e uma funcao recriada nasce aberta para `public`,
  // ou seja, para `anon`, que e quem abre a pagina do QR.
  for (const f of [PE_F, BS_F]) {
    const agora = await uma(PORTAS, [f])
    if (JSON.stringify(agora) !== JSON.stringify(portasAntes[f]))
      throw new Error(`a porta de ${f} mudou: ${JSON.stringify(portasAntes[f])} -> ${JSON.stringify(agora)}`)
    if (agora.autenticado !== true) throw new Error(`a Central nao consegue usar ${f}`)
    if (agora.anon !== false || agora.qualquer_um !== false)
      throw new Error(`${f}: porta aberta para a pagina publica: ${JSON.stringify(agora)}`)
  }

  await cli.query('savepoint prova')

  // ── 5. SEM SESSAO NENHUMA, NADA. `auth.uid()` e nulo aqui ────────────────
  for (const [nome, chamada] of [
    ['private edit',   `select public.vessel_private_edit_encerrar('PE-X', false) as r`],
    ['beauty session', `select public.vessel_beauty_session_encerrar('BS-X', false) as r`],
  ]) {
    const { r } = await uma(chamada)
    // ⚠️ `if (r.ok)` NAO BASTA: `pg` devolve SQL NULL como `null`, que e falsy
    // em JavaScript — um `ok` nulo passaria batido por um `if` solto, do mesmo
    // jeito que passa um `false`. As comparacoes sao estritas de proposito.
    if (r.ok !== false) throw new Error(`${nome}: passou quem nao tem sessao (ok=${JSON.stringify(r.ok)})`)
  }

  // ── 6. PERFIS DE MENTIRA E SESSAO DE VERDADE ─────────────────────────────
  // ⚠️ `profiles.id` tem FK para `auth.users(id)` e `profiles.email` e NOT NULL
  // sem default: por isso cada perfil de mentira nasce em DOIS inserts. Nada
  // disto sobrevive ao `rollback to savepoint prova`.
  const perfil = async (features, permissions) => {
    const id = randomUUID()
    const email = `prova-encerrar-exige-editar-${id}@teste.invalido`
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

  // ⚠️ O ENCONTRO E A SESSAO DA PROVA SAO INVENTADOS AQUI, E SO NELES SE MEXE.
  // Nenhuma das tres sessoes de verdade e citada em lugar nenhum deste arquivo.
  const { id: sty } = await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp)
     values ('STY-9996','Prova Encerrar','5519988888886') returning id`)
  await uma(
    `insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, local, praca, loja, vagas)
     values ($1,'ZZZZZZZZ',$2, now() + interval '9 days','Piso L3','CPS','iguatemi',8)`, [PE, sty])
  await uma(
    `insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro)
     values ($1, date '2027-08-11', 'SBO', 'tivoli', 'Salao da Prova')`, [BS])

  const ativaPE = async () => (await uma(
    `select ativa from public.vessel_private_edits where codigo = $1`, [PE])).ativa
  const ativaBS = async () => (await uma(
    `select ativa from public.vessel_beauty_sessions where codigo = $1`, [BS])).ativa

  /**
   * A ASERCAO QUE ESTA MIGRATION EXISTE PARA FAZER PASSAR: quem so VE nao
   * encerra nada, e nao encerra SEM TER MEXIDO.
   *
   * ⚠️ E UMA FUNCAO, e nao codigo solto, porque os mutantes la embaixo
   * precisam roda-la de novo com a funcao estragada e exigir que ela QUEBRE.
   * Uma asercao que nunca viu um erro nao e uma asercao, e um enfeite.
   */
  const soVeNaoEncerra = async () => {
    await falarComo(so_ve)
    const antesPE = await ativaPE(), antesBS = await ativaBS()
    for (const [nome, chamada, cod, erro] of [
      ['private edit',   `select public.vessel_private_edit_encerrar($1, false) as r`,   PE, ERRO_PE],
      ['beauty session', `select public.vessel_beauty_session_encerrar($1, false) as r`, BS, ERRO_BS],
    ]) {
      const { r } = await uma(chamada, [cod])
      if (r.ok !== false)
        throw new Error(`${nome}: quem so ve ENCERROU (ok=${JSON.stringify(r.ok)}, r=${JSON.stringify(r)})`)
      if (r.erro !== erro)
        throw new Error(`${nome}: recusou por outro motivo: ${JSON.stringify(r)}`)
    }
    // ⚠️ E RECUSAR NAO BASTA: recusar SEM TER ESCRITO e o que se prova aqui.
    // Uma funcao que gravasse `ativa` e so depois devolvesse a recusa passaria
    // pelas quatro asercoes de cima.
    if (await ativaPE() !== antesPE) throw new Error('quem so ve mexeu no `ativa` do encontro')
    if (await ativaBS() !== antesBS) throw new Error('quem so ve mexeu no `ativa` da sessao')
  }

  // ── 7. O ANTES: COM A DEFINICAO VELHA, O MESMO PERFIL ENCERRAVA ──────────
  // ⚠️ SEM ESTE BLOCO A PROVA NAO PROVA A MUDANCA. "Quem so ve e recusado" e
  // verdade tambem num banco onde nada foi apertado. O que separa os dois
  // mundos e o `ok` que o MESMO perfil recebia da definicao VELHA — que e
  // recolocada aqui, dentro de um savepoint proprio, a partir do
  // `pg_get_functiondef` capturado la em cima, antes de qualquer DDL.
  await cli.query('savepoint antes')
  try {
    await cli.query(defAntes.vessel_private_edit_encerrar)
    await cli.query(defAntes.vessel_beauty_session_encerrar)
    await falarComo(so_ve)
    for (const [nome, chamada, cod] of [
      ['private edit',   `select public.vessel_private_edit_encerrar($1, false) as r`,   PE],
      ['beauty session', `select public.vessel_beauty_session_encerrar($1, false) as r`, BS],
    ]) {
      const { r } = await uma(chamada, [cod])
      if (r.ok !== true)
        throw new Error(`o ANTES nao se confirmou: ${nome} ja recusava quem so ve: ${JSON.stringify(r)}`)
      console.log(`   ANTES  ${nome}: quem so tem \`ver\` recebia ${JSON.stringify(r)}`)
    }
    if (await ativaPE() !== false) throw new Error('o ANTES: o encontro nao foi encerrado de verdade')
    if (await ativaBS() !== false) throw new Error('o ANTES: a sessao nao foi encerrada de verdade')
  } finally {
    // ⚠️ O `rollback` NO `finally` desfaz DUAS coisas de uma vez: as definicoes
    // velhas e o `ativa` que elas gravaram. Nao ha caminho de saida deste
    // bloco que deixe a funcao velha no ar.
    await cli.query('rollback to savepoint antes')
  }

  // ⚠️ E A DEFINICAO NOVA TEM DE TER VOLTADO. Sem esta linha, um `rollback`
  // que nao pegasse deixaria todo o resto do arquivo provando a funcao VELHA.
  const { volta } = await uma(
    `select pg_get_functiondef(p.oid) like '%is_vessel_atendimentos_editar()%' as volta
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'vessel_beauty_session_encerrar'`)
  if (volta !== true) throw new Error('o rollback do bloco ANTES nao devolveu a definicao nova')

  // ── 8. O DEPOIS: O MESMO PERFIL, AGORA RECUSADO ──────────────────────────
  await soVeNaoEncerra()
  console.log('   DEPOIS quem so tem `ver` recebe recusa nas duas, sem escrever')

  // ── 9. E QUEM PODE EDITAR CONTINUA ENCERRANDO E REABRINDO ────────────────
  // ⚠️ APERTAR SEM PROVAR O CAMINHO QUE FUNCIONA e trocar um buraco por uma
  // tela quebrada. E encerrar TEM DE TER VOLTA: sem reabrir, um clique errado
  // mataria o QR impresso para sempre.
  await falarComo(mexe)
  for (const [nome, fechar, abrir, ativa, cod] of [
    ['private edit',
      `select public.vessel_private_edit_encerrar($1, false) as r`,
      `select public.vessel_private_edit_encerrar($1, true) as r`, ativaPE, PE],
    ['beauty session',
      `select public.vessel_beauty_session_encerrar($1, false) as r`,
      `select public.vessel_beauty_session_encerrar($1, true) as r`, ativaBS, BS],
  ]) {
    const { r: f } = await uma(fechar, [cod])
    if (f.ok !== true) throw new Error(`${nome}: quem pode editar foi recusado ao encerrar: ${JSON.stringify(f)}`)
    if (f.ativa !== false) throw new Error(`${nome}: encerrar nao devolveu ativa=false: ${JSON.stringify(f)}`)
    if (f.codigo !== cod) throw new Error(`${nome}: encerrar devolveu outro codigo: ${JSON.stringify(f)}`)
    if (await ativa() !== false) throw new Error(`${nome}: encerrar nao gravou`)

    const { r: a } = await uma(abrir, [cod])
    if (a.ok !== true) throw new Error(`${nome}: quem pode editar foi recusado ao reabrir: ${JSON.stringify(a)}`)
    if (a.ativa !== true) throw new Error(`${nome}: reabrir nao devolveu ativa=true: ${JSON.stringify(a)}`)
    if (await ativa() !== true) throw new Error(`${nome}: reabrir nao gravou`)
  }

  // ⚠️ E O CODIGO TORTO CONTINUA ACHANDO. A normalizacao
  // `upper(nullif(trim(coalesce(p_codigo,'')),''))` nao podia ter ido embora
  // junto com a troca do portao — as quatro acoes moram na MESMA TELA e um
  // codigo em minusculas que faz tres funcionarem e uma responder "nao achei"
  // a pessoa le como sistema quebrado.
  const { r: torto } = await uma(
    `select public.vessel_beauty_session_encerrar($1, false) as r`, [`  ${BS.toLowerCase()}  `])
  if (torto.ok !== true) throw new Error(`o codigo torto deixou de ser achado: ${JSON.stringify(torto)}`)
  if (torto.codigo !== BS) throw new Error(`encerrar devolveu o codigo sem normalizar: ${JSON.stringify(torto)}`)
  if (await ativaBS() !== false) throw new Error('encerrar com codigo torto nao gravou')
  await uma(`select public.vessel_beauty_session_encerrar($1, true) as r`, [BS])

  // Codigo que nao existe: recusa por NAO ACHEI, nao por permissao.
  // ⚠️ `update` que nao acha nada NAO levanta erro no Postgres.
  for (const [nome, chamada, erroDePermissao] of [
    ['private edit',   `select public.vessel_private_edit_encerrar($1, false) as r`,   ERRO_PE],
    ['beauty session', `select public.vessel_beauty_session_encerrar($1, false) as r`, ERRO_BS],
  ]) {
    const { r } = await uma(chamada, [SUMIU])
    if (r.ok !== false) throw new Error(`${nome} disse ok sobre codigo que nao existe: ${JSON.stringify(r)}`)
    if (r.erro === erroDePermissao)
      throw new Error(`${nome}: quem PODE editar levou recusa de permissao: ${JSON.stringify(r)}`)
  }

  // ── 10. MUTANTES ────────────────────────────────────────────────────────
  // ⚠️ CADA UM DENTRO DO SEU `savepoint`, com o `rollback` no `finally` —
  // inclusive quando o caso PASSA. Nao existe `commit` neste bloco.
  const falhasMutantes = []
  const mutante = async (caso, ddl) => {
    await cli.query('savepoint mutante')
    try {
      await cli.query(ddl)
      await soVeNaoEncerra()
      falhasMutantes.push(caso)
      console.log(`   ✘ mutante "${caso}": a prova PASSOU com a funcao estragada`)
    } catch (e) {
      console.log(`   ✔ mutante "${caso}": a prova reprovou — "${e.message.slice(0, 140)}"`)
    } finally {
      await cli.query('rollback to savepoint mutante')
      await falarComo(mexe)
    }
  }

  // Mutante 1 e 2: a linha exata que esta migration trocou, destrocada. E o
  // erro mais provavel num refactor futuro, porque a definicao velha esta no
  // historico do git e num arquivo de migration ao lado.
  await mutante('beauty session volta a chamar a trava de VER',
    defAntes.vessel_beauty_session_encerrar)
  await mutante('private edit volta a chamar a trava de VER',
    defAntes.vessel_private_edit_encerrar)

  // Mutante 3: portao CERTO, mas o `update` antes dele. A resposta continua
  // sendo a recusa esperada, palavra por palavra — e o dado muda mesmo assim.
  // ⚠️ E O MUTANTE QUE JUSTIFICA a metade final de `soVeNaoEncerra()`: sem a
  // conferencia de que `ativa` nao mudou, este passaria batido.
  await mutante('portao certo, mas grava ANTES de recusar', `
    create or replace function public.vessel_beauty_session_encerrar(
      p_codigo text, p_ativa boolean default false
    ) returns json language plpgsql security definer set search_path to 'public'
    as $mut$
    declare v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
    begin
      update public.vessel_beauty_sessions set ativa = coalesce(p_ativa, false)
       where codigo = v_codigo;
      if not public.is_vessel_atendimentos_editar() then
        return json_build_object('ok', false, 'erro',
          'Você não tem a permissão de Atendimentos para mexer nas sessões.');
      end if;
      return json_build_object('ok', true, 'codigo', v_codigo, 'ativa', coalesce(p_ativa, false));
    end;
    $mut$`)

  if (falhasMutantes.length)
    throw new Error(`a prova nao reprovou ${falhasMutantes.length} mutante(s): ${falhasMutantes.join(' | ')}`)

  // ── 11. NADA DISSO FICA ─────────────────────────────────────────────────
  await falarComo(null)
  await cli.query('rollback to savepoint prova')

  // ⚠️ DEPOIS DO ROLLBACK, ANTES DO COMMIT e antes de qualquer linha de
  // sucesso: a sessao de mentira tem de ter ido embora junto.
  const { u } = await uma(`select auth.uid() as u`)
  if (u !== null) throw new Error(`a sessao de mentira sobreviveu ao rollback: ${u}`)

  // ⚠️ E OS DOIS PORTOES CONTINUAM INTEIROS. Esta prova nao troca nenhum por
  // `select true` em momento nenhum — mas a conferencia fica, porque e barata e
  // porque o dia em que alguem trouxer um stub para dentro deste arquivo ela e
  // quem avisa, antes do commit. O de ver e o `using` do RLS de SEIS tabelas;
  // o de editar e, a partir desta migration, o unico portao de ENCERRAR.
  await conferirQueOPortaoVoltou(cli)

  // ⚠️⚠️ E OS DADOS DE VERDADE VOLTARAM IDENTICOS, campo a campo.
  const bsDepois = await uma(IMPRESSAO)
  if (bsDepois.quantas !== bsAntes.quantas)
    throw new Error(`o numero de Beauty Sessions mudou: ${bsAntes.quantas} -> ${bsDepois.quantas}`)
  if (bsDepois.impressao !== bsAntes.impressao)
    throw new Error(`as Beauty Sessions NAO voltaram como estavam:\nANTES\n${bsAntes.impressao}\nDEPOIS\n${bsDepois.impressao}`)
  const peDepois = await uma(IMPRESSAO_PE)
  if (peDepois.quantas !== peAntes.quantas || peDepois.impressao !== peAntes.impressao)
    throw new Error(`os Private Edits nao voltaram como estavam: ${peAntes.quantas} -> ${peDepois.quantas}`)

  // E NENHUMA LINHA DE PROVA PODE TER ESCAPADO DO SAVEPOINT.
  // ⚠️ Procura-se pela MARCA de cada linha inventada aqui, nao por "a tabela
  // esta vazia": `vessel_beauty_sessions` TEM linhas de verdade. Uma
  // conferencia escrita como `count(*) = 0` reprovaria migration correta.
  const sobrou = await uma(
    `select (select count(*) from public.vessel_beauty_sessions where codigo in ($1,$2))::int as sessoes,
            (select count(*) from public.vessel_private_edits where codigo in ($1,$2))::int as encontros,
            (select count(*) from public.vessel_stylists where codigo = 'STY-9996')::int as stylists,
            (select count(*) from public.profiles where email like 'prova-encerrar-exige-editar-%')::int as perfis,
            (select count(*) from auth.users where email like 'prova-encerrar-exige-editar-%')::int as contas`,
    [BS, PE])
  for (const [onde, n] of Object.entries(sobrou))
    if (n !== 0) throw new Error(`sobrou dado de prova em ${onde}: ${n} linha(s)`)

  await cli.query('commit')

  // ── 12. E DE NOVO, DEPOIS DO COMMIT, NUMA CONEXAO NOVA ──────────────────
  // ⚠️ UM `COMMIT` DEPOIS DE ERRO VIRA `ROLLBACK` CALADO, e o script imprime
  // sucesso do mesmo jeito. Conferir na mesma conexao tambem nao resolve: ela
  // pode estar num estado que a proxima nao tera.
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  try {
    const dela = async (s, a = []) => (await outra.query(s, a)).rows[0]

    const defsNoAr = Object.fromEntries((await outra.query(DEFINICOES)).rows.map(r => [r.proname, r.def]))
    for (const nome of ['vessel_private_edit_encerrar', 'vessel_beauty_session_encerrar']) {
      if (!defsNoAr[nome].includes('public.is_vessel_atendimentos_editar()'))
        throw new Error(`depois do commit, ${nome} NAO exige editar:\n${defsNoAr[nome]}`)
      if (/public\.is_vessel_atendimentos\(\)/.test(defsNoAr[nome]))
        throw new Error(`depois do commit, ${nome} ainda cita a trava de ver:\n${defsNoAr[nome]}`)
      if (defsNoAr[nome] !== defDepois[nome])
        throw new Error(`depois do commit, ${nome} nao e a definicao que foi provada`)
    }

    for (const f of [PE_F, BS_F]) {
      const p = await dela(PORTAS, [f])
      if (JSON.stringify(p) !== JSON.stringify(portasAntes[f]))
        throw new Error(`depois do commit, a porta de ${f} esta ${JSON.stringify(p)}`)
    }

    // ⚠️ OS PORTOES, DE NOVO, JA PUBLICADOS. Ultima chance de descobrir que
    // alguma coisa foi ao ar aberta.
    await conferirQueOPortaoVoltou(outra)

    // ⚠️⚠️ E AS SESSOES DE VERDADE, DEPOIS DE TUDO COMMITADO.
    const agora = await dela(IMPRESSAO)
    if (agora.impressao !== bsAntes.impressao)
      throw new Error(`depois do commit as Beauty Sessions estao diferentes:\nANTES\n${bsAntes.impressao}\nAGORA\n${agora.impressao}`)
    const agoraPE = await dela(IMPRESSAO_PE)
    if (agoraPE.quantas !== peAntes.quantas || agoraPE.impressao !== peAntes.impressao)
      throw new Error(`depois do commit os Private Edits estao diferentes: ${agoraPE.quantas}`)

    const { registrada } = await dela(
      `select exists (select 1 from public.schema_migrations where name = $1) as registrada`, [ARQUIVO])
    if (registrada !== true) throw new Error('a migration nao ficou registrada: o commit nao pegou')

    console.log(`   ${agora.quantas} Beauty Sessions de verdade, identicas as de antes da prova;` +
                ` ${agoraPE.quantas} Private Edit(s)`)
  } finally { await outra.end() }

  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
