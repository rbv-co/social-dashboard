// TODOS OS LINKS PÚBLICOS DA VESSEL, NUMA LISTA SÓ.
//
//   node coletor/os-links-da-vessel.mjs [saida.txt]
//
// POR QUE ISTO EXISTE: em 18/09/2026 o dono disse, com estas palavras, "não tem
// nenhuma ferramenta que eu consiga gerir essas gerações de links, cartões, QR
// codes — tô sentindo perda de controle nisso". Ele estava certo, e dá para
// medir: são CINCO famílias de endereço público, cada uma nascendo num lugar
// diferente, e só DUAS têm tela.
//
// Isto NÃO é o conserto — é o retrato. O conserto é uma tela na Central. Até
// ela existir, este comando responde as três perguntas que a falta dela deixa
// sem resposta: o que existe, está no ar, e alguém usou?
//
// ⚠️ MORA NO IAMUNDI, E NÃO NO REPO DO SITE, porque precisa da credencial do
// banco — e o repositório do site é público por natureza (ver o LEIA-ME de lá:
// "NÃO GUARDE SEGREDO AQUI").
//
// ⚠️ SÓ LÊ. Não cria link, não apaga, não muda nada.
import './lib/carregar-env.mjs'
import pg from 'pg'
import { writeFileSync } from 'node:fs'

const SAIDA = process.argv[2]
const SITE = 'https://vesselbrasil.com.br'

/**
 * ⚠️ `nasce_em` É A COLUNA QUE MAIS IMPORTA, e a que ninguém anota: é ela que
 * responde "quem cria isto?". Três das cinco nascem à mão, por migration, o que
 * quer dizer que dependem de alguém lembrar. É daí que vem a perda de controle
 * — não do número de links.
 */
const FAMILIAS = [
  {
    nome: 'Beauty Session (QR de mesa + QR de cartão)',
    endereco: '/bs/<codigo>  ·  o cartão abre /private-appointment com a origem',
    nasce_em: 'migration, à mão  ←  SEM TELA',
    caminho: (l) => `/bs/${l.chave}`,
    sql: `select s.codigo as chave, s.quando::text as quando,
                 coalesce(s.parceiro, '(sem parceiro)') as detalhe,
                 (select count(*) from vessel_sessao_aberturas a
                   where a.codigo = s.codigo and a.peca = 'mesa') as leu,
                 (select count(*) from vessel_sessao_aberturas a
                   where a.codigo = s.codigo and a.peca = 'cartao') as cartao,
                 (select count(distinct o.pessoa_id) from vessel_origens o
                   where o.evento_id = s.codigo) as pessoas
            from vessel_beauty_sessions s order by s.quando`,
  },
  {
    nome: 'Stylist — link permanente',
    endereco: '/s/STY-0000',
    nasce_em: 'a própria stylist, em /stylist-circle',
    caminho: (l) => `/s/${l.chave}`,
    sql: `select s.codigo as chave, s.criado_em::date::text as quando,
                 coalesce(s.nome, '') as detalhe,
                 (select count(*) from vessel_stylist_aberturas a
                   where a.codigo = s.codigo) as leu,
                 0 as cartao,
                 (select count(distinct o.pessoa_id) from vessel_origens o
                   where o.stylist_id = s.codigo) as pessoas
            from vessel_stylists s order by s.codigo`,
  },
  {
    nome: 'Private Edit — convite do encontro',
    endereco: '/pe/<chave>',
    nasce_em: 'migration, à mão  ←  SEM TELA',
    caminho: (l) => `/pe/${l.chave}`,
    sql: `select e.chave as chave, e.quando::text as quando,
                 coalesce(e.local, '') as detalhe,
                 (select count(*) from vessel_convite_aberturas a
                   where a.convite_codigo = e.chave) as leu,
                 0 as cartao, 0 as pessoas
            from vessel_private_edits e order by e.quando`,
  },
  {
    nome: 'Appointment Card — o convite da loja',
    endereco: '/c/<praça>/<CA>/<código>',
    // ⚠️ O CÓDIGO DO CARTÃO NÃO É GRAVADO EM LUGAR NENHUM. O gerador sorteia
    // seis letras, imprime no cartão e esquece — está escrito no cabeçalho de
    // `cartao-de-agendamento.mjs`, e é decisão de projeto, não esquecimento:
    // sem lista ligando código a cliente, o código não identifica ninguém.
    // A CONSEQUÊNCIA é que não existe "a lista de cartões emitidos": o único
    // rastro de um cartão é quando alguém o ABRE. A lista abaixo é de
    // aberturas, e por isso um cartão nunca aberto é invisível para sempre.
    nasce_em: 'a CA, em /geradorappointmentcard (tem tela) — mas o código NÃO é guardado',
    caminho: () => null,
    sql: `select a.convite_codigo as chave, min(a.momento)::date::text as quando,
                 coalesce(a.praca, '') || ' · CA ' || coalesce(a.client_advisor, '?') as detalhe,
                 count(*) as leu, 0 as cartao, 0 as pessoas
            from vessel_convite_aberturas a
           where not coalesce(a.teste, false)
           group by a.convite_codigo, a.praca, a.client_advisor
           order by min(a.momento) desc limit 50`,
  },
  {
    nome: 'Selo da peça — a etiqueta NFC costurada na bolsa',
    endereco: '/verify/<código>',
    nasce_em: 'o painel Autenticidade e Garantia, na Central',
    caminho: () => null,
    resumo: true,
    sql: `select (select count(*)::text from vessel_pecas) as chave,
                 (select max(criado_em)::date::text from vessel_pecas) as quando,
                 (select count(*)::text || ' etiquetas gravadas' from vessel_pecas
                   where gravada_em is not null) as detalhe,
                 (select count(*) from vessel_leituras) as leu,
                 0 as cartao,
                 (select count(*) from vessel_registros) as pessoas`,
  },
]

async function noAr(caminho) {
  if (!caminho) return '—'
  try {
    const r = await fetch(SITE + caminho, { redirect: 'manual' })
    return r.status === 200 ? 'no ar' : String(r.status)
  } catch { return '(sem rede)' }
}

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()

const col = (s, n) => String(s ?? '').slice(0, n).padEnd(n)
const corpo = []
let total = 0
let semTela = 0

for (const f of FAMILIAS) {
  const { rows } = await cli.query(f.sql)
  const quantos = f.resumo ? Number(rows[0]?.chave || 0) : rows.length
  total += quantos
  if (f.nasce_em.includes('SEM TELA')) semTela += quantos

  corpo.push('', '─'.repeat(104),
    `${f.nome}   —   ${quantos}`,
    `   endereço:  ${f.endereco}`,
    `   nasce em:  ${f.nasce_em}`, '')
  if (!rows.length) { corpo.push('   (nenhum criado até agora)'); continue }
  corpo.push('   ' + col('CHAVE', 22) + col('QUANDO', 12) + col('DETALHE', 26)
    + col('LEU', 6) + col('CARTÃO', 8) + col('PESSOAS', 9) + 'NO AR')
  for (const l of rows) {
    corpo.push('   ' + col(l.chave, 22) + col(l.quando, 12) + col(l.detalhe, 26)
      + col(l.leu, 6) + col(l.cartao, 8) + col(l.pessoas, 9)
      + await noAr(f.caminho(l)))
  }
}

const texto = [
  'TODOS OS LINKS PÚBLICOS DA VESSEL',
  `gerado em ${new Date().toLocaleString('pt-BR')}`,
  '',
  'O QUE É: o retrato de tudo que hoje é um endereço que alguém pode abrir —',
  'QR de mesa, QR de cartão, link de stylist, convite, cartão da loja e selo.',
  '',
  'AS COLUNAS:',
  '   LEU       quantas vezes foi ABERTO. É leitura, não pessoa: a mesma cliente',
  '             abrindo duas vezes conta duas. Não dá para ser diferente sem',
  '             marcar o navegador dela, e isso não se faz aqui.',
  '   CARTÃO    as leituras vindas do QR do CARTÃO, separadas das da MESA — é a',
  '             comparação que diz qual peça vale imprimir de novo.',
  '   PESSOAS   quantas se identificaram, com nome e WhatsApp. Essa é gente.',
  '',
  `TOTAL: ${total} endereços vivos.`,
  `⚠️ ${semTela} deles nascem À MÃO, por migration, sem tela para criar, listar ou`,
  '   desativar. É daí que vem a perda de controle — e este arquivo é o retrato,',
  '   não o conserto. O conserto é uma tela na Central, ao lado de Atendimentos.',
  ...corpo, '',
].join('\n')

if (SAIDA) { writeFileSync(SAIDA, texto); console.log('pronto →', SAIDA) }
else console.log(texto)
await cli.end()
