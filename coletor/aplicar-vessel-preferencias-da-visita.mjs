// APLICA e REGISTRA as preferências da visita (o segundo formulário da LP),
// na mesma transação — e PROVA a função antes de confirmar.
//
// ⚠️ A prova escreve numa linha de mentira e desfaz com `rollback to savepoint`.
// Sem isso não dá para saber se a função grava: `create function` sempre "dá
// certo", e um erro de lógica só apareceria com uma cliente de verdade do outro
// lado.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-17-vessel-preferencias-da-visita.sql'
const ASSINATURA = 'public.vessel_detalhar_visita(text, date, text, text, text, boolean, int, text, text)'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')

// Uma terça-feira daqui a pouco — calculada, nunca cravada: data escrita à mão
// num teste envelhece e o teste passa a falhar sozinho semanas depois.
function proximaTerca() {
  const d = new Date()
  do { d.setDate(d.getDate() + 1) } while (d.getDay() !== 2)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function proximoSabado() {
  const d = new Date()
  do { d.setDate(d.getDate() + 1) } while (d.getDay() !== 6)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-preferencias-da-visita.mjs'])

  // ── as colunas ────────────────────────────────────────────────────────────
  const esperadas = ['visita_data', 'visita_hora', 'visita_bolsa', 'visita_ocasiao',
    'visita_atelier', 'visita_acompanhantes', 'visita_pedido', 'visita_detalhes_em']
  const { rows: colunas } = await cli.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='vessel_lista_espera'
        and column_name = any($1)`, [esperadas])
  if (colunas.length !== esperadas.length) {
    const achadas = colunas.map((c) => c.column_name)
    throw new Error('faltou coluna: ' + esperadas.filter((c) => !achadas.includes(c)).join(', '))
  }

  // ── a porta ───────────────────────────────────────────────────────────────
  // ⚠️ `revoke from public` NÃO fecha anon/authenticated (buraco já pago em
  // 16/09). A pergunta é feita papel por papel, com a assinatura inteira.
  const { rows: [porta] } = await cli.query(
    `select has_function_privilege('anon',          $1, 'EXECUTE') as anon,
            has_function_privilege('authenticated', $1, 'EXECUTE') as autenticado,
            has_function_privilege('public',        $1, 'EXECUTE') as qualquer_um`,
    [ASSINATURA])
  if (!porta.anon) throw new Error('a pagina publica (anon) NAO consegue chamar a funcao')
  if (porta.autenticado) throw new Error('authenticated ficou com a porta aberta')
  if (porta.qualquer_um) throw new Error('public ficou com a porta aberta')

  // ── a prova de que ela grava, e de que ela recusa ─────────────────────────
  await cli.query('savepoint prova')
  const senha = 'prova-' + Math.random().toString(36).slice(2)
  const { rows: [linha] } = await cli.query(
    `insert into public.vessel_lista_espera
       (nome, email, whatsapp, aceite_versao, origem, senha_hash, senha_em)
     values ('Prova da Migration', $1, '19999999999', 'prova', 'prova',
             encode(extensions.digest($2, 'sha256'), 'hex'), now())
     returning id`,
    [`prova-${Date.now()}@exemplo.invalido`, senha])

  const chamar = async (args) => (await cli.query(
    `select public.vessel_detalhar_visita($1,$2,$3,$4,$5,$6,$7,$8) as r`, args)).rows[0].r

  const sabado = await chamar([senha, proximoSabado(), '15:00', null, null, false, null, null])
  if (sabado.situacao !== 'dia_fechado') throw new Error('sabado deveria ser recusado, veio: ' + JSON.stringify(sabado))

  const fora = await chamar([senha, proximaTerca(), '09:00', null, null, false, null, null])
  if (fora.situacao !== 'hora_fora') throw new Error('09:00 deveria ser recusado, veio: ' + JSON.stringify(fora))

  const inventado = await chamar([senha, proximaTerca(), '15:00', 'mochila', null, false, null, null])
  if (inventado.situacao !== 'bolsa_invalida') throw new Error('peca inventada deveria ser recusada')

  const bom = await chamar([senha, proximaTerca(), '15:30', 'shoulder-bag', 'viagem', true, 2, '  Champanhe rosé  '])
  if (bom.ok !== true) throw new Error('a resposta boa foi recusada: ' + JSON.stringify(bom))

  const { rows: [gravado] } = await cli.query(
    `select objetivo, loja, visita_data::text, visita_hora, visita_bolsa, visita_ocasiao,
            visita_atelier, visita_acompanhantes, visita_pedido, senha_hash, planilha_em,
            visita_detalhes_em is not null as carimbada
       from public.vessel_lista_espera where id = $1`, [linha.id])
  if (gravado.objetivo !== 'visita') throw new Error('o objetivo nao foi gravado junto')
  if (gravado.visita_hora !== '15:30') throw new Error('a hora nao bateu')
  if (gravado.visita_acompanhantes !== 2) throw new Error('os acompanhantes nao bateram')
  if (gravado.visita_pedido !== 'Champanhe rosé') throw new Error('o pedido nao foi aparado: ' + JSON.stringify(gravado.visita_pedido))
  if (gravado.senha_hash !== null) throw new Error('a senha de uso unico NAO foi queimada')
  if (gravado.planilha_em !== null) throw new Error('o espelho nao foi avisado (planilha_em)')
  if (!gravado.carimbada) throw new Error('faltou o carimbo de quando respondeu')

  // A senha já foi queimada: a segunda tentativa tem de ser recusada.
  const repetida = await chamar([senha, proximaTerca(), '15:30', null, null, false, null, null])
  if (repetida.situacao !== 'senha_invalida') throw new Error('a senha queimada ainda abre a porta')

  await cli.query('rollback to savepoint prova')

  const { rows: [sobrou] } = await cli.query(
    `select count(*)::int as n from public.vessel_lista_espera where origem = 'prova'`)
  if (sobrou.n !== 0) throw new Error('a linha de prova ficou no banco')

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  8 colunas novas em vessel_lista_espera      ok')
  console.log('  porta: anon SIM, authenticated NAO, public NAO')
  console.log('  sabado recusado, 09:00 recusado, peca inventada recusada')
  console.log('  resposta boa gravada, objetivo junto, senha queimada')
  console.log('  segunda tentativa com a mesma senha: recusada')
  console.log('  linha de prova desfeita                     ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
