import test from 'node:test'
import assert from 'node:assert/strict'
import { rodarTudo } from './rodada-completa.js'
import { ErroChatwoot } from './cliente-chatwoot.js'

const DENTRO = new Date('2026-09-29T15:00:00Z') // 12:00 em Brasília
const CHATWOOT = { CHATWOOT_URL: 'https://cw.exemplo.com', CHATWOOT_CONTA_ID: '7', CHATWOOT_CAIXA_ID: '3', CHATWOOT_API_TOKEN: 'SEGREDO-DO-TOKEN' }
const env = (o) => (nome) => o[nome] ?? ''
const calar = (t) => t.mock.method(console, 'error', () => {})

function fakeSb({ linhasPedido = [], linhasFollowup = [], linhasInicio = [] } = {}) {
  const chamadas = []
  return {
    chamadas,
    async rpc(nome, args) {
      chamadas.push([nome, args])
      if (nome === 'pegar_da_fila') return { data: { pedido: linhasPedido, inicio: linhasInicio }[args.p_tipo] ?? linhasFollowup, error: null }
      if (nome === 'pegar_para_mensagem') return { data: [], error: null }
      return { data: null, error: null }
    },
    from() { return { select: () => ({ in: async () => ({ data: [], error: null }), eq: () => ({ maybeSingle: async () => ({ data: { status: 'fila_envio' }, error: null }) }) }) } },
  }
}
const fakeCliente = ({ falharEm = null, erro = null } = {}) => {
  const chamadas = []
  const passo = (nome, valor) => async (arg) => { chamadas.push([nome, arg]); if (falharEm === nome) throw erro; return valor }
  return { chamadas, acharOuCriarContato: passo('contato', 11), abrirConversa: passo('conversa', 22), enviarTemplate: passo('template', 33), respondeu: passo('respondeu', false) }
}
function rodar(vars, { sb = fakeSb(), cliente = fakeCliente() } = {}) {
  const criados = []
  const criarCliente = (cfg) => { criados.push(cfg); return cliente }
  return rodarTudo({ env: env({ ...CHATWOOT, LINK_BASE: 'https://loja.com.br/', ...vars }), sb, criarCliente, agora: DENTRO })
    .then((r) => ({ ...r, sb, cliente, criados }))
}
const nomes = (sb) => sb.chamadas.map((c) => c[0])

test('⚠️ nasce tudo desligado: nada é tocado, nenhum cliente do Chatwoot é criado, e o formato antigo da resposta é mantido', async () => {
  const r = await rodar({})
  assert.equal(r.status, 200)
  assert.deepEqual(r.corpo, {
    ok: true, modo: 'desligado', inicio: { ok: true, modo: 'desligado' }, pedido: { ok: true, modo: 'desligado' }, followup: { ok: true, modo: 'desligado' },
  })
  assert.deepEqual(r.sb.chamadas, [])
  assert.equal(r.criados.length, 0)
})

test('inicio em modo lista: teto de 1 h, só os números da lista, e o modelo/texto do INICIO (não os do pedido nem do abandono)', async () => {
  const linha = { tipo: 'inicio', chave: 'tok1', numero: null, nome: 'maysa', telefone: '19982621821', url_de_recuperacao: null, conversa_origem: null }
  const r = await rodar({
    ENVIO_MODO_INICIO: 'lista', ENVIO_SO_PARA: '5519982621821', TEMPLATE_INICIO: 'checkout_iniciado_v1', TEMPLATE_PEDIDO: 'nao_e_este',
    TEMPLATE_NOME: 'nem_este', TEMPLATE_TEXTO_INICIO: 'Olá, {{1}}, tudo bem? Nós reservamos seu pedido.', ENVIO_LIMITE_POR_RODADA: '4',
  }, { sb: fakeSb({ linhasInicio: [linha] }) })
  const args = r.sb.chamadas.find((c) => c[0] === 'pegar_da_fila' && c[1].p_tipo === 'inicio')[1]
  assert.deepEqual(args, { p_tipo: 'inicio', p_limite: 4, p_max_horas: 1, p_reservar: true, p_ultimos11: ['19982621821'] })
  const envio = r.cliente.chamadas.find((c) => c[0] === 'template')[1]
  assert.equal(envio.templateParams.name, 'checkout_iniciado_v1')
  assert.equal(envio.texto, 'Olá, Maysa, tudo bem? Nós reservamos seu pedido.')
  assert.equal(r.corpo.inicio.quantidade, 1)
  assert.deepEqual(r.corpo.pedido, { ok: true, modo: 'desligado' })
})

test('INICIO_MAX_HORAS configura o teto; modo desconhecido do inicio falha fechado só nele', async (t) => {
  calar(t)
  const a = await rodar({ ENVIO_MODO_INICIO: 'seco', INICIO_MAX_HORAS: '2' })
  assert.equal(a.sb.chamadas.find((c) => c[0] === 'pegar_da_fila')[1].p_max_horas, 2)
  const b = await rodar({ ENVIO_MODO_INICIO: 'talvez', ENVIO_MODO: 'seco' })
  assert.equal(b.status, 500)
  assert.deepEqual(b.corpo.inicio, { ok: false, erro: 'modo_invalido', modo: 'talvez' })
  assert.equal(b.corpo.modo, 'seco')
})

test('só o abandono ligado (como hoje): resposta com `modo` e `quantidade` no topo, teto de 24 h, cliente com caixa numérica', async () => {
  const r = await rodar({ ENVIO_MODO: 'ligado', ENVIO_LIMITE_POR_RODADA: '3', TEMPLATE_NOME: 'v3' })
  assert.equal(r.status, 200)
  assert.equal(r.corpo.modo, 'ligado')
  assert.equal(r.corpo.quantidade, 0)
  assert.deepEqual(r.corpo.pedido, { ok: true, modo: 'desligado' })
  const args = r.sb.chamadas.find((c) => c[0] === 'pegar_para_mensagem')[1]
  assert.deepEqual([args.p_limite, args.p_atraso_min, args.p_max_horas, args.p_reservar], [3, 0, 24, true])
  assert.deepEqual(r.criados, [{ url: 'https://cw.exemplo.com', contaId: '7', caixaId: 3, token: 'SEGREDO-DO-TOKEN' }])
})

test('⚠️ troca do abandono para 24 h é só configuração: ENVIO_ATRASO_MINUTOS=1440 e ENVIO_MAX_HORAS=48 chegam ao banco', async () => {
  const r = await rodar({ ENVIO_MODO: 'seco', ENVIO_ATRASO_MINUTOS: '1440', ENVIO_MAX_HORAS: '48' })
  const args = r.sb.chamadas.find((c) => c[0] === 'pegar_para_mensagem')[1]
  assert.deepEqual([args.p_atraso_min, args.p_max_horas], [1440, 48])
})

test('pedido em modo lista: teto de 14 h, só os números da lista, e o modelo/texto do PEDIDO (não os do abandono)', async () => {
  const linha = { tipo: 'pedido', chave: '1001', numero: '#1001', nome: 'maysa', telefone: '19982621821', url_de_recuperacao: null, conversa_origem: null }
  const r = await rodar({
    ENVIO_MODO_PEDIDO: 'lista', ENVIO_SO_PARA: '5519982621821', TEMPLATE_PEDIDO: 'pedido_v1', TEMPLATE_NOME: 'nao_e_este', ENVIO_LIMITE_POR_RODADA: '4',
  }, { sb: fakeSb({ linhasPedido: [linha] }) })
  const args = r.sb.chamadas.find((c) => c[0] === 'pegar_da_fila')[1]
  assert.deepEqual(args, { p_tipo: 'pedido', p_limite: 4, p_max_horas: 14, p_reservar: true, p_ultimos11: ['19982621821'] })
  assert.equal(r.cliente.chamadas.find((c) => c[0] === 'template')[1].templateParams.name, 'pedido_v1')
  assert.equal(r.corpo.pedido.quantidade, 1)
  assert.deepEqual(r.corpo.modo, 'desligado') // o abandono segue desligado
})

test('⚠️ follow-up: agenda ANTES de pegar (48 h depois, teto igual ao teto de horas); em modo seco NÃO agenda (seco só lê)', async () => {
  const ligado = await rodar({ ENVIO_MODO_FOLLOWUP: 'ligado', TEMPLATE_FOLLOWUP: 'fu_v1' })
  assert.deepEqual(nomes(ligado.sb).filter((n) => ['agendar_followups', 'pegar_da_fila'].includes(n)), ['agendar_followups', 'pegar_da_fila'])
  assert.deepEqual(ligado.sb.chamadas.find((c) => c[0] === 'agendar_followups')[1], { p_apos_horas: 48, p_teto_horas: 24 })
  const seco = await rodar({ ENVIO_MODO_FOLLOWUP: 'seco' })
  assert.ok(!nomes(seco.sb).includes('agendar_followups'))
  assert.equal(seco.criados.length, 0) // seco não cria cliente do Chatwoot
})

test('follow-up: FOLLOWUP_APOS_HORAS configura o prazo', async () => {
  const r = await rodar({ ENVIO_MODO_FOLLOWUP: 'ligado', FOLLOWUP_APOS_HORAS: '72', TEMPLATE_FOLLOWUP: 'fu_v1' })
  assert.equal(r.sb.chamadas.find((c) => c[0] === 'agendar_followups')[1].p_apos_horas, 72)
})

test('⚠️ modo desconhecido de UM tipo falha fechado (500) sem tocar nele, e os outros seguem rodando', async (t) => {
  calar(t)
  const r = await rodar({ ENVIO_MODO_PEDIDO: 'talvez', ENVIO_MODO: 'seco' })
  assert.equal(r.status, 500)
  assert.deepEqual(r.corpo.pedido, { ok: false, erro: 'modo_invalido', modo: 'talvez' })
  assert.equal(r.corpo.modo, 'seco') // o abandono rodou
  assert.ok(!r.sb.chamadas.some((c) => c[0] === 'pegar_da_fila'))
})

test('⚠️ exceção numa passada não derruba as outras; o status é o pior e o token nunca aparece na resposta nem no log', async (t) => {
  const logs = []
  t.mock.method(console, 'error', (...a) => logs.push(a.join(' ')))
  const sb = fakeSb()
  const original = sb.rpc
  sb.rpc = async (nome, args) => { if (nome === 'pegar_da_fila' && args.p_tipo === 'pedido') throw new Error('boom'); return original(nome, args) }
  const r = await rodar({ ENVIO_MODO_PEDIDO: 'ligado', TEMPLATE_PEDIDO: 'p', ENVIO_MODO: 'seco' }, { sb })
  assert.equal(r.status, 500)
  assert.deepEqual(r.corpo.pedido, { ok: false, erro: 'excecao' })
  assert.equal(r.corpo.modo, 'seco')
  assert.ok(!JSON.stringify(r.corpo).includes('SEGREDO-DO-TOKEN'))
  assert.ok(!logs.join('\n').includes('SEGREDO-DO-TOKEN'))
})

test('credencial recusada (401) no pedido: a resposta geral é 502 e o abandono ainda roda', async (t) => {
  calar(t)
  const linha = { tipo: 'pedido', chave: '1', numero: '#1', nome: 'a', telefone: '19982621821', url_de_recuperacao: null, conversa_origem: null }
  const cliente = fakeCliente({ falharEm: 'contato', erro: new ErroChatwoot(401, 'x', 'buscar_contato') })
  const r = await rodar({ ENVIO_MODO_PEDIDO: 'ligado', TEMPLATE_PEDIDO: 'p', ENVIO_MODO: 'seco' }, { sb: fakeSb({ linhasPedido: [linha] }), cliente })
  assert.equal(r.status, 502)
  assert.equal(r.corpo.pedido.erro, 'credencial_recusada')
  assert.equal(r.corpo.modo, 'seco')
})

test('⚠️ número inválido na configuração (ENVIO_MAX_HORAS="abc") falha fechado em vez de virar "sem teto"', async () => {
  const r = await rodar({ ENVIO_MODO: 'ligado', ENVIO_MAX_HORAS: 'abc', TEMPLATE_NOME: 'v3' })
  assert.equal(r.status, 500)
  assert.equal(r.corpo.erro, 'config_invalida')
  assert.ok(!r.sb.chamadas.some((c) => c[0] === 'pegar_para_mensagem'))
})
