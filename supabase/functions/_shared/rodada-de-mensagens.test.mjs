import test from 'node:test'
import assert from 'node:assert/strict'
import { processarRodada } from './rodada-de-mensagens.js'
import { ErroChatwoot } from './cliente-chatwoot.js'

const BASE = 'https://loja.com.br/'
const DENTRO = new Date('2026-09-29T15:00:00Z') // 12:00 em Brasília
const NOITE = new Date('2026-09-30T02:00:00Z')  // 23:00 em Brasília
const CONFIG = {
  modo: 'ligado', limite: 10, atrasoMin: 0, soPara: [], linkBase: BASE, templateNome: 'rec_v1', idioma: 'pt_BR', templateTexto: '',
  chatwoot: { url: 'https://cw.exemplo.com', contaId: '7', caixaId: '3', token: 'T' },
}
const lead = (n, extra = {}) => ({
  token: `t${n}`, status: 'fila_envio', telefone: `1998262182${n}`, nome: 'Luis Magrin',
  url_de_recuperacao: `${BASE}1/checkouts/t${n}/recover?key=SEGREDO${n}`, ...extra,
})

function fakeSb({ linhas = [], errPegar = null, errBloq = null, bloqueados = [], falhaMarcarEnviada = false } = {}) {
  const chamadas = []
  return {
    chamadas,
    async rpc(nome, args) {
      chamadas.push([nome, args])
      if (nome === 'pegar_para_mensagem') return { data: linhas, error: errPegar }
      if (nome === 'marcar_mensagem' && falhaMarcarEnviada && args.p_status === 'enviada') return { data: null, error: { message: 'boom' } }
      return { data: null, error: null }
    },
    from(tabela) {
      return { select: () => ({ in: async (_col, valores) => {
        chamadas.push([`from:${tabela}`, valores])
        return { data: bloqueados.filter((b) => valores.includes(b)).map((telefone) => ({ telefone })), error: errBloq }
      } }) }
    },
  }
}
function fakeCliente({ falharEm = null, erro = null } = {}) {
  const chamadas = []
  const passo = (nome, valor) => async (arg) => {
    chamadas.push([nome, arg])
    if (falharEm === nome) throw erro
    return valor
  }
  return {
    chamadas,
    acharOuCriarContato: passo('contato', 11),
    abrirConversa: passo('conversa', 22),
    enviarTemplate: passo('template', 33),
  }
}
const nomes = (sb) => sb.chamadas.map((c) => c[0])
const rodar = (sb, cliente, extra = {}, agora = DENTRO) => processarRodada({ sb, cliente, config: { ...CONFIG, ...extra }, agora })
const calar = (t) => t.mock.method(console, 'error', () => {})

test('⚠️ configuração inválida: 500 e NENHUM lead é tocado (falha fechada)', async () => {
  const sb = fakeSb({ linhas: [lead(1)] })
  const r = await rodar(sb, fakeCliente(), { linkBase: '', limite: NaN })
  assert.equal(r.status, 500)
  assert.equal(r.corpo.erro, 'config_invalida')
  assert.ok(r.corpo.problemas.length >= 2)
  assert.deepEqual(sb.chamadas, [])
})

test('caminho feliz: contato → conversa → template, e grava enviada com o id da conversa', async () => {
  const sb = fakeSb({ linhas: [lead(1)] })
  const cliente = fakeCliente()
  const r = await rodar(sb, cliente)
  assert.equal(r.status, 200)
  assert.deepEqual(cliente.chamadas.map((c) => c[0]), ['contato', 'conversa', 'template'])
  const tp = cliente.chamadas[2][1].templateParams
  assert.equal(tp.processed_params.body['1'], 'Luis')
  assert.equal(tp.processed_params.buttons[0].parameter, '1/checkouts/t1/recover?key=SEGREDO1')
  assert.deepEqual(sb.chamadas.at(-1), ['marcar_mensagem', { p_token: 't1', p_status: 'enviada', p_conversa: 22 }])
  assert.deepEqual(r.corpo.resultado, [{ token: 't1', resultado: 'enviada' }])
})

test('⚠️ CRÍTICO: falha ao ler os bloqueados aborta a rodada e devolve TODOS os reservados (nunca envia sem checar)', async (t) => {
  calar(t)
  const sb = fakeSb({ linhas: [lead(1), lead(2)], errBloq: { message: '504' } })
  const cliente = fakeCliente()
  const r = await rodar(sb, cliente)
  assert.equal(r.status, 500)
  assert.equal(r.corpo.erro, 'falha_bloqueados')
  assert.equal(cliente.chamadas.length, 0)
  const devolvidos = sb.chamadas.filter((c) => c[0] === 'devolver_mensagem').map((c) => c[1])
  assert.deepEqual(devolvidos, [{ p_token: 't1', p_contar: false }, { p_token: 't2', p_contar: false }])
})

test('bloqueado (pediu para parar) é ignorado e o Chatwoot nem é chamado; a consulta é só dos telefones do lote', async () => {
  const sb = fakeSb({ linhas: [lead(1)], bloqueados: ['5519982621821'] })
  const cliente = fakeCliente()
  await rodar(sb, cliente)
  assert.equal(cliente.chamadas.length, 0)
  assert.deepEqual(sb.chamadas.find((c) => c[0] === 'from:contatos_sem_mensagem')[1], ['5519982621821'])
  assert.deepEqual(sb.chamadas.at(-1), ['marcar_mensagem', { p_token: 't1', p_status: 'ignorada', p_motivo: 'pediu_para_nao_receber' }])
})

test('⚠️ IMPORTANTE: se gravar "enviada" falhar, NÃO devolve nem reenvia (o item fica enviando e depois vira falhou, nunca duplica)', async (t) => {
  calar(t)
  const sb = fakeSb({ linhas: [lead(1)], falhaMarcarEnviada: true })
  const cliente = fakeCliente()
  const r = await rodar(sb, cliente)
  assert.equal(cliente.chamadas.filter((c) => c[0] === 'template').length, 1)
  assert.ok(!nomes(sb).includes('devolver_mensagem'))
  assert.equal(r.corpo.resultado[0].resultado, 'enviada_sem_gravar')
})

test('⚠️ 401 no Chatwoot: para a rodada, devolve o atual e os que sobraram sem contar tentativa, e ninguém vira falhou', async (t) => {
  calar(t)
  const sb = fakeSb({ linhas: [lead(1), lead(2), lead(3)] })
  const cliente = fakeCliente({ falharEm: 'contato', erro: new ErroChatwoot(401, { error: 'x' }, 'buscar_contato') })
  const r = await rodar(sb, cliente)
  assert.equal(r.status, 502)
  assert.equal(r.corpo.erro, 'credencial_recusada')
  const devolvidos = sb.chamadas.filter((c) => c[0] === 'devolver_mensagem').map((c) => c[1])
  assert.deepEqual(devolvidos, [{ p_token: 't1', p_contar: false }, { p_token: 't2', p_contar: false }, { p_token: 't3', p_contar: false }])
  assert.ok(!sb.chamadas.some((c) => c[0] === 'marcar_mensagem'))
  assert.equal(cliente.chamadas.length, 1)
})

test('⚠️ template recusado (422): marca falhou com o motivo e a rodada SEGUE para o próximo lead, sem laço de retentativa', async (t) => {
  calar(t)
  const sb = fakeSb({ linhas: [lead(1), lead(2)] })
  const cliente = fakeCliente({ falharEm: 'template', erro: new ErroChatwoot(422, { error: 'template' }, 'enviar_template') })
  const r = await rodar(sb, cliente)
  assert.equal(r.status, 200)
  const falhou = sb.chamadas.filter((c) => c[0] === 'marcar_mensagem' && c[1].p_status === 'falhou')
  assert.equal(falhou.length, 2)
  assert.match(falhou[0][1].p_motivo, /^enviar_template:422/)
  assert.ok(!nomes(sb).includes('devolver_mensagem'))
})

test('⚠️ rede/timeout NO ENVIO do template: falhou (retentar duplicaria); rede ANTES do envio: devolve contando tentativa', async (t) => {
  calar(t)
  const noEnvio = fakeSb({ linhas: [lead(1)] })
  await rodar(noEnvio, fakeCliente({ falharEm: 'template', erro: new ErroChatwoot(0, 'timeout', 'enviar_template') }))
  assert.ok(noEnvio.chamadas.some((c) => c[0] === 'marcar_mensagem' && c[1].p_status === 'falhou'))
  assert.ok(!nomes(noEnvio).includes('devolver_mensagem'))

  const antes = fakeSb({ linhas: [lead(1)] })
  await rodar(antes, fakeCliente({ falharEm: 'conversa', erro: new ErroChatwoot(0, 'fetch failed', 'abrir_conversa') }))
  assert.deepEqual(antes.chamadas.at(-1), ['devolver_mensagem', { p_token: 't1', p_contar: true }])
})

test('fora da janela: devolve sem contar tentativa e não fala com o Chatwoot', async () => {
  const sb = fakeSb({ linhas: [lead(1)] })
  const cliente = fakeCliente()
  const r = await rodar(sb, cliente, {}, NOITE)
  assert.equal(cliente.chamadas.length, 0)
  assert.deepEqual(sb.chamadas.at(-1), ['devolver_mensagem', { p_token: 't1', p_contar: false }])
  assert.equal(r.corpo.resultado[0].resultado, 'esperando')
})

test('⚠️ modo seco: só LÊ (p_reservar false), não grava nada, não chama o Chatwoot, e mostra o link sem a chave secreta', async () => {
  const sb = fakeSb({ linhas: [lead(1)] })
  const cliente = fakeCliente()
  const r = await rodar(sb, cliente, { modo: 'seco', chatwoot: {}, templateNome: '' })
  assert.equal(r.status, 200)
  assert.equal(cliente.chamadas.length, 0)
  assert.equal(sb.chamadas.find((c) => c[0] === 'pegar_para_mensagem')[1].p_reservar, false)
  assert.ok(!sb.chamadas.some((c) => ['marcar_mensagem', 'devolver_mensagem'].includes(c[0])))
  const item = r.corpo.resultado[0]
  assert.equal(item.decisao, 'enviar')
  assert.equal(item.sufixo_amostra, '1/checkouts/t1/recover?key=…')
  assert.ok(!JSON.stringify(r.corpo).includes('SEGREDO1'))
})

test('modo lista: pede só os últimos 11 dígitos dos números da lista, e reserva de verdade', async () => {
  const sb = fakeSb({ linhas: [] })
  await rodar(sb, fakeCliente(), { modo: 'lista', soPara: ['5519982621821'] })
  const args = sb.chamadas.find((c) => c[0] === 'pegar_para_mensagem')[1]
  assert.deepEqual(args.p_ultimos11, ['19982621821'])
  assert.equal(args.p_reservar, true)
})
