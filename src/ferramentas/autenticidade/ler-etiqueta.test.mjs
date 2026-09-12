import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enderecoDaTag } from './lotes.js'
import {
  classificarLeitura, acoesDaLeitura, precisaConfirmarGarantia, resetar, regravar,
} from './ler-etiqueta.js'

const PECA = { codigo: 'PX9FWMYJET', numero_na_serie: 1, lote_id: 'l1' }
const acharPeca = (c) => (c === PECA.codigo ? PECA : null)
const enderecoDe = (c) => enderecoDaTag(c)

// ── O QUE A ETIQUETA É ─────────────────────────────────────────────────────

test('etiqueta nossa e conhecida diz DE QUEM é', () => {
  const r = classificarLeitura(enderecoDe('PX9FWMYJET'), acharPeca)
  assert.equal(r.tipo, 'conhecida')
  assert.equal(r.codigo, 'PX9FWMYJET')
  assert.equal(r.peca, PECA)
})

test('etiqueta nossa com código que o sistema não conhece NÃO vira peça inventada', () => {
  const r = classificarLeitura(enderecoDe('ZZZZZZZZZZ'), acharPeca)
  assert.equal(r.tipo, 'desconhecida')
  assert.equal(r.codigo, 'ZZZZZZZZZZ')
  assert.equal(r.peca, undefined)
})

test('chip em branco é chip em branco', () => {
  for (const nada of ['', '   ', null, undefined]) {
    assert.equal(classificarLeitura(nada, acharPeca).tipo, 'vazia')
  }
})

test('etiqueta de terceiro não é confundida com nossa', () => {
  for (const outro of ['https://google.com', 'texto qualquer', 'https://lavessel.com.br/verify/AAA']) {
    assert.equal(classificarLeitura(outro, acharPeca).tipo, 'nao-e-vessel')
  }
})

// ── O QUE A TELA OFERECE ───────────────────────────────────────────────────

test('quem só pode ver não ganha ação nenhuma', () => {
  const r = classificarLeitura(enderecoDe('PX9FWMYJET'), acharPeca)
  assert.deepEqual(acoesDaLeitura(r, { podeMexer: false }), [])
})

test('etiqueta conhecida oferece regravar e resetar', () => {
  const r = classificarLeitura(enderecoDe('PX9FWMYJET'), acharPeca)
  assert.deepEqual(acoesDaLeitura(r, { podeMexer: true }), ['regravar', 'resetar'])
})

test('etiqueta virgem e de terceiro NÃO ganham ação — nem para quem pode', () => {
  for (const lido of ['', 'https://google.com']) {
    const r = classificarLeitura(lido, acharPeca)
    assert.deepEqual(acoesDaLeitura(r, { podeMexer: true }), [],
      'oferecer ação aqui é dar poder de estragar por engano')
  }
})

test('etiqueta nossa mas órfã só oferece apagar o chip', () => {
  const r = classificarLeitura(enderecoDe('ZZZZZZZZZZ'), acharPeca)
  assert.deepEqual(acoesDaLeitura(r, { podeMexer: true }), ['apagar-chip'])
})

test('peça com garantia de cliente exige confirmação', () => {
  const comGarantia = { ...PECA, tem_garantia: true }
  const r = classificarLeitura(enderecoDe('PX9FWMYJET'), () => comGarantia)
  assert.equal(precisaConfirmarGarantia(r), true)
  assert.equal(precisaConfirmarGarantia(classificarLeitura(enderecoDe('PX9FWMYJET'), acharPeca)), false)
})

// ── O RESET E A SUA ORDEM ──────────────────────────────────────────────────

test('o reset apaga o CHIP ANTES de soltar no banco', async () => {
  const ordem = []
  const r = classificarLeitura(enderecoDe('PX9FWMYJET'), acharPeca)
  const saida = await resetar({
    leitura: r,
    apagarOChip: async () => { ordem.push('chip') },
    desmarcarNoBanco: async () => { ordem.push('banco') },
  })
  assert.equal(saida.ok, true)
  assert.deepEqual(ordem, ['chip', 'banco'],
    'banco primeiro deixaria etiqueta ORFA se o chip falhasse')
})

test('chip que nao apaga NAO mexe no banco, e a tela diz que nada mudou', async () => {
  let mexeuNoBanco = false
  const r = classificarLeitura(enderecoDe('PX9FWMYJET'), acharPeca)
  const saida = await resetar({
    leitura: r,
    apagarOChip: async () => { throw new Error('etiqueta saiu do leitor') },
    desmarcarNoBanco: async () => { mexeuNoBanco = true },
  })
  assert.equal(saida.ok, false)
  assert.equal(saida.estado, 'chip-intacto')
  assert.equal(mexeuNoBanco, false)
  assert.match(saida.frase, /Nada foi alterado no sistema/)
})

test('chip apagado e banco falhando: a frase diz o estado REAL e o que fazer', async () => {
  const r = classificarLeitura(enderecoDe('PX9FWMYJET'), acharPeca)
  const saida = await resetar({
    leitura: r,
    apagarOChip: async () => {},
    desmarcarNoBanco: async () => { throw new Error('sem rede') },
  })
  assert.equal(saida.estado, 'pela-metade')
  assert.match(saida.frase, /etiqueta foi apagada/i)
  assert.match(saida.frase, /Resetar de novo/)
})

test('nao se reseta o que o sistema nao conhece', async () => {
  const r = classificarLeitura(enderecoDe('ZZZZZZZZZZ'), acharPeca)
  const saida = await resetar({ leitura: r, apagarOChip: async () => {}, desmarcarNoBanco: async () => {} })
  assert.equal(saida.ok, false)
  assert.equal(saida.estado, 'nao-da')
})

// ── REGRAVAR ───────────────────────────────────────────────────────────────

test('regravar escreve o MESMO codigo e confere relendo', async () => {
  const escritos = []
  const r = classificarLeitura(enderecoDe('PX9FWMYJET'), acharPeca)
  const saida = await regravar({
    leitura: r,
    gravarNoChip: async (c) => { escritos.push(c) },
    lerDeVolta: async () => enderecoDe('PX9FWMYJET'),
  })
  assert.equal(saida.ok, true)
  assert.deepEqual(escritos, ['PX9FWMYJET'])
})

test('gravou mas releu OUTRA coisa: reprova e manda NAO usar a bolsa', async () => {
  const r = classificarLeitura(enderecoDe('PX9FWMYJET'), acharPeca)
  const saida = await regravar({
    leitura: r,
    gravarNoChip: async () => {},
    lerDeVolta: async () => enderecoDe('OUTROCODIGO'),
  })
  assert.equal(saida.ok, false)
  assert.match(saida.frase, /NÃO use esta bolsa/)
})

test('falha ao gravar diz que a etiqueta ficou como estava', async () => {
  const r = classificarLeitura(enderecoDe('PX9FWMYJET'), acharPeca)
  const saida = await regravar({
    leitura: r,
    gravarNoChip: async () => { throw new Error('etiqueta saiu do leitor') },
    lerDeVolta: async () => { throw new Error('nao deveria chegar aqui') },
  })
  assert.equal(saida.ok, false)
  assert.match(saida.frase, /ficou como estava/)
})
