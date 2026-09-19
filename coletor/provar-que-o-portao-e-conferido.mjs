// PROVA QUE A CONFERENCIA DO PORTAO REPROVA DE VERDADE.
//
// ⚠️ UMA CONFERENCIA QUE NUNCA VIU UM ERRO NAO E UMA CONFERENCIA, E UM ENFEITE.
// `conferirQueOPortaoVoltou()` passa nos dois scripts de hoje — mas passaria
// igual se estivesse quebrada, porque o portao esta inteiro nos dois. Este
// script quebra o portao DE PROPOSITO, de tres jeitos diferentes, e exige que
// a conferencia levante erro em cada um.
//
// ⚠️ NADA DISSO SOBREVIVE: cada estrago acontece dentro de um `begin` proprio,
// e o `rollback` vem no `finally`, inclusive quando o caso passa. Em nenhum
// momento existe um `commit` neste arquivo — de proposito.
import './lib/carregar-env.mjs'
import pg from 'pg'
import { conferirQueOPortaoVoltou, corpoOriginalDoPortao } from './lib/o-portao-dos-atendimentos.mjs'

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const corpo = corpoOriginalDoPortao()
const falhas = []

/** Estraga o portao de um jeito, confere que a conferencia reclama, desfaz. */
const deveReprovar = async (caso, ddl, pedaco) => {
  await cli.query('begin')
  try {
    await cli.query(ddl)
    await conferirQueOPortaoVoltou(cli)
    falhas.push(caso)
    console.log(`  ✘ ${caso}: a conferencia PASSOU com o portao estragado`)
  } catch (e) {
    if (e.message.includes(pedaco)) console.log(`  ✔ ${caso}: reprovou — "${e.message.slice(0, 96)}"`)
    else { falhas.push(caso); console.log(`  ✘ ${caso}: reprovou por outro motivo — ${e.message}`) }
  } finally {
    await cli.query('rollback')
  }
}

// 1. O ESTRAGO DE VERDADE: e exatamente o stub que os dois scripts usam para
//    conseguir provar as contas sem sessao. E o que iria para producao se o
//    `rollback to savepoint` fosse movido ou apagado.
await deveReprovar(
  'o stub `select true` dos proprios scripts',
  `create or replace function public.is_vessel_atendimentos()
     returns boolean language sql stable as $f$ select true $f$`,
  'NAO VOLTOU')

// 2. Corpo certo, mas SEM `security definer`: a funcao passaria a rodar como
//    quem chama, e a leitura de `profiles` cairia na RLS de `profiles` — o
//    portao responderia `false` para gente que tem acesso.
await deveReprovar(
  'corpo certo, sem security definer',
  `create or replace function public.is_vessel_atendimentos()
     returns boolean language sql stable set search_path = public as $f$${corpo}$f$`,
  'SEM security definer')

// 3. Corpo certo e `security definer`, mas SEM `search_path`: uma funcao
//    `security definer` sem search_path fixo e o buraco classico — quem
//    consegue criar um schema na frente do caminho troca a tabela `profiles`
//    por uma sua.
await deveReprovar(
  'corpo certo, sem search_path',
  `create or replace function public.is_vessel_atendimentos()
     returns boolean language sql stable security definer as $f$${corpo}$f$`,
  'search_path=public')

// 4. E o contraponto: com o portao intacto, a conferencia PASSA. Sem isto, uma
//    conferencia que so soubesse dizer "nao" pareceria perfeita aqui.
try {
  await conferirQueOPortaoVoltou(cli)
  console.log('  ✔ portao intacto: a conferencia aprova')
} catch (e) {
  falhas.push('portao intacto')
  console.log(`  ✘ portao intacto: a conferencia reprovou sem motivo — ${e.message}`)
}

await cli.end()
if (falhas.length) {
  console.error(`\n❌ ${falhas.length} caso(s) sem prova: ${falhas.join(', ')}`)
  process.exitCode = 1
} else console.log('\n✅ a conferencia do portao reprova os tres estragos e aprova o portao inteiro')
