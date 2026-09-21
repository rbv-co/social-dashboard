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
// ⚠️⚠️ ESTE APLICADOR ENVELHECEU: RODAR DE NOVO RESSUSCITA DUAS ASSINATURAS
// MORTAS DE `vessel_abrir_convite` E `vessel_registrar_cartao` (B11 de
// docs/pendencias.md).
//
// Este arquivo cria as duas com a assinatura de 16/09 (sem `p_teste`).
// `2026-09-17-vessel-portas-nascem-reais.sql` acrescentou `p_teste boolean`
// às duas — e virou o padrão dela de `true` para `false`, porque com o
// gerador ATIVO uma chamada sem o parâmetro passou a criar um atendimento
// REAL marcado como ensaio, em vez do contrário. Reaplicar este arquivo hoje
// não sobrescreve essa versão: `create or replace` não troca uma função por
// outra de assinatura diferente, então o banco passa a ter AS DUAS ao mesmo
// tempo. Toda chamada da Central, que informa `p_teste`, bate nas duas
// assinaturas e morre com `function ... is not unique` — abrir um convite ou
// registrar um cartão na tela para de funcionar até alguém apagar a versão
// velha.
//
// ⚠️ `vessel_registrar_cartao` tem um segundo motivo, mais silencioso:
// `2026-09-17-vessel-um-horario-uma-visita.sql` acrescentou a trava de fila
// (`pg_advisory_xact_lock`) que impede duas Client Advisors marcarem a MESMA
// visita na mesma loja e dia. Isso está DENTRO do corpo da versão nova, não
// na assinatura — então mesmo sem a colisão de "function is not unique" (se
// algum dia uma chamada bater só na versão velha), a trava de conflito de
// horário desapareceria de volta, calada.
//
// ⚠️ POR QUE A TRAVA É UMA CONSULTA, E NÃO UM `process.exit` cravado: num
// banco NOVO, onde nenhuma das duas migrations posteriores foi aplicada, não
// há nada para desfazer e este aplicador tem de rodar normalmente.
const DEPOIS_DESTE = [
  {
    migration: '2026-09-17-vessel-portas-nascem-reais.sql',
    estrago:
      'recria `vessel_abrir_convite` com a assinatura de 16/09 (sem\n' +
      '       `p_teste`) AO LADO da de hoje — a Central passa a ter duas\n' +
      '       versoes, e abrir um convite pela tela quebra com `function ...\n' +
      '       is not unique` ate alguem apagar a velha.',
  },
  {
    migration: '2026-09-17-vessel-um-horario-uma-visita.sql',
    estrago:
      'recria `vessel_registrar_cartao` com a assinatura de 16/09 AO LADO\n' +
      '       da de hoje — registrar um cartao pela tela quebra com `function\n' +
      '       ... is not unique`; e a versao velha nem tem a trava de fila que\n' +
      '       impede duas Client Advisors marcarem a MESMA visita na mesma\n' +
      '       loja e dia.',
  },
]

import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-16-vessel-pessoas-e-atendimentos.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()

// ⚠️ ANTES DE ABRIR TRANSACAO E ANTES DE APLICAR QUALQUER COISA.
const { rows: posteriores } = await cli.query(
  `select name from public.schema_migrations where name = any($1::text[]) order by name`,
  [DEPOIS_DESTE.map((x) => x.migration)])
if (posteriores.length > 0) {
  console.error(
    `❌ nao aplicada: ${ARQUIVO} ja foi superada e reaplica-la ressuscitaria assinatura(s) morta(s).\n\n` +
    `Este arquivo cria \`vessel_abrir_convite\` e \`vessel_registrar_cartao\` com a assinatura de\n` +
    `16/09 (sem \`p_teste\`). Migration(s) mais nova(s) JA APLICADA(S) trocaram essa assinatura, e\n` +
    `rodar este aplicador agora recriaria a versao antiga do lado da nova:\n\n` +
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
