import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MINUTOS_ATE_ABANDONO, segundosRestantes, percentualDoPrazo, formatarContagem,
  separarPorStatus, foiCortado, LIMITE_ABANDONO, seloDaMensagem,
} from './regras-do-abandono.js'

const T0 = new Date('2026-09-28T12:00:00Z').getTime()
const em = (seg) => T0 + seg * 1000

test('o prazo é de 10 minutos, como o do Shopify', () => {
  assert.equal(MINUTOS_ATE_ABANDONO, 10)
})

test('a contagem regressiva parte de 600s e nunca fica negativa', () => {
  const evento = new Date(T0).toISOString()
  assert.equal(segundosRestantes(evento, em(0)), 600)
  assert.equal(segundosRestantes(evento, em(90)), 510)
  assert.equal(segundosRestantes(evento, em(600)), 0)
  assert.equal(segundosRestantes(evento, em(9999)), 0)
})

test('percentual do prazo vai de 0 a 100', () => {
  const evento = new Date(T0).toISOString()
  assert.equal(percentualDoPrazo(evento, em(0)), 0)
  assert.equal(percentualDoPrazo(evento, em(300)), 50)
  assert.equal(percentualDoPrazo(evento, em(700)), 100)
})

test('formata m:ss', () => {
  assert.equal(formatarContagem(600), '10:00')
  assert.equal(formatarContagem(65), '1:05')
  assert.equal(formatarContagem(0), '0:00')
})

test('separa por status; aguardando: o que vence primeiro em cima; demais: o mais novo em cima', () => {
  const r = separarPorStatus([
    { token: 'a', status: 'aguardando', ultimo_evento_em: '2026-09-28T12:05:00Z' },
    { token: 'b', status: 'aguardando', ultimo_evento_em: '2026-09-28T12:01:00Z' },
    { token: 'c', status: 'fila_envio', fila_envio_em: '2026-09-28T12:10:00Z' },
    { token: 'd', status: 'fila_envio', fila_envio_em: '2026-09-28T12:20:00Z' },
    { token: 'e', status: 'comprou', comprou_em: '2026-09-28T12:30:00Z' },
    { token: 'f', status: 'pagamento_pendente', pedido_criado_em: '2026-09-28T12:40:00Z' },
    { token: 'g', status: 'pagamento_pendente', pedido_criado_em: '2026-09-28T12:50:00Z' },
  ])
  assert.deepEqual(r.aguardando.map((x) => x.token), ['b', 'a'])
  assert.deepEqual(r.filaEnvio.map((x) => x.token), ['d', 'c'])
  assert.deepEqual(r.compraram.map((x) => x.token), ['e'])
  assert.deepEqual(r.pagamentoPendente.map((x) => x.token), ['g', 'f'])
})

test('lista que bateu no limite é marcada como cortada', () => {
  assert.equal(foiCortado(new Array(LIMITE_ABANDONO).fill({})), true)
  assert.equal(foiCortado([]), false)
})

test('seloDaMensagem: um selo por estado, e nada quando a mensagem nem começou', () => {
  assert.equal(seloDaMensagem({ mensagem_status: null }), null)
  assert.deepEqual(seloDaMensagem({ mensagem_status: 'enviando' }), { texto: 'enviando…', tipo: 'info' })
  assert.deepEqual(seloDaMensagem({ mensagem_status: 'enviada' }), { texto: 'mensagem enviada', tipo: 'ok' })
  assert.deepEqual(seloDaMensagem({ mensagem_status: 'falhou', mensagem_motivo: 'enviar_template:422' }),
    { texto: 'falhou', tipo: 'erro' })
})

test('seloDaMensagem: ignorada explica o motivo em português; motivo desconhecido não quebra', () => {
  const motivo = (m) => seloDaMensagem({ mensagem_status: 'ignorada', mensagem_motivo: m })
  assert.equal(motivo('sem_telefone').texto, 'sem telefone: não recebe WhatsApp')
  assert.equal(motivo('telefone_invalido').texto, 'telefone inválido')
  assert.equal(motivo('pediu_para_nao_receber').texto, 'pediu para não receber')
  assert.equal(motivo('sem_link').texto, 'sem link de recuperação')
  assert.equal(motivo('nao_esta_mais_na_fila').texto, 'já não estava na fila')
  assert.deepEqual(motivo('algo_novo'), { texto: 'não enviada', tipo: 'neutro' })
  assert.equal(motivo('sem_telefone').tipo, 'neutro')
})
