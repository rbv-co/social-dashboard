// APLICA, REGISTRA e PROVA o cadastro de lead PELA EQUIPE dentro da Beauty Session.
//
//   node coletor/aplicar-vessel-beauty-cadastro-pela-equipe.mjs            → ensaio: prova tudo e DESFAZ
//   node coletor/aplicar-vessel-beauty-cadastro-pela-equipe.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ O MESMO DESENHO DE `aplicar-vessel-t11-bases-do-stylist-circle.mjs`:
// tudo numa transação só (aplicar, registrar em `schema_migrations`, provar) e
// só então `commit`. Sem `--gravar` o fim é `rollback`.
//
// ⚠️ A PROVA FALA COMO GENTE DE VERDADE: perfis de mentira em
// `auth.users`/`profiles` e `request.jwt.claims` com o `sub` deles. E mora
// inteira dentro de savepoints desfeitos: toda linha que ela vê é linha que
// ela fez. A impressão das tabelas reais é tirada antes e conferida depois.
//
// ⚠️ O QR É PROVADO ANTES E DEPOIS DA MIGRATION: a mesma chamada à porta
// pública, numa sessão de prova, com a versão velha e com a nova. O que ela
// grava (origem, atendimento, permissões) tem de sair IGUAL nas duas.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-24-beauty-session-cadastro-pela-equipe.sql'
const GRAVAR = process.argv.includes('--gravar')

const PORTAS = {
  vessel_beauty_session_cadastrar_lead: 'vessel_beauty_session_cadastrar_lead(text,text,text,text,text)',
  vessel_leads_da_beauty_session: 'vessel_leads_da_beauty_session(text,integer)',
  vessel_conta_das_beauty_sessions: 'vessel_conta_das_beauty_sessions(integer,boolean)',
  vessel_beauty_session_apagar: 'vessel_beauty_session_apagar(text)',
}

// Sessões e telefones sintéticos: nenhum deles existe no banco (conferido
// abaixo, antes de tudo, e depois de tudo).
const BS_ABERTA = 'BS-20990101-CPS-P1'
const BS_ENCERRADA = 'BS-20990102-CPS-P2'
const BS_ARQUIVADA = 'BS-20990103-CPS-P3'
const BS_VAZIA = 'BS-20990104-CPS-P4'
const FONE_QR = '5519990002401'
const FONE_NOVA = '5519990002402'
const FONE_BASE = '5519990002403'
const FONE_TESTE = '5519990002404'
const FONES = [FONE_QR, FONE_NOVA, FONE_BASE, FONE_TESTE]
const VERSAO = 'equipe-beauty-session-2026-09-24'

const IMPRESSAO = `
  select (select count(*) from public.vessel_pedidos)::int as pedidos,
         (select count(*) from public.vessel_pedidos where bling_pedido_id < 0)::int as pedidos_de_prova,
         (select count(*) from public.vessel_pessoas)::int as pessoas,
         (select count(*) from public.vessel_pessoas
           where telefone in (${FONES.map((f) => `'${f}'`).join(',')}))::int as pessoas_de_prova,
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
            from (select id, pessoa_id, loja, quando, status, origem_registro, interesse, teste
                    from public.vessel_atendimentos) t) as atendimentos,
         (select count(*) from public.vessel_origens)::int as origens,
         (select count(*) from public.vessel_consentimentos)::int as consentimentos,
         (select md5(coalesce(string_agg(s::text, '|' order by s.codigo), ''))
            from public.vessel_beauty_sessions s) as beauty_sessions,
         (select count(*) from public.vessel_beauty_sessions where codigo like 'BS-2099%')::int as sessoes_de_prova,
         to_regclass('public.vessel_beauty_session_cadastros') is not null as tabela_nova`

const falhas = []
let provas = 0
const conferir = (ok, frase, detalhe) => {
  provas++
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r

const antes = await uma(IMPRESSAO)
const { ja } = await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ja`, [ARQUIVO])
if (ja) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }
if (antes.pessoas_de_prova || antes.sessoes_de_prova || antes.pedidos_de_prova) {
  console.error('❌ já existe dado com a marca de prova no banco — não sigo.', antes); process.exit(1)
}

// A mesma chamada da página do QR, com o `p_origem` que o site monta.
const origemDoSite = (codigo) => JSON.stringify({ canal: 'beauty_session', evento_id: codigo,
  utm_source: 'beauty_session', utm_medium: 'offline_qr', utm_campaign: codigo.toLowerCase().replaceAll('-', '_') })
const chamarOQr = (codigo, nome, fone, extra = {}) => r(
  `public.vessel_interesse_da_beauty_session($1, $2, $3, p_interesse => $4, p_aceite_marketing => $5,
     p_aceite_versao => 'privacidade-v3', p_origem => $6::jsonb, p_teste => $7, p_instagram => $8)`,
  [nome, fone, codigo, extra.interesse ?? 'conhecer-a-loja', extra.marketing ?? false,
    origemDoSite(codigo), extra.teste ?? false, extra.instagram ?? null])

// O que o QR grava, sem id nem instante (que mudam de uma rodada para outra).
async function oQueOQrGravou(fone) {
  return uma(`
    select (select json_agg(json_build_object('canal', o.canal, 'evento', o.evento_id, 'src', o.utm_source,
                    'med', o.utm_medium, 'camp', o.utm_campaign) order by o.id)
              from public.vessel_origens o where o.pessoa_id = pe.id) as origens,
           (select json_agg(json_build_object('loja', t.loja, 'status', t.status, 'reg', t.origem_registro,
                    'interesse', t.interesse, 'teste', t.teste, 'ip', t.ip_hash is not null) order by t.id)
              from public.vessel_atendimentos t where t.pessoa_id = pe.id) as atendimentos,
           (select json_agg(json_build_object('fin', c.finalidade, 'versao', c.versao, 'fonte', c.fonte) order by c.id)
              from public.vessel_consentimentos c where c.pessoa_id = pe.id) as consentimentos,
           pe.nome, pe.instagram, pe.teste
      from public.vessel_pessoas pe where pe.telefone = $1`, [fone])
}

const sessaoDeProva = (codigo, ativa, arquivada) => cli.query(
  `insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro, ativa, arquivada)
   values ($1, '2099-01-01', 'CPS', 'iguatemi', 'Salão da Prova', $2, $3)`, [codigo, ativa, arquivada])

await cli.query('begin')
try {
  // A página do QR fala sem login, com o IP no cabeçalho.
  const comoAPaginaDoQr = () => cli.query(`select set_config('request.jwt.claims', '', true),
    set_config('request.headers', '{"x-forwarded-for":"203.0.113.77"}', true)`)

  console.log('\n── o QR, ANTES da migration')
  await cli.query('savepoint qr_antes')
  await sessaoDeProva(BS_ABERTA, true, false)
  await comoAPaginaDoQr()
  const qrAntes = await chamarOQr(BS_ABERTA, 'Rita do QR', '(19) 99000-2401', { marketing: true, instagram: '@rita' })
  const gravouAntes = await oQueOQrGravou(FONE_QR)
  conferir(qrAntes.ok === true && gravouAntes?.origens?.length === 1, 'a página do QR grava hoje (versão velha)', { qrAntes, gravouAntes })
  await cli.query('rollback to savepoint qr_antes')

  console.log('\n── aplicar')
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-beauty-cadastro-pela-equipe.mjs'])

  console.log('\n── as portas')
  for (const [nome, assinatura] of Object.entries(PORTAS)) {
    const { quantas, lista } = await uma(
      `select count(*)::int as quantas, string_agg(p.oid::regprocedure::text, ' | ') as lista
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nome])
    conferir(quantas === 1 && lista === assinatura, `${nome}: uma assinatura só`, lista)
    const pr = await uma(
      `select has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
              has_function_privilege('anon', $1, 'EXECUTE') as anon`, [`public.${assinatura}`])
    conferir(pr.aut === true && pr.anon === false, `${nome}: a Central entra, a página pública não`, pr)
  }
  const pub = await uma(`select has_function_privilege('anon', $1, 'EXECUTE') as anon,
      has_function_privilege('authenticated', $1, 'EXECUTE') as aut,
      has_function_privilege('anon', $2, 'EXECUTE') as miolo_anon,
      has_function_privilege('authenticated', $2, 'EXECUTE') as miolo_aut`,
    ['public.vessel_interesse_da_beauty_session(text,text,text,text,boolean,text,jsonb,text,boolean,text)',
      'public.vessel_anotar_interesse(text,text,text,text,text,text,text,text,text,boolean,text,jsonb,boolean,text)'])
  conferir(pub.anon === true && pub.aut === false && pub.miolo_anon === false && pub.miolo_aut === false,
    'a porta do QR continua só da página pública, e o miolo continua fechado', pub)
  const tab = await uma(`select c.relrowsecurity as rls,
      has_table_privilege('anon', 'public.vessel_beauty_session_cadastros', 'SELECT') as anon_le,
      has_table_privilege('authenticated', 'public.vessel_beauty_session_cadastros', 'SELECT') as aut_le,
      has_table_privilege('authenticated', 'public.vessel_beauty_session_cadastros', 'INSERT') as aut_grava
      from pg_class c where c.oid = 'public.vessel_beauty_session_cadastros'::regclass`)
  conferir(tab.rls === true && !tab.anon_le && !tab.aut_le && !tab.aut_grava,
    'a tabela nova: RLS ligada e ninguém lê ou grava pela API', tab)

  await cli.query('savepoint prova')

  // ── perfis de mentira ──
  const perfil = async (nome, features, permissions) => {
    const id = randomUUID()
    const email = `prova-bs-equipe-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(
      `insert into public.profiles (id, email, name, features, permissions, is_superadmin)
       values ($1, $2, $3, $4, $5::jsonb, false)`, [id, email, nome, features, JSON.stringify(permissions)])
    return id
  }
  const falarComo = async (id) => cli.query(`select set_config('request.jwt.claims', $1, true),
      set_config('request.headers', '{"x-forwarded-for":"203.0.113.77"}', true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])
  const soVe = await perfil('Vera Só Vê', ['atendimentos'], { atendimentos: ['ver'] })
  const mexe = await perfil('Ionara da Prova', ['atendimentos'], { atendimentos: ['ver', 'editar'] })

  await sessaoDeProva(BS_ABERTA, true, false)
  await sessaoDeProva(BS_ENCERRADA, false, false)
  await sessaoDeProva(BS_ARQUIVADA, true, true)
  await sessaoDeProva(BS_VAZIA, true, false)

  console.log('\n── o QR, DEPOIS da migration: igual')
  await comoAPaginaDoQr()
  const qrDepois = await chamarOQr(BS_ABERTA, 'Rita do QR', '(19) 99000-2401', { marketing: true, instagram: '@rita' })
  const gravouDepois = await oQueOQrGravou(FONE_QR)
  conferir(qrDepois.ok === true && JSON.stringify(gravouDepois) === JSON.stringify(gravouAntes),
    'a página do QR grava EXATAMENTE o mesmo que antes (origem, atendimento, permissões, ficha)',
    { gravouAntes, gravouDepois })
  const qrEncerrada = await chamarOQr(BS_ENCERRADA, 'Outra', '(19) 99000-2409')
  conferir(qrEncerrada.situacao === 'evento_encerrado', 'o QR de sessão encerrada continua recusando (só a equipe pode)', qrEncerrada)

  console.log('\n── quem não pode, não cadastra')
  const tentar = (codigo, nome, fone, extra = {}) => r(
    `public.vessel_beauty_session_cadastrar_lead($1, $2, $3, p_instagram => $4, p_interesse => $5)`,
    [codigo, nome, fone, extra.instagram ?? null, extra.interesse ?? null])
  await falarComo(null)
  try {
    await cli.query('savepoint anon')
    await cli.query('set local role anon')
    await tentar(BS_ABERTA, 'Anônima', FONE_NOVA)
    conferir(false, 'a página pública (anon) não chama a porta da equipe', 'respondeu')
  } catch (e) {
    await cli.query('rollback to savepoint anon')
    conferir(e.code === '42501', 'a página pública (anon) não chama a porta da equipe: 42501', e.code)
  }
  const semSessao = await tentar(BS_ABERTA, 'Sem Login', FONE_NOVA)
  conferir(semSessao.situacao === 'sem_permissao', 'sem login (mesmo por dentro) é recusado', semSessao)
  await falarComo(soVe)
  const soVendo = await tentar(BS_ABERTA, 'Só Vendo', FONE_NOVA)
  conferir(soVendo.situacao === 'sem_permissao', 'quem só VÊ atendimentos não cadastra', soVendo)
  const { n: nadaGravado } = await uma(`select count(*)::int as n from public.vessel_pessoas where telefone = $1`, [FONE_NOVA])
  conferir(nadaGravado === 0, '…e nada foi gravado', nadaGravado)

  console.log('\n── as conferências, na ordem')
  await falarComo(mexe)
  conferir((await tentar('BS-20990199-CPS-XX', 'Ana', FONE_NOVA)).situacao === 'nao_achei', 'sessão que não existe (ou apagada): nao_achei')
  const arq = await tentar(BS_ARQUIVADA, 'Ana Arquivada', FONE_NOVA)
  conferir(arq.ok === false && arq.situacao === 'sessao_arquivada', 'sessão ARQUIVADA recusa', arq)
  conferir((await tentar(BS_ABERTA, ' A ', FONE_NOVA)).situacao === 'sem_nome', 'nome com menos de 2 letras recusa')
  const foneRuim = await tentar(BS_ABERTA, 'Ana Prova', '19 9900')
  conferir(foneRuim.situacao === 'whatsapp_invalido', 'telefone inválido recusa', foneRuim)
  conferir((await tentar(BS_ABERTA, 'Ana Prova', '+351 912 345 678')).situacao === 'whatsapp_invalido',
    'telefone de fora do Brasil recusa (o banco só guarda 55 + DDD + número)')
  conferir((await tentar(BS_ABERTA, 'Ana Prova', FONE_NOVA, { instagram: 'x'.repeat(121) })).situacao === 'instagram_longo',
    'Instagram de 121 letras recusa (o teto do QR)')
  conferir((await tentar(BS_ABERTA, 'Ana Prova', FONE_NOVA, { interesse: 'comprar-tudo' })).situacao === 'interesse_invalido',
    'interesse fora das três opções recusa')
  const { n: nadaAinda } = await uma(`select count(*)::int as n from public.vessel_pessoas where telefone = $1`, [FONE_NOVA])
  conferir(nadaAinda === 0, 'nenhuma recusa gravou nada', nadaAinda)

  console.log('\n── pessoa NOVA, pela equipe')
  const nova = await tentar(BS_ABERTA, '  Ana   da   Prova ', '(19) 99000-2402',
    { instagram: '@anadaprova', interesse: 'rever-uma-peca' })
  conferir(nova.ok === true && nova.ja_na_base === false && nova.nome === 'Ana da Prova',
    'cadastra pessoa nova (nome limpo, "não estava na base")', nova)
  const pNova = await uma(`select * from public.vessel_pessoas where id = $1`, [nova.pessoa_id])
  conferir(pNova.telefone === FONE_NOVA && pNova.instagram === '@anadaprova' && pNova.teste === false,
    'a ficha nasce com telefone canônico e Instagram', pNova)
  const oNova = await uma(`select * from public.vessel_origens where pessoa_id = $1`, [nova.pessoa_id])
  conferir(oNova.canal === 'beauty_session' && oNova.evento_id === BS_ABERTA && oNova.utm_source === 'beauty_session'
    && oNova.utm_medium === 'offline_equipe' && oNova.utm_campaign === 'bs_20990101_cps_p1',
    'a origem leva a marca da equipe (utm_medium offline_equipe) e o evento da sessão', oNova)
  const aNova = await uma(`select * from public.vessel_atendimentos where id = $1`, [nova.atendimento_id])
  conferir(Number(aNova.pessoa_id) === Number(nova.pessoa_id) && aNova.loja === 'iguatemi' && aNova.status === 'solicitado'
    && aNova.origem_registro === 'beauty-session-equipe' && aNova.interesse === 'rever-uma-peca'
    && aNova.ip_hash === null && aNova.teste === false,
    'o atendimento abre na loja da sessão, com origem_registro próprio e SEM ip (não gasta o limite do QR)', aNova)
  const cNova = (await cli.query(`select finalidade, versao, fonte from public.vessel_consentimentos
      where pessoa_id = $1 order by id`, [nova.pessoa_id])).rows
  conferir(cNova.length === 2 && cNova[0].finalidade === 'atendimento' && cNova[1].finalidade === 'marketing'
    && cNova.every((c) => c.versao === VERSAO && c.fonte === 'beauty-session-equipe'),
    'atendimento E marketing, os dois com a versão da equipe', cNova)
  const cad = await uma(`select * from public.vessel_beauty_session_cadastros where pessoa_id = $1`, [nova.pessoa_id])
  conferir(cad.codigo === BS_ABERTA && cad.cadastrado_por === mexe && cad.cadastrado_por_nome === 'Ionara da Prova'
    && Number(cad.atendimento_id) === Number(nova.atendimento_id),
    'guarda QUEM da equipe cadastrou', cad)

  console.log('\n── duplicata na mesma sessão')
  const dupEquipe = await tentar(BS_ABERTA, 'Ana outra vez', '19990002402')
  conferir(dupEquipe.ok === false && dupEquipe.situacao === 'ja_estava' && dupEquipe.porta === 'equipe'
    && dupEquipe.nome === 'Ana da Prova', 'a mesma pessoa de novo: recusada com aviso ("já pela equipe")', dupEquipe)
  const dupQr = await tentar(BS_ABERTA, 'Rita pela equipe', FONE_QR)
  conferir(dupQr.situacao === 'ja_estava' && dupQr.porta === 'qr', 'quem já leu o QR: recusada com aviso ("já pelo QR")', dupQr)
  const contagem = await uma(`select
      (select count(*) from public.vessel_origens o join public.vessel_pessoas pe on pe.id = o.pessoa_id
        where pe.telefone in ($1, $2))::int as origens,
      (select count(*) from public.vessel_beauty_session_cadastros)::int as cadastros`, [FONE_NOVA, FONE_QR])
  conferir(contagem.origens === 2 && contagem.cadastros === 1, '…e nada foi duplicado', contagem)

  console.log('\n── pessoa QUE JÁ ESTAVA NA BASE (por outra porta)')
  await cli.query(`insert into public.vessel_pessoas (nome, telefone, email) values ('Bia da Base', $1, 'bia@prova.test')`, [FONE_BASE])
  const base = await tentar(BS_ENCERRADA, 'Beatriz Digitada', '+55 (19) 99000-2403')
  const pBase = await uma(`select nome, email, (select count(*)::int from public.vessel_pessoas where telefone = $1) as fichas
      from public.vessel_pessoas where telefone = $1`, [FONE_BASE])
  conferir(base.ok === true && base.ja_na_base === true && base.nome === 'Bia da Base'
    && pBase.fichas === 1 && pBase.nome === 'Bia da Base' && pBase.email === 'bia@prova.test',
    'reaproveita a ficha: uma só, o nome e o e-mail que já estavam ficam', { base, pBase })
  conferir(base.ok === true, 'sessão ENCERRADA aceita o cadastro da equipe')
  const outraSessao = await tentar(BS_ABERTA, 'Bia', FONE_BASE)
  conferir(outraSessao.ok === true, 'a mesma pessoa pode entrar em OUTRA sessão (a duplicata é por sessão)', outraSessao)

  console.log('\n── os números e a lista')
  // Uma ficha de TESTE que leu o QR: não pode contar em "Se identificaram".
  await comoAPaginaDoQr()
  await chamarOQr(BS_ABERTA, 'Teste Interno', FONE_TESTE, { teste: true })
  await falarComo(mexe)
  // A Ana (equipe) foi à loja e comprou; a Rita (QR) foi e não comprou.
  await cli.query(`update public.vessel_atendimentos set status = 'realizado', quando = now() - interval '1 day'
      where id = $1`, [nova.atendimento_id])
  await cli.query(`update public.vessel_atendimentos set status = 'realizado', quando = now() - interval '1 day'
      where pessoa_id = (select id from public.vessel_pessoas where telefone = $1)`, [FONE_QR])
  await cli.query(`insert into public.vessel_pedidos (bling_pedido_id, numero, pessoa_id, data_do_pedido, situacao_id, receita_liquida)
      values (-990101, 'PROVA-BS-1', $1, (now() at time zone 'America/Sao_Paulo')::date, 9, 2500)`, [nova.pessoa_id])
  const conta = Object.fromEntries((await r(`public.vessel_conta_das_beauty_sessions(7, true)`)).map((s) => [s.codigo, s]))
  const a = conta[BS_ABERTA]
  // ABERTA: Rita (QR), Ana (equipe), Bia (equipe), e o teste (fora).
  conferir(a.pessoas === 3 && a.pessoas_qr === 1 && a.pessoas_equipe === 2,
    '"Se identificaram" separa QR × equipe e as duas portas somam o total', a)
  const { n: comTeste } = await uma(`select count(distinct pessoa_id)::int as n from public.vessel_origens where evento_id = $1`, [BS_ABERTA])
  conferir(comTeste === 4 && a.pessoas === 3, '`pessoas` EXCLUI a ficha de teste (eram 4 origens, contam 3)', { comTeste, pessoas: a.pessoas })
  conferir(a.compareceram === 2 && Number(a.receita) === 2500,
    '"Foram à loja" e "Receita" contam as duas portas (a da equipe comprou)', a)
  conferir(conta[BS_ENCERRADA].pessoas_equipe === 1 && conta[BS_ENCERRADA].pessoas === 1, 'a encerrada conta a lead da equipe', conta[BS_ENCERRADA])
  const lista = await r(`public.vessel_leads_da_beauty_session($1, 7)`, [BS_ABERTA])
  const porFone = Object.fromEntries(lista.map((l) => [l.telefone, l]))
  conferir(lista.length === 3 && !porFone[FONE_TESTE], 'a lista da sessão traz as 3, sem a de teste', lista)
  conferir(porFone[FONE_NOVA].porta === 'equipe' && porFone[FONE_NOVA].cadastrado_por_nome === 'Ionara da Prova'
    && porFone[FONE_NOVA].foi_a_loja === true && porFone[FONE_NOVA].comprou === true && porFone[FONE_NOVA].instagram === '@anadaprova',
    'lead da equipe: porta, quem cadastrou, foi à loja e comprou', porFone[FONE_NOVA])
  conferir(porFone[FONE_QR].porta === 'qr' && porFone[FONE_QR].cadastrado_por_nome === null
    && porFone[FONE_QR].foi_a_loja === true && porFone[FONE_QR].comprou === false,
    'lead do QR: porta QR, sem "quem cadastrou", foi à loja e não comprou', porFone[FONE_QR])
  await falarComo(null)
  try {
    await cli.query('savepoint lista_sem_login')
    await r(`public.vessel_leads_da_beauty_session($1, 7)`, [BS_ABERTA])
    conferir(false, 'a lista sem login recusa com 42501 (não é lista vazia)', 'respondeu')
  } catch (e) {
    await cli.query('rollback to savepoint lista_sem_login')
    conferir(e.code === '42501', 'a lista sem login recusa com 42501 (não é lista vazia)', e.code)
  }
  await falarComo(soVe)
  conferir((await r(`public.vessel_leads_da_beauty_session($1, 7)`, [BS_ABERTA])).length === 3, 'quem só vê, vê a lista')

  console.log('\n── apagar')
  await falarComo(mexe)
  const apagarComLead = await r(`public.vessel_beauty_session_apagar($1)`, [BS_ENCERRADA])
  conferir(apagarComLead.situacao === 'tem_leads', 'sessão sem leitura mas com lead não se apaga (tem_leads)', apagarComLead)
  const apagarVazia = await r(`public.vessel_beauty_session_apagar($1)`, [BS_VAZIA])
  conferir(apagarVazia.ok === true, 'sessão vazia continua se apagando', apagarVazia)
  await cli.query(`insert into public.vessel_sessao_aberturas (codigo, peca) values ($1, 'mesa')`, [BS_ABERTA])
  conferir((await r(`public.vessel_beauty_session_apagar($1)`, [BS_ABERTA])).situacao === 'tem_gente',
    'sessão com leitura continua dizendo tem_gente (a frase de antes)')

  await cli.query('rollback to savepoint prova')
  const depoisDaProva = await uma(IMPRESSAO)
  for (const chave of ['pedidos_de_prova', 'pessoas_de_prova', 'sessoes_de_prova']) {
    conferir(depoisDaProva[chave] === 0, `${chave}: nenhum resquício de teste`, depoisDaProva[chave])
  }
  const { pedidos: _p1, tabela_nova: _t1, ...antesEstavel } = antes
  const { pedidos: _p2, tabela_nova: _t2, ...depoisEstavel } = depoisDaProva
  conferir(JSON.stringify(depoisEstavel) === JSON.stringify(antesEstavel),
    'a prova não deixou rastro nas tabelas reais (fora os pedidos, que o robô do Bling mexe sozinho)',
    { antes: antesEstavel, depoisDaProva: depoisEstavel })

  if (falhas.length) throw new Error(`${falhas.length} de ${provas} conferência(s) falharam`)

  if (GRAVAR) {
    const fim = await cli.query('commit')
    if (fim.command !== 'COMMIT') throw new Error(`o commit voltou como ${fim.command}`)
    console.log(`\n✅ ${ARQUIVO} aplicada e registrada (${provas} provas).`)
  } else {
    await cli.query('rollback')
    console.log(`\n✅ ensaio limpo: ${provas} provas, todas passaram, e NADA foi gravado. Rode com --gravar para valer.`)
  }
} catch (e) {
  await cli.query('rollback')
  console.error(`\n❌ nada foi gravado: ${e.message}`)
  process.exitCode = 1
} finally {
  await cli.end()
}

// ⚠️ NUMA CONEXÃO NOVA: é o que o resto do mundo vê. No ensaio, a tabela nova
// NÃO pode existir e a migration NÃO pode estar registrada; gravando, as duas
// têm de estar lá.
if (!process.exitCode) {
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  const agora = (await outra.query(IMPRESSAO)).rows[0]
  const reg = (await outra.query(`select 1 from public.schema_migrations where name = $1`, [ARQUIVO])).rowCount
  await outra.end()
  const { pedidos: _a, tabela_nova: _b, ...antesEstavel } = antes
  const { pedidos: _c, tabela_nova: tabelaAgora, ...agoraEstavel } = agora
  const esperado = GRAVAR ? (tabelaAgora && reg === 1) : (!tabelaAgora && reg === 0)
  if (JSON.stringify(agoraEstavel) !== JSON.stringify(antesEstavel) || !esperado) {
    console.error('❌ numa conexão nova, a impressão mudou ou o registro não é o esperado', { antes, agora, reg })
    process.exitCode = 1
  } else {
    console.log(GRAVAR
      ? '  ✓ numa conexão nova: tabelas reais intactas, tabela nova no ar e migration registrada'
      : '  ✓ numa conexão nova: tabelas reais intactas, tabela nova NÃO existe e nada foi registrado')
  }
}
