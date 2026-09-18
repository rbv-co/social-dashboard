/**
 * O MATERIAL DE CADA PEÇA VESSEL — canvas ou couro.
 *
 * PARA QUE SERVE: desde 18/09/2026 o prazo de garantia vem do material —
 * 2 anos no canvas, 6 meses no couro. O banco não guarda material nenhum, e o
 * Bling também não tem campo para isso. O que o Bling tem é a ESTRUTURA do
 * produto: a lista de matéria-prima. O material se lê dali.
 *
 * SÓ LÊ. Não escreve no banco nem no Bling.
 *
 *   node coletor/classificar-material-vessel.mjs saida.txt [--despejo arquivo.json]
 *
 * `--despejo` guarda as estruturas cruas num JSON e, se o arquivo já existir,
 * classifica a partir dele SEM bater no Bling de novo — reclassificar é
 * barato, e cada rodada completa custa ~500 chamadas.
 *
 * ⚠️ A REGRA NÃO É "A MAIOR FRAÇÃO", E NÃO É "TEM COURO NA LISTA".
 * As duas foram tentadas em 18/09/2026 e as duas erraram:
 *
 *   "tem couro na lista" → couro aparece como REFORÇO em quase toda bolsa
 *   (Recouro 0.03). Classificaria a coleção inteira como couro e cortaria a
 *   garantia de 2 anos pela metade na peça errada.
 *
 *   "a maior fração" → corrente e borracha também são vendidas por METRO
 *   (0.95, 0.66) e passavam na frente do tecido. 18 das 63 peças saíram como
 *   "não sei" por causa disso.
 *
 * A regra que ficou: a FACE é o componente de maior fração DEPOIS de tirar
 * ferragem e acessório. Com ela, sobraram 10 peças para olho humano.
 *
 * ⚠️ E NADA AQUI VIRA PRAZO SOZINHO. A saída separa no topo o que precisa de
 * conferência, inclusive quando um couro tem fração grande o bastante para
 * DISPUTAR a face. Errar para menos corta a garantia da cliente; errar para
 * mais promete o que a marca não vai honrar.
 */
import pg from 'pg'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const BLING = 'https://api.bling.com.br/Api/v3'
const SAIDA = process.argv[2] || 'material-por-peca.txt'
const DESPEJO = process.argv.includes('--despejo')
  ? process.argv[process.argv.indexOf('--despejo') + 1] : null
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))

// Ferragem e acessório NÃO são a face da peça — mesmo vindo em fração.
const FERRAGEM = /REGINATO|ESCOVAD|DOURAD|BOTAO|BOTÃO|IMA\b|MOSQUETAO|ARGOLA|REBITE|FIVELA|PUXADOR|CORRENTE|PE DE BOLSA|PLACA VESSEL|GRAMPO|ZIPER|ZÍPER|FIM250|BM18|NFC|ILHOS|PRESSAO/
const ACESSORIO = /LINHA |RESINA|PRIMER|PAINT|COLA|ESPUMA|REFORCO|REFORÇO|BORRACHA|NYLON 600|ETIQUETA|EMBALAG|SACO|CAIXA|MANTA|PAPEL|ADESIVO|FQ \d|EVA\b|NITRILICO|RETALHO/
const COURO = /COURO|CAMURC|CAMURÇ|NOBUCK|NUBUCK|NAPA|RASPA|SUEDE|VAQUETA|RECOURO/
const TECIDO = /TECIDO|IMPREGNAD|KROYAL|LONA|CANVAS|SINTETIC|SINTÉTIC|YORK|ARTEDUR|CAPRI|DETROID|JACQUARD/

async function baixarDoBling() {
  const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await cli.connect()
  const { rows: [t] } = await cli.query('select access_token from bling_tokens order by id desc limit 1')
  if (!t?.access_token) throw new Error('não há token do Bling guardado.')
  const cab = { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' }
  const nomes = new Map()
  const pega = async (u) => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(u, { headers: cab })
      if (r.status === 429) { await dorme(1500 * (i + 1)); continue }
      if (!r.ok) return null
      return r.json().catch(() => null)
    }
    return null
  }
  const nomeDo = async (id) => {
    if (nomes.has(id)) return nomes.get(id)
    const d = (await pega(`${BLING}/produtos/${id}`))?.data
    nomes.set(id, d?.nome || ''); await dorme(250); return nomes.get(id)
  }
  const { rows: lotes } = await cli.query(
    `select distinct on (sku) sku, modelo, cor from public.vessel_lotes
      where sku is not null and sku <> '' and teste is not true order by sku`)
  const saida = []
  for (const [i, l] of lotes.entries()) {
    const busca = await pega(`${BLING}/produtos?codigo=${encodeURIComponent(l.sku)}&limite=5`)
    const p = (busca?.data || []).find((x) => String(x.codigo).toUpperCase() === l.sku.toUpperCase())
      || busca?.data?.[0]
    if (!p) { saida.push({ ...l, erro: 'nao achei no bling' }); continue }
    const d = (await pega(`${BLING}/produtos/${p.id}`))?.data
    const componentes = []
    for (const c of (d?.estrutura?.componentes || [])) {
      componentes.push({ nome: await nomeDo(c.produto.id), qtd: c.quantidade })
    }
    saida.push({ ...l, componentes })
    console.log(`${i + 1}/${lotes.length} ${l.sku}`)
  }
  await cli.end()
  return saida
}

function classificar(peca) {
  if (peca.erro) return { veredito: 'NAO ACHEI NO BLING' }
  const comp = peca.componentes || []
  if (!comp.length) return { veredito: 'SEM ESTRUTURA' }
  const cand = comp
    .filter((c) => c.qtd > 0 && c.qtd < 1)
    .filter((c) => !FERRAGEM.test(c.nome.toUpperCase()) && !ACESSORIO.test(c.nome.toUpperCase()))
    .sort((a, b) => b.qtd - a.qtd)
  const face = cand[0]
  if (!face) return { veredito: 'SEM FACE — CONFERIR' }
  const U = face.nome.toUpperCase()
  const veredito = COURO.test(U) ? 'COURO (6 meses)'
    : TECIDO.test(U) ? 'canvas (2 anos)' : 'NAO SEI — CONFERIR'
  // Couro que chega perto da face é candidato a ser a face de verdade.
  let alerta = ''
  if (!/COURO/.test(veredito)) {
    const c = cand.filter((x) => COURO.test(x.nome.toUpperCase()))
      .sort((a, b) => b.qtd - a.qtd)[0]
    if (c && c.qtd >= 0.6 * face.qtd) alerta = `couro disputa: ${c.nome} (${c.qtd})`
  }
  return { face: face.nome, qtd: face.qtd, veredito, alerta }
}

const pecas = DESPEJO && existsSync(DESPEJO)
  ? JSON.parse(readFileSync(DESPEJO, 'utf8'))
  : await baixarDoBling()
if (DESPEJO && !existsSync(DESPEJO)) writeFileSync(DESPEJO, JSON.stringify(pecas, null, 1))

const linhas = pecas.map((p) => ({ sku: p.sku, modelo: p.modelo, ...classificar(p) }))
const conferir = linhas.filter((l) => /CONFERIR|SEM ESTRUTURA|NAO ACHEI/.test(l.veredito) || l.alerta)
const col = (s, n) => String(s ?? '').slice(0, n).padEnd(n)
const linha = (l) => col(l.sku, 15) + col(l.modelo, 32) + col(l.face, 42) + col(l.qtd, 6) + col(l.veredito, 22) + (l.alerta || '')
const resumo = linhas.reduce((a, l) => ({ ...a, [l.veredito]: (a[l.veredito] || 0) + 1 }), {})

writeFileSync(SAIDA, [
  'MATERIAL DE CADA PECA — lido da estrutura de materia-prima no Bling',
  `${linhas.length} SKUs · ${new Date().toLocaleString('pt-BR')}`, '',
  'A face da peca e o componente de maior fracao DEPOIS de tirar ferragem e',
  'acessorio — varios deles tambem vem por metro. Ver o cabecalho do programa.', '',
  '⚠️ NADA AQUI VIRA PRAZO DE GARANTIA SEM UM HUMANO OLHAR.', '',
  `>>> PRECISAM DO SEU OLHO: ${conferir.length} de ${linhas.length}  <<<`, '',
  col('SKU', 15) + col('MODELO', 32) + col('FACE DA PECA', 42) + col('QTD', 6) + col('VEREDITO', 22) + 'ALERTA',
  '-'.repeat(160),
  ...conferir.map(linha),
  '', '', 'A LISTA INTEIRA', '-'.repeat(160),
  ...linhas.map(linha), '', 'RESUMO:',
  ...Object.entries(resumo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${String(v).padStart(3)}  ${k}`),
].join('\n'))
console.log(`${conferir.length} de ${linhas.length} precisam de conferencia → ${SAIDA}`)
