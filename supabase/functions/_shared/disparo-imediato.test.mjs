import test from 'node:test'
import assert from 'node:assert/strict'
import { dispararAgora, tiposDoTopico } from './disparo-imediato.js'
import { rodarTudo } from './rodada-completa.js'

const DENTRO = new Date('2026-09-29T15:00:00Z') // 12:00 em Brasília
const FORA = new Date('2026-09-29T03:00:00Z') // 00:00 em Brasília
const BASE = {
  CHATWOOT_URL: 'https://cw.exemplo.com', CHATWOOT_CONTA_ID: '7', CHATWOOT_CAIXA_ID: '3', CHATWOOT_API_TOKEN: 'SEGREDO-DO-TOKEN',
  LINK_BASE: 'https://loja.com.br/', DISPARO_IMEDIATO: 'true',
  ENVIO_MODO_INICIO: 'ligado', TEMPLATE_INICIO: 'inicio_v1', ENVIO_MODO_PEDIDO: 'ligado', TEMPLATE_PEDIDO: 'pedido_v1',
  ENVIO_MODO: 'ligado', TEMPLATE_NOME: 'abandono_v1', ENVIO_MODO_FOLLOWUP: 'ligado', TEMPLATE_FOLLOWUP: 'follow_v1',
}
const env = (o) => (nome) => o[nome] ?? ''
const calar = (t) => t.mock.method(console, 'error', () => {})

/** Banco falso com a mesma garantia do `pegar_da_fila` real: ler os candidatos e marcá-los `enviando` é UM passo atômico. */
function fakeSb(linhas) {
  const chamadas = []
  return {
    linhas, chamadas,
    async rpc(nome, args) {
      chamadas.push([nome, args])
      if (nome === 'pegar_da_fila') {
        const ps = linhas.filter((l) => l.tipo === args.p_tipo && l.mensagem_status == null)
        if (args.p_reservar) ps.forEach((l) => { l.mensagem_status = 'enviando' })
        await Promise.resolve() // devolver a resposta cede a vez: o outro disparo roda aqui no meio
        return { data: ps.map((l) => ({ ...l })), error: null }
      }
      const l = linhas.find((x) => x.tipo === args.p_tipo && x.chave === args.p_chave)
      if (nome === 'marcar_da_fila' && l?.mensagem_status === 'enviando') l.mensagem_status = args.p_status
      if (nome === 'devolver_da_fila' && l?.mensagem_status === 'enviando') l.mensagem_status = null
      return { data: null, error: null }
    },
    from() { return { select: () => ({ in: async () => ({ data: [], error: null }) }) } },
  }
}
const fakeCliente = () => {
  const enviados = []
  return {
    enviados, reservas: [],
    acharOuCriarContato: async () => 11, abrirConversa: async () => 22,
    enviarTemplate: async (a) => { await Promise.resolve(); enviados.push(a) },
    reservarAviso: async function (a) { this.reservas.push(a); return this.resposta ?? 'reservado' },
  }
}
const inicio = (extra = {}) => ({ tipo: 'inicio', chave: 'tok1', numero: null, nome: 'maysa', telefone: '19982621821', url_de_recuperacao: 'https://loja.com.br/1/checkouts/tok1/recover?key=K', conversa_origem: null, mensagem_status: null, ...extra })
const pedido = (extra = {}) => ({ tipo: 'pedido', chave: '99', numero: '#1001', nome: 'maysa', telefone: '19982621821', url_de_recuperacao: null, conversa_origem: null, mensagem_status: null, ...extra })
const disparar = (vars, sb, cliente, topico, agora = DENTRO) =>
  dispararAgora({ env: env({ ...BASE, ...vars }), sb, criarCliente: () => cliente, topico, agora })

test('tópico -> tipo: checkouts/* é inicio, orders/create|paid é pedido, o resto não envia', () => {
  assert.deepEqual(tiposDoTopico('checkouts/update'), ['inicio'])
  assert.deepEqual(tiposDoTopico('orders/paid'), ['pedido'])
  assert.deepEqual(tiposDoTopico('orders/cancelled'), [])
})

test('⚠️ flag desligada (padrão): não toca em banco nem em Chatwoot', async () => {
  const sb = fakeSb([inicio()]), c = fakeCliente()
  const r = await disparar({ DISPARO_IMEDIATO: '' }, sb, c, 'checkouts/create')
  assert.deepEqual(r, { rodou: false, motivo: 'desligado' })
  assert.deepEqual(sb.chamadas, [])
  assert.equal(c.enviados.length, 0)
})

test('ligada: envia o inicio na hora, e SÓ o tipo do tópico (pedido, abandono e follow-up nem são lidos)', async () => {
  const sb = fakeSb([inicio(), pedido()]), c = fakeCliente()
  await disparar({}, sb, c, 'checkouts/create')
  assert.equal(c.enviados.length, 1)
  assert.equal(sb.linhas[0].mensagem_status, 'enviada')
  assert.equal(sb.linhas[1].mensagem_status, null)
  const lidos = sb.chamadas.filter((x) => x[0] === 'pegar_da_fila').map((x) => x[1].p_tipo)
  assert.deepEqual(lidos, ['inicio'])
  assert.ok(!sb.chamadas.some((x) => x[0] === 'agendar_followups' || x[0] === 'pegar_para_mensagem'))
})

test('⚠️ dois disparos CONCORRENTES (webhook + robô de 1 min, ou dois webhooks) não enviam em dobro', async () => {
  const sb = fakeSb([inicio(), pedido()]), c = fakeCliente()
  const env1 = env(BASE)
  await Promise.all([
    dispararAgora({ env: env1, sb, criarCliente: () => c, topico: 'checkouts/update', agora: DENTRO }),
    dispararAgora({ env: env1, sb, criarCliente: () => c, topico: 'checkouts/update', agora: DENTRO }),
    rodarTudo({ env: env1, sb, criarCliente: () => c, agora: DENTRO }), // o robô do minuto, todas as passadas
    dispararAgora({ env: env1, sb, criarCliente: () => c, topico: 'orders/paid', agora: DENTRO }),
  ])
  assert.equal(c.enviados.length, 2, 'uma mensagem de inicio + uma de pedido, nunca mais')
  assert.deepEqual(sb.linhas.map((l) => l.mensagem_status), ['enviada', 'enviada'])
})

test('inicio sem link: espera sem gastar tentativa; quando o link chega, o disparo do evento seguinte envia', async () => {
  const sb = fakeSb([inicio({ url_de_recuperacao: null })]), c = fakeCliente()
  await disparar({}, sb, c, 'checkouts/create')
  assert.equal(c.enviados.length, 0)
  assert.equal(sb.linhas[0].mensagem_status, null, 'devolvida à fila')
  assert.ok(sb.chamadas.some((x) => x[0] === 'devolver_da_fila' && x[1].p_contar === false))
  sb.linhas[0].url_de_recuperacao = 'https://loja.com.br/1/checkouts/tok1/recover?key=K' // evento seguinte trouxe o link
  await disparar({}, sb, c, 'checkouts/update')
  assert.equal(c.enviados.length, 1)
  assert.equal(sb.linhas[0].mensagem_status, 'enviada')
})

test('modos: desligado não faz nada, seco não reserva nem envia, lista respeita ENVIO_SO_PARA', async () => {
  let sb = fakeSb([inicio()]), c = fakeCliente()
  await disparar({ ENVIO_MODO_INICIO: 'desligado' }, sb, c, 'checkouts/create')
  assert.deepEqual(sb.chamadas, [])
  await disparar({ ENVIO_MODO_INICIO: 'seco' }, sb, c, 'checkouts/create')
  assert.equal(c.enviados.length, 0)
  assert.equal(sb.linhas[0].mensagem_status, null)
  assert.equal(sb.chamadas.find((x) => x[0] === 'pegar_da_fila')[1].p_reservar, false)
  await disparar({ ENVIO_MODO_INICIO: 'lista', ENVIO_SO_PARA: '5511999990000' }, sb, c, 'checkouts/create')
  assert.deepEqual(sb.chamadas.filter((x) => x[0] === 'pegar_da_fila').at(-1)[1].p_ultimos11,['11999990000'], 'a consulta só pede os números da lista')
})

test('fora da janela de horário: devolve a fila sem enviar (o robô pega depois)', async () => {
  const sb = fakeSb([inicio()]), c = fakeCliente()
  await disparar({}, sb, c, 'checkouts/create', FORA)
  assert.equal(c.enviados.length, 0)
  assert.equal(sb.linhas[0].mensagem_status, null)
})

test('telefone bloqueado não recebe o inicio', async () => {
  const sb = fakeSb([inicio()]), c = fakeCliente()
  sb.from = () => ({ select: () => ({ in: async () => ({ data: [{ telefone: '5519982621821' }], error: null }) }) })
  await disparar({}, sb, c, 'checkouts/create')
  assert.equal(c.enviados.length, 0)
  assert.equal(sb.linhas[0].mensagem_status, 'ignorada')
})

test('reserva do Chatwoot: `adiado` não envia e devolve a linha; `reservado` envia', async () => {
  const sb = fakeSb([pedido()]), c = fakeCliente()
  c.resposta = 'adiado'
  await disparar({ RESERVAR_AVISO_CHATWOOT: 'true', CHATWOOT_BOT_SECRET: 's' }, sb, c, 'orders/create')
  assert.equal(c.enviados.length, 0)
  assert.equal(sb.linhas[0].mensagem_status, null)
  c.resposta = 'reservado'
  await disparar({ RESERVAR_AVISO_CHATWOOT: 'true', CHATWOOT_BOT_SECRET: 's' }, sb, c, 'orders/paid')
  assert.equal(c.enviados.length, 1)
})

test('⚠️ falha nunca vaza: banco que lança, Chatwoot que lança e limite de tempo viram retorno + log sem telefone nem segredo', async (t) => {
  const logs = []
  t.mock.method(console, 'error', (...a) => logs.push(a.join(' ')))
  const quebrado = { rpc: async () => { throw new Error('banco caiu') }, from: () => { throw new Error('x') } }
  const r1 = await disparar({}, quebrado, fakeCliente(), 'checkouts/create')
  assert.equal(r1.rodou, true) // a passada captura o erro; o disparo não lança
  const sb = fakeSb([inicio()]), c = fakeCliente()
  c.enviarTemplate = async () => { throw new Error('rede 19982621821 SEGREDO-DO-TOKEN') }
  await disparar({}, sb, c, 'checkouts/create')
  const r3 = await dispararAgora({ env: env(BASE), sb: { rpc: () => new Promise(() => {}) }, criarCliente: () => fakeCliente(), topico: 'checkouts/create', limiteMs: 20, agora: DENTRO })
  assert.deepEqual(r3, { rodou: true, motivo: 'limite_de_tempo' })
  const r4 = await dispararAgora({ env: () => { throw new Error('env quebrou') }, sb, criarCliente: () => c, topico: 'checkouts/create' })
  assert.equal(r4.motivo, 'excecao')
  assert.ok(!logs.join('\n').includes('19982621821'), 'telefone nunca no log')
  assert.ok(!logs.join('\n').includes('SEGREDO-DO-TOKEN'), 'segredo nunca no log')
})
