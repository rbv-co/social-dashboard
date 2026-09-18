// APLICA, REGISTRA e PROVA a chave criptográfica do convite da Private Edit.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-18-vessel-chave-do-convite-sorteada-a-serio.sql'
const F = 'public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean)'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-chave-sorteada-a-serio.mjs'])

  // ⚠️ O CODIGO NAO PODE MAIS CITAR random(): e o defeito que esta migration veio consertar.
  const { rows: [f] } = await cli.query(
    `select pg_get_functiondef($1::regprocedure) as corpo`, [F])
  if (/\brandom\s*\(/.test(f.corpo)) throw new Error('a funcao ainda sorteia com random()')
  if (!/gen_random_bytes/.test(f.corpo)) throw new Error('a funcao nao usa gen_random_bytes')

  const { rows: [p] } = await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [F])
  if (p.anon || p.autenticado || p.qualquer_um)
    throw new Error('a porta de criar encontro ficou aberta')

  await cli.query('savepoint prova')
  await cli.query(
    `insert into public.vessel_stylists (codigo, nome, whatsapp, praca_preview, teste)
     values ('STY-9999','Prova da Chave','5519999111222','CPS',true)`)

  // 240 chaves: o bastante para pegar letra fora do alfabeto, tamanho errado e
  // um sorteio grosseiramente torto.
  const chaves = []
  for (let i = 0; i < 240; i++) {
    const { rows: [{ r }] } = await cli.query(
      `select public.vessel_criar_private_edit('STY-9999',
         (timestamptz '2027-01-01 19:00-03' + ($1 || ' days')::interval),
         'Prova','CPS','iguatemi',8,true) as r`, [i])
    if (!r.ok) throw new Error('nao criou: ' + JSON.stringify(r))
    chaves.push(r.chave)
  }

  const ALFABETO = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
  for (const c of chaves) {
    if (c.length !== 8) throw new Error('chave de ' + c.length + ' letras: ' + c)
    for (const l of c) if (!ALFABETO.includes(l)) throw new Error(`letra "${l}" fora do alfabeto em ${c}`)
  }
  if (new Set(chaves).size !== chaves.length) throw new Error('saiu chave repetida em 240 sorteios')

  // ⚠️ A REJEICAO E O QUE TIRA O VIES: sem ela as 16 primeiras letras sairiam
  // ~53% mais que as outras 14. 240 chaves x 8 letras = 1920 sorteios; o
  // esperado por letra e 64. Um viés de resto direto deixaria as 16 primeiras
  // perto de 74 e as 14 ultimas perto de 51 — muito fora desta folga.
  const conta = new Map([...ALFABETO].map((l) => [l, 0]))
  for (const c of chaves) for (const l of c) conta.set(l, conta.get(l) + 1)
  const primeiras = [...ALFABETO].slice(0, 16).reduce((s, l) => s + conta.get(l), 0) / 16
  const ultimas = [...ALFABETO].slice(16).reduce((s, l) => s + conta.get(l), 0) / 14
  if (primeiras > ultimas * 1.3)
    throw new Error(`sorteio torto: 16 primeiras letras ${primeiras.toFixed(1)}x, 14 ultimas ${ultimas.toFixed(1)}x`)

  await cli.query('rollback to savepoint prova')
  await cli.query('commit')
  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
  console.log(`   240 chaves sorteadas, nenhuma repetida, nenhuma letra fora do alfabeto`)
  console.log(`   distribuicao: 16 primeiras ${primeiras.toFixed(1)}x · 14 ultimas ${ultimas.toFixed(1)}x (esperado 64x)`)
} catch (e) {
  await cli.query('rollback')
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally {
  await cli.end()
}
