import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mexeEmDinheiro, SELO_DINHEIRO, EMOJI_DINHEIRO } from './consequencia-do-recurso.js'

test('gasta verba real: Trafego e Fabrica', () => {
  assert.equal(mexeEmDinheiro('meta.gestor'), true)
  assert.equal(mexeEmDinheiro('meta.fabrica'), true)
})

test('meta de venda NAO mexe em dinheiro', () => {
  // Eu tinha colocado na conversa e esta errado: meta e alvo de faturamento,
  // nao gasto. Mexer nela nao tira dinheiro de lugar nenhum.
  assert.equal(mexeEmDinheiro('sales.metas'), false)
})

test('so ver nao vale selo — o selo e sobre poder gastar', () => {
  assert.equal(mexeEmDinheiro('social'), false)
  assert.equal(mexeEmDinheiro('noticias'), false)
})

test('nao estoura com chave desconhecida', () => {
  assert.equal(mexeEmDinheiro('inventado'), false)
  assert.equal(mexeEmDinheiro(null), false)
})

test('o selo tem o texto exato — a lista e o modal mostram o MESMO simbolo', () => {
  // `length > 0` passava com qualquer coisa, inclusive com o simbolo trocado
  // so num dos dois lugares. O que precisa ser verdade e o texto em si.
  assert.equal(SELO_DINHEIRO, '💰 mexe em dinheiro')
  assert.ok(SELO_DINHEIRO.startsWith(EMOJI_DINHEIRO), 'o selo nasce do mesmo simbolo que a lista usa')
})

test('toda chave marcada como dinheiro existe no catalogo', async () => {
  // Sem isto, um erro de digitacao apaga o selo em silencio.
  globalThis.window = { supabase: { createClient: () => ({}) } }
  const { RECURSOS } = await import('../../compartilhado/controle-de-login-e-usuario.js')
  const existentes = new Set(RECURSOS.map((r) => r.key))
  for (const k of ['meta.gestor', 'meta.fabrica']) {
    assert.ok(mexeEmDinheiro(k), `${k} deveria estar marcada`)
    assert.ok(existentes.has(k), `${k} nao existe no catalogo`)
  }
})
