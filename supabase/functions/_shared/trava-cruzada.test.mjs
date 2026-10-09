import test from 'node:test'
import assert from 'node:assert/strict'
import { travaCruzadaLigada } from './trava-cruzada.js'
import { processarRodada } from './rodada-de-mensagens.js'
import { rodarTudo } from './rodada-completa.js'

test('ABANDONO_TRAVA_CRUZADA: padrão ligado; só false/0/off/nao desligam', () => {
  for (const v of [undefined, '', 'true', '1', 'sim']) assert.equal(travaCruzadaLigada(v), true, String(v))
  for (const v of ['false', 'FALSE', ' 0 ', 'off', 'nao']) assert.equal(travaCruzadaLigada(v), false, v)
})

const linha = { status: 'fila_envio', token: 'tok1', telefone: '19982621821', nome: 'ana', url_de_recuperacao: 'https://loja.com.br/1/checkouts/tok1/recover?key=K', iniciado_em: '2026-09-29T10:00:00Z' }
function sbDo(abandono) {
  const chamadas = []
  return {
    chamadas,
    async rpc(nome, args) {
      chamadas.push([nome, args])
      if (nome === 'pegar_para_mensagem') return { data: [linha], error: null }
      if (nome === 'avaliar_trava_cruzada') return { data: abandono === true ? 'barrar' : abandono === false ? 'liberar' : abandono, error: null }
      return { data: null, error: null }
    },
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }), eq: () => ({ maybeSingle: async () => ({ data: { status: 'fila_envio' }, error: null }) }) }) }),
  }
}
const CFG = { modo: 'ligado', limite: 5, atrasoMin: 0, maxHoras: 24, soPara: [], linkBase: 'https://loja.com.br/', templateNome: 't', idioma: 'pt_BR', templateTexto: '', chatwoot: { url: 'https://cw.exemplo.com', contaId: '1', caixaId: '1', token: 'T' }, travaCruzada: true }

test('abandono 24 h: trava cruzada marca ignorada_trava_cruzada em marcar_mensagem e não chama o Chatwoot', async () => {
  const sb = sbDo(true)
  const cliente = new Proxy({}, { get: () => () => { throw new Error('não podia chamar o Chatwoot') } })
  const r = await processarRodada({ sb, cliente, config: CFG, agora: new Date('2026-09-29T15:00:00Z') })
  assert.equal(r.corpo.resultado[0].motivo, 'ignorada_trava_cruzada')
  assert.deepEqual(sb.chamadas.find((c) => c[0] === 'marcar_mensagem')[1], { p_token: 'tok1', p_status: 'ignorada', p_motivo: 'ignorada_trava_cruzada' })
})

test('rodarTudo: ABANDONO_TRAVA_CRUZADA chega à rodada (padrão ligada, false desliga)', async () => {
  const consultas = async (flag) => {
    const sb = sbDo(true)
    const env = (n) => ({ ENVIO_MODO: 'lista', ENVIO_SO_PARA: '19982621821', TEMPLATE_NOME: 't', LINK_BASE: 'https://loja.com.br/', CHATWOOT_URL: 'https://cw.exemplo.com', CHATWOOT_CONTA_ID: '1', CHATWOOT_CAIXA_ID: '1', CHATWOOT_API_TOKEN: 'T', ABANDONO_TRAVA_CRUZADA: flag }[n] ?? '')
    await rodarTudo({ sb, env, criarCliente: () => ({}), agora: new Date('2026-09-29T15:00:00Z') })
    return sb.chamadas.filter((c) => c[0] === 'avaliar_trava_cruzada').length
  }
  assert.equal(await consultas(''), 1)
  assert.equal(await consultas('false'), 0)
})
