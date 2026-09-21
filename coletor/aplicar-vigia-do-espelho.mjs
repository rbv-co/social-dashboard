// APLICA, REGISTRA e PROVA o vigia do robô da planilha da Vessel.
//
// ⚠️ A PROVA MEXE EM `robos_execucoes` DE VERDADE — dentro de um `savepoint` que
// é desfeito antes do `commit`. Só assim se prova que a view ACUSA de verdade:
// conferir o texto da migration provaria que eu escrevi o insert, não que o
// painel muda de cor. O que ela NÃO faz é chamar o robô: linha de execução é
// dado de termômetro, e inventar chamada seria escrever em produção de verdade.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { ETAPA_PLANILHA, ETAPA_BLING, ROBO }
  from '../supabase/functions/_shared/vigia-do-espelho.js'

const ARQUIVO = '2026-09-21-vigia-do-espelho-da-vessel.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vigia-do-espelho.mjs'])

  // ── o registro entrou, e com os números que a migration diz ───────────────
  const { rows: [esperado] } = await cli.query(
    'select horas_sem_sucesso_ate, critico, porque from public.robos_esperados where robo = $1', [ROBO])
  if (!esperado) throw new Error('o robo nao entrou em robos_esperados')
  if (esperado.horas_sem_sucesso_ate !== 3) throw new Error('as horas nao sao 3: ' + esperado.horas_sem_sucesso_ate)
  if (esperado.critico !== false) throw new Error('entrou como critico, e a migration diz que nao e')

  // ── a view passou a devolver UMA linha para ele ───────────────────────────
  const saude = async () => (await cli.query(
    `select situacao, quem_falhou, variantes_vivas, ultimo_sucesso
       from public.robos_saude where robo = $1`, [ROBO])).rows
  const antes = await saude()
  if (antes.length !== 1) throw new Error('a view devolveu ' + antes.length + ' linhas, e tinha de ser 1')

  await cli.query('savepoint prova')

  const anotar = (nome, quandoMin, ok) => cli.query(
    `insert into public.robos_execucoes (robo, ok, resposta, disparado_em, conferido_em)
     values ($1, $2, 'prova do aplicador', now() - make_interval(mins => $3), now())`,
    [nome, ok, quandoMin])

  // CENÁRIO 1 — as duas etapas deram certo agora: o painel diz ok.
  await anotar(ETAPA_PLANILHA, 1, true)
  await anotar(ETAPA_BLING, 1, true)
  const [tudoBem] = await saude()
  if (tudoBem.situacao !== 'ok') {
    throw new Error('com as duas etapas em dia o painel disse "' + tudoBem.situacao + '"')
  }
  if (tudoBem.quem_falhou) throw new Error('acusou etapa sem ninguem ter falhado')
  if (Number(tudoBem.variantes_vivas) < 2) {
    throw new Error('a view nao juntou as duas etapas: ' + tudoBem.variantes_vivas + ' variante(s)')
  }

  // CENÁRIO 2 — ⚠️ O QUE ESTA ENTREGA EXISTE PARA CONSERTAR.
  // A planilha sem sucesso há 5 horas, falhando agora, e o Bling em dia. O
  // painel TEM de acusar e TEM de dizer que é a planilha — antes disto, a
  // rodada respondia 200 e ele diria "em dia".
  await cli.query('savepoint cenario2')
  await cli.query(
    `delete from public.robos_execucoes
      where robo = $1 and resposta = 'prova do aplicador'`, [ETAPA_PLANILHA])
  await anotar(ETAPA_PLANILHA, 300, true)   // último sucesso: 5 horas atrás
  await anotar(ETAPA_PLANILHA, 1, false)    // e falhando agora
  const [parada] = await saude()
  if (parada.situacao !== 'ATRASADO') {
    throw new Error('a planilha 5h sem sucesso e o painel disse "' + parada.situacao + '"')
  }
  if (!(parada.quem_falhou ?? []).includes(ETAPA_PLANILHA)) {
    throw new Error('nao nomeou a planilha: ' + JSON.stringify(parada.quem_falhou))
  }
  if ((parada.quem_falhou ?? []).includes(ETAPA_BLING)) {
    throw new Error('acusou o Bling tambem, e ele estava em dia — as etapas nao sao independentes')
  }

  // CENÁRIO 3 — o contrário: o Bling parado e a planilha em dia.
  await cli.query('rollback to savepoint cenario2')
  await cli.query(
    `delete from public.robos_execucoes
      where robo = $1 and resposta = 'prova do aplicador'`, [ETAPA_BLING])
  await anotar(ETAPA_BLING, 300, true)
  await anotar(ETAPA_BLING, 1, false)
  const [blingParado] = await saude()
  if (blingParado.situacao !== 'ATRASADO') throw new Error('o Bling parado nao acusou')
  if (!(blingParado.quem_falhou ?? []).includes(ETAPA_BLING)) {
    throw new Error('nao nomeou o Bling: ' + JSON.stringify(blingParado.quem_falhou))
  }
  if ((blingParado.quem_falhou ?? []).includes(ETAPA_PLANILHA)) {
    throw new Error('acusou a planilha tambem, e ela estava em dia')
  }

  // ── a prova sai inteira ───────────────────────────────────────────────────
  await cli.query('rollback to savepoint prova')
  const { rows: [sujeira] } = await cli.query(
    `select count(*)::int n from public.robos_execucoes where resposta = 'prova do aplicador'`)
  if (sujeira.n !== 0) throw new Error('a prova deixou ' + sujeira.n + ' linha(s) para tras')

  // E o painel volta a dizer o que dizia antes de eu mexer.
  const depois = await saude()
  if (depois[0].situacao !== antes[0].situacao) {
    throw new Error(`a prova mudou a situacao real: era "${antes[0].situacao}", virou "${depois[0].situacao}"`)
  }

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log(`  o robo entrou no vigia, com teto de 3h e critico = false`)
  console.log(`  a view devolve 1 linha para ele, juntando as etapas por prefixo`)
  console.log(`  planilha 5h sem sucesso  -> ATRASADO, nomeando a planilha`)
  console.log(`  Bling 5h sem sucesso     -> ATRASADO, nomeando o Bling`)
  console.log(`  uma etapa parada NAO acusa a outra`)
  console.log(`  prova desfeita, e a situacao real voltou a "${antes[0].situacao}"`)
} catch (e) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + e.message)
  process.exitCode = 1
} finally { await cli.end() }
