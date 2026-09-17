// APLICA, REGISTRA e PROVA o fio entre a Client Advisor e o vendedor do Bling.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-17-vessel-client-advisor-e-o-vendedor.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-vendedor-da-ca.mjs'])

  // ── a trava da tabela nova, conferida contra as IRMÃS ─────────────────────
  const { rows: [t] } = await cli.query(
    `select c.relrowsecurity as trava,
            (select count(*)::int from pg_policies p
              where p.schemaname='public' and p.tablename='vessel_vendedores_bling') as politicas
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='vessel_vendedores_bling'`)
  if (!t) throw new Error('a tabela vessel_vendedores_bling nao nasceu')
  if (!t.trava) throw new Error('vessel_vendedores_bling: RLS desligada')
  if (t.politicas !== 0) throw new Error('vessel_vendedores_bling: tem politica')

  // ── as portas ─────────────────────────────────────────────────────────────
  const porta = async (assinatura) => (await cli.query(
    `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
            has_function_privilege('authenticated', $1, 'EXECUTE') as autenticado,
            has_function_privilege('public', $1, 'EXECUTE') as qualquer_um`,
    [assinatura])).rows[0]

  const busca = await porta('public.vessel_vendedores_parecidos(text)')
  if (busca.anon || busca.autenticado || busca.qualquer_um)
    throw new Error('a BUSCA de vendedores ficou aberta — seria uma porta para baixar a lista de funcionarios')
  const liga = await porta('public.vessel_ligar_vendedor(text, bigint)')
  if (!liga.anon) throw new Error('o gerador (anon) nao consegue confirmar')
  const identifica = await porta('public.vessel_identificar_client_advisor(text, text, boolean)')
  if (!identifica.anon) throw new Error('o gerador (anon) nao consegue se identificar')

  // ── a prova, desfeita no fim ──────────────────────────────────────────────
  await cli.query('savepoint prova')
  await cli.query(
    `insert into public.vessel_vendedores_bling (bling_vendedor_id, nome, chave, situacao)
     values (90000001, 'Kariny Stefany Ezidio dos Santos', public.vessel_chave_do_nome('Kariny Stefany Ezidio dos Santos'), 'A'),
            (90000002, 'Maria Eduarda Florencio', public.vessel_chave_do_nome('Maria Eduarda Florencio'), 'A'),
            (90000003, 'Maria Eduarda Cristina Schettini', public.vessel_chave_do_nome('Maria Eduarda Cristina Schettini'), 'E')`)

  const chamar = async (s, a) => (await cli.query(`select ${s} as r`, a)).rows[0].r

  // O primeiro nome acha a pessoa inteira.
  const porPrimeiro = await chamar('public.vessel_vendedores_parecidos($1)', ['Kariny'])
  if (porPrimeiro.length !== 1 || porPrimeiro[0].id !== 90000001)
    throw new Error('o primeiro nome nao achou a pessoa: ' + JSON.stringify(porPrimeiro))

  // Um pedaço no MEIO de uma palavra nao acha nada.
  const pedaco = await chamar('public.vessel_vendedores_parecidos($1)', ['ariny'])
  if (pedaco.length !== 0) throw new Error('pedaco no meio da palavra achou alguem: ' + JSON.stringify(pedaco))

  // Menos de tres letras nao responde nada — e o teto que impede varredura.
  const curto = await chamar('public.vessel_vendedores_parecidos($1)', ['ka'])
  if (curto.length !== 0) throw new Error('duas letras ja respondem; o teto nao esta valendo')

  // Vendedor EXCLUIDO no Bling nao e oferecido.
  const duas = await chamar('public.vessel_vendedores_parecidos($1)', ['Maria Eduarda'])
  if (duas.length !== 1 || duas[0].id !== 90000002)
    throw new Error('o vendedor excluido apareceu na lista: ' + JSON.stringify(duas))

  // A identificacao traz os parecidos junto com o codigo.
  const eu = await chamar('public.vessel_identificar_client_advisor($1,$2,$3)', ['Kariny', 'iguatemi', true])
  if (!eu.ok || !eu.codigo) throw new Error('nao me identificou: ' + JSON.stringify(eu))
  if (!eu.vendedor?.parecidos?.length) throw new Error('nao veio quem eu posso ser: ' + JSON.stringify(eu))

  // A confirmacao amarra.
  const ligou = await chamar('public.vessel_ligar_vendedor($1,$2)', [eu.codigo, 90000001])
  if (ligou.situacao !== 'ligado') throw new Error('nao amarrou: ' + JSON.stringify(ligou))

  // E agora a identificacao ja responde "ligado", sem perguntar de novo.
  const denovo = await chamar('public.vessel_identificar_client_advisor($1,$2,$3)', ['Kariny', 'iguatemi', true])
  if (denovo.vendedor?.ligado?.id !== 90000001)
    throw new Error('depois de ligado ainda pergunta: ' + JSON.stringify(denovo))

  // ⚠️ E NAO DESAMARRA. Trocar o vendedor reescreveria o passado em silencio.
  const troca = await chamar('public.vessel_ligar_vendedor($1,$2)', [eu.codigo, 90000002])
  if (troca.ok !== false || troca.situacao !== 'ja_ligado_a_outro')
    throw new Error('deixou trocar o vendedor de um codigo ja ligado: ' + JSON.stringify(troca))

  // Um vendedor nao pode ser de duas Client Advisors.
  const outra = await chamar('public.vessel_identificar_client_advisor($1,$2,$3)', ['Fulana de Prova', 'iguatemi', true])
  const roubo = await chamar('public.vessel_ligar_vendedor($1,$2)', [outra.codigo, 90000001])
  if (roubo.ok !== false || roubo.situacao !== 'vendedor_ja_e_de_outra')
    throw new Error('dois codigos ficaram com o mesmo vendedor: ' + JSON.stringify(roubo))

  // "Nao me achei na lista" para de perguntar.
  const dispensou = await chamar('public.vessel_ligar_vendedor($1,$2)', [outra.codigo, null])
  if (dispensou.situacao !== 'dispensado') throw new Error('nao aceitou dispensar')
  const calada = await chamar('public.vessel_identificar_client_advisor($1,$2,$3)', ['Fulana de Prova', 'iguatemi', true])
  if (calada.vendedor?.parecidos?.length) throw new Error('continua perguntando depois de dispensar')

  await cli.query('rollback to savepoint prova')
  const { rows: [sobrou] } = await cli.query(
    `select (select count(*)::int from public.vessel_vendedores_bling) as vendedores,
            (select count(*)::int from public.vessel_client_advisors where nome = 'Fulana de Prova') as falsas`)
  if (sobrou.vendedores !== 0 || sobrou.falsas !== 0) throw new Error('a prova deixou sujeira')

  await cli.query('commit')
  console.log('aplicada, registrada e provada.\n')
  console.log('  vessel_vendedores_bling: trava ligada, 0 politicas')
  console.log('  busca de vendedores FECHADA para anon/authenticated/public')
  console.log('  ligar e identificar: abertas so para anon')
  console.log('  primeiro nome acha; pedaco no meio nao acha; 2 letras nao respondem')
  console.log('  vendedor excluido no Bling nao e oferecido')
  console.log('  amarra uma vez, NAO troca depois, e nao deixa dois codigos no mesmo vendedor')
  console.log('  "nao me achei" para de perguntar')
  console.log('  prova desfeita                              ok')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally { await cli.end() }
