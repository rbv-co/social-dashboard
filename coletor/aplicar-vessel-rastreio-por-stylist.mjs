// APLICA, REGISTRA e PROVA o rastreio por stylist (T07).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-18-vessel-rastreio-por-stylist.sql'
const VISITA = 'public.vessel_visita_do_stylist(text, text)'
const CONFERE = 'public.vessel_stylist_do_codigo(text)'
const PAINEL = 'public.vessel_rastreio_dos_stylists(integer)'
const PEDIR = 'public.vessel_solicitar_atendimento(text, text, text, text, text, text, boolean, text, jsonb, text, boolean)'

// ⚠️⚠️ ESTE APLICADOR ENVELHECEU: RODAR DE NOVO RESSUSCITA UMA ASSINATURA
// MORTA. A migration deste arquivo faz `create or replace function
// public.vessel_rastreio_dos_stylists(p_dias integer default 7)` — UM
// parâmetro. A T12 (a tela do Stylist Circle ganhar cadastrar, corrigir e
// desativar) precisou de um SEGUNDO parâmetro (`p_incluir_desativadas`) para
// devolver quem está desativada só quando a tela pede, e por isso a migration
// dela começa com `drop function if exists
// public.vessel_rastreio_dos_stylists(integer)` antes de criar a versão de
// dois parâmetros — `create or replace` não troca uma função por outra de
// assinatura diferente, então sem o `drop` as duas ficariam sobrepostas.
// Reaplicar ESTE arquivo depois da T12 recria a versão de UM parâmetro do
// zero: o banco passa a ter as DUAS assinaturas ao mesmo tempo, e uma chamada
// por nome de parâmetro (`{p_dias: 7}`, do jeito que a Central chama) morre
// com "function is not unique" — a tela do Stylist Circle quebra inteira,
// sem erro nenhum até o clique de alguém.
const DEPOIS_DESTE = [
  {
    migration: '2026-09-20-vessel-rastreio-devolve-ativa-e-contato.sql',
    estrago:
      'ressuscitaria `vessel_rastreio_dos_stylists(integer)` — a assinatura de\n' +
      '       UM parâmetro que aquela migration derrubou de propósito — ao lado da\n' +
      '       de dois parâmetros que ela criou. Com as duas no banco, uma chamada\n' +
      '       por nome de parâmetro (o jeito que a Central chama) responde\n' +
      '       "function is not unique" e a tela do Stylist Circle para de\n' +
      '       carregar, sem erro nenhum até o clique de alguém.',
  },
]

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()

// ⚠️ ANTES DE ABRIR TRANSAÇÃO E ANTES DE APLICAR QUALQUER COISA.
const { rows: posteriores } = await cli.query(
  `select name from public.schema_migrations where name = any($1::text[]) order by name`,
  [DEPOIS_DESTE.map((x) => x.migration)])
if (posteriores.length > 0) {
  console.error(
    `❌ nao aplicada: ${ARQUIVO} ja foi superada e reaplica-la ressuscitaria assinatura morta.\n\n` +
    `Esta migration faz \`create or replace\` em ` +
    `\`vessel_rastreio_dos_stylists(integer)\`.\n` +
    `Migration(s) mais nova(s) JA APLICADA(S) trocaram essa assinatura, e rodar este\n` +
    `aplicador agora recriaria a versao antiga do lado da nova:\n\n` +
    posteriores.map(({ name }) =>
      `  · ${name}\n       ${DEPOIS_DESTE.find((x) => x.migration === name).estrago}`).join('\n\n') +
    `\n\nVa ler essa migration em db/migrations/ antes de qualquer coisa. Se voce PRECISA mesmo\n` +
    `reaplicar este arquivo, a saida NAO e apagar esta trava: e reaplicar a migration\n` +
    `posterior logo depois, pelo aplicador dela.\n`)
  await cli.end()
  process.exit(1)
}

await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-rastreio-por-stylist.mjs'])

  // ── a tabela ────────────────────────────────────────────────────────────
  const { rows: [t] } = await cli.query(
    `select c.relrowsecurity as trava,
            (select count(*)::int from pg_policies p
              where p.schemaname='public' and p.tablename='vessel_stylist_aberturas') as politicas
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='vessel_stylist_aberturas'`)
  if (!t?.trava) throw new Error('vessel_stylist_aberturas: RLS desligada')
  if (t.politicas !== 1) throw new Error('vessel_stylist_aberturas: ' + t.politicas + ' politicas (esperava so a da Central)')

  // ── quem pode chamar o que ──────────────────────────────────────────────
  const porta = async (f) => (await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])).rows[0]

  const v = await porta(VISITA)
  if (!v.anon) throw new Error('a pagina publica nao consegue contar a abertura')
  if (v.autenticado || v.qualquer_um) throw new Error('a porta da abertura ficou aberta alem do necessario')

  const c = await porta(CONFERE)
  if (c.anon || c.autenticado || c.qualquer_um)
    throw new Error('vessel_stylist_do_codigo ficou aberta: vira sonda para varrer a lista de stylists')

  const pa = await porta(PAINEL)
  if (pa.anon || pa.qualquer_um) throw new Error('o painel de stylists ficou aberto para a pagina publica')
  if (!pa.autenticado) throw new Error('a Central nao consegue ler o painel')

  const pe = await porta(PEDIR)
  if (!pe.anon) throw new Error('a LP perdeu a porta de pedir atendimento')
  if (pe.autenticado || pe.qualquer_um) throw new Error('a porta da LP ficou aberta alem do necessario')

  // ── as provas ───────────────────────────────────────────────────────────
  await cli.query('savepoint prova')
  const fone = () => '5519' + String(900000000 + Math.floor(Math.random() * 9999999))
  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

  // Uma stylist de verdade, pela porta da LP do Circle.
  await uma(`select public.vessel_pedido_do_stylist($1,$2,$3,null,'stylist','sim','5-8','CPS',
                    true,'v3',null,null,false) as r`, ['Raissa Herculano', fone(), 'Campinas'])
  const { codigo } = await uma(`select codigo from vessel_stylists order by id desc limit 1`)
  if (!/^STY-\d{4}$/.test(codigo)) throw new Error('o codigo saiu ' + codigo)

  // 1. abertura de codigo INVENTADO nao entra.
  const inventado = 'STY-9999' === codigo ? 'STY-9998' : 'STY-9999'
  const r1 = await uma(`select public.vessel_visita_do_stylist($1,'qr') as r`, [inventado])
  const r2 = await uma(`select public.vessel_visita_do_stylist($1,'qr') as r`, [codigo])
  if (JSON.stringify(r1.r) !== JSON.stringify(r2.r))
    throw new Error('a resposta denuncia se o codigo existe: da para varrer a lista de stylists')
  const { rows: ab } = await cli.query('select codigo, via from vessel_stylist_aberturas')
  if (ab.length !== 1 || ab[0].codigo !== codigo)
    throw new Error('codigo inventado virou trafego de uma stylist: ' + JSON.stringify(ab))

  // 2. minuscula no endereco vale, e `via` vem do texto quando e o caso.
  await uma(`select public.vessel_visita_do_stylist($1,'texto') as r`, [codigo.toLowerCase()])
  const { rows: ab2 } = await cli.query(
    `select via from vessel_stylist_aberturas where codigo = $1 order by id`, [codigo])
  if (ab2.length !== 2 || ab2[1].via !== 'texto')
    throw new Error('o link em minuscula nao contou: ' + JSON.stringify(ab2))

  // 3. codigo INVENTADO num pedido: a cliente entra, a etiqueta nao.
  const f1 = fone()
  const p1 = await uma(
    `select public.vessel_solicitar_atendimento('Cliente do link torto',$1,'iguatemi',
       null,null,null,false,'v3',$2::jsonb,null,false) as r`,
    [f1, JSON.stringify({ canal: 'stylist', stylist_id: inventado, utm_source: 'stylist' })])
  if (!p1.r.ok || p1.r.situacao !== 'solicitado')
    throw new Error('um link torto derrubou o pedido da cliente: ' + JSON.stringify(p1.r))
  const o1 = await uma(
    `select o.canal, o.stylist_id, o.utm_source from vessel_origens o
       join vessel_pessoas p on p.id = o.pessoa_id
      where p.telefone = $1`, [f1])
  if (o1.stylist_id !== null)
    throw new Error('codigo inventado virou stylist na origem: ' + o1.stylist_id)
  if (o1.canal === 'stylist')
    throw new Error('codigo inventado virou canal stylist no painel de atribuicao')

  // 4. codigo REAL: o canal e as UTMs sao cravados no servidor, mesmo com a
  //    pagina mandando outra coisa.
  const f2 = fone()
  await uma(
    `select public.vessel_solicitar_atendimento('Cliente da Raissa',$1,'iguatemi',
       'ocasiao','tarde',null,false,'v3',$2::jsonb,null,false) as r`,
    [f2, JSON.stringify({
      canal: 'instagram', stylist_id: codigo.toLowerCase(),
      utm_source: 'digitado_errado', utm_medium: 'qualquer', utm_campaign: 'sty0001',
      utm_content: 'story-3', clique_meta: 'fb.1.1758200000000.abc',
    })])
  const o2 = await uma(
    `select o.canal, o.stylist_id, o.utm_source, o.utm_medium, o.utm_campaign,
            o.utm_content, o.clique_meta
       from vessel_origens o join vessel_pessoas p on p.id = o.pessoa_id
      where p.telefone = $1`, [f2])
  if (o2.stylist_id !== codigo) throw new Error('a stylist nao ficou na origem: ' + JSON.stringify(o2))
  if (o2.canal !== 'stylist') throw new Error('o canal nao foi cravado: ' + o2.canal)
  if (o2.utm_source !== 'stylist' || o2.utm_medium !== 'referral'
      || o2.utm_campaign !== codigo.toLowerCase().replace('-', '_'))
    throw new Error('as UTMs nao foram derivadas do codigo: ' + JSON.stringify(o2))
  if (o2.utm_content !== 'story-3') throw new Error('o utm_content da pagina foi perdido')
  if (!o2.clique_meta) throw new Error('o clique do Meta foi perdido: o retorno de evento depende dele')

  // 5. a conta nao dobra quando a mesma cliente manda o formulario duas vezes.
  await uma(
    `select public.vessel_solicitar_atendimento('Cliente da Raissa',$1,'tivoli',
       null,null,null,false,'v3',$2::jsonb,null,false) as r`,
    [f2, JSON.stringify({ stylist_id: codigo })])
  const { rows: [{ n: linhas }] } = await cli.query(
    `select count(*)::int as n from vessel_origens where stylist_id = $1`, [codigo])
  if (linhas !== 2) throw new Error('esperava 2 linhas de origem (first touch so acrescenta), veio ' + linhas)

  // ⚠️ A PERMISSAO E CONFERIDA DENTRO DA FUNCAO, nao so no grant. `auth.uid()`
  // e nulo nesta conexao (nao ha sessao), entao `is_vessel_atendimentos()`
  // responde false — e e exatamente o caso de "sessao autenticada SEM a
  // permissao de atendimentos".
  let barrou = false
  try {
    await cli.query('savepoint sem_permissao')
    await cli.query('select public.vessel_rastreio_dos_stylists(7)')
  } catch (e) {
    barrou = e.code === '42501'
    await cli.query('rollback to savepoint sem_permissao')
  }
  if (!barrou)
    throw new Error('quem nao tem a permissao de atendimentos leu a lista inteira de stylists')

  // Daqui em diante, fingindo que a permissao existe — o que a Central tera.
  // ⚠️ Dentro do savepoint: o `rollback to savepoint prova` devolve a funcao de
  // verdade antes do commit.
  await cli.query(`create or replace function public.is_vessel_atendimentos()
    returns boolean language sql stable as $f$ select true $f$`)

  const painel = (await uma(`select public.vessel_rastreio_dos_stylists(7) as r`)).r
  const linha = painel.find((l) => l.codigo === codigo)
  if (!linha) throw new Error('a stylist nao apareceu no painel')
  if (linha.aberturas !== 2) throw new Error('trafego errado: ' + linha.aberturas)
  if (linha.clientes !== 1)
    throw new Error('a mesma cliente contou ' + linha.clientes + ' vezes: a conta dobra por linha de origem')
  if (linha.pedidos !== 2) throw new Error('pedidos errado: ' + linha.pedidos)
  if (linha.confirmados !== 0 || linha.compareceram !== 0)
    throw new Error('pedido entrou como confirmado: ' + JSON.stringify(linha))
  if (Number(linha.receita) !== 0) throw new Error('receita saiu do nada: ' + linha.receita)
  if (linha.janela_de_venda_em_dias !== 7)
    throw new Error('a regua da venda nao viaja na resposta')
  if (painel.some((l) => l.codigo === inventado))
    throw new Error('a stylist inventada apareceu no painel')

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
