// APLICA, REGISTRA e PROVA a tela das Beauty Sessions.
//
// ⚠️ As provas escrevem dado de verdade e são desfeitas antes do commit
// (`savepoint prova` → `rollback to savepoint prova`).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-18-zzzzz-vessel-beauty-sessions-com-tela.sql'
const CRIAR = 'public.vessel_beauty_session_criar(text, date, text, text, text)'
const ENCERRAR = 'public.vessel_beauty_session_encerrar(text, boolean)'
const INTERESSE = 'public.vessel_interesse_da_beauty_session(text, text, text, text, boolean, text, jsonb, text, boolean)'

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-beauty-sessions-com-tela.mjs'])

  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
  const porta = async (f) => (await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])).rows[0]

  for (const [nome, f] of [['criar', CRIAR], ['encerrar', ENCERRAR]]) {
    const p = await porta(f)
    if (!p.autenticado) throw new Error(`a Central nao consegue ${nome} sessao`)
    if (p.anon || p.qualquer_um) throw new Error(`${nome}: a porta ficou aberta para a pagina publica`)
  }
  const i = await porta(INTERESSE)
  if (!i.anon) throw new Error('a pagina da Beauty Session perdeu a porta de enviar')

  await cli.query('savepoint prova')

  // ⚠️ SEM A PERMISSAO, NADA. `auth.uid()` e nulo nesta conexao, entao
  // `is_vessel_atendimentos()` responde false — o caso "logado, mas sem a
  // permissao de Atendimentos".
  const semPerm = await uma(
    `select public.vessel_beauty_session_criar('BS-20261201-CPS-99','2026-12-01','CPS','iguatemi',null) as r`)
  if (semPerm.r.ok) throw new Error('quem nao tem a permissao criou uma sessao')

  // Daqui em diante, fingindo a permissao — o que a Central tera.
  await cli.query(`create or replace function public.is_vessel_atendimentos()
    returns boolean language sql stable as $f$ select true $f$`)

  // 1. a DATA do codigo tem de bater com a data da sessao
  const dataTorta = await uma(
    `select public.vessel_beauty_session_criar('BS-20261201-CPS-99','2026-12-02','CPS','iguatemi',null) as r`)
  if (dataTorta.r.ok) throw new Error('passou codigo com data diferente da sessao')
  if (!/data do c/i.test(dataTorta.r.erro)) throw new Error('o erro da data nao explica: ' + dataTorta.r.erro)

  // 2. a PRACA do codigo tem de bater com a praca escolhida
  const pracaTorta = await uma(
    `select public.vessel_beauty_session_criar('BS-20261201-CPS-99','2026-12-01','BSB','iguatemi',null) as r`)
  if (pracaTorta.r.ok) throw new Error('passou codigo com praca diferente da escolhida')

  // 3. formato torto nao entra
  for (const torto of ['BS-2026-CPS-01', 'lixo', 'BS-20261201-CP-99']) {
    const r = await uma(`select public.vessel_beauty_session_criar($1,'2026-12-01','CPS','iguatemi',null) as r`, [torto])
    if (r.r.ok) throw new Error('passou codigo torto: ' + torto)
  }

  // 4. o caminho feliz
  const bom = await uma(
    `select public.vessel_beauty_session_criar('BS-20261201-CPS-99','2026-12-01','CPS','iguatemi','Salao da Prova') as r`)
  if (!bom.r.ok) throw new Error('nao criou a sessao boa: ' + JSON.stringify(bom.r))
  const criada = await uma(`select codigo, quando::text, praca, loja, parceiro, ativa
                              from vessel_beauty_sessions where codigo='BS-20261201-CPS-99'`)
  if (!criada || criada.parceiro !== 'Salao da Prova' || criada.ativa !== true)
    throw new Error('a sessao nasceu errada: ' + JSON.stringify(criada))

  // 5. codigo NAO se reaproveita
  const repetido = await uma(
    `select public.vessel_beauty_session_criar('BS-20261201-CPS-99','2026-12-01','CPS','iguatemi',null) as r`)
  if (repetido.r.ok) throw new Error('deixou reaproveitar um codigo que ja existe')

  // 6. enquanto ATIVA, o formulario aceita
  const fone = () => '5519' + String(900000000 + Math.floor(Math.random() * 9999999))
  const aceitou = await uma(
    `select public.vessel_interesse_da_beauty_session('Cliente da prova',$1,'BS-20261201-CPS-99',
       null,false,'v3',null,null,false) as r`, [fone()])
  if (!aceitou.r.ok) throw new Error('a sessao ativa recusou: ' + JSON.stringify(aceitou.r))

  // 7. ⚠️ ENCERRADA, O FORMULARIO RECUSA — era isto que `ativa` nao fazia.
  const fechou = await uma(`select public.vessel_beauty_session_encerrar('BS-20261201-CPS-99', false) as r`)
  if (!fechou.r.ok) throw new Error('nao encerrou')
  const recusou = await uma(
    `select public.vessel_interesse_da_beauty_session('Cliente depois do fim',$1,'BS-20261201-CPS-99',
       null,false,'v3',null,null,false) as r`, [fone()])
  if (recusou.r.ok) throw new Error('⚠️ a sessao ENCERRADA continuou aceitando contato')
  if (recusou.r.situacao !== 'evento_encerrado')
    throw new Error('a recusa veio com outro motivo: ' + JSON.stringify(recusou.r))
  if (/inv[aá]lido|nao reconhec/i.test(recusou.r.erro))
    throw new Error('a recusa acusa a cliente, em vez de mandar falar com a equipe')

  // 8. encerrada, o CARTAO tambem para de etiquetar — e o pedido nao cai
  const f2 = fone()
  const pedido = await uma(
    `select public.vessel_solicitar_atendimento('Cliente do cartao velho',$1,'iguatemi',
       null,null,null,false,'v3',$2::jsonb,null,false) as r`,
    [f2, JSON.stringify({ canal: 'beauty_session', evento_id: 'BS-20261201-CPS-99' })])
  if (!pedido.r.ok) throw new Error('o cartao de uma sessao encerrada derrubou o pedido da cliente')
  const o = await uma(`select o.evento_id from vessel_origens o
                         join vessel_pessoas p on p.id=o.pessoa_id where p.telefone=$1`, [f2])
  if (o.evento_id !== null)
    throw new Error('sessao encerrada continuou etiquetando: ' + o.evento_id)

  // 9. reabrir volta a valer
  await uma(`select public.vessel_beauty_session_encerrar('BS-20261201-CPS-99', true) as r`)
  const dePovolta = await uma(
    `select public.vessel_interesse_da_beauty_session('Cliente da reabertura',$1,'BS-20261201-CPS-99',
       null,false,'v3',null,null,false) as r`, [fone()])
  if (!dePovolta.r.ok) throw new Error('reabrir nao voltou a aceitar')

  // 10. ⚠️ AS SESSOES QUE JA EXISTEM CONTINUAM ACEITANDO. Elas nasceram com
  //     ativa=true; se esta migration as tivesse derrubado, tres QR impressos
  //     parariam de funcionar de uma vez, dias antes do evento.
  const { rows: vivas } = await cli.query(
    `select codigo from vessel_beauty_sessions where codigo like 'BS-2026092%' and ativa`)
  if (vivas.length < 2)
    throw new Error('as sessoes ja impressas perderam a ativacao: ' + JSON.stringify(vivas))

  await cli.query('rollback to savepoint prova')
  await cli.query('commit')
  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback')
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally {
  await cli.end()
}
