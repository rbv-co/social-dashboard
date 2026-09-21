// APLICA, REGISTRA e PROVA que CRIAR passa a exigir a trava de EDITAR, e nao
// mais a de VER. B10 de docs/pendencias.md.
//
// ⚠️ TUDO NUMA TRANSACAO SO: aplicar, registrar, provar e so entao `commit`.
// DDL no Postgres e transacional — nao existe um instante em que a tela de
// alguem encontre uma funcao pela metade.
//
// ⚠️⚠️ `vessel_beauty_sessions` TEM DADO DE VERDADE: as tres sessoes do
// negocio, com QR ja impresso e na mao de cliente. `vessel_pedidos` e
// `vessel_pedido_itens` tambem tem dado de verdade (vendas reais). Esta
// migration NAO MEXE em nenhuma das duas — nao cria, nao edita, nao apaga
// sessao nenhuma real — mas a prova tira uma IMPRESSAO campo a campo da
// Beauty Sessions ANTES de escrever qualquer coisa e exige que ela volte
// identica depois do `rollback to savepoint` E DE NOVO depois do `commit`,
// numa conexao nova. `vessel_stylists`, `vessel_pessoas`, `vessel_atendimentos`
// e `vessel_private_edits` estao ZERADAS hoje; a prova exige que voltem a
// ZERO tambem.
//
// ⚠️ ESTA PROVA NAO TROCA NENHUM PORTAO POR `select true`. O caminho e o das
// irmas (`aplicar-vessel-encerrar-exige-editar.mjs`,
// `aplicar-vessel-beauty-session-mexer.mjs`): FABRICAR SESSAO DE VERDADE com
// `set_config('request.jwt.claims', ...)`, que e de onde `auth.uid()` le quem
// e. Assim as duas funcoes rodam com a TRAVA LIGADA, do jeito que a Central
// vai chamar — e nao ha um instante sequer em que `is_vessel_atendimentos()`
// (o `using` do RLS de SEIS tabelas) esteja aberto.
//
// ⚠️ A PROVA TEM DE PROVAR A MUDANCA, NAO SO O ESTADO FINAL. Um perfil que so
// tem `ver` recusado hoje nao diz nada sozinho: ele seria recusado igual se a
// funcao ja fosse assim. Por isso o bloco "ANTES" recoloca, DENTRO de um
// savepoint proprio, a definicao VELHA lida do banco com `pg_get_functiondef`
// antes de qualquer DDL — e exige que o MESMO perfil receba `ok` la, com a
// linha realmente gravada (lida de volta da tabela, nao so o JSON de volta).
// E a diferenca entre as duas respostas que mede o que esta migration fez.
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

const ARQUIVO = '2026-09-21-vessel-criar-exige-editar.sql'

const PE_F = 'public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean)'
const BS_F = 'public.vessel_beauty_session_criar(text, date, text, text, text)'

const STY = 'STY-9997'                    // stylist INVENTADA por esta prova

// ⚠️ A IMPRESSAO DAS SESSOES DE VERDADE, campo a campo e em ordem fixa. Nao e
// `count(*)`: uma sessao criada ou apagada por engano deixaria a contagem
// igual e a impressao diferente (ou vice-versa).
const IMPRESSAO_BS = `
  select count(*)::int as quantas,
         coalesce(string_agg(
           t.codigo || '|' || coalesce(t.quando::text, '~') || '|' ||
           coalesce(t.praca, '~') || '|' || t.loja || '|' ||
           coalesce(t.parceiro, '~') || '|' || t.ativa::text || '|' ||
           t.arquivada::text || '|' || t.criado_em::text,
           E'\\n' order by t.codigo), '') as impressao
    from public.vessel_beauty_sessions t`

const DEFINICOES = `
  select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('vessel_criar_private_edit', 'vessel_beauty_session_criar')`

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
 * uma linha trocada por outra, nada inserido e nada removido.
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

  // 0a. A Beauty Sessions de verdade.
  const bsAntes = await uma(IMPRESSAO_BS)
  if (bsAntes.quantas < 1)
    throw new Error('vessel_beauty_sessions veio vazia: a impressao nao provaria nada')

  // 0b. AS DEFINICOES VELHAS, lidas do BANCO e nao do repositorio.
  // ⚠️ VARIAS MIGRATIONS DEFINEM ESTES DOIS NOMES e a mais nova e que vale — e
  // `applied_at` provou que a ordem dos ARQUIVOS mente aqui (medido: uma
  // migration que cria de novo `vessel_criar_private_edit` rodou 23h depois de
  // outra que a filename ordena depois dela). Quem sabe o que esta rodando e
  // `pg_get_functiondef`.
  const defAntes = Object.fromEntries((await todas(DEFINICOES)).map(r => [r.proname, r.def]))
  for (const nome of ['vessel_criar_private_edit', 'vessel_beauty_session_criar']) {
    if (!defAntes[nome]) throw new Error(`${nome} nao existe no banco: nada a apertar`)
    if (!defAntes[nome].includes('public.is_vessel_atendimentos()'))
      throw new Error(`${nome} ja nao chama a trava de ver — o alvo desta migration mudou:\n${defAntes[nome]}`)
  }

  // 0c. AS PORTAS COMO ESTAO HOJE. Esta migration NAO mexe nelas — nem aperta
  // nem afrouxa.
  const portasAntes = {}
  for (const f of [PE_F, BS_F]) portasAntes[f] = await uma(PORTAS, [f])

  // 0d. ⚠️ A MEDIDA QUE AUTORIZA APERTAR. Medida AGORA, na hora, nao copiada
  // de uma medicao antiga: se alguem tiver ganho a permissao de VER sem a de
  // EDITAR entre a ultima medicao e este `node`, este arquivo PARA.
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
      'Apertar CRIAR agora TIRARIA acesso de gente que o usa. Falar com o dono antes.')

  // ── 1. APLICAR E REGISTRAR ───────────────────────────────────────────────
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-criar-exige-editar.mjs'])

  // ── 2. SO A LINHA DO PORTAO MUDOU ────────────────────────────────────────
  // ⚠️ ESTA E A ASERCAO CENTRAL DE UMA MIGRATION DE SEGURANCA. Um `create or
  // replace` reescreve a funcao INTEIRA: sem este diff, uma normalizacao
  // perdida ou uma mensagem reescrita entrariam de carona com a mudanca de
  // portao, e nenhuma prova de permissao veria.
  const defDepois = Object.fromEntries((await todas(DEFINICOES)).map(r => [r.proname, r.def]))
  console.log('   ── diff das definicoes (banco antes -> banco depois) ──')
  for (const nome of ['vessel_criar_private_edit', 'vessel_beauty_session_criar']) {
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
    // trava de ver e PREFIXO do nome da de editar.
    if (/is_vessel_atendimentos\(\)/.test(d[0].depois))
      throw new Error(`${nome}: a trava de ver ficou na linha nova: ${d[0].depois}`)
  }

  // ── 3. UMA SO DE CADA, com a assinatura combinada ────────────────────────
  for (const [nome, tipos] of [
    ['vessel_criar_private_edit',   '(text,timestamp with time zone,text,text,text,integer,boolean)'],
    ['vessel_beauty_session_criar', '(text,date,text,text,text)'],
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

  // ── 4. A PORTA CONTINUA A MESMA ──────────────────────────────────────────
  // ⚠️ ESTA MIGRATION APERTA O PORTAO DE DENTRO DA FUNCAO, NAO A PORTA DE
  // FORA. A porta aqui tambem nao pode ter AFROUXADO: `revoke ... from
  // public` nao fecha `authenticated`, e uma funcao recriada nasce aberta
  // para `public`, ou seja, para `anon`.
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
    ['private edit', `select public.vessel_criar_private_edit(
        'STY-X', now() + interval '5 days', null, 'CPS', 'iguatemi', 8, true) as r`],
    ['beauty session', `select public.vessel_beauty_session_criar(
        'BS-20990101-CPS-ZZ', date '2099-01-01', 'CPS', 'iguatemi', null) as r`],
  ]) {
    const { r } = await uma(chamada)
    // ⚠️ `if (r.ok)` NAO BASTA: `pg` devolve SQL NULL como `null`, que e falsy
    // em JavaScript — um `ok` nulo passaria batido por um `if` solto, do mesmo
    // jeito que passa um `false`. As comparacoes sao estritas de proposito.
    if (r.ok !== false) throw new Error(`${nome}: passou sem sessao nenhuma (ok=${JSON.stringify(r.ok)})`)
  }

  // ── 6. PERFIS DE MENTIRA ──────────────────────────────────────────────────
  // ⚠️ `profiles.id` tem FK para `auth.users(id)` e `profiles.email` e NOT
  // NULL sem default: por isso cada perfil de mentira nasce em DOIS inserts.
  // Nada disto sobrevive ao `rollback to savepoint prova`.
  const perfil = async (features, permissions) => {
    const id = randomUUID()
    const email = `prova-criar-exige-editar-${id}@teste.invalido`
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

  // ⚠️ A STYLIST DA PROVA E INVENTADA AQUI. Nenhuma sessao real, nenhum
  // encontro real e nenhuma stylist real e citado em lugar nenhum deste
  // arquivo.
  await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp)
     values ($1, 'Prova Criar Exige Editar', '5519977777777')`, [STY])

  const linhaBS = async (cod) => await uma(
    `select codigo, quando::text as quando, praca, loja, parceiro, ativa, arquivada
       from public.vessel_beauty_sessions where codigo = $1`, [cod])
  const linhaPE = async (cod) => await uma(
    `select codigo, chave, local, praca, loja, vagas, ativa, arquivada
       from public.vessel_private_edits where codigo = $1`, [cod])
  const contaPE = async () => (await uma(`select count(*)::int as n from public.vessel_private_edits`)).n
  const contaBS = async () => (await uma(`select count(*)::int as n from public.vessel_beauty_sessions`)).n

  const chamaPE = async (codArg, quando) =>
    (await uma(`select public.vessel_criar_private_edit($1, $2::timestamptz, 'Piso L3', 'CPS', 'iguatemi', 8, true) as r`,
      [codArg, quando])).r
  const chamaBS = async (cod, quando) =>
    (await uma(`select public.vessel_beauty_session_criar($1, $2::date, 'CPS', 'iguatemi', 'Salao da Prova') as r`,
      [cod, quando])).r

  /**
   * A ASERCAO QUE ESTA MIGRATION EXISTE PARA FAZER PASSAR: quem so VE nao
   * cria nada, e nao cria SEM TER ESCRITO.
   *
   * ⚠️ E UMA FUNCAO, e nao codigo solto, porque os mutantes la embaixo
   * precisam roda-la de novo com a funcao estragada e exigir que ela QUEBRE.
   */
  const soVeNaoCria = async () => {
    await falarComo(so_ve)
    const antesPE = await contaPE(), antesBS = await contaBS()

    const rPE = await chamaPE(STY, '2027-06-15T19:00:00-03:00')
    if (rPE.ok !== false) throw new Error(`private edit: quem so ve CRIOU (r=${JSON.stringify(rPE)})`)
    if (rPE.situacao !== 'sem_permissao')
      throw new Error(`private edit: recusou por outro motivo: ${JSON.stringify(rPE)}`)

    const rBS = await chamaBS('BS-20270615-CPS-SV', '2027-06-15')
    if (rBS.ok !== false) throw new Error(`beauty session: quem so ve CRIOU (r=${JSON.stringify(rBS)})`)
    if (!/permiss/i.test(rBS.erro || ''))
      throw new Error(`beauty session: recusou por outro motivo: ${JSON.stringify(rBS)}`)

    // ⚠️ E RECUSAR NAO BASTA: recusar SEM TER ESCRITO e o que se prova aqui.
    // Uma funcao que inserisse a linha e so depois devolvesse a recusa
    // passaria pelas asercoes de cima.
    if (await contaPE() !== antesPE) throw new Error('quem so ve inseriu em vessel_private_edits mesmo assim')
    if (await contaBS() !== antesBS) throw new Error('quem so ve inseriu em vessel_beauty_sessions mesmo assim')
    if (await linhaPE('PE-20270615-CPS-01') !== undefined) throw new Error('quem so ve criou o encontro')
    if (await linhaBS('BS-20270615-CPS-SV') !== undefined) throw new Error('quem so ve criou a sessao')
  }

  // ── 7. O ANTES: COM A DEFINICAO VELHA, O MESMO PERFIL CRIAVA ─────────────
  // ⚠️ SEM ESTE BLOCO A PROVA NAO PROVA A MUDANCA. "Quem so ve e recusado" e
  // verdade tambem num banco onde nada foi apertado. O que separa os dois
  // mundos e o `ok` que o MESMO perfil recebia da definicao VELHA — recolocada
  // aqui, dentro de um savepoint proprio, a partir do `pg_get_functiondef`
  // capturado antes de qualquer DDL. E a linha TEM de ter sido gravada de
  // verdade: le-se de volta da tabela, nao so o JSON de resposta.
  await cli.query('savepoint antes')
  try {
    await cli.query(defAntes.vessel_criar_private_edit)
    await cli.query(defAntes.vessel_beauty_session_criar)
    await falarComo(so_ve)

    const rPE = await chamaPE(STY, '2027-07-20T19:00:00-03:00')
    if (rPE.ok !== true) throw new Error(`o ANTES nao se confirmou: private edit ja recusava quem so ve: ${JSON.stringify(rPE)}`)
    const dPE = await linhaPE(rPE.codigo)
    if (dPE === undefined) throw new Error('o ANTES: o encontro nao foi criado de verdade (nao esta na tabela)')
    console.log(`   ANTES  private edit: quem so tem \`ver\` recebia ${JSON.stringify(rPE)}, e a linha ficou gravada`)

    const rBS = await chamaBS('BS-20270720-CPS-AN', '2027-07-20')
    if (rBS.ok !== true) throw new Error(`o ANTES nao se confirmou: beauty session ja recusava quem so ve: ${JSON.stringify(rBS)}`)
    const dBS = await linhaBS('BS-20270720-CPS-AN')
    if (dBS === undefined) throw new Error('o ANTES: a sessao nao foi criada de verdade (nao esta na tabela)')
    console.log(`   ANTES  beauty session: quem so tem \`ver\` recebia ${JSON.stringify(rBS)}, e a linha ficou gravada`)
  } finally {
    // ⚠️ O `rollback` NO `finally` desfaz DUAS coisas de uma vez: as
    // definicoes velhas e as linhas que elas gravaram. Nao ha caminho de
    // saida deste bloco que deixe a funcao velha no ar.
    await cli.query('rollback to savepoint antes')
  }

  // ⚠️ E A DEFINICAO NOVA TEM DE TER VOLTADO. Sem esta linha, um `rollback`
  // que nao pegasse deixaria todo o resto do arquivo provando a funcao VELHA.
  const { volta } = await uma(
    `select pg_get_functiondef(p.oid) like '%is_vessel_atendimentos_editar()%' as volta
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'vessel_beauty_session_criar'`)
  if (volta !== true) throw new Error('o rollback do bloco ANTES nao devolveu a definicao nova')

  // E OS ENCONTROS/SESSOES INVENTADOS NO BLOCO ANTES SOMEM DE VERDADE.
  // ⚠️ vessel_beauty_sessions TEM 3 LINHAS DE VERDADE: o teste e contra
  // `bsAntes.quantas`, nao contra zero. `vessel_private_edits` esta zerada de
  // verdade hoje, entao ali zero e o numero certo.
  if (await contaPE() !== 0) throw new Error('sobrou private edit do bloco ANTES depois do rollback')
  if (await contaBS() !== bsAntes.quantas)
    throw new Error(`sobrou beauty session do bloco ANTES depois do rollback: ${bsAntes.quantas} -> ${await contaBS()}`)

  // ── 8. O DEPOIS: O MESMO PERFIL, AGORA RECUSADO ──────────────────────────
  await soVeNaoCria()
  console.log('   DEPOIS quem so tem `ver` recebe recusa nas duas, sem escrever')

  // ── 9. E QUEM PODE EDITAR CONTINUA CRIANDO, E A LINHA LANDA DE VERDADE ───
  await falarComo(mexe)

  const rPEok = await chamaPE(STY, '2027-08-09T19:00:00-03:00')
  if (rPEok.ok !== true) throw new Error(`private edit: quem pode editar foi recusado: ${JSON.stringify(rPEok)}`)
  const dPEok = await linhaPE(rPEok.codigo)
  if (dPEok === undefined) throw new Error('private edit: quem pode editar criou, mas a linha nao esta na tabela')
  if (dPEok.loja !== 'iguatemi') throw new Error(`private edit: a loja nao entrou: ${JSON.stringify(dPEok)}`)
  if (dPEok.vagas !== 8) throw new Error(`private edit: vagas nao entrou: ${JSON.stringify(dPEok)}`)

  const rBSok = await chamaBS('BS-20270809-CPS-OK', '2027-08-09')
  if (rBSok.ok !== true) throw new Error(`beauty session: quem pode editar foi recusado: ${JSON.stringify(rBSok)}`)
  const dBSok = await linhaBS('BS-20270809-CPS-OK')
  if (dBSok === undefined) throw new Error('beauty session: quem pode editar criou, mas a linha nao esta na tabela')
  if (dBSok.loja !== 'iguatemi') throw new Error(`beauty session: a loja nao entrou: ${JSON.stringify(dBSok)}`)
  if (dBSok.ativa !== true) throw new Error(`beauty session: nao nasceu ativa: ${JSON.stringify(dBSok)}`)

  // ── 10. MUTANTES ─────────────────────────────────────────────────────────
  // ⚠️ CADA UM DENTRO DO SEU `savepoint`, com o `rollback` no `finally` —
  // inclusive quando o caso PASSA. Nao existe `commit` neste bloco.
  const falhasMutantes = []
  const mutante = async (caso, ddl) => {
    await cli.query('savepoint mutante')
    try {
      await cli.query(ddl)
      await soVeNaoCria()
      falhasMutantes.push(caso)
      console.log(`   ✘ mutante "${caso}": a prova PASSOU com a funcao estragada`)
    } catch (e) {
      console.log(`   ✔ mutante "${caso}": a prova reprovou — "${e.message.slice(0, 160)}"`)
    } finally {
      await cli.query('rollback to savepoint mutante')
      await falarComo(mexe)
    }
  }

  // Mutante 1 e 2: a linha exata que esta migration trocou, destrocada — o
  // erro mais provavel num refactor futuro, porque a definicao velha esta no
  // historico do git e num arquivo de migration ao lado.
  await mutante('beauty session criar volta a chamar a trava de VER',
    defAntes.vessel_beauty_session_criar)
  await mutante('private edit criar volta a chamar a trava de VER',
    defAntes.vessel_criar_private_edit)

  if (falhasMutantes.length)
    throw new Error(`a prova nao reprovou ${falhasMutantes.length} mutante(s): ${falhasMutantes.join(' | ')}`)

  // ── 11. NADA DISSO FICA ──────────────────────────────────────────────────
  await falarComo(null)
  await cli.query('rollback to savepoint prova')

  // ⚠️ DEPOIS DO ROLLBACK, ANTES DO COMMIT e antes de qualquer linha de
  // sucesso: a sessao de mentira tem de ter ido embora junto.
  const { u } = await uma(`select auth.uid() as u`)
  if (u !== null) throw new Error(`a sessao de mentira sobreviveu ao rollback: ${u}`)

  // ⚠️ E OS DOIS PORTOES CONTINUAM INTEIROS. Esta prova nao troca nenhum por
  // `select true` em momento nenhum — mas a conferencia fica, porque e barata
  // e porque o dia em que alguem trouxer um stub para dentro deste arquivo
  // ela e quem avisa, antes do commit.
  await conferirQueOPortaoVoltou(cli)

  // ⚠️⚠️ E AS SESSOES DE VERDADE VOLTARAM IDENTICAS, campo a campo.
  const bsDepois = await uma(IMPRESSAO_BS)
  if (bsDepois.quantas !== bsAntes.quantas)
    throw new Error(`o numero de Beauty Sessions mudou: ${bsAntes.quantas} -> ${bsDepois.quantas}`)
  if (bsDepois.impressao !== bsAntes.impressao)
    throw new Error(`as Beauty Sessions NAO voltaram como estavam:\nANTES\n${bsAntes.impressao}\nDEPOIS\n${bsDepois.impressao}`)

  // E NENHUMA LINHA DE PROVA PODE TER ESCAPADO DO SAVEPOINT.
  // ⚠️ Procura-se pela MARCA de cada linha inventada aqui, nao por "a tabela
  // esta vazia": as tabelas de negocio de verdade nao estao vazias. Aqui elas
  // ESTAO zeradas de verdade — e e isso que se confere.
  const sobrou = await uma(
    `select (select count(*) from public.vessel_stylists)::int as stylists,
            (select count(*) from public.vessel_private_edits)::int as private_edits,
            (select count(*) from public.vessel_pessoas)::int as pessoas,
            (select count(*) from public.vessel_atendimentos)::int as atendimentos,
            (select count(*) from public.vessel_beauty_sessions where codigo not in (
              select codigo from (values ('BS-20260925-CPS-01'),('BS-20260926-CPS-02'),
                                          ('BS-20261016-CPS-AME')) t(codigo)
            ))::int as sessoes_a_mais,
            (select count(*) from public.profiles where email like 'prova-criar-exige-editar-%')::int as perfis,
            (select count(*) from auth.users where email like 'prova-criar-exige-editar-%')::int as contas`)
  for (const [onde, n] of Object.entries(sobrou))
    if (n !== 0) throw new Error(`sobrou dado de prova em ${onde}: ${n} linha(s)`)

  await cli.query('commit')

  // ── 12. E DE NOVO, DEPOIS DO COMMIT, NUMA CONEXAO NOVA ───────────────────
  // ⚠️ UM `COMMIT` DEPOIS DE ERRO VIRA `ROLLBACK` CALADO, e o script imprime
  // sucesso do mesmo jeito. Conferir na mesma conexao tambem nao resolve: ela
  // pode estar num estado que a proxima nao tera.
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  try {
    const dela = async (s, a = []) => (await outra.query(s, a)).rows[0]

    const defsNoAr = Object.fromEntries((await outra.query(DEFINICOES)).rows.map(r => [r.proname, r.def]))
    for (const nome of ['vessel_criar_private_edit', 'vessel_beauty_session_criar']) {
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

    // ⚠️⚠️ E A BEAUTY SESSIONS DE VERDADE, DEPOIS DE TUDO COMMITADO.
    const agora = await dela(IMPRESSAO_BS)
    if (agora.impressao !== bsAntes.impressao)
      throw new Error(`depois do commit as Beauty Sessions estao diferentes:\nANTES\n${bsAntes.impressao}\nAGORA\n${agora.impressao}`)

    const zeradas = await dela(`
      select (select count(*) from public.vessel_stylists)::int as stylists,
             (select count(*) from public.vessel_private_edits)::int as private_edits,
             (select count(*) from public.vessel_pessoas)::int as pessoas,
             (select count(*) from public.vessel_atendimentos)::int as atendimentos`)
    for (const [onde, n] of Object.entries(zeradas))
      if (n !== 0) throw new Error(`depois do commit, ${onde} nao esta mais zerada: ${n}`)

    const { registrada } = await dela(
      `select exists (select 1 from public.schema_migrations where name = $1) as registrada`, [ARQUIVO])
    if (registrada !== true) throw new Error('a migration nao ficou registrada: o commit nao pegou')

    console.log(`   ${agora.quantas} Beauty Sessions de verdade, identicas as de antes da prova;` +
                ` vessel_stylists/vessel_private_edits/vessel_pessoas/vessel_atendimentos continuam em 0`)
  } finally { await outra.end() }

  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
