// APLICA, REGISTRA e PROVA que `vessel_rastreio_dos_stylists` passa a
// devolver `ativa`, `whatsapp`, `instagram` e `atuacao` por linha, e ganha
// `p_incluir_desativadas` (T12).
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE: achado durante a T12 (a tela do Stylist
// Circle ganhar cadastrar, corrigir e desativar), medido AO VIVO com
// `pg_get_functiondef` antes de escrever a migration. A função já filtrava
// por `coalesce(s.ativa, true)` no `where` (desde
// `2026-09-19-vessel-stylist-mexer.sql`), mas nunca devolvia `ativa` por
// linha — nem `whatsapp`, `instagram` ou `atuacao`, os campos que o
// formulário de corrigir precisa pré-preencher. Sem `ativa` na resposta, a
// tela não teria como escolher entre "Desativar" e "Reativar"; e como a
// função sempre excluía quem está desativada, um filtro de "Só desativadas"
// viria vazio para sempre — o botão "Reativar" ficaria inalcançável.
//
// ⚠️ ASSINATURA MUDA: esta migration faz `drop function if exists
// vessel_rastreio_dos_stylists(integer)` ANTES de criar a versão de dois
// parâmetros — `create or replace` não troca uma função por outra de lista
// de parâmetros diferente, cria uma segunda, sobrecarregada. Por isso este
// aplicador confere, DEPOIS do `drop` + `create`, que sobrou EXATAMENTE UMA
// versão da função no banco.
//
// ⚠️ TUDO NUMA TRANSACAO SO: aplicar, registrar, provar e só então `commit`.
//
// ⚠️ ESTA PROVA NÃO TROCA NENHUM PORTÃO POR `select true`. Fabrica sessão de
// verdade (`request.jwt.claims`), como `auth.uid()` lê de fato — a trava de
// `is_vessel_atendimentos()` roda LIGADA. `conferirQueOPortaoVoltou` confere
// os dois portões (ver/editar) antes do commit e de novo depois, numa conexão
// nova.
//
// ⚠️ `vessel_stylists` ESTÁ VAZIA HOJE (medido: 0 linhas) — toda linha que
// esta prova vê é linha que ela mesma fez, e nenhuma sobrevive ao
// `rollback to savepoint` nem ao commit.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { conferirQueOPortaoVoltou } from './lib/o-portao-dos-atendimentos.mjs'

const ARQUIVO = '2026-09-20-vessel-rastreio-devolve-ativa-e-contato.sql'
const FUNCAO = 'vessel_rastreio_dos_stylists'
const NOVA_ASSINATURA = 'public.vessel_rastreio_dos_stylists(integer,boolean)'
const VELHA_ASSINATURA = 'public.vessel_rastreio_dos_stylists(integer)'

const FONE_ATIVA = '5519990001001'
const FONE_DESATIVADA = '5519990001002'

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()

const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const definicao = async (c) => (await c.query(
  `select pg_get_functiondef(p.oid) as d
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = $1`, [FUNCAO])).rows[0]?.d

await cli.query('begin')
try {
  // ── 0. COMO O MUNDO ESTA AGORA ─────────────────────────────────────────
  const { n: antesDeTudo } = await uma(`select count(*)::int as n from public.vessel_stylists`)
  if (antesDeTudo !== 0)
    throw new Error(`vessel_stylists tinha ${antesDeTudo} linha(s) antes desta prova — ` +
      `esta tabela deveria estar vazia em producao; parando sem mexer em nada`)

  const defAntes = await definicao(cli)
  if (!defAntes) throw new Error(`${FUNCAO} nao existe no banco: nao ha o que recriar`)

  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-rastreio-devolve-ativa-e-contato.mjs'])

  // ── 1. SOBROU UMA SO, com a assinatura NOVA ──────────────────────────────
  // ⚠️ ESTA E A CONFERENCIA CENTRAL DO `drop` + `create`: sem o `drop` na
  // migration, `create or replace` teria criado uma SEGUNDA versao
  // sobrecarregada, e uma chamada por nome de parametro (o jeito que a
  // Central chama) morreria com "function is not unique".
  const { quantas, assinaturas } = await uma(
    `select count(*)::int as quantas,
            string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as assinaturas
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`, [FUNCAO])
  if (quantas !== 1) throw new Error(`ficou com ${quantas} versoes: ${assinaturas}`)
  if (!assinaturas.endsWith('(integer,boolean)'))
    throw new Error(`assinatura nao ficou (integer,boolean): ${assinaturas}`)

  // ── 2. A PORTA continua so para authenticated, na assinatura NOVA ────────
  const p = await uma(
    `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [NOVA_ASSINATURA])
  if (p.autenticado !== true) throw new Error('a Central nao consegue mais chamar a funcao')
  if (p.anon !== false || p.qualquer_um !== false)
    throw new Error(`porta aberta para a pagina publica (anon=${p.anon}, public=${p.qualquer_um})`)

  // ── 3. O DIFF: nada saiu, e só as linhas combinadas mudaram/entraram ─────
  // ⚠️ Comentário não conta como "mudou o comportamento" — só código. A régua:
  // zero linha REMOVIDA de código (só a assinatura e a linha do `where` podem
  // ter mudado de TEXTO, não desaparecido — elas viram outra linha, contada
  // como uma remoção + uma adição), e as linhas de código acrescentadas são
  // só as 4 do json_build_object mais essas duas substituições.
  const defDepois = await definicao(cli)
  const linhasAntes = defAntes.split('\n').map((l) => l.trim()).filter(Boolean)
  const linhasDepois = defDepois.split('\n').map((l) => l.trim()).filter(Boolean)
  const acrescentadas = linhasDepois.filter((l) => !linhasAntes.includes(l))
  const removidas = linhasAntes.filter((l) => !linhasDepois.includes(l))
  const acrescentadasDeCodigo = acrescentadas.filter((l) => !l.startsWith('--'))
  const removidasDeCodigo = removidas.filter((l) => !l.startsWith('--'))

  const REMOVIDAS_ESPERADAS = [
    'CREATE OR REPLACE FUNCTION public.vessel_rastreio_dos_stylists(p_dias integer DEFAULT 7)',
    'and coalesce(s.ativa, true)',
  ]
  const ACRESCENTADAS_ESPERADAS = [
    'CREATE OR REPLACE FUNCTION public.vessel_rastreio_dos_stylists(p_dias integer DEFAULT 7, p_incluir_desativadas boolean DEFAULT false)',
    "'ativa', s.ativa,",
    "'whatsapp', s.whatsapp,",
    "'instagram', s.instagram,",
    "'atuacao', s.atuacao,",
    'and (coalesce(p_incluir_desativadas, false) or coalesce(s.ativa, true))',
  ]
  const removidasInesperadas = removidasDeCodigo.filter((l) => !REMOVIDAS_ESPERADAS.includes(l))
  const acrescentadasInesperadas = acrescentadasDeCodigo.filter((l) => !ACRESCENTADAS_ESPERADAS.includes(l))
  if (removidasInesperadas.length)
    throw new Error(`o diff removeu linha(s) de codigo alem do esperado: ${JSON.stringify(removidasInesperadas)}`)
  if (acrescentadasInesperadas.length)
    throw new Error(`o diff acrescentou linha(s) de codigo alem do esperado: ${JSON.stringify(acrescentadasInesperadas)}`)
  for (const esperada of REMOVIDAS_ESPERADAS)
    if (!removidasDeCodigo.includes(esperada))
      throw new Error(`esperava que esta linha tivesse saido e nao saiu: ${JSON.stringify(esperada)}`)
  for (const esperada of ACRESCENTADAS_ESPERADAS)
    if (!acrescentadasDeCodigo.includes(esperada))
      throw new Error(`esperava que esta linha tivesse entrado e nao entrou: ${JSON.stringify(esperada)}`)

  console.log('   DIFF — linhas removidas (so as combinadas com a linha nova que as substitui):')
  for (const l of removidasDeCodigo) console.log('   - ' + l)
  console.log('   DIFF — linhas acrescentadas:')
  for (const l of acrescentadasDeCodigo) console.log('   + ' + l)

  await cli.query('savepoint prova')

  // ── 4. UMA STYLIST ATIVA E UMA DESATIVADA, DE VERDADE ────────────────────
  await cli.query(
    `insert into public.vessel_stylists
       (codigo, nome, whatsapp, cidade, instagram, atuacao, praca_preview, ativa)
     values ('STY-9001', 'Prova Ativa', $1, 'Campinas', '@prova.ativa', 'stylist', 'CPS', true)`,
    [FONE_ATIVA])
  await cli.query(
    `insert into public.vessel_stylists
       (codigo, nome, whatsapp, cidade, instagram, atuacao, praca_preview, ativa)
     values ('STY-9002', 'Prova Desativada', $1, 'Sao Paulo', '@prova.des', 'personal-shopper', 'SAO', false)`,
    [FONE_DESATIVADA])

  // fabrica sessão de verdade: um perfil só-de-ver basta, is_vessel_atendimentos()
  // já aceita 'ver'.
  const id = randomUUID()
  const email = `prova-rastreio-devolve-${id}@teste.invalido`
  await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
  await cli.query(
    `insert into public.profiles (id, email, features, permissions, is_superadmin)
     values ($1, $2, $3, $4::jsonb, false)`,
    [id, email, ['atendimentos'], JSON.stringify({ atendimentos: ['ver'] })])
  await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id })])

  // ── 5. SEM PEDIR AS DESATIVADAS (o padrao de sempre) ─────────────────────
  const { r: semPedir } = await uma(`select public.${FUNCAO}(7, false) as r`)
  const porCodigoSemPedir = Object.fromEntries(semPedir.map((l) => [l.codigo, l]))
  if (!porCodigoSemPedir['STY-9001'])
    throw new Error('a ativa nao apareceu nem sem pedir desativadas')
  if (porCodigoSemPedir['STY-9002'])
    throw new Error('a desativada apareceu mesmo com p_incluir_desativadas:false — R do filtro quebrou')

  // e o valor default (sem passar o segundo argumento) tem de se comportar
  // exatamente igual a `false` — é o que a Central chama quando a tela não
  // pediu "Só desativadas"/"Todas".
  const { r: comDefault } = await uma(`select public.${FUNCAO}(7) as r`)
  if (comDefault.some((l) => l.codigo === 'STY-9002'))
    throw new Error('o DEFAULT de p_incluir_desativadas nao ficou false')

  // ── 6. OS QUATRO CAMPOS NOVOS CHEGAM, com o valor certo ──────────────────
  const ativa = porCodigoSemPedir['STY-9001']
  if (ativa.ativa !== true) throw new Error(`ativa da ativa veio ${JSON.stringify(ativa.ativa)}, esperava true`)
  if (ativa.whatsapp !== FONE_ATIVA) throw new Error(`whatsapp nao veio: ${JSON.stringify(ativa.whatsapp)}`)
  if (ativa.instagram !== '@prova.ativa') throw new Error(`instagram nao veio: ${JSON.stringify(ativa.instagram)}`)
  if (ativa.atuacao !== 'stylist') throw new Error(`atuacao nao veio: ${JSON.stringify(ativa.atuacao)}`)

  // ── 7. PEDINDO AS DESATIVADAS, as duas aparecem — com ativa=false na certa ─
  const { r: comPedido } = await uma(`select public.${FUNCAO}(7, true) as r`)
  const porCodigoComPedido = Object.fromEntries(comPedido.map((l) => [l.codigo, l]))
  const desativada = porCodigoComPedido['STY-9002']
  if (!desativada) throw new Error('a desativada nao voltou com p_incluir_desativadas:true')
  if (desativada.ativa !== false)
    throw new Error(`ativa da desativada veio ${JSON.stringify(desativada.ativa)}, esperava false`)
  if (desativada.whatsapp !== FONE_DESATIVADA) throw new Error('whatsapp da desativada nao veio')
  if (desativada.instagram !== '@prova.des') throw new Error('instagram da desativada nao veio')
  if (desativada.atuacao !== 'personal-shopper') throw new Error('atuacao da desativada nao veio')
  if (!porCodigoComPedido['STY-9001'])
    throw new Error('pedir as desativadas fez a ativa desaparecer')
  if (porCodigoComPedido['STY-9001'].ativa !== true)
    throw new Error('pedir as desativadas mudou o campo ativa da ativa')

  // ⚠️ E AS CONTAS DE SEMPRE CONTINUAM DE PE (aberturas/clientes/pedidos/
  // confirmados/compareceram/receita/janela_de_venda_em_dias) — nao é preciso
  // fabricar tráfego so para provar isso: basta que as chaves continuem lá.
  const CHAVES_ESPERADAS = [
    'aberturas', 'ativa', 'atuacao', 'cidade', 'clientes', 'codigo',
    'compareceram', 'confirmados', 'estagio', 'instagram',
    'janela_de_venda_em_dias', 'nome', 'pedidos', 'praca_preview',
    'receita', 'whatsapp',
  ].sort().join(',')
  const chaves = Object.keys(ativa).sort().join(',')
  if (chaves !== CHAVES_ESPERADAS)
    throw new Error(`o painel perdeu ou ganhou conta alem do combinado: ${chaves}`)

  // Desfaz TUDO que este bloco escreveu — o `commit` la embaixo leva só a
  // migration.
  await cli.query('rollback to savepoint prova')

  // ⚠️ DEPOIS DO ROLLBACK, ANTES DO COMMIT — a sessao de mentira foi embora, e
  // os dois portoes (ver/editar) continuam INTEIROS: esta prova nao trocou
  // nenhum por `select true` em momento nenhum.
  const { u } = await uma(`select auth.uid() as u`)
  if (u !== null) throw new Error(`a sessao de mentira sobreviveu ao rollback: ${u}`)
  await conferirQueOPortaoVoltou(cli)

  // ── 8. A MIGRATION SOBREVIVE ao rollback do savepoint, o teste nao ────────
  const { n: sobrou } = await uma(
    `select count(*)::int as n from public.vessel_stylists where codigo in ('STY-9001','STY-9002')`)
  if (sobrou !== 0) throw new Error(`sobrou linha de prova: ${sobrou}`)
  const defAinda = await definicao(cli)
  if (!defAinda.includes('p_incluir_desativadas'))
    throw new Error('o rollback do savepoint desfez a migration junto')

  // ── 9. VESSEL_STYLISTS CONTINUA VAZIA (0 linhas, como em producao) ────────
  const { n: depoisDeTudo } = await uma(`select count(*)::int as n from public.vessel_stylists`)
  if (depoisDeTudo !== 0)
    throw new Error(`vessel_stylists deveria voltar a 0 linhas, ficou com ${depoisDeTudo}`)

  await cli.query('commit')
  console.log('OK — vessel_rastreio_dos_stylists agora devolve ativa/whatsapp/instagram/atuacao ' +
    'e aceita p_incluir_desativadas. Migration registrada.')
} catch (e) {
  await cli.query('rollback')
  console.error('FALHOU, tudo desfeito:', e.message)
  process.exitCode = 1
} finally {
  await cli.end()
}

if (process.exitCode !== 1) {
  // ── 10. NUMA CONEXÃO NOVA, DEPOIS DO COMMIT ──────────────────────────────
  const c2 = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c2.connect()
  try {
    const { rows: [{ quantas, assinaturas }] } = await c2.query(
      `select count(*)::int as quantas,
              string_agg(p.oid::regprocedure::text, ' | ') as assinaturas
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [FUNCAO])
    if (quantas !== 1 || !assinaturas.endsWith('(integer,boolean)'))
      throw new Error(`depois do commit, ${FUNCAO} esta ${quantas}x como ${assinaturas}`)

    const { rows: [pp] } = await c2.query(
      `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
              has_function_privilege('anon',$1,'EXECUTE') as anon,
              has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [NOVA_ASSINATURA])
    if (pp.autenticado !== true) throw new Error('depois do commit, a Central nao consegue chamar a funcao')
    if (pp.anon !== false || pp.qualquer_um !== false)
      throw new Error(`depois do commit, porta aberta para a pagina publica: ${JSON.stringify(pp)}`)

    const { rows: [{ n: linhas }] } = await c2.query(`select count(*)::int as n from public.vessel_stylists`)
    if (linhas !== 0) throw new Error(`depois do commit, vessel_stylists tem ${linhas} linha(s), esperava 0`)

    const { rows: [{ registrada }] } = await c2.query(
      `select exists (select 1 from public.schema_migrations where name = $1) as registrada`, [ARQUIVO])
    if (registrada !== true) throw new Error('a migration nao ficou registrada: o commit nao pegou')

    await conferirQueOPortaoVoltou(c2)

    console.log('CONFERIDO numa conexao nova: assinatura unica, porta correta, ' +
      'vessel_stylists com 0 linhas, migration registrada, os dois portoes inteiros.')
  } finally { await c2.end() }
}
