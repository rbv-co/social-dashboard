// APLICA, REGISTRA e PROVA que `vessel_conta_das_beauty_sessions` passa a
// devolver `arquivada` em cada linha.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE: achado durante a T11 (a tela de Beauty
// Sessions ganhar filtro, editar, arquivar e apagar), medido AO VIVO com
// `pg_get_functiondef` antes de escrever a migration. A função já recebia
// `p_incluir_arquivadas` (a mesma R1 da irmã Private Edit) e já filtrava por
// `s.arquivada` no `where`, mas nunca devolvia esse campo por linha — só
// `ativa`. Com `p_incluir_arquivadas: true` a resposta mistura arquivada e
// não-arquivada sem nenhum campo para a tela separar as duas: "Só arquivadas"
// filtraria um array que TEM as arquivadas mas nunca as reconhece — vazio,
// calado — e o botão "Desarquivar" não saberia quando aparecer.
//
// ⚠️ TUDO NUMA TRANSACAO SO: aplicar, registrar, provar e só então `commit`.
//
// ⚠️ ESTA PROVA NÃO TROCA NENHUM PORTÃO POR `select true`. Fabrica sessão de
// verdade (`request.jwt.claims`), como `auth.uid()` lê de fato — a trava de
// `is_vessel_atendimentos()` roda LIGADA.
//
// ⚠️ É CONSERTO ADITIVO, não muda assinatura nem regra de negócio: UM campo a
// mais no mesmo SELECT. A prova mede o antes/depois do `pg_get_functiondef`
// (só a linha de `arquivada` pode ter mudado) e depois prova com dado real —
// nunca as 3 sessões de produção, que são fabricadas à parte e desfeitas.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-19-vessel-beauty-sessions-lista-devolve-arquivada.sql'
const FUNCAO = 'vessel_conta_das_beauty_sessions'

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()

const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const buscarDef = async () => (await uma(
  `select pg_get_functiondef(p.oid) as def
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = $1`, [FUNCAO])).def

// ── 0. AS 3 SESSÕES REAIS, ANTES DE QUALQUER COISA ──────────────────────────
// ⚠️⚠️ `vessel_beauty_sessions` TEM DADO DE VERDADE: as 3 sessões do negócio,
// com QR já impresso e na mão de cliente/parceiro. Impressão campo a campo
// ANTES de escrever qualquer coisa, e a mesma consulta depois do commit numa
// conexão NOVA tem de devolver byte a byte igual.
const impressaoAntes = (await cli.query(
  `select codigo, quando, praca, loja, parceiro, ativa, arquivada, criado_em
     from public.vessel_beauty_sessions order by codigo`)).rows
if (impressaoAntes.length !== 3)
  throw new Error(`esperava 3 sessoes reais, achei ${impressaoAntes.length} — parando sem mexer em nada`)

const defAntes = await buscarDef()

await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada por coletor/aplicar-vessel-beauty-sessions-lista-devolve-arquivada.mjs'])

  // ── 1. SOBROU UMA SÓ, com a assinatura de sempre ──────────────────────────
  const { quantas, assinaturas } = await uma(
    `select count(*)::int as quantas,
            string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as assinaturas
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`, [FUNCAO])
  if (quantas !== 1) throw new Error(`ficou com ${quantas} versoes: ${assinaturas}`)
  if (!assinaturas.includes('(integer,boolean)'))
    throw new Error(`assinatura mudou: ${assinaturas}`)

  // ── 2. A PORTA continua so para authenticated ─────────────────────────────
  const F = `public.${FUNCAO}(integer, boolean)`
  const p = await uma(
    `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [F])
  if (p.autenticado !== true) throw new Error('a Central nao consegue mais chamar a funcao')
  if (p.anon !== false || p.qualquer_um !== false)
    throw new Error(`porta aberta para a pagina publica (anon=${p.anon}, public=${p.qualquer_um})`)

  // ── 3. O DIFF: nada saiu, e a única linha de CÓDIGO nova é `arquivada` ────
  // ⚠️ Comentário não conta como "mudou o comportamento" — só código. Por
  // isso a régua é: zero linha REMOVIDA (nada do que já existia foi tocado) e
  // exatamente UMA linha de código nova, que é a do campo. As linhas de
  // comentário explicando a mudança podem ser quantas forem — elas não regem
  // a função rodando.
  const defDepois = await buscarDef()
  const linhasAntes = defAntes.split('\n').map((l) => l.trim()).filter(Boolean)
  const linhasDepois = defDepois.split('\n').map((l) => l.trim()).filter(Boolean)
  const acrescentadas = linhasDepois.filter((l) => !linhasAntes.includes(l))
  const removidas = linhasAntes.filter((l) => !linhasDepois.includes(l))
  if (removidas.length !== 0)
    throw new Error(`o diff removeu linha(s) que nao devia: ${JSON.stringify(removidas)}`)
  const acrescentadasDeCodigo = acrescentadas.filter((l) => !l.startsWith('--'))
  if (acrescentadasDeCodigo.length !== 1
      || !acrescentadasDeCodigo[0].includes("'arquivada'")
      || !acrescentadasDeCodigo[0].includes('s.arquivada'))
    throw new Error(`o diff de CODIGO nao e so a linha de 'arquivada': ${JSON.stringify(acrescentadasDeCodigo)}`)

  await cli.query('savepoint prova')

  // ── 4. O CAMPO CHEGA, com o valor certo, nos dois estados ─────────────────
  await cli.query(
    `insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro, ativa, arquivada)
     values ('BS-PROVA-ABERTA', current_date + 5, 'CPS', 'iguatemi', 'Prova', true, false)`)
  await cli.query(
    `insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro, ativa, arquivada)
     values ('BS-PROVA-ARQ', current_date - 5, 'SBO', 'tivoli', 'Prova Arquivada', false, true)`)

  // fabrica sessão de verdade: um perfil so-de-ver basta, is_vessel_atendimentos()
  // ja aceita 'ver'.
  const id = randomUUID()
  const email = `prova-bs-lista-arquivada-${id}@teste.invalido`
  await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
  await cli.query(
    `insert into public.profiles (id, email, features, permissions, is_superadmin)
     values ($1, $2, $3, $4::jsonb, false)`,
    [id, email, ['atendimentos'], JSON.stringify({ atendimentos: ['ver'] })])
  await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id })])

  const { r: comArquivadas } = await uma(`select public.${FUNCAO}(7, true) as r`)
  const porCodigo = Object.fromEntries(comArquivadas.map((l) => [l.codigo, l]))

  const aberta = porCodigo['BS-PROVA-ABERTA']
  if (!aberta) throw new Error('a linha aberta nao voltou com p_incluir_arquivadas:true')
  if (aberta.arquivada !== false)
    throw new Error(`arquivada da aberta veio ${JSON.stringify(aberta.arquivada)}, esperava false`)
  if (aberta.ativa !== true)
    throw new Error(`ativa da aberta veio ${JSON.stringify(aberta.ativa)}, esperava true (nao pode ter regredido)`)

  const arq = porCodigo['BS-PROVA-ARQ']
  if (!arq) throw new Error('a linha arquivada nao voltou com p_incluir_arquivadas:true')
  if (arq.arquivada !== true)
    throw new Error(`arquivada da arquivada veio ${JSON.stringify(arq.arquivada)}, esperava true`)

  // ⚠️ E SEM PEDIR AS ARQUIVADAS, ela continua de fora — o comportamento de
  // sempre (R1) não pode ter mudado por causa deste conserto aditivo.
  const { r: semArquivadas } = await uma(`select public.${FUNCAO}(7, false) as r`)
  if (semArquivadas.some((l) => l.codigo === 'BS-PROVA-ARQ'))
    throw new Error('a arquivada voltou mesmo sem pedir p_incluir_arquivadas')
  const abertaSemPedir = semArquivadas.find((l) => l.codigo === 'BS-PROVA-ABERTA')
  if (!abertaSemPedir || abertaSemPedir.arquivada !== false)
    throw new Error(`a aberta sem pedir arquivadas veio errada: ${JSON.stringify(abertaSemPedir)}`)

  // Desfaz TUDO que este bloco escreveu (perfil, as duas linhas de prova) — o
  // `commit` lá embaixo leva só a migration.
  await cli.query('rollback to savepoint prova')

  // ── 5. A MIGRATION SOBREVIVE ao rollback do savepoint, o teste não ────────
  const sobrou = await uma(
    `select count(*)::int as n from public.vessel_beauty_sessions where codigo like 'BS-PROVA-%'`)
  if (sobrou.n !== 0) throw new Error(`sobrou linha de prova: ${sobrou.n}`)
  const defAinda = await buscarDef()
  if (!defAinda.includes("'arquivada'"))
    throw new Error('o rollback do savepoint desfez a migration junto')

  // ── 6. AS 3 SESSÕES REAIS, INTOCADAS, AINDA DENTRO DA TRANSAÇÃO ───────────
  const impressaoDentro = (await cli.query(
    `select codigo, quando, praca, loja, parceiro, ativa, arquivada, criado_em
       from public.vessel_beauty_sessions order by codigo`)).rows
  if (JSON.stringify(impressaoDentro) !== JSON.stringify(impressaoAntes))
    throw new Error('as 3 sessoes reais mudaram durante a prova — nao vou commitar')

  await cli.query('commit')
  console.log('OK — vessel_conta_das_beauty_sessions agora devolve arquivada. Migration registrada.')
} catch (e) {
  await cli.query('rollback')
  console.error('FALHOU, tudo desfeito:', e.message)
  process.exitCode = 1
} finally {
  await cli.end()
}

if (process.exitCode !== 1) {
  // ── 7. NUMA CONEXÃO NOVA, DEPOIS DO COMMIT: as 3 reais, byte a byte iguais.
  const c2 = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c2.connect()
  const impressaoDepois = (await c2.query(
    `select codigo, quando, praca, loja, parceiro, ativa, arquivada, criado_em
       from public.vessel_beauty_sessions order by codigo`)).rows
  await c2.end()
  if (impressaoDepois.length !== 3)
    throw new Error(`depois do commit ficaram ${impressaoDepois.length} sessoes, esperava 3`)
  if (JSON.stringify(impressaoDepois) !== JSON.stringify(impressaoAntes))
    throw new Error('as 3 sessoes reais divergem do estado de antes, numa conexao nova')
  console.log('CONFERIDO numa conexao nova: as 3 sessoes reais continuam byte a byte iguais.')
}
