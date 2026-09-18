#!/usr/bin/env node
// coletor/classificar-material-dos-lotes.mjs
//
// A VARREDURA SÓ DE LEITURA para a decisão do dono de 18/09/2026: a garantia
// passa a ser de 2 anos para canvas e 6 meses para couro, contadas da compra.
// O sistema não sabe, hoje, de qual material cada bolsa do selo é feita — este
// robô olha a estrutura de cada produto no Bling, aplica a regra pura de
// `src/ferramentas/autenticidade/material-do-produto.js` e escreve uma
// planilha para o dono CONFERIR. Ele não decide sozinho, e não grava nada.
//
//   node coletor/classificar-material-dos-lotes.mjs
//
// ⚠️ ISTO NÃO GRAVA NADA — nem no banco, nem no Bling. É leitura pura: lê
// `vessel_lotes`, lê a estrutura de cada SKU no Bling, escreve um CSV local.
// A pessoa é quem decide, olhando a evidência — a mesma cautela do critério do
// dono ("na dúvida, não chuta").
//
// ── POR QUE CACHE POR SKU, E NÃO POR LOTE ──────────────────────────────────
// Medido em 18/09/2026: 140 lotes, mas só 64 SKUs distintos — o mesmo produto
// vira lote de novo a cada produção nova. Buscar a estrutura por LOTE bateria
// no Bling mais de duas vezes a mais do que o necessário, e o Bling limita a
// 3 requisições por segundo. Buscando por SKU, cada produto entra no Bling
// uma vez só, não importa quantos lotes ele tenha.
//
// ── POR QUE CACHE DE COMPONENTE TAMBÉM É GLOBAL, NÃO POR PRODUTO ───────────
// A ferragem (Reginato), o NFC, a linha de costura e vários químicos se
// repetem de produto para produto — medido: "MundoCamurca - Couro - Bristol
// nozes" e a fita de Hot Stamping apareceram tanto na Cyrène quanto na Astrea.
// Um cache de nome por id de componente, compartilhado entre todos os SKUs,
// evita perguntar ao Bling o nome da mesma peça de ferragem 64 vezes.
import './lib/carregar-env.mjs'
import pg from 'pg'
import { writeFileSync } from 'node:fs'
import { classificarMaterial } from '../src/ferramentas/autenticidade/material-do-produto.js'

const BLING = 'https://api.bling.com.br/Api/v3'
const CSV_DE_SAIDA = '/private/tmp/claude-501/-Users-erickmartins/1343e15e-997e-4f51-a038-d5128dc87527/scratchpad/material-dos-lotes.csv'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
// ⚠️ 400ms ENTRE CHAMADAS, DE PROPÓSITO — o Bling limita a 3 por segundo, e
// esta varredura não tem pressa nenhuma: é auditoria, não robô de produção.
// O mesmo intervalo usado em `trazer-vendedores-do-bling.mjs`.
const PAUSA_ENTRE_CHAMADAS_MS = 400

/**
 * O token, e a renovação só se precisar — mesma conta de sempre
 * (`bling_tokens`), copiada de `trazer-vendedores-do-bling.mjs`.
 *
 * ⚠️ RENOVAR ROTACIONA O `refresh_token`: renovar e não gravar de volta deixa
 * o próximo robô que usar o antigo ser recusado.
 */
async function pegarToken(cli) {
  const { rows: [t] } = await cli.query('select * from bling_tokens order by id desc limit 1')
  if (!t?.access_token) throw new Error('não há token do Bling guardado.')
  if (new Date(t.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) return t.access_token

  console.log('o token estava vencendo; renovando.')
  const credenciais = Buffer.from(`${t.client_id}:${t.client_secret}`).toString('base64')
  const r = await fetch(`${BLING}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${credenciais}` },
    body: `grant_type=refresh_token&refresh_token=${t.refresh_token}`,
  })
  if (!r.ok) throw new Error(`não consegui renovar o acesso ao Bling (${r.status}).`)
  const novo = await r.json()
  await cli.query(
    `update bling_tokens set access_token = $1, refresh_token = $2,
            expires_at = $3, updated_at = now() where id = $4`,
    [novo.access_token, novo.refresh_token,
     new Date(Date.now() + novo.expires_in * 1000).toISOString(), t.id])
  return novo.access_token
}

// Excel em português abre CSV separado por PONTO-E-VÍRGULA — mesma regra de
// `src/ferramentas/autenticidade/lotes.js` (`celula`/`linhasDoCsv`).
function celula(valor) {
  const texto = valor == null ? '' : String(valor)
  if (!/[;"\n]/.test(texto)) return texto
  return `"${texto.replace(/"/g, '""')}"`
}

// O NOME de um componente, pelo id. Cache GLOBAL — ver comentário do topo.
const nomeDoComponente = new Map()
async function nomeDoProdutoBling(id, cabecalho) {
  if (nomeDoComponente.has(id)) return nomeDoComponente.get(id)
  await espera(PAUSA_ENTRE_CHAMADAS_MS)
  const r = await fetch(`${BLING}/produtos/${id}`, { headers: cabecalho })
  const nome = r.ok ? ((await r.json())?.data?.nome ?? `(id ${id})`) : `(id ${id}, o Bling respondeu ${r.status})`
  nomeDoComponente.set(id, nome)
  return nome
}

// A ESTRUTURA + NCM de um SKU, ou `null` quando o Bling não tem o que buscar
// — SKU não encontrado, sem `estrutura.componentes`, ou lista vazia.
async function estruturaDoSku(sku, cabecalho) {
  await espera(PAUSA_ENTRE_CHAMADAS_MS)
  const busca = await fetch(`${BLING}/produtos?criterio=5&codigo=${encodeURIComponent(sku)}`, { headers: cabecalho })
  if (!busca.ok) return { erro: `busca por SKU respondeu ${busca.status}` }
  const achado = (await busca.json())?.data?.[0]
  if (!achado?.id) return { erro: 'SKU não encontrado no Bling' }

  await espera(PAUSA_ENTRE_CHAMADAS_MS)
  const detalhe = await fetch(`${BLING}/produtos/${achado.id}`, { headers: cabecalho })
  if (!detalhe.ok) return { erro: `detalhe do produto respondeu ${detalhe.status}` }
  const produto = (await detalhe.json())?.data
  const componentesIds = produto?.estrutura?.componentes
  if (!Array.isArray(componentesIds) || !componentesIds.length) {
    return { erro: `sem estrutura de componentes no Bling (formato "${produto?.formato ?? '?'}")` }
  }

  const nomes = []
  for (const c of componentesIds) {
    const id = c?.produto?.id
    if (id == null) continue
    nomes.push(await nomeDoProdutoBling(id, cabecalho))
  }
  return { componentes: nomes, ncm: produto?.tributacao?.ncm ?? '' }
}

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()

try {
  const token = await pegarToken(cli)
  const cabecalho = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

  const { rows: lotes } = await cli.query(
    `select id, modelo, cor, sku, quantidade from vessel_lotes order by sku, modelo, cor`)
  console.log(`${lotes.length} lotes lidos de vessel_lotes.`)

  const skusUnicos = [...new Set(lotes.map((l) => l.sku).filter(Boolean))]
  console.log(`${skusUnicos.length} SKUs distintos — é isso que vai bater no Bling, não os ${lotes.length} lotes.`)

  // ── CACHE POR SKU ──────────────────────────────────────────────────────
  const resultadoPorSku = new Map()
  let i = 0
  for (const sku of skusUnicos) {
    i += 1
    process.stdout.write(`  [${i}/${skusUnicos.length}] ${sku} ... `)
    try {
      const est = await estruturaDoSku(sku, cabecalho)
      if (est.erro) {
        resultadoPorSku.set(sku, { semEstrutura: true, motivoSemEstrutura: est.erro })
        console.log(`sem estrutura (${est.erro})`)
      } else {
        const r = classificarMaterial({ componentes: est.componentes, ncm: est.ncm })
        resultadoPorSku.set(sku, { ...r, ncm: est.ncm, semEstrutura: false })
        console.log(`${r.material ?? 'AMBÍGUO'}${r.ambiguo ? ' (ambíguo)' : ''}`)
      }
    } catch (erro) {
      resultadoPorSku.set(sku, { semEstrutura: true, motivoSemEstrutura: `erro: ${erro.message}` })
      console.log(`erro: ${erro.message}`)
    }
  }

  // ── A PLANILHA ────────────────────────────────────────────────────────
  const cabecalhoCsv = ['lote', 'modelo', 'cor', 'sku', 'material sugerido', 'ambiguo', 'evidencia', 'ncm']
  const linhas = lotes.map((l) => {
    const r = l.sku ? resultadoPorSku.get(l.sku) : null
    const semEstrutura = !r || r.semEstrutura
    const materialSugerido = semEstrutura ? '' : (r.material ?? '')
    const ambiguo = semEstrutura ? '' : (r.ambiguo ? 'sim' : 'nao')
    const evidencia = semEstrutura ? (r?.motivoSemEstrutura ?? 'sem SKU') : r.evidencia.join(' | ')
    const ncm = semEstrutura ? '' : (r.ncm ?? '')
    return [l.id, l.modelo ?? '', l.cor ?? '', l.sku ?? '', materialSugerido, ambiguo, evidencia, ncm]
      .map(celula).join(';')
  })
  writeFileSync(CSV_DE_SAIDA, [cabecalhoCsv.join(';'), ...linhas].join('\n') + '\n', 'utf8')

  // ── O RESUMO ──────────────────────────────────────────────────────────
  let canvas = 0; let couro = 0; let ambiguos = 0; let semEstruturaN = 0
  for (const l of lotes) {
    const r = l.sku ? resultadoPorSku.get(l.sku) : null
    if (!r || r.semEstrutura) { semEstruturaN += 1; continue }
    if (r.ambiguo) { ambiguos += 1; continue }
    if (r.material === 'canvas') canvas += 1
    else if (r.material === 'couro') couro += 1
  }

  console.log(`\n── RESUMO (${lotes.length} lotes, ${skusUnicos.length} SKUs distintos) ──`)
  console.log(`  canvas:         ${canvas}`)
  console.log(`  couro:          ${couro}`)
  console.log(`  ambíguos:       ${ambiguos}`)
  console.log(`  sem estrutura no Bling: ${semEstruturaN}`)
  console.log(`\nPlanilha para conferir: ${CSV_DE_SAIDA}`)
  console.log('Nada foi gravado no banco nem no Bling — isto é só leitura.')
} finally {
  await cli.end()
}
