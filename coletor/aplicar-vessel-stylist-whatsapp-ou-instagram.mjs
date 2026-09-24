// APLICA, REGISTRA e PROVA "WhatsApp OU Instagram" na parceira do Stylist
// Circle (e o campo de observações).
//
//   node coletor/aplicar-vessel-stylist-whatsapp-ou-instagram.mjs            → ensaio: prova tudo e DESFAZ
//   node coletor/aplicar-vessel-stylist-whatsapp-ou-instagram.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar em `schema_migrations`, provar
// e só então `commit` — e o `commit` é conferido (`.command === 'COMMIT'`):
// transação abortada responde ROLLBACK sem lançar erro.
//
// ⚠️ A PROVA FALA COMO GENTE DE VERDADE, com a trava ligada: perfis de mentira
// em `auth.users`/`profiles` e `request.jwt.claims` com o `sub` deles. E mora
// inteira dentro de `savepoint prova` … `rollback to savepoint prova`: a
// impressão de `vessel_stylists` é tirada antes e conferida depois do desfazer
// E, quando grava, de novo numa conexão nova depois do `commit`.
//
// ⚠️ `vessel_rastreio_dos_stylists` é recriada com o texto do banco e UMA chave
// a mais. O `pg_get_functiondef` de antes e o de depois são comparados linha a
// linha: a única diferença aceita é a linha de `observacoes`.
//
// DATABASE_URL: vem de coletor/.env (carregar-env) OU do ambiente — numa árvore
// sem .env, `node --env-file=<caminho do .env> coletor/...`.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql'
const GRAVAR = process.argv.includes('--gravar')

const PORTAS = {
  vessel_stylist_criar: 'vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date,text)',
  vessel_stylist_editar: 'vessel_stylist_editar(text,text,text,text,text,text,text,text,text,text,text,date,text,date,boolean,text)',
  vessel_rastreio_dos_stylists: 'vessel_rastreio_dos_stylists(integer,boolean)',
}

const FONE_A = '5519990002401'

const IMPRESSAO = `
  select (select count(*) from public.vessel_stylists)::int as stylists,
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
            from public.vessel_stylists t) as stylists_md5,
         (select count(*) from public.vessel_stylist_contatos)::int as contatos,
         (select count(*) from public.vessel_consentimentos where stylist_id is not null)::int as consentimentos`

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}

if (!process.env.DATABASE_URL) { console.error('❌ sem DATABASE_URL'); process.exit(1) }
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r
const definicao = async (assinatura) =>
  r(`pg_get_functiondef($1::regprocedure)`, [`public.${assinatura}`])

const antes = await uma(IMPRESSAO)
const { ja } = await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ja`, [ARQUIVO])
if (ja) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }
const rastreioAntes = await definicao(PORTAS.vessel_rastreio_dos_stylists)

await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-stylist-whatsapp-ou-instagram.mjs'])

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
  const miolo = await uma(
    `select has_function_privilege('authenticated', 'public.vessel_instagram_canonico(text)', 'EXECUTE') as aut,
            has_function_privilege('anon', 'public.vessel_instagram_canonico(text)', 'EXECUTE') as anon`)
  conferir(miolo.aut === false && miolo.anon === false, 'vessel_instagram_canonico: miolo fechado', miolo)
  const pub = await uma(
    `select has_function_privilege('anon', 'public.vessel_pedido_do_stylist(text,text,text,text,text,text,text,text,boolean,text,jsonb,text,boolean)', 'EXECUTE') as anon`)
  conferir(pub.anon === true, 'a porta pública da landing continua aberta', pub)

  // ⚠️ A LEITURA NÃO PERDEU NADA NO CAMINHO: só a linha de observacoes a mais.
  const rastreioDepois = await definicao(PORTAS.vessel_rastreio_dos_stylists)
  const la = rastreioAntes.split('\n'), ld = rastreioDepois.split('\n')
  const aMais = ld.filter((l) => !la.includes(l))
  const aMenos = la.filter((l) => !ld.includes(l))
  conferir(aMenos.length === 0 && aMais.length === 1 && /'observacoes', s\.observacoes/.test(aMais[0]),
    'vessel_rastreio_dos_stylists: idêntica à do banco, mais a linha de observacoes', { aMais, aMenos })

  console.log('\n── a tabela')
  const col = await uma(`select is_nullable from information_schema.columns
                          where table_schema='public' and table_name='vessel_stylists' and column_name='whatsapp'`)
  conferir(col.is_nullable === 'YES', 'whatsapp deixou de ser obrigatório', col)
  const obs = await uma(`select data_type from information_schema.columns
                          where table_schema='public' and table_name='vessel_stylists' and column_name='observacoes'`)
  conferir(obs?.data_type === 'text', 'observacoes existe (text)', obs)

  await cli.query('savepoint prova')

  const perfil = async (features, permissions) => {
    const id = randomUUID()
    const email = `prova-wa-ig-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(
      `insert into public.profiles (id, email, features, permissions, is_superadmin)
       values ($1, $2, $3, $4::jsonb, false)`, [id, email, features, JSON.stringify(permissions)])
    return id
  }
  const falarComo = async (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])
  const soVe = await perfil(['atendimentos'], { atendimentos: ['ver'] })
  const mexe = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] })

  // ⚠️ A TRAVA DA TABELA VALE PARA QUALQUER PORTA, não só para a função.
  try {
    await cli.query('savepoint sem_contato_direto')
    await cli.query(`insert into public.vessel_stylists (codigo, nome, whatsapp, instagram)
                     values ('STY-9990', 'Sem Contato', null, '  ')`)
    conferir(false, 'insert direto sem WhatsApp e sem Instagram é recusado pela tabela (23514)', 'entrou')
  } catch (e) {
    await cli.query('rollback to savepoint sem_contato_direto')
    conferir(e.code === '23514' && /vessel_stylists_tem_contato/.test(e.message),
      'insert direto sem WhatsApp e sem Instagram é recusado pela tabela (23514)', e.message)
  }

  console.log('\n── cadastrar')
  await falarComo(soVe)
  const recusa = await r(`public.vessel_stylist_criar('Nao Devia', null, p_instagram => '@naodevia', p_origem_contato => 'pesquisa')`)
  conferir(recusa.situacao === 'sem_permissao', 'quem só vê não cadastra', recusa)

  await falarComo(mexe)
  const nada = await r(`public.vessel_stylist_criar('Sem Contato', null, p_origem_contato => 'pesquisa')`)
  conferir(nada.situacao === 'sem_contato', 'sem WhatsApp e sem Instagram: sem_contato', nada)
  const vazio = await r(`public.vessel_stylist_criar('Sem Contato', '  ', p_instagram => ' ', p_origem_contato => 'pesquisa')`)
  conferir(vazio.situacao === 'sem_contato', 'só espaços nos dois: sem_contato', vazio)
  const lixo = await r(`public.vessel_stylist_criar('Sem Perfil', null, p_instagram => 'Não localizado publicamente', p_origem_contato => 'pesquisa')`)
  conferir(lixo.situacao === 'instagram_invalido', 'só Instagram, e ele não é um perfil: instagram_invalido', lixo)
  const foneRuim = await r(`public.vessel_stylist_criar('Fone Ruim', '(19) 7160-592', p_instagram => '@foneruim', p_origem_contato => 'pesquisa')`)
  conferir(foneRuim.situacao === 'whatsapp_invalido', 'telefone escrito e inválido continua recusado (não vira "só Instagram" calado)', foneRuim)

  const soInsta = await r(
    `public.vessel_stylist_criar('Prova Só Instagram', null, p_cidade => 'Limeira', p_instagram => '@Prova.So_Insta',
       p_atuacao => 'consultoria', p_origem_contato => 'pesquisa', p_prospectado_em => date '2026-09-16',
       p_observacoes => 'Nota de prova')`)
  conferir(soInsta.ok === true && /^STY-\d{4}$/.test(soInsta.codigo), 'só com o Instagram, cadastra', soInsta)
  let s = await uma(`select * from public.vessel_stylists where codigo = $1`, [soInsta.codigo])
  conferir(s.whatsapp === null && s.instagram === '@Prova.So_Insta' && s.observacoes === 'Nota de prova'
    && s.estagio === 'prospectado' && s.origem_contato === 'pesquisa',
    'nasce prospectada, sem WhatsApp, Instagram como escrito, com a observação', s)

  const repetida = await r(`public.vessel_stylist_criar('Outra', null, p_instagram => 'https://www.instagram.com/prova.so_insta/?igsh=x', p_origem_contato => 'pesquisa')`)
  conferir(repetida.situacao === 'instagram_repetido' && repetida.codigo === soInsta.codigo,
    'o mesmo perfil em outra forma (URL, maiúsculas) é repetido, e diz de quem', repetida)

  const comFone = await r(`public.vessel_stylist_criar('Prova Com Fone', '(19) 99000-2401', p_origem_contato => 'pesquisa')`)
  s = await uma(`select whatsapp, instagram from public.vessel_stylists where codigo = $1`, [comFone.codigo])
  conferir(comFone.ok === true && s.whatsapp === FONE_A && s.instagram === null, 'só com WhatsApp continua funcionando', { comFone, s })
  const foneRep = await r(`public.vessel_stylist_criar('Repetida', '19990002401', p_origem_contato => 'pesquisa')`)
  conferir(foneRep.situacao === 'whatsapp_repetido' && foneRep.codigo === comFone.codigo, 'WhatsApp repetido continua recusado', foneRep)
  const semOrigem = await r(`public.vessel_stylist_criar('Sem Origem', null, p_instagram => '@semorigem')`)
  conferir(semOrigem.situacao === 'origem_invalida', 'origem continua obrigatória', semOrigem)

  console.log('\n── corrigir')
  const e1 = await r(`public.vessel_stylist_editar($1, p_observacoes => null, p_cidade => 'Piracicaba')`, [soInsta.codigo])
  s = await uma(`select cidade, observacoes, whatsapp from public.vessel_stylists where codigo = $1`, [soInsta.codigo])
  conferir(e1.ok && s.cidade === 'Piracicaba' && s.observacoes === 'Nota de prova', 'observação nula não mexe', s)
  const e2 = await r(`public.vessel_stylist_editar($1, p_whatsapp => '(19) 99000-2402', p_observacoes => '')`, [soInsta.codigo])
  s = await uma(`select observacoes, whatsapp from public.vessel_stylists where codigo = $1`, [soInsta.codigo])
  conferir(e2.ok && s.observacoes === null && s.whatsapp === '5519990002402', 'string vazia apaga a observação; WhatsApp se acrescenta depois', s)
  const e3 = await r(`public.vessel_stylist_editar($1, p_instagram => '@PROVA.SO_INSTA')`, [comFone.codigo])
  conferir(e3.situacao === 'instagram_repetido', 'corrigir para o Instagram de outra é recusado', e3)
  const e4 = await r(`public.vessel_stylist_editar($1, p_instagram => '@prova.so_insta')`, [soInsta.codigo])
  conferir(e4.ok === true, 'reescrever o próprio Instagram não é "repetido"', e4)

  console.log('\n── a leitura e a porta pública')
  const lista = await r(`public.vessel_rastreio_dos_stylists(7, true)`)
  const minha = (lista || []).find((x) => x.codigo === comFone.codigo)
  conferir(minha && 'observacoes' in minha, 'a lista da tela traz observacoes', minha)
  const placar = await r(`public.vessel_placar_do_stylist_circle(null, null, 14)`)
  conferir(placar !== null && typeof placar === 'object', 'o placar continua respondendo', placar)
  await falarComo(null)
  const publica = await r(`public.vessel_pedido_do_stylist('Da Landing', null, p_instagram => '@dalanding')`)
  conferir(publica.ok === false && publica.situacao === 'invalido', 'a landing continua exigindo WhatsApp', publica)

  await cli.query('rollback to savepoint prova')
  const depoisDaProva = await uma(IMPRESSAO)
  conferir(JSON.stringify(depoisDaProva) === JSON.stringify(antes),
    'a prova não deixou rastro em vessel_stylists/contatos/consentimentos', { antes, depoisDaProva })

  if (falhas.length) throw new Error(`${falhas.length} conferência(s) falharam`)

  if (GRAVAR) {
    const fim = await cli.query('commit')
    if (fim.command !== 'COMMIT') throw new Error(`o commit voltou ${fim.command}`)
    console.log(`\n✅ ${ARQUIVO} aplicada e registrada.`)
  } else {
    await cli.query('rollback')
    console.log(`\n✅ ensaio limpo: tudo passou e NADA foi gravado. Rode com --gravar para valer.`)
  }
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error(`\n❌ nada foi gravado: ${e.message}`)
  process.exitCode = 1
} finally {
  await cli.end()
}

if (GRAVAR && !process.exitCode) {
  // ⚠️ DE NOVO NUMA CONEXÃO NOVA: é o que o resto do mundo vê.
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  const agora = (await outra.query(IMPRESSAO)).rows[0]
  const reg = (await outra.query(`select 1 from public.schema_migrations where name = $1`, [ARQUIVO])).rowCount
  const nul = (await outra.query(`select is_nullable from information_schema.columns
     where table_schema='public' and table_name='vessel_stylists' and column_name='whatsapp'`)).rows[0]
  const assin = (await outra.query(`select p.oid::regprocedure::text as a from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='vessel_stylist_criar'`)).rows
  await outra.end()
  if (JSON.stringify(agora) !== JSON.stringify(antes) || reg !== 1 || nul?.is_nullable !== 'YES'
      || assin.length !== 1 || assin[0].a !== PORTAS.vessel_stylist_criar) {
    console.error('❌ depois do commit algo não bate', { antes, agora, reg, nul, assin })
    process.exitCode = 1
  } else {
    console.log('  ✓ depois do commit, numa conexão nova: tabela intacta, coluna opcional, função nova e migration registrada')
  }
}
