import test from 'node:test'
import assert from 'node:assert/strict'
import { criarClienteChatwoot, classificarErro, ErroChatwoot } from './cliente-chatwoot.js'

const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status })

function fake(respostas) {
  const chamadas = []
  const fetchFn = async (url, init) => {
    chamadas.push({ url, metodo: init.method, cabecalhos: init.headers, corpo: init.body ? JSON.parse(init.body) : null })
    return respostas.shift()
  }
  return { chamadas, fetchFn }
}
const cliente = (fetchFn) => criarClienteChatwoot({ url: 'https://cw.exemplo.com/', contaId: 7, caixaId: 3, token: 'T', fetchFn })

test('acharOuCriarContato: usa o existente pelo telefone E.164 (busca com o token no cabeçalho)', async () => {
  const { chamadas, fetchFn } = fake([json({ payload: [{ id: 11, phone_number: '+5519982621828' }] })])
  assert.equal(await cliente(fetchFn).acharOuCriarContato({ nome: 'Luis', telefone: '5519982621828' }), 11)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].url, 'https://cw.exemplo.com/api/v1/accounts/7/contacts/search?q=%2B5519982621828')
  assert.equal(chamadas[0].cabecalhos.api_access_token, 'T')
})

test('acharOuCriarContato: sem correspondência exata, cria o contato na caixa', async () => {
  const { chamadas, fetchFn } = fake([
    json({ payload: [{ id: 99, phone_number: '+5511000000000' }] }),
    json({ payload: { contact: { id: 12 } } }),
  ])
  assert.equal(await cliente(fetchFn).acharOuCriarContato({ nome: 'Luis', telefone: '5519982621828' }), 12)
  assert.deepEqual(chamadas[1].corpo, { inbox_id: 3, name: 'Luis', phone_number: '+5519982621828' })
})

test('abrirConversa e enviarTemplate: corpos e endereços', async () => {
  const { chamadas, fetchFn } = fake([json({ id: 55 }), json({ id: 66 })])
  const c = cliente(fetchFn)
  assert.equal(await c.abrirConversa({ contatoId: 12, telefone: '5519982621828' }), 55)
  assert.deepEqual(chamadas[0].corpo, { inbox_id: 3, contact_id: 12, source_id: '5519982621828' })
  const tp = { name: 't', category: 'MARKETING', language: 'pt_BR', processed_params: { body: { '1': 'Luis' } } }
  assert.equal(await c.enviarTemplate({ conversaId: 55, texto: 'oi', templateParams: tp }), 66)
  assert.equal(chamadas[1].url, 'https://cw.exemplo.com/api/v1/accounts/7/conversations/55/messages')
  assert.deepEqual(chamadas[1].corpo, { content: 'oi', message_type: 'outgoing', private: false, template_params: tp })
})

test('resposta não-2xx vira ErroChatwoot com passo, status e corpo', async () => {
  const { fetchFn } = fake([json({ error: 'template' }, 422)])
  await assert.rejects(
    () => cliente(fetchFn).enviarTemplate({ conversaId: 1, texto: 'x', templateParams: {} }),
    (e) => e instanceof ErroChatwoot && e.status === 422 && e.passo === 'enviar_template' && e.corpo.error === 'template')
})

test('⚠️ classificarErro: 401/403 para; 429, 5xx e rede tentam de novo; 4xx (template não aprovado) falha sem laço', () => {
  const e = (status) => new ErroChatwoot(status, null, 'x')
  assert.equal(classificarErro(e(401)), 'parar')
  assert.equal(classificarErro(e(403)), 'parar')
  assert.equal(classificarErro(e(429)), 'tentar_de_novo')
  assert.equal(classificarErro(e(502)), 'tentar_de_novo')
  assert.equal(classificarErro(new TypeError('fetch failed')), 'tentar_de_novo')
  assert.equal(classificarErro(e(422)), 'falhou')
  assert.equal(classificarErro(e(404)), 'falhou')
})

test('⚠️ toda chamada leva um timeout (AbortSignal): um fetch pendurado não prende a rodada nem deixa item preso', async () => {
  let sinal
  const fetchFn = async (_url, init) => { sinal = init.signal; return json({ payload: [] }) }
  await cliente(fetchFn).acharOuCriarContato({ nome: 'x', telefone: '5519982621828' }).catch(() => {})
  assert.ok(sinal instanceof AbortSignal, 'a chamada deveria levar um AbortSignal')
})

test('⚠️ falha de rede/timeout vira ErroChatwoot com status 0 e o passo, em vez de escapar como erro genérico', async () => {
  const fetchFn = async () => { throw new TypeError('fetch failed') }
  await assert.rejects(
    () => cliente(fetchFn).abrirConversa({ contatoId: 1, telefone: '5519982621828' }),
    (e) => e instanceof ErroChatwoot && e.status === 0 && e.passo === 'abrir_conversa')
})

test('⚠️ classificarErro: rede em passo ANTES do envio tenta de novo; rede no enviar_template NÃO (a mensagem pode ter saído: retentar duplicaria)', () => {
  assert.equal(classificarErro(new ErroChatwoot(0, 'fetch failed', 'buscar_contato')), 'tentar_de_novo')
  assert.equal(classificarErro(new ErroChatwoot(0, 'fetch failed', 'abrir_conversa')), 'tentar_de_novo')
  assert.equal(classificarErro(new ErroChatwoot(0, 'timeout', 'enviar_template')), 'falhou')
})
