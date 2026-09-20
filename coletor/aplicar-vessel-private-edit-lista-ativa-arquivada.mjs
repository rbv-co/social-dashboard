// APLICA, REGISTRA e PROVA que `vessel_conta_das_private_edits` passa a
// devolver `ativa`, `arquivada`, `praca` e `loja` em cada linha.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE: achado durante a T10 (a tela do Private
// Edit), não previsto em nenhum ruling anterior. `p_incluir_arquivadas` já
// existia (R1), mas a função nunca devolvia, LINHA A LINHA, se aquela linha
// está arquivada, nem a praça/loja atuais — com `p_incluir_arquivadas: true`
// ela mistura arquivada e não-arquivada sem nenhum campo para a tela separar
// as duas, o filtro de "Só arquivadas" e o de "Loja" ficam sempre vazios,
// calados, e o formulário de editar não tem como pré-preencher praça/loja.
// Ver o comentário no topo da migration para a conta completa.
//
// ⚠️ TUDO NUMA TRANSACAO SO: aplicar, registrar, provar e só então `commit`.
//
// ⚠️ ESTA PROVA NÃO TROCA NENHUM PORTÃO POR `select true`. Fabrica sessão de
// verdade (`request.jwt.claims`), como `auth.uid()` lê de fato — a trava de
// `is_vessel_atendimentos()` roda LIGADA.
//
// ⚠️ É CONSERTO ADITIVO, não muda assinatura nem regra de negócio: dois campos
// a mais no mesmo SELECT. Por isso a prova é mais enxuta que a das irmãs que
// mexem em permissão — não há "antes/depois" de comportamento para comparar,
// só "o campo chegou, com o valor certo, para os dois estados".
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-19-vessel-private-edit-lista-devolve-ativa-e-arquivada.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada por coletor/aplicar-vessel-private-edit-lista-ativa-arquivada.mjs'])

  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

  // ── 1. SOBROU UMA SÓ, com a assinatura de sempre ────────────────────────
  const { quantas, assinaturas } = await uma(
    `select count(*)::int as quantas,
            string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as assinaturas
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'vessel_conta_das_private_edits'`)
  if (quantas !== 1) throw new Error(`ficou com ${quantas} versoes: ${assinaturas}`)
  if (!assinaturas.includes('(integer,boolean)'))
    throw new Error(`assinatura mudou: ${assinaturas}`)

  // ── 2. A PORTA continua so para authenticated ───────────────────────────
  const F = 'public.vessel_conta_das_private_edits(integer, boolean)'
  const p = await uma(
    `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [F])
  if (p.autenticado !== true) throw new Error('a Central nao consegue mais chamar a funcao')
  if (p.anon !== false || p.qualquer_um !== false)
    throw new Error(`porta aberta para a pagina publica (anon=${p.anon}, public=${p.qualquer_um})`)

  await cli.query('savepoint prova')

  // ── 3. OS DOIS CAMPOS CHEGAM, com o valor certo, nos dois estados ───────
  const id = randomUUID()
  const email = `prova-lista-ativa-arquivada-${id}@teste.invalido`
  await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
  await cli.query(
    `insert into public.profiles (id, email, features, permissions, is_superadmin)
     values ($1, $2, $3, $4::jsonb, false)`,
    [id, email, ['atendimentos'], JSON.stringify({ atendimentos: ['ver'] })])
  await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id })])

  const { id: sty } = await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp)
     values ('STY-9996','Prova Lista','5519988888886') returning id`)
  // Uma aberta (o default: ativa=true, arquivada=false) e uma encerrada e
  // arquivada — os dois estados que a tela precisa distinguir. Praças e lojas
  // DIFERENTES nas duas, para a asserção não passar por acaso.
  await cli.query(
    `insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, loja, vagas)
     values ('PE-PROVA-ABERTA','AAAAAAAA',$1, now() + interval '5 days','CPS','iguatemi',8)`, [sty])
  await cli.query(
    `insert into public.vessel_private_edits
       (codigo, chave, stylist_id, quando, praca, loja, vagas, ativa, arquivada)
     values ('PE-PROVA-ARQ','BBBBBBBB',$1, now() - interval '5 days','SBO','tivoli',8, false, true)`, [sty])

  const { r: comArquivadas } = await uma(
    `select public.vessel_conta_das_private_edits(14, true) as r`)
  const porCodigo = Object.fromEntries(comArquivadas.map((l) => [l.codigo, l]))

  const aberta = porCodigo['PE-PROVA-ABERTA']
  if (!aberta) throw new Error('a linha aberta nao voltou com p_incluir_arquivadas:true')
  if (aberta.ativa !== true) throw new Error(`ativa da aberta veio ${JSON.stringify(aberta.ativa)}, esperava true`)
  if (aberta.arquivada !== false) throw new Error(`arquivada da aberta veio ${JSON.stringify(aberta.arquivada)}, esperava false`)
  if (aberta.praca !== 'CPS') throw new Error(`praca da aberta veio ${JSON.stringify(aberta.praca)}, esperava CPS`)
  if (aberta.loja !== 'iguatemi') throw new Error(`loja da aberta veio ${JSON.stringify(aberta.loja)}, esperava iguatemi`)

  const arq = porCodigo['PE-PROVA-ARQ']
  if (!arq) throw new Error('a linha arquivada nao voltou com p_incluir_arquivadas:true')
  if (arq.ativa !== false) throw new Error(`ativa da arquivada veio ${JSON.stringify(arq.ativa)}, esperava false`)
  if (arq.arquivada !== true) throw new Error(`arquivada da arquivada veio ${JSON.stringify(arq.arquivada)}, esperava true`)
  if (arq.praca !== 'SBO') throw new Error(`praca da arquivada veio ${JSON.stringify(arq.praca)}, esperava SBO`)
  if (arq.loja !== 'tivoli') throw new Error(`loja da arquivada veio ${JSON.stringify(arq.loja)}, esperava tivoli`)

  // ⚠️ E SEM PEDIR AS ARQUIVADAS, ela continua de fora — o comportamento de
  // sempre (R1) não pode ter mudado por causa deste conserto aditivo.
  const { r: semArquivadas } = await uma(
    `select public.vessel_conta_das_private_edits(14, false) as r`)
  if (semArquivadas.some((l) => l.codigo === 'PE-PROVA-ARQ'))
    throw new Error('a arquivada voltou mesmo sem pedir p_incluir_arquivadas')
  const abertaSemPedir = semArquivadas.find((l) => l.codigo === 'PE-PROVA-ABERTA')
  if (!abertaSemPedir || abertaSemPedir.ativa !== true || abertaSemPedir.arquivada !== false)
    throw new Error(`a aberta sem pedir arquivadas veio errada: ${JSON.stringify(abertaSemPedir)}`)

  // Desfaz TUDO que este bloco escreveu (perfil, stylist, as duas linhas de
  // prova) — o `commit` lá embaixo leva só a migration.
  await cli.query('rollback to savepoint prova')

  // ── 4. A MIGRATION SOBREVIVE ao rollback do savepoint, o teste não ──────
  const sobrou = await uma(
    `select count(*)::int as n from public.vessel_private_edits where codigo like 'PE-PROVA-%'`)
  if (sobrou.n !== 0) throw new Error(`sobrou linha de prova: ${sobrou.n}`)
  const defAinda = await uma(
    `select pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'vessel_conta_das_private_edits'`)
  if (!defAinda.def.includes("'ativa'") || !defAinda.def.includes("'arquivada'"))
    throw new Error('o rollback do savepoint desfez a migration junto')

  await cli.query('commit')
  console.log('OK — vessel_conta_das_private_edits agora devolve ativa e arquivada. Migration registrada.')
} catch (e) {
  await cli.query('rollback')
  console.error('FALHOU, tudo desfeito:', e.message)
  process.exitCode = 1
} finally {
  await cli.end()
}
