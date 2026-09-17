// APLICA, REGISTRA e PROVA o horário novo do private appointment.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-17-vessel-visita-sexta-e-ate-as-20h.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')

// Datas CALCULADAS, nunca cravadas: data escrita à mão num teste envelhece e o
// teste passa a falhar sozinho semanas depois.
function proximo(diaDaSemana) {
  const d = new Date()
  do { d.setDate(d.getDate() + 1) } while (d.getDay() !== diaDaSemana)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const TERCA = proximo(2); const SEXTA = proximo(5); const SABADO = proximo(6)

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-sexta-e-20h.mjs'])

  await cli.query('savepoint prova')
  const novaSenha = async () => {
    const s = 'prova-' + Math.random().toString(36).slice(2)
    await cli.query(
      `insert into public.vessel_lista_espera
         (nome, email, whatsapp, aceite_versao, origem, senha_hash, senha_em)
       values ('Prova da Migration', $1, '19999999999', 'prova', 'prova',
               encode(extensions.digest($2, 'sha256'), 'hex'), now())`,
      [`prova-${Math.random()}@exemplo.invalido`, s])
    return s
  }
  const tentar = async (data, hora) => {
    const s = await novaSenha()
    return (await cli.query('select public.vessel_detalhar_visita($1,$2,$3) as r', [s, data, hora])).rows[0].r
  }

  // ⚠️ O MESMO HORÁRIO, DOIS DIAS, DUAS RESPOSTAS. É o defeito que uma faixa
  // única esconderia.
  const tercaTarde = await tentar(TERCA, '19:30')
  if (tercaTarde.ok !== true) throw new Error('19:30 na terca foi recusado: ' + JSON.stringify(tercaTarde))
  const sextaTarde = await tentar(SEXTA, '19:30')
  if (sextaTarde.situacao !== 'hora_fora') throw new Error('19:30 na SEXTA passou: ' + JSON.stringify(sextaTarde))

  // As pontas de cada janela.
  if ((await tentar(TERCA, '20:00')).ok !== true) throw new Error('20:00 na terca deveria valer')
  if ((await tentar(TERCA, '20:30')).situacao !== 'hora_fora') throw new Error('20:30 nao existe em dia nenhum')
  if ((await tentar(SEXTA, '17:00')).ok !== true) throw new Error('17:00 na sexta deveria valer')
  if ((await tentar(SEXTA, '17:30')).situacao !== 'hora_fora') throw new Error('17:30 na sexta deveria ser recusado')
  if ((await tentar(TERCA, '10:30')).situacao !== 'hora_fora') throw new Error('antes das 11 nao existe')
  if ((await tentar(TERCA, '11:15')).situacao !== 'hora_fora') throw new Error('fora da meia hora nao existe')

  // A sexta agora ABRE; o sabado continua fechado.
  if ((await tentar(SEXTA, '15:00')).ok !== true) throw new Error('a sexta deveria abrir agora')
  if ((await tentar(SABADO, '15:00')).situacao !== 'dia_fechado') throw new Error('o sabado deveria continuar fechado')

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query(
    `select count(*)::int as n from public.vessel_lista_espera where origem = 'prova'`)
  if (sobrou.n !== 0) throw new Error('a prova deixou sujeira')

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  19:30 na TERCA vale; 19:30 na SEXTA e recusado (o mesmo horario, dias diferentes)')
  console.log('  as pontas: 20:00 terca ok, 20:30 nao; 17:00 sexta ok, 17:30 nao')
  console.log('  antes das 11h nao existe; fora da meia hora nao existe')
  console.log('  a sexta ABRE; o sabado continua fechado')
  console.log('  prova desfeita                              ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
