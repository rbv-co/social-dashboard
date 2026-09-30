import test from 'node:test'
import assert from 'node:assert/strict'
import { processarFila } from './rodada-da-fila.js'
import { ErroChatwoot } from './cliente-chatwoot.js'

const BASE = 'https://loja.com.br/'
const DENTRO = new Date('2026-09-29T15:00:00Z') // 12:00 em Brasília
const NOITE = new Date('2026-09-30T02:00:00Z')  // 23:00 em Brasília
const CONFIG = {
  modo: 'ligado', limite: 5, maxHoras: 14, soPara: [], linkBase: BASE, templateNome: 'modelo_v1', idioma: 'pt_BR', templateTexto: '',
  chatwoot: { url: 'https://cw.exemplo.com', contaId: '7', caixaId: '3', token: 'T' },
}
const pedido = (n, extra = {}) => ({
  tipo: 'pedido', chave: `100${n}`, numero: `#100${n}`, nome: 'maysa priscila', telefone: `1998262182${n}`,
  url_de_recuperacao: null, conversa_origem: null, ...extra,
})
const inicio = (n, extra = {}) => ({
  tipo: 'inicio', chave: `tok${n}`, numero: null, nome: 'maysa priscila', telefone: `1998262182${n}`,
  url_de_recuperacao: `${BASE}1/checkouts/tok${n}/recover?key=SEGREDO${n}`, conversa_origem: null, ...extra,
})
const followup = (n, extra = {}) => ({
  tipo: 'followup', chave: `tok${n}`, numero: null, nome: 'maysa priscila', telefone: `1998262182${n}`,
  url_de_recuperacao: `${BASE}1/checkouts/tok${n}/recover?key=SEGREDO${n}`, conversa_origem: 900 + n, ...extra,
})

function fakeSb({ linhas = [], errPegar = null, errBloq = null, bloqueados = [], statusAgora = {}, errStatus = null, falhaMarcarEnviada = false } = {}) {
  const chamadas = []
  return {
    chamadas,
    async rpc(nome, args) {
      chamadas.push([nome, args])
      if (nome === 'pegar_da_fila') return { data: linhas, error: errPegar }
      if (nome === 'marcar_da_fila' && falhaMarcarEnviada && args.p_status === 'enviada') return { data: null, error: { message: 'boom' } }
      return { data: null, error: null }
    },
    from(tabela) {
      chamadas.push([`from:${tabela}`])
      if (tabela === 'checkout_abandono') {
        return { select: () => ({ eq: (_c, token) => ({ maybeSingle: async () => ({ data: errStatus ? null : { status: statusAgora[token] ?? 'fila_envio' }, error: errStatus }) }) }) }
      }
      return { select: () => ({ in: async (_c, valores) => ({ data: bloqueados.filter((b) => valores.includes(b)).map((telefone) => ({ telefone })), error: errBloq }) }) }
    },
  }
}
function fakeCliente({ falharEm = null, erro = null, respondeu = false } = {}) {
  const chamadas = []
  const passo = (nome, valor) => async (arg) => { chamadas.push([nome, arg]); if (falharEm === nome) throw erro; return valor }
  return {
    chamadas,
    acharOuCriarContato: passo('contato', 11), abrirConversa: passo('conversa', 22), enviarTemplate: passo('template', 33),
    respondeu: passo('respondeu', respondeu),
  }
}
const nomes = (sb) => sb.chamadas.map((c) => c[0])
const rpcs = (sb, nome) => sb.chamadas.filter((c) => c[0] === nome).map((c) => c[1])
const rodar = (tipo, sb, cliente, extra = {}, agora = DENTRO) => processarFila({ sb, cliente, tipo, config: { ...CONFIG, ...extra }, agora })
const calar = (t) => t.mock.method(console, 'error', () => {})

// ── configuração ──────────────────────────────────────────────────────────────
test('⚠️ configuração inválida (limite, teto de horas, template): 500 e NENHUMA linha é tocada', async () => {
  for (const extra of [{ limite: NaN }, { maxHoras: 0 }, { maxHoras: 'abc' }, { templateNome: '' }]) {
    const sb = fakeSb({ linhas: [pedido(1)] })
    const r = await rodar('pedido', sb, fakeCliente(), extra)
    assert.equal(r.status, 500, JSON.stringify(extra))
    assert.equal(r.corpo.erro, 'config_invalida')
    assert.deepEqual(sb.chamadas, [])
  }
})

test('pedido não exige LINK_BASE; o follow-up exige', async () => {
  assert.equal((await rodar('pedido', fakeSb(), fakeCliente(), { linkBase: '' })).status, 200)
  assert.equal((await rodar('followup', fakeSb(), fakeCliente(), { linkBase: '' })).status, 500)
})

// ── pedido ────────────────────────────────────────────────────────────────────
test('pedido, caminho feliz: contato com nome formatado, conversa, template de UTILIDADE {1: nome, 2: número} e SEM botão', async () => {
  const sb = fakeSb({ linhas: [pedido(1)] })
  const cliente = fakeCliente()
  const r = await rodar('pedido', sb, cliente)
  assert.equal(r.status, 200)
  assert.deepEqual(rpcs(sb, 'pegar_da_fila'), [{ p_tipo: 'pedido', p_limite: 5, p_max_horas: 14, p_reservar: true, p_ultimos11: null }])
  assert.deepEqual(cliente.chamadas.map((c) => c[0]), ['contato', 'conversa', 'template'])
  assert.equal(cliente.chamadas[0][1].nome, 'Maysa Priscila')
  const tp = cliente.chamadas[2][1].templateParams
  assert.equal(tp.category, 'UTILITY')
  assert.deepEqual(tp.processed_params, { body: { '1': 'Maysa', '2': '#1001' } })
  assert.deepEqual(sb.chamadas.at(-1), ['marcar_da_fila', { p_tipo: 'pedido', p_chave: '1001', p_status: 'enviada', p_conversa: 22 }])
  assert.deepEqual(r.corpo.resultado, [{ chave: '1001', resultado: 'enviada' }])
})

test('pedido: o texto de pré-visualização troca {{1}} e {{2}}', async () => {
  const cliente = fakeCliente()
  await rodar('pedido', fakeSb({ linhas: [pedido(1)] }), cliente, { templateTexto: 'Olá, {{1}}! Pedido {{2}} recebido.' })
  assert.equal(cliente.chamadas.find((c) => c[0] === 'template')[1].texto, 'Olá, Maysa! Pedido #1001 recebido.')
})

test('⚠️ pedido é transacional: não consulta a lista de bloqueados nem o status de checkout, e não consulta se respondeu', async () => {
  const sb = fakeSb({ linhas: [pedido(1)], bloqueados: ['5519982621821'] })
  const cliente = fakeCliente()
  await rodar('pedido', sb, cliente)
  assert.ok(!nomes(sb).includes('from:contatos_sem_mensagem'))
  assert.ok(!nomes(sb).includes('from:checkout_abandono'))
  assert.ok(!cliente.chamadas.some((c) => c[0] === 'respondeu'))
  assert.equal(cliente.chamadas.filter((c) => c[0] === 'template').length, 1)
})

test('pedido: telefone inválido é ignorado com o motivo; fora da janela espera sem gastar tentativa', async () => {
  const sb1 = fakeSb({ linhas: [pedido(1, { telefone: '1932221828' })] })
  await rodar('pedido', sb1, fakeCliente())
  assert.deepEqual(sb1.chamadas.at(-1), ['marcar_da_fila', { p_tipo: 'pedido', p_chave: '1001', p_status: 'ignorada', p_motivo: 'telefone_invalido' }])
  const sb2 = fakeSb({ linhas: [pedido(1)] })
  const cliente = fakeCliente()
  const r = await rodar('pedido', sb2, cliente, {}, NOITE)
  assert.equal(cliente.chamadas.length, 0)
  assert.deepEqual(sb2.chamadas.at(-1), ['devolver_da_fila', { p_tipo: 'pedido', p_chave: '1001', p_contar: false }])
  assert.equal(r.corpo.resultado[0].resultado, 'esperando')
})

// ── follow-up ─────────────────────────────────────────────────────────────────
test('follow-up, caminho feliz: relê o status, vê que não respondeu e envia com o botão do link', async () => {
  const sb = fakeSb({ linhas: [followup(1)] })
  const cliente = fakeCliente({ respondeu: false })
  const r = await rodar('followup', sb, cliente, { maxHoras: 24 })
  assert.deepEqual(cliente.chamadas.map((c) => c[0]), ['respondeu', 'contato', 'conversa', 'template'])
  assert.deepEqual(cliente.chamadas[0][1], { conversaId: 901 })
  const tp = cliente.chamadas.find((c) => c[0] === 'template')[1].templateParams
  assert.equal(tp.category, 'MARKETING')
  assert.deepEqual(tp.processed_params, { body: { '1': 'Maysa' }, buttons: [{ type: 'url', parameter: '1/checkouts/tok1/recover?key=SEGREDO1' }] })
  assert.deepEqual(sb.chamadas.at(-1), ['marcar_da_fila', { p_tipo: 'followup', p_chave: 'tok1', p_status: 'enviada', p_conversa: 22 }])
  assert.equal(r.corpo.resultado[0].resultado, 'enviada')
})

test('⚠️ follow-up: se a cliente JÁ RESPONDEU, não envia (ignorada/respondeu) e o item seguinte segue', async () => {
  const sb = fakeSb({ linhas: [followup(1), followup(2)] })
  let n = 0
  const cliente = fakeCliente()
  cliente.respondeu = async (arg) => { cliente.chamadas.push(['respondeu', arg]); return n++ === 0 }
  const r = await rodar('followup', sb, cliente)
  assert.equal(cliente.chamadas.filter((c) => c[0] === 'template').length, 1)
  assert.ok(sb.chamadas.some((c) => c[0] === 'marcar_da_fila' && c[1].p_chave === 'tok1' && c[1].p_status === 'ignorada' && c[1].p_motivo === 'respondeu'))
  assert.deepEqual(r.corpo.resultado.map((x) => x.resultado), ['ignorada', 'enviada'])
})

test('⚠️ follow-up: quem comprou (ou entrou em pagamento pendente) desde o agendamento não recebe, e nem se pergunta se respondeu', async () => {
  const sb = fakeSb({ linhas: [followup(1), followup(2)], statusAgora: { tok1: 'comprou', tok2: 'pagamento_pendente' } })
  const cliente = fakeCliente()
  const r = await rodar('followup', sb, cliente)
  assert.equal(cliente.chamadas.length, 0)
  assert.deepEqual(r.corpo.resultado.map((x) => x.motivo), ['nao_esta_mais_na_fila', 'nao_esta_mais_na_fila'])
})

test('⚠️ follow-up: falha ao reler o status NÃO envia: devolve contando tentativa', async (t) => {
  calar(t)
  const sb = fakeSb({ linhas: [followup(1)], errStatus: { message: '504' } })
  const cliente = fakeCliente()
  await rodar('followup', sb, cliente)
  assert.equal(cliente.chamadas.length, 0)
  assert.deepEqual(sb.chamadas.at(-1), ['devolver_da_fila', { p_tipo: 'followup', p_chave: 'tok1', p_contar: true }])
})

test('⚠️ follow-up: falha ao LER a conversa (5xx) não envia e devolve contando; 401 para a rodada e devolve os que sobraram', async (t) => {
  calar(t)
  const sb1 = fakeSb({ linhas: [followup(1)] })
  const c1 = fakeCliente({ falharEm: 'respondeu', erro: new ErroChatwoot(500, 'x', 'ler_conversa') })
  await rodar('followup', sb1, c1)
  assert.ok(!c1.chamadas.some((c) => c[0] === 'template'))
  assert.deepEqual(sb1.chamadas.at(-1), ['devolver_da_fila', { p_tipo: 'followup', p_chave: 'tok1', p_contar: true }])

  const sb2 = fakeSb({ linhas: [followup(1), followup(2)] })
  const c2 = fakeCliente({ falharEm: 'respondeu', erro: new ErroChatwoot(401, 'x', 'ler_conversa') })
  const r = await rodar('followup', sb2, c2)
  assert.equal(r.status, 502)
  assert.deepEqual(rpcs(sb2, 'devolver_da_fila').map((a) => a.p_chave), ['tok1', 'tok2'])
  assert.ok(rpcs(sb2, 'devolver_da_fila').every((a) => a.p_contar === false))
})

test('follow-up sem a conversa de origem não dá para saber se respondeu: ignorada (falha fechada)', async () => {
  const sb = fakeSb({ linhas: [followup(1, { conversa_origem: null })] })
  const cliente = fakeCliente()
  await rodar('followup', sb, cliente)
  assert.equal(cliente.chamadas.length, 0)
  assert.deepEqual(sb.chamadas.at(-1), ['marcar_da_fila', { p_tipo: 'followup', p_chave: 'tok1', p_status: 'ignorada', p_motivo: 'sem_conversa_de_origem' }])
})

test('follow-up: quem pediu para não receber é ignorado; se a lista não puder ser lida, a rodada aborta e devolve TODOS', async (t) => {
  const sb = fakeSb({ linhas: [followup(1)], bloqueados: ['5519982621821'] })
  await rodar('followup', sb, fakeCliente())
  assert.deepEqual(sb.chamadas.at(-1), ['marcar_da_fila', { p_tipo: 'followup', p_chave: 'tok1', p_status: 'ignorada', p_motivo: 'pediu_para_nao_receber' }])

  calar(t)
  const sb2 = fakeSb({ linhas: [followup(1), followup(2)], errBloq: { message: '504' } })
  const cliente = fakeCliente()
  const r = await rodar('followup', sb2, cliente)
  assert.equal(r.status, 500)
  assert.equal(r.corpo.erro, 'falha_bloqueados')
  assert.equal(cliente.chamadas.length, 0)
  assert.deepEqual(rpcs(sb2, 'devolver_da_fila').map((a) => a.p_chave), ['tok1', 'tok2'])
})

test('follow-up: link fora da base fixa é ignorado (o botão quebraria)', async () => {
  const sb = fakeSb({ linhas: [followup(1, { url_de_recuperacao: 'https://outra.com/x' })] })
  await rodar('followup', sb, fakeCliente())
  assert.equal(sb.chamadas.at(-1)[1].p_motivo, 'sem_link')
})

// ── comum ─────────────────────────────────────────────────────────────────────
test('⚠️ modo seco: só LÊ (p_reservar false), não grava, não chama o Chatwoot e mostra a decisão', async () => {
  const sb = fakeSb({ linhas: [followup(1)] })
  const cliente = fakeCliente()
  const r = await rodar('followup', sb, cliente, { modo: 'seco', chatwoot: {}, templateNome: '' })
  assert.equal(r.status, 200)
  assert.equal(cliente.chamadas.length, 0)
  assert.equal(rpcs(sb, 'pegar_da_fila')[0].p_reservar, false)
  assert.ok(!nomes(sb).some((n) => ['marcar_da_fila', 'devolver_da_fila', 'liberar_travadas_da_fila'].includes(n)))
  assert.equal(r.corpo.resultado[0].decisao, 'enviar')
  assert.ok(!JSON.stringify(r.corpo).includes('SEGREDO1'))
})

test('modo lista: filtra pelos últimos 11 dígitos dos números da lista e reserva de verdade', async () => {
  const sb = fakeSb()
  await rodar('pedido', sb, fakeCliente(), { modo: 'lista', soPara: ['5519982621821'] })
  assert.deepEqual(rpcs(sb, 'pegar_da_fila')[0].p_ultimos11, ['19982621821'])
  assert.equal(rpcs(sb, 'pegar_da_fila')[0].p_reservar, true)
})

test('a faxina dos travados roda antes da reserva (fora do modo seco)', async () => {
  const sb = fakeSb()
  await rodar('pedido', sb, fakeCliente())
  assert.deepEqual(nomes(sb).slice(0, 2), ['liberar_travadas_da_fila', 'pegar_da_fila'])
})

test('⚠️ template recusado (422): marca falhou com o motivo e segue; 401 no envio para a rodada', async (t) => {
  calar(t)
  const sb = fakeSb({ linhas: [pedido(1), pedido(2)] })
  const cliente = fakeCliente({ falharEm: 'template', erro: new ErroChatwoot(422, { error: 'template' }, 'enviar_template') })
  const r = await rodar('pedido', sb, cliente)
  assert.equal(r.status, 200)
  const falhou = sb.chamadas.filter((c) => c[0] === 'marcar_da_fila' && c[1].p_status === 'falhou')
  assert.equal(falhou.length, 2)
  assert.match(falhou[0][1].p_motivo, /^enviar_template:422/)

  const sb2 = fakeSb({ linhas: [pedido(1), pedido(2)] })
  const r2 = await rodar('pedido', sb2, fakeCliente({ falharEm: 'contato', erro: new ErroChatwoot(403, 'x', 'buscar_contato') }))
  assert.equal(r2.status, 502)
  assert.deepEqual(rpcs(sb2, 'devolver_da_fila').map((a) => a.p_chave), ['1001', '1002'])
})

test('⚠️ rede NO ENVIO do template: falhou (retentar duplicaria); rede ANTES do envio: devolve contando', async (t) => {
  calar(t)
  const a = fakeSb({ linhas: [pedido(1)] })
  await rodar('pedido', a, fakeCliente({ falharEm: 'template', erro: new ErroChatwoot(0, 'timeout', 'enviar_template') }))
  assert.ok(a.chamadas.some((c) => c[0] === 'marcar_da_fila' && c[1].p_status === 'falhou'))
  const b = fakeSb({ linhas: [pedido(1)] })
  await rodar('pedido', b, fakeCliente({ falharEm: 'conversa', erro: new ErroChatwoot(0, 'fetch failed', 'abrir_conversa') }))
  assert.deepEqual(b.chamadas.at(-1), ['devolver_da_fila', { p_tipo: 'pedido', p_chave: '1001', p_contar: true }])
})

test('⚠️ se gravar "enviada" falhar, NÃO devolve nem reenvia (fica enviando e depois vira falhou, nunca duplica)', async (t) => {
  calar(t)
  const sb = fakeSb({ linhas: [pedido(1)], falhaMarcarEnviada: true })
  const cliente = fakeCliente()
  const r = await rodar('pedido', sb, cliente)
  assert.equal(cliente.chamadas.filter((c) => c[0] === 'template').length, 1)
  assert.ok(!nomes(sb).includes('devolver_da_fila'))
  assert.equal(r.corpo.resultado[0].resultado, 'enviada_sem_gravar')
})

// ── inicio ("Nós reservamos seu pedido", assim que o checkout aparece com telefone) ──
test('inicio, caminho feliz: contato com nome formatado, conversa e template MARKETING {1: nome} com o link no botão', async () => {
  const sb = fakeSb({ linhas: [inicio(1)] })
  const cliente = fakeCliente()
  const r = await rodar('inicio', sb, cliente, { maxHoras: 1 })
  assert.equal(r.status, 200)
  assert.deepEqual(rpcs(sb, 'pegar_da_fila'), [{ p_tipo: 'inicio', p_limite: 5, p_max_horas: 1, p_reservar: true, p_ultimos11: null }])
  assert.deepEqual(cliente.chamadas.map((c) => c[0]), ['contato', 'conversa', 'template'])
  assert.equal(cliente.chamadas[0][1].nome, 'Maysa Priscila')
  const tp = cliente.chamadas[2][1].templateParams
  assert.equal(tp.category, 'MARKETING')
  assert.deepEqual(tp.processed_params, { body: { '1': 'Maysa' }, buttons: [{ type: 'url', parameter: '1/checkouts/tok1/recover?key=SEGREDO1' }] })
  assert.deepEqual(sb.chamadas.at(-1), ['marcar_da_fila', { p_tipo: 'inicio', p_chave: 'tok1', p_status: 'enviada', p_conversa: 22 }])
})

test('inicio: exige LINK_BASE (o botão precisa do link), não relê status de checkout e não pergunta se respondeu', async () => {
  const sb = fakeSb({ linhas: [inicio(1)] })
  const cliente = fakeCliente()
  const r = await rodar('inicio', sb, cliente, { maxHoras: 1 })
  assert.equal(r.status, 200)
  assert.ok(!nomes(sb).includes('from:checkout_abandono'))
  assert.ok(!cliente.chamadas.some((c) => c[0] === 'respondeu'))
  const sem = await rodar('inicio', fakeSb({ linhas: [inicio(1)] }), fakeCliente(), { maxHoras: 1, linkBase: '' })
  assert.equal(sem.status, 500)
  assert.equal(sem.corpo.erro, 'config_invalida')
})

test('⚠️ inicio sem link AINDA (a Shopify pode mandar o link num evento seguinte): espera sem gastar tentativa; link de outra base é ignorado', async () => {
  const sb = fakeSb({ linhas: [inicio(1, { url_de_recuperacao: null })] })
  const cliente = fakeCliente()
  const r = await rodar('inicio', sb, cliente, { maxHoras: 1 })
  assert.equal(cliente.chamadas.length, 0)
  assert.deepEqual(sb.chamadas.at(-1), ['devolver_da_fila', { p_tipo: 'inicio', p_chave: 'tok1', p_contar: false }])
  assert.deepEqual(r.corpo.resultado, [{ chave: 'tok1', resultado: 'esperando', motivo: 'sem_link_ainda' }])
  const outra = fakeSb({ linhas: [inicio(1, { url_de_recuperacao: 'https://outra.com/x' })] })
  await rodar('inicio', outra, fakeCliente(), { maxHoras: 1 })
  assert.equal(outra.chamadas.at(-1)[1].p_motivo, 'sem_link')
})

test('⚠️ inicio é marketing: quem pediu para não receber é ignorado, e se a lista não puder ser lida a rodada aborta e devolve TODOS', async (t) => {
  const sb = fakeSb({ linhas: [inicio(1)], bloqueados: ['5519982621821'] })
  const cliente = fakeCliente()
  await rodar('inicio', sb, cliente, { maxHoras: 1 })
  assert.equal(cliente.chamadas.length, 0)
  assert.deepEqual(sb.chamadas.at(-1), ['marcar_da_fila', { p_tipo: 'inicio', p_chave: 'tok1', p_status: 'ignorada', p_motivo: 'pediu_para_nao_receber' }])

  calar(t)
  const sb2 = fakeSb({ linhas: [inicio(1), inicio(2)], errBloq: { message: '504' } })
  const r = await rodar('inicio', sb2, fakeCliente(), { maxHoras: 1 })
  assert.equal(r.status, 500)
  assert.deepEqual(rpcs(sb2, 'devolver_da_fila').map((a) => a.p_chave), ['tok1', 'tok2'])
})

test('inicio: o texto de pré-visualização troca {{1}}; fora da janela espera; telefone inválido é ignorado', async () => {
  const cliente = fakeCliente()
  await rodar('inicio', fakeSb({ linhas: [inicio(1)] }), cliente, { maxHoras: 1, templateTexto: 'Olá, {{1}}, tudo bem? Nós reservamos seu pedido.' })
  assert.equal(cliente.chamadas.find((c) => c[0] === 'template')[1].texto, 'Olá, Maysa, tudo bem? Nós reservamos seu pedido.')
  const fora = fakeSb({ linhas: [inicio(1)] })
  await rodar('inicio', fora, fakeCliente(), { maxHoras: 1 }, NOITE)
  assert.deepEqual(fora.chamadas.at(-1), ['devolver_da_fila', { p_tipo: 'inicio', p_chave: 'tok1', p_contar: false }])
  const ruim = fakeSb({ linhas: [inicio(1, { telefone: '1932221828' })] })
  await rodar('inicio', ruim, fakeCliente(), { maxHoras: 1 })
  assert.equal(ruim.chamadas.at(-1)[1].p_motivo, 'telefone_invalido')
})

test('erro ao pegar da fila: 500 e nada mais é chamado', async (t) => {
  calar(t)
  const cliente = fakeCliente()
  const r = await rodar('pedido', fakeSb({ errPegar: { message: 'x' } }), cliente)
  assert.equal(r.status, 500)
  assert.equal(r.corpo.erro, 'falha_ao_pegar')
  assert.equal(cliente.chamadas.length, 0)
})
