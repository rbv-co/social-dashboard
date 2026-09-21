// APLICA, REGISTRA e PROVA a contagem das Beauty Sessions.
//
// ⚠️ APLICAR PELO MCP NÃO ESCREVE EM `schema_migrations`, e é assim que a dívida
// de migration cresce em silêncio. Aqui as duas coisas acontecem na MESMA
// transação: se qualquer metade falhar, nada fica.
//
// ⚠️ AS PROVAS ESCREVEM DADO DE VERDADE e são desfeitas antes do commit
// (`savepoint prova` → `rollback to savepoint prova`). O que fica no banco é só
// a estrutura.
//
// ⚠️⚠️ ESTE APLICADOR ENVELHECEU: RODAR DE NOVO RESSUSCITA UMA ASSINATURA
// MORTA E DEVOLVE `vessel_sessao_do_codigo` PARA ANTES DO ENCERRAMENTO EXISTIR
// (B11 de docs/pendencias.md).
//
// (1) Este arquivo cria `vessel_conta_das_beauty_sessions(integer)` — UM
//     argumento. Migrations posteriores trocaram para DOIS
//     (`integer, boolean`, o `p_incluir_arquivadas`), com `drop function`
//     antes — `create or replace` não troca uma assinatura por outra.
//     Reaplicar hoje ressuscita a versão de UM argumento AO LADO da de dois:
//     o Painel Autenticidade, que chama com os dois, passa a bater nas duas
//     e quebra com `function ... is not unique`.
//
// (2) Este arquivo cria `vessel_sessao_do_codigo` SEM filtrar por
//     `s.ativa` — qualquer código de Beauty Session, encerrada ou não, conta
//     como válido. `2026-09-18-zzzzz-vessel-beauty-sessions-com-tela.sql`
//     acrescentou esse filtro para que ENCERRAR uma sessão tire a etiqueta do
//     cartão físico dela (a cliente não perde o pedido, só deixa de contar
//     para um evento que já acabou). Reaplicar este arquivo hoje é
//     `create or replace` de VERDADE — mesma assinatura —, então o corpo
//     antigo volta calado: o cartão de uma sessão JÁ ENCERRADA volta a
//     etiquetar pedido novo, sem erro nenhum até alguém reparar que o painel
//     está contando visita para um evento que já fechou.
//
// ⚠️ POR QUE A TRAVA É UMA CONSULTA, E NÃO UM `process.exit` cravado: num
// banco NOVO, onde nenhuma das migrations posteriores foi aplicada, não há
// nada para desfazer e este aplicador tem de rodar normalmente.
const DEPOIS_DESTE = [
  {
    migration: '2026-09-19-vessel-beauty-sessions-lista-devolve-arquivada.sql',
    estrago:
      'ressuscitaria `vessel_conta_das_beauty_sessions(integer)` — a\n' +
      '       assinatura de UM argumento que ja foi trocada por DOIS — ao lado\n' +
      '       da de hoje. O Painel Autenticidade, que chama com os dois\n' +
      '       argumentos, quebraria com `function ... is not unique`.',
  },
  {
    migration: '2026-09-18-zzzzz-vessel-beauty-sessions-com-tela.sql',
    estrago:
      'devolveria `vessel_sessao_do_codigo` para a versao que NAO confere\n' +
      '       `ativa` — o cartao fisico de uma Beauty Session JA ENCERRADA\n' +
      '       voltaria a etiquetar pedido novo, calado, ate alguem reparar que\n' +
      '       o painel conta visita para um evento que ja fechou.',
  },
]

import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-18-vessel-contar-as-beauty-sessions.sql'
const ABRIR = 'public.vessel_visita_da_sessao(text, text, text)'
const CONFERE = 'public.vessel_sessao_do_codigo(text)'
const PAINEL = 'public.vessel_conta_das_beauty_sessions(integer)'
const PEDIR = 'public.vessel_solicitar_atendimento(text, text, text, text, text, text, boolean, text, jsonb, text, boolean)'

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()

// ⚠️ ANTES DE ABRIR TRANSACAO E ANTES DE APLICAR QUALQUER COISA.
const { rows: posteriores } = await cli.query(
  `select name from public.schema_migrations where name = any($1::text[]) order by name`,
  [DEPOIS_DESTE.map((x) => x.migration)])
if (posteriores.length > 0) {
  console.error(
    `❌ nao aplicada: ${ARQUIVO} ja foi superada e reaplica-la desfaria trabalho posterior.\n\n` +
    `Esta migration cria \`vessel_conta_das_beauty_sessions(integer)\` e \`vessel_sessao_do_codigo\`.\n` +
    `Migration(s) mais nova(s) JA APLICADA(S) mudaram essas funcoes, e rodar este aplicador agora\n` +
    `voltaria atras sem erro nenhum (ou pior, quebraria com function is not unique):\n\n` +
    posteriores.map(({ name }) =>
      `  · ${name}\n       ${DEPOIS_DESTE.find((x) => x.migration === name).estrago}`).join('\n\n') +
    `\n\nVa ler essa(s) migration(s) em db/migrations/ antes de qualquer coisa. Se voce PRECISA\n` +
    `mesmo reaplicar este arquivo, a saida NAO e apagar esta trava: e reaplicar a(s)\n` +
    `migration(s) posterior(es) logo depois, pelo aplicador de cada uma.\n`)
  await cli.end()
  process.exit(1)
}

await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-contar-as-beauty-sessions.mjs'])

  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

  // ── a tabela nova se confere contra as IRMÃS ────────────────────────────
  const { rows: [t] } = await cli.query(
    `select c.relrowsecurity as trava,
            (select count(*)::int from pg_policies p
              where p.schemaname='public' and p.tablename='vessel_sessao_aberturas') as politicas
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='vessel_sessao_aberturas'`)
  if (!t?.trava) throw new Error('vessel_sessao_aberturas: RLS desligada')
  if (t.politicas !== 1)
    throw new Error('vessel_sessao_aberturas: ' + t.politicas + ' politicas (esperava so a da Central)')

  // ── quem pode chamar o que ──────────────────────────────────────────────
  const porta = async (f) => (await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])).rows[0]

  const a = await porta(ABRIR)
  if (!a.anon) throw new Error('a pagina publica nao consegue contar a leitura do QR')
  if (a.autenticado || a.qualquer_um) throw new Error('a porta da abertura ficou aberta alem do necessario')

  const c = await porta(CONFERE)
  if (c.anon || c.autenticado || c.qualquer_um)
    throw new Error('vessel_sessao_do_codigo ficou aberta: vira sonda para varrer a agenda de sessoes')

  const pa = await porta(PAINEL)
  if (pa.anon || pa.qualquer_um) throw new Error('a conta das sessoes ficou aberta para a pagina publica')
  if (!pa.autenticado) throw new Error('a Central nao consegue ler a conta das sessoes')

  const pe = await porta(PEDIR)
  if (!pe.anon) throw new Error('a LP perdeu a porta de pedir atendimento')
  if (pe.autenticado || pe.qualquer_um) throw new Error('a porta da LP ficou aberta alem do necessario')

  // ── as provas ───────────────────────────────────────────────────────────
  await cli.query('savepoint prova')
  const fone = () => '5519' + String(900000000 + Math.floor(Math.random() * 9999999))

  const { codigo } = await uma(`select codigo from vessel_beauty_sessions order by quando limit 1`)
  if (!codigo) throw new Error('nao ha sessao nenhuma para provar')
  const inventado = 'BS-20991231-XXX-99'

  // 1. leitura de codigo INVENTADO nao entra, e a resposta nao denuncia.
  const r1 = await uma(`select public.vessel_visita_da_sessao($1,'mesa','qr') as r`, [inventado])
  const r2 = await uma(`select public.vessel_visita_da_sessao($1,'mesa','qr') as r`, [codigo])
  if (JSON.stringify(r1.r) !== JSON.stringify(r2.r))
    throw new Error('a resposta denuncia se a sessao existe: da para varrer a agenda de eventos')
  const { rows: ab } = await cli.query('select codigo, peca from vessel_sessao_aberturas')
  if (ab.length !== 1 || ab[0].codigo !== codigo)
    throw new Error('codigo inventado virou leitura: ' + JSON.stringify(ab))

  // 2. MESA e CARTAO contam separados — é a pergunta que a medicao existe para
  //    responder, e somar os dois a apagaria.
  await uma(`select public.vessel_visita_da_sessao($1,'cartao','qr') as r`, [codigo.toLowerCase()])
  await uma(`select public.vessel_visita_da_sessao($1,'cartao','texto') as r`, [codigo])
  const { rows: contagem } = await cli.query(
    `select peca, count(*)::int as n from vessel_sessao_aberturas
      where codigo = $1 group by peca order by peca`, [codigo])
  if (JSON.stringify(contagem) !== JSON.stringify([{ peca: 'cartao', n: 2 }, { peca: 'mesa', n: 1 }]))
    throw new Error('mesa e cartao nao contaram separados: ' + JSON.stringify(contagem))

  // 3. peca torta cai em 'mesa', e nao cria valor novo na coluna.
  await uma(`select public.vessel_visita_da_sessao($1,'inventada','qr') as r`, [codigo])
  const { rows: [{ n: tortas }] } = await cli.query(
    `select count(*)::int as n from vessel_sessao_aberturas where peca not in ('mesa','cartao')`)
  if (tortas !== 0) throw new Error('uma peca inventada entrou na coluna')

  // 4. evento INVENTADO num pedido: a cliente entra, a etiqueta nao.
  const f1 = fone()
  const p1 = await uma(
    `select public.vessel_solicitar_atendimento('Cliente do cartao torto',$1,'iguatemi',
       null,null,null,false,'v3',$2::jsonb,null,false) as r`,
    [f1, JSON.stringify({ canal: 'beauty_session', event_id: inventado, evento_id: inventado,
                          utm_source: 'beauty_session' })])
  if (!p1.r.ok || p1.r.situacao !== 'solicitado')
    throw new Error('um cartao torto derrubou o pedido da cliente: ' + JSON.stringify(p1.r))
  const o1 = await uma(
    `select o.canal, o.evento_id, o.utm_source from vessel_origens o
       join vessel_pessoas p on p.id = o.pessoa_id where p.telefone = $1`, [f1])
  if (o1.evento_id !== null)
    throw new Error('codigo inventado virou sessao na origem: ' + o1.evento_id)
  if (o1.canal === 'beauty_session')
    throw new Error('codigo inventado virou canal beauty_session no painel de atribuicao')

  // 5. evento REAL: canal e UTMs cravados no servidor, mesmo a pagina mandando
  //    outra coisa — e o MEIO do cartao e respeitado (offline_qr x whatsapp).
  const f2 = fone()
  await uma(
    `select public.vessel_solicitar_atendimento('Cliente do cartao',$1,'iguatemi',
       'ocasiao','tarde',null,false,'v3',$2::jsonb,null,false) as r`,
    [f2, JSON.stringify({
      canal: 'instagram', evento_id: codigo.toLowerCase(),
      utm_source: 'digitado_errado', utm_medium: 'whatsapp', utm_campaign: 'errado',
      utm_content: 'cartao-frente', clique_meta: 'fb.1.1758200000000.abc',
    })])
  const o2 = await uma(
    `select o.canal, o.evento_id, o.utm_source, o.utm_medium, o.utm_campaign,
            o.utm_content, o.clique_meta
       from vessel_origens o join vessel_pessoas p on p.id = o.pessoa_id
      where p.telefone = $1`, [f2])
  if (o2.evento_id !== codigo) throw new Error('a sessao nao ficou na origem: ' + JSON.stringify(o2))
  if (o2.canal !== 'beauty_session') throw new Error('o canal nao foi cravado: ' + o2.canal)
  if (o2.utm_source !== 'beauty_session')
    throw new Error('a utm_source nao foi derivada: ' + o2.utm_source)
  if (o2.utm_medium !== 'whatsapp')
    throw new Error('o meio do cartao foi perdido — sem ele nao da para separar QR de WhatsApp: ' + o2.utm_medium)
  if (o2.utm_campaign !== codigo.toLowerCase().replace(/-/g, '_'))
    throw new Error('a campanha nao foi derivada do codigo: ' + o2.utm_campaign)
  if (o2.utm_content !== 'cartao-frente') throw new Error('o utm_content da pagina foi perdido')
  if (!o2.clique_meta) throw new Error('o clique do Meta foi perdido')

  // 6. meio DESCONHECIDO no cartao cai no padrao, em vez de virar lixo na coluna.
  const f3 = fone()
  await uma(
    `select public.vessel_solicitar_atendimento('Cliente do meio torto',$1,'iguatemi',
       null,null,null,false,'v3',$2::jsonb,null,false) as r`,
    [f3, JSON.stringify({ evento_id: codigo, utm_medium: 'sei_la_o_que' })])
  const o3 = await uma(
    `select o.utm_medium from vessel_origens o join vessel_pessoas p on p.id = o.pessoa_id
      where p.telefone = $1`, [f3])
  if (o3.utm_medium !== 'offline_qr')
    throw new Error('um meio inventado entrou na coluna: ' + o3.utm_medium)

  // 7. a STYLIST ganha da sessao quando as duas vierem: a indicacao de uma
  //    pessoa e mais especifica do que o evento onde o cartao foi entregue.
  await uma(`select public.vessel_pedido_do_stylist($1,$2,$3,null,'stylist','sim','5-8','CPS',
                    true,'v3',null,null,false) as r`, ['Prova da Sessao', fone(), 'Campinas'])
  const { codigo: sty } = await uma(`select codigo from vessel_stylists order by id desc limit 1`)
  const f4 = fone()
  await uma(
    `select public.vessel_solicitar_atendimento('Cliente dos dois',$1,'iguatemi',
       null,null,null,false,'v3',$2::jsonb,null,false) as r`,
    [f4, JSON.stringify({ evento_id: codigo, stylist_id: sty })])
  const o4 = await uma(
    `select o.canal, o.stylist_id, o.evento_id from vessel_origens o
       join vessel_pessoas p on p.id = o.pessoa_id where p.telefone = $1`, [f4])
  if (o4.canal !== 'stylist' || o4.stylist_id !== sty)
    throw new Error('a stylist perdeu para a sessao: ' + JSON.stringify(o4))
  if (o4.evento_id !== codigo)
    throw new Error('o evento sumiu quando veio junto com a stylist: ' + JSON.stringify(o4))

  // ── a permissao e conferida DENTRO da funcao, nao so no grant ───────────
  let barrou = false
  try {
    await cli.query('savepoint sem_permissao')
    await cli.query('select public.vessel_conta_das_beauty_sessions(7)')
  } catch (e) {
    barrou = e.code === '42501'
    await cli.query('rollback to savepoint sem_permissao')
  }
  if (!barrou) throw new Error('quem nao tem a permissao de atendimentos leu a conta das sessoes')

  // Daqui em diante, fingindo que a permissao existe — o que a Central tera.
  await cli.query(`create or replace function public.is_vessel_atendimentos()
    returns boolean language sql stable as $f$ select true $f$`)

  const painel = (await uma(`select public.vessel_conta_das_beauty_sessions(7) as r`)).r
  const linha = painel.find((l) => l.codigo === codigo)
  if (!linha) throw new Error('a sessao nao apareceu na conta')
  if (linha.leituras_mesa !== 2 || linha.leituras_cartao !== 2)
    throw new Error('as leituras nao bateram: ' + JSON.stringify(linha))
  if (linha.pessoas !== 3)
    throw new Error('esperava 3 pessoas com etiqueta da sessao, veio ' + linha.pessoas)
  if (linha.pedidos !== 3) throw new Error('pedidos errado: ' + linha.pedidos)
  if (linha.confirmados !== 0 || linha.compareceram !== 0)
    throw new Error('pedido entrou como confirmado: ' + JSON.stringify(linha))
  if (Number(linha.receita) !== 0) throw new Error('receita saiu do nada: ' + linha.receita)
  if (linha.janela_de_venda_em_dias !== 7) throw new Error('a regua da venda nao viaja na resposta')
  if (painel.some((l) => l.codigo === inventado))
    throw new Error('a sessao inventada apareceu na conta')

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
