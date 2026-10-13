import { test } from 'node:test'
import assert from 'node:assert/strict'

// Este módulo puxa, na cadeia de imports, o conectar-no-banco-de-dados.js, que
// chama window.supabase.createClient() assim que carrega. No navegador o window
// existe; aqui no node, não. Então fingimos um window mínimo ANTES de importar —
// por isso o import é dinâmico e não estático, senão ele rodaria primeiro.
globalThis.window = { supabase: { createClient: () => ({}) } }
const { comErro } = await import('./buscar-e-salvar-dados.js')

// O sb() em si depende de fetch + estado global do app; o contrato testável e
// importante é o do comErro(): o array tem que continuar sendo um array normal
// para os 53 sitios que nao sabem do .erro.

test('array com erro continua sendo um array de verdade', () => {
  const a = comErro([], { tipo: 'sessao', mensagem: 'x', acao: 'entrar' })
  assert.ok(Array.isArray(a))
  assert.equal(a.length, 0)
  assert.deepEqual(a.map(x => x), [])
  assert.deepEqual([...a], [])
})

test('o .erro fica acessivel para quem quer tratar', () => {
  const a = comErro([], { tipo: 'permissao', mensagem: 'sem permissao', acao: null })
  assert.equal(a.erro.tipo, 'permissao')
  assert.equal(a.erro.mensagem, 'sem permissao')
})

test('o .erro e nao-enumeravel: nao aparece em JSON nem em for-in', () => {
  const a = comErro([], { tipo: 'rede', mensagem: 'x', acao: 'tentar' })
  assert.equal(JSON.stringify(a), '[]')
  assert.deepEqual(Object.keys(a), [])
})

test('array sem erro tem .erro undefined (o caso "vazio de verdade")', () => {
  const vazio = []
  assert.equal(vazio.erro, undefined)
})

/* ── lerDaApi (Plano 7): o formato do `sb`, pela API em Go ─────────────────── */
const { lerDaApi } = await import('./buscar-e-salvar-dados.js')
function respostaDaApi(status, corpo) {
  const pedidos = []
  globalThis.fetch = async (url, init) => {
    pedidos.push({ url, ...init })
    return { status, ok: status < 300, text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)), headers: { get: () => null } }
  }
  return pedidos
}

test('lerDaApi: array da API, com os parâmetros na query', async () => {
  const pedidos = respostaDaApi(200, [{ rodada: '2026-10-05' }])
  const r = await lerDaApi('/noticias/rodadas', { limite: 6 })
  assert.equal(pedidos[0].url, '/api/noticias/rodadas?limite=6')
  assert.deepEqual([...r], [{ rodada: '2026-10-05' }])
  assert.equal(r.erro, undefined)
})

test('lerDaApi: falha vira [] com .erro (frase em message), como o sb', async () => {
  respostaDaApi(401, { error: 'nao_autenticado' })
  const r = await lerDaApi('/status-ia/execucoes', { limite: 200 })
  assert.equal(r.length, 0)
  assert.equal(r.erro.tipo, 'sessao')
  assert.ok(r.erro.message)

  respostaDaApi(200, { nao: 'é array' })
  const s = await lerDaApi('/noticias/panorama', { limite: 1 })
  assert.equal(s.erro.tipo, 'servidor')
  assert.ok(s.erro.message)
})
