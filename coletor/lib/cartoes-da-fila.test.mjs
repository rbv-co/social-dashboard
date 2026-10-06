import test from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDoCartao, nomeDaSubpasta, agruparPorSku, planoDeDevolucao, arquivosDoCartao } from './cartoes-da-fila.js'

test('o arquivo do cartão leva o SKU e o número da peça com 2 dígitos, como a entrega que a gráfica já aceitou', () => {
  assert.equal(rotuloDoCartao('SS0004HB.B3', 5), 'SS0004HB.B3_cartao_05')
  assert.equal(rotuloDoCartao('SS0001CB.M3', 22), 'SS0001CB.M3_cartao_22')
  assert.deepEqual(arquivosDoCartao('X_cartao_01'),
    ['X_cartao_01_frente.png', 'X_cartao_01_frente.pdf', 'X_cartao_01_verso.png', 'X_cartao_01_verso.pdf'])
})

test('a subpasta de entrega é a mesma do gerar-lote: SKU primeiro, sublinhado vira espaço', () => {
  assert.equal(nomeDaSubpasta('Alba_Areia - SS0004HB.B3', 'SS0004HB.B3'), 'SS0004HB.B3 - Alba Areia')
  assert.equal(nomeDaSubpasta('Hand_Small_Areia c\u007FVinho - SS0010HB.S2', 'SS0010HB.S2'), 'SS0010HB.S2 - Hand Small Areia c-Vinho')
})

test('código da peça NÃO é número de série: o SKU vem do lote e o número é a posição dela no lote', () => {
  const linhas = [
    { codigo: '5STJHPGYX6', numero_na_serie: 14, vessel_lotes: { sku: 'SS0001CB.M1' } },
    { codigo: '3HY2DN8AE4', numero_na_serie: 13, vessel_lotes: { sku: 'SS0001CB.M1' } },
    { codigo: '3XQFRXHGTT', numero_na_serie: 2, vessel_lotes: { sku: 'SS0001CB.M3' } },
  ]
  const { porSku, semDados } = agruparPorSku(['5STJHPGYX6', '3HY2DN8AE4', '3XQFRXHGTT'], linhas)
  assert.deepEqual(semDados, [])
  assert.deepEqual(porSku.get('SS0001CB.M1'), [{ codigo: '3HY2DN8AE4', numero: 13 }, { codigo: '5STJHPGYX6', numero: 14 }])
  assert.deepEqual(porSku.get('SS0001CB.M3'), [{ codigo: '3XQFRXHGTT', numero: 2 }])
})

test('peça sem lote, lote sem SKU ou sem número não gera cartão e volta como falha com o motivo', () => {
  const linhas = [
    { codigo: 'A', numero_na_serie: 1, vessel_lotes: { sku: '  ' } },
    { codigo: 'B', numero_na_serie: null, vessel_lotes: { sku: 'SS1' } },
    { codigo: 'C', numero_na_serie: 3, vessel_lotes: null },
  ]
  const { porSku, semDados } = agruparPorSku(['A', 'B', 'C', 'D'], linhas)
  assert.equal(porSku.size, 0)
  assert.deepEqual(semDados.map((x) => [x.codigo, x.motivo]), [
    ['A', 'o lote não tem SKU'], ['B', 'a peça não tem número no lote'], ['C', 'o lote não tem SKU'], ['D', 'peça não encontrada'],
  ])
})

test('tudo bom: UMA chamada, ok, marcando todas as peças', () => {
  assert.deepEqual(planoDeDevolucao({ pedidas: ['A', 'B'], confirmadas: ['A', 'B'], falhas: [], pasta: 'Cartões com EAN/2026-10-06' }),
    [{ ok: true, pecas: ['A', 'B'], erro: null, pasta: 'Cartões com EAN/2026-10-06' }])
})

test('resultado parcial: marca só as boas e fecha o pedido como falhou — nunca "pronto" com cartão faltando', () => {
  const plano = planoDeDevolucao({
    pedidas: ['A', 'B', 'C'], confirmadas: ['A'],
    falhas: [{ rotulo: 'SS1 nº2', motivo: 'sem foto no Zoho' }, { rotulo: 'SS1 nº3', motivo: 'código de barras não bate' }],
    pasta: 'p',
  })
  assert.equal(plano.length, 2)
  assert.deepEqual([plano[0].ok, plano[0].pecas], [true, ['A']])
  assert.equal(plano[1].ok, false)
  assert.deepEqual(plano[1].pecas, [])
  assert.match(plano[1].erro, /2 de 3 cartões não saíram/)
  assert.match(plano[1].erro, /sem foto no Zoho/)
})

test('nada confirmado: só a chamada de falha, sem marcar peça', () => {
  const plano = planoDeDevolucao({ pedidas: ['A'], confirmadas: [], falhas: [{ rotulo: 'pedido', motivo: 'sem credencial do Zoho' }], pasta: null })
  assert.deepEqual(plano.map((c) => [c.ok, c.pecas]), [[false, []]])
})

test('peça confirmada que o pedido não pediu nunca é marcada, e o erro cabe na coluna', () => {
  const plano = planoDeDevolucao({ pedidas: ['A'], confirmadas: ['A', 'INTRUSA'], falhas: [], pasta: null })
  assert.deepEqual(plano[0].pecas, ['A'])
  const longo = planoDeDevolucao({ pedidas: ['A'], confirmadas: [], falhas: [{ rotulo: 'x', motivo: 'y'.repeat(2000) }], pasta: null })
  assert.ok(longo[0].erro.length <= 900)
})
