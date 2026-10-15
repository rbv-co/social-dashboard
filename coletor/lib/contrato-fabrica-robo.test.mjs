import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* O CONTRATO ROBÔ DA FÁBRICA -> `/fabrica/robo/*` DA API EM GO. O robô (fabrica.yml, no Actions: é o único que SEGUE longe do
 * banco) escreve pelas 7 rotas do robô com o token `srv_`. Cada lado já se testa sozinho (fabrica-banco.test.mjs aqui, robo_test.go
 * na API) com a requisição que ELE imagina; o que faltava era provar que a requisição que o robô de verdade monta é a que a API
 * aceita. Aqui se grava, com os módulos REAIS (`escreverFabrica`, `linhaCriativoProduto`, `registrarExecucao`...), o que sai pela
 * rede, em `__fixtures__/contrato-fabrica-robo.json`; o teste Go `contrato_do_robo_test.go` repete cada pedido na API de verdade.
 * Mudou o que o robô manda: este teste reprova até o arquivo ser regravado (`ATUALIZAR_FIXTURE=1 node --test ...`) e o Go julga. */

process.env.CENTRAL_API_URL = 'http://api:8080'
process.env.CENTRAL_API_TOKEN = 'srv_robo'
const fb = await import('./fabrica-banco.mjs?' + Math.random())
const { linhaCriativoProduto } = await import('../gerar-criativos.mjs')
const { registrarExecucao } = await import('../registrar-execucao.mjs')

// os ids do mundo de teste da API (api/internal/fabrica/mundo_test.go): J1 job `gerar` rodando da C1, C2 rodada pronta
const J1 = 'a5850000-0000-4000-a000-0000000000e1'
const C1 = 'a5830000-0000-4000-a000-0000000000c1'
const C2 = 'a5830000-0000-4000-a000-0000000000c2'
const C3 = 'a5830000-0000-4000-a000-0000000000c3'
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'contrato-fabrica-robo.json')

function gravador() {
  const pedidos = []
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    pedidos.push({ metodo: init.method || 'GET', caminho: u.pathname + u.search, corpo: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization })
    return { status: 204, ok: true, text: async () => '', headers: { get: () => null } }
  }
  return pedidos
}

test('o que o robô da Fábrica manda é o que a API confere (arquivo do contrato)', async () => {
  const pedidos = gravador()
  const v = { template: 'produto-solo', formato: 'feed', variante: 'sage', preco_de: 890, preco_por: 790 }
  const op = async (nome, fn) => { const antes = pedidos.length; await fn(); for (const p of pedidos.slice(antes)) p.operacao = nome }

  await op('proximo lote do gerar', () => fb.proximoLote(J1))
  await op('job começou a rodar', () => fb.escreverFabrica('PATCH', `/fabrica_jobs?id=eq.${J1}`, { status: 'rodando', github_run_id: '111', updated_at: 'x' }))
  await op('criativo de produto', () => fb.escreverFabrica('POST', '/fabrica_criativos', [linhaCriativoProduto({
    campanhaId: C1, cand: { sku: 'SS1A.01' }, v, url: 'https://midia.x/f/a.png', storagePath: `${C1}/produto/ss1a-01-sage-feed.png`, legenda: 'legenda' })]))
  await op('criativo de promo', () => fb.escreverFabrica('POST', '/fabrica_criativos', [
    { campanha_id: C1, arquetipo: 'promo', template: 'promo-sage', formato: 'feed', variante: 'sage', storage_path: `${C1}/promo/sage-feed.png`, url: 'https://midia.x/f/p.png', legenda: null }]))
  await op('preview do look', () => fb.escreverFabrica('PATCH', '/fabrica_looks?chave=eq.promo-sage', { preview_url: 'https://midia.x/f/p.png' }))
  await op('rastro da subida', () => fb.escreverFabrica('POST', '/fabrica_meta_jobs', [{
    ad_account_id: 'act_123456', loja: 'Tivoli', tipo: 'estudio', meta_campaign_id: '120200000000001', adset_ids: ['1202'], ad_ids: ['1203'],
    payload: { campanhaId: C3, destino: 'feed', escolhidos: 2, caption: 'x' }, status: 'parcial', erro: 'rate limit — 1 pendente(s)' }]))
  await op('custo da execução', () => registrarExecucao({
    robo: 'fabrica-gerar', acao: 'gerar', modelo: 'claude-sonnet-5-5', inputTokens: 1200, outputTokens: 300, chamadas: 2, duracaoMs: 4100, itens: 3, unidade: 'criativos', status: 'ok' }))
  await op('rodada pronta', () => fb.escreverFabrica('PATCH', `/fabrica_campanhas?id=eq.${C1}`, { status: 'pronta' }))
  await op('rodada fechada', () => fb.escreverFabrica('PATCH', `/fabrica_campanhas?id=eq.${C2}`, { fechada_em: '2026-10-15T00:00:00Z' }))
  await op('job concluído', () => fb.escreverFabrica('PATCH', `/fabrica_jobs?id=eq.${J1}`, { status: 'concluido', resultado: { criativos: 3 }, erro: null, updated_at: 'x' }))

  for (const p of pedidos) assert.equal(p.auth, 'Bearer srv_robo', `${p.operacao}: o robô entra com o token de serviço`)
  const saida = pedidos.map(({ operacao, metodo, caminho, corpo }) => ({ operacao, metodo, caminho, corpo }))
  if (process.env.ATUALIZAR_FIXTURE) writeFileSync(FIXTURE, JSON.stringify(saida, null, 2) + '\n')
  assert.deepEqual(saida, JSON.parse(readFileSync(FIXTURE, 'utf8')),
    'o robô manda outra coisa: regrave (ATUALIZAR_FIXTURE=1) e rode contrato_do_robo_test.go na API')
})
