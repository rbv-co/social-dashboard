// APLICA a migration das pessoas e atendimentos da Vessel E a REGISTRA, na
// mesma transação. Roda uma vez e só.
//
// POR QUE NÃO PELO MCP: o MCP aplica e NÃO escreve em `schema_migrations`. É
// exatamente o hábito que criou a dívida de 15 migrations "pendentes" em
// setembro — e mandar o runner aplicar pendentes quase sobrescreveu, por uma
// versão velha, a trava que impede o número de série de uma bolsa vendida de
// mudar. Aplicar e registrar juntos é o que impede a dívida de nascer.
//
// Se qualquer metade falhar, o rollback desfaz tudo: nunca sobra meio banco.
//
// O SQL é todo `if not exists` / `create or replace` / `drop … if exists`, então
// rodar de novo é inofensivo. Mas não há motivo para rodar.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-16-vessel-pessoas-e-atendimentos.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao)
     values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-pessoas.mjs'],
  )

  // ⚠️ CONFERIR DENTRO DA TRANSAÇÃO. "Sem erro" não é o mesmo que "ficou certo":
  // um `create table if not exists` sobre uma tabela que já existia passa calado
  // e deixa a coluna nova de fora. Aqui se pergunta ao banco o que ele tem.
  const { rows: tabelas } = await cli.query(
    `select c.relname, c.relrowsecurity as trava_ligada,
            (select count(*) from pg_policies p
              where p.schemaname='public' and p.tablename=c.relname) as politicas
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r'
        and c.relname in ('vessel_pessoas','vessel_origens','vessel_atendimentos',
                          'vessel_permissoes','vessel_convite_aberturas')
      order by c.relname`)

  if (tabelas.length !== 5) {
    throw new Error(`esperava 5 tabelas, o banco tem ${tabelas.length}`)
  }
  for (const t of tabelas) {
    if (!t.trava_ligada) throw new Error(`${t.relname}: RLS DESLIGADA`)
    // ⚠️ ZERO política é o desenho, não um esquecimento: a chave anônima está
    // dentro do HTML das páginas públicas. Uma política "só leitura" ali seria
    // a lista de nomes e telefones aberta para qualquer visitante.
    if (Number(t.politicas) !== 0) throw new Error(`${t.relname}: tem ${t.politicas} politica(s)`)
  }

  const { rows: funcoes } = await cli.query(
    `select p.proname, p.prosecdef as roda_como_dono
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
        ('vessel_pedir_atendimento','vessel_registrar_cartao','vessel_abrir_convite',
         'vessel_pessoa_por_telefone','vessel_novo_codigo_de_convite',
         'vessel_hash_de_origem','vessel_telefone_canonico')
      order by p.proname`)
  if (funcoes.length !== 7) {
    throw new Error(`esperava 7 funcoes, o banco tem ${funcoes.length}: `
      + funcoes.map((f) => f.proname).join(', '))
  }

  // A normalização do telefone é a CHAVE do sistema. Provar aqui, com o banco
  // de verdade, é mais barato que descobrir em novembro que nada cruzou.
  const { rows: [tel] } = await cli.query(
    `select vessel_telefone_canonico('(19) 99999-8888') as com_mascara,
            vessel_telefone_canonico('5519999998888')   as ja_canonico,
            vessel_telefone_canonico('1999998888')      as fixo,
            vessel_telefone_canonico('123')             as lixo`)
  if (tel.com_mascara !== '5519999998888') throw new Error('telefone com mascara saiu ' + tel.com_mascara)
  if (tel.ja_canonico !== '5519999998888') throw new Error('telefone ja canonico saiu ' + tel.ja_canonico)
  if (tel.fixo !== '551999998888') throw new Error('telefone fixo saiu ' + tel.fixo)
  if (tel.lixo !== null) throw new Error('telefone invalido nao foi recusado')

  await cli.query('commit')
  console.log('aplicada e registrada.\n')
  for (const t of tabelas) console.log(`  ${t.relname.padEnd(26)} trava ligada, ${t.politicas} politicas`)
  console.log()
  for (const f of funcoes) {
    console.log(`  ${f.proname.padEnd(30)} ${f.roda_como_dono ? 'roda como dono' : 'roda como quem chama'}`)
  }
  console.log('\n  telefone: "(19) 99999-8888" -> ' + tel.com_mascara + ', lixo -> recusado')
} catch (erro) {
  await cli.query('rollback')
  console.error('\n⛔ NADA FOI APLICADO. ' + erro.message)
  process.exitCode = 1
} finally {
  await cli.end()
}
