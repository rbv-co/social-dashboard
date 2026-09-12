import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apagarEConferir } from './gravar-pelo-leitor-de-mesa.js'

// Uma porta de mentira: guarda o que foi pedido e responde o que o teste mandar.
function portaFalsa({ leituras = [], aoApagar = null } = {}) {
  const pedidos = []
  let i = 0
  return {
    pedidos,
    async lerAEtiqueta() {
      const proxima = leituras[Math.min(i++, leituras.length - 1)]
      if (proxima instanceof Error) throw proxima
      return proxima
    },
    async apagar(memoria) {
      pedidos.push({ apagou: true, memoria })
      if (aoApagar) throw aoApagar
      return 36
    },
  }
}

const CHEIA = { endereco: 'https://vesselbrasil.com.br/verify/PX9FWMYJET', memoria: [1, 2, 3], capability: null }
const VAZIA = { endereco: '', memoria: [1, 2, 3], capability: null }

test('apaga e confere: dá certo quando a etiqueta NAO devolve mais endereco', async () => {
  const porta = portaFalsa({ leituras: [CHEIA, VAZIA] })
  const r = await apagarEConferir({ porta })
  assert.equal(r.ok, true)
  assert.equal(r.estado, 'apagada')
  assert.equal(porta.pedidos.length, 1)
})

test('⚠️ se ainda devolve endereco, NAO considera apagada', async () => {
  const porta = portaFalsa({ leituras: [CHEIA, CHEIA] })
  const r = await apagarEConferir({ porta })
  assert.equal(r.ok, false)
  assert.match(r.frase, /NÃO considere esta etiqueta apagada/)
})

test('nao conseguiu LER antes: nao apaga nada', async () => {
  const porta = portaFalsa({ leituras: [new Error('etiqueta fora do leitor')] })
  const r = await apagarEConferir({ porta })
  assert.equal(r.ok, false)
  assert.match(r.frase, /não apaguei nada/)
  assert.equal(porta.pedidos.length, 0, 'apagar sem ter lido escreveria por cima do Lock Control')
})

test('a memoria JA LIDA e reusada — nao se le o chip duas vezes a toa', async () => {
  const porta = portaFalsa({ leituras: [VAZIA] })
  await apagarEConferir({ porta, memoria: [9, 9, 9] })
  assert.deepEqual(porta.pedidos[0].memoria, [9, 9, 9],
    'cada ida ao chip e mais uma chance de a etiqueta sair do leitor no meio')
})

test('⚠️ falha ao apagar NUNCA manda separar a etiqueta', async () => {
  const porta = portaFalsa({ leituras: [CHEIA, VAZIA], aoApagar: new Error('leitor caiu') })
  const r = await apagarEConferir({ porta })
  assert.equal(r.ok, false)
  assert.ok(!/SEPARE|separe esta etiqueta|jogue fora/i.test(r.frase),
    'a primeira escrita ja e a mensagem vazia: parar no meio deixa a etiqueta VALIDA e em branco')
  assert.match(r.frase, /apagar de novo|Apagar duas vezes/i)
})

test('recusa com a etiqueta intacta e dita como recusa, nao como falha', async () => {
  const intacta = Object.assign(new Error('não dá para apagar sem ter lido'), { nadaFoiEscrito: true })
  const porta = portaFalsa({ leituras: [CHEIA, VAZIA], aoApagar: intacta })
  const r = await apagarEConferir({ porta })
  assert.equal(r.estado, 'recusada')
})
