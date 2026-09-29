import test from 'node:test'
import assert from 'node:assert/strict'
import { montarTemplate, validarTemplate, TEMPLATE_A, TEMPLATE_B } from './template-meta.js'

const BASE = {
  nome: 'recuperacao_checkout_v2', idioma: 'pt_BR',
  corpo: 'Oi, {{1}}! Seu carrinho na Vessel ficou guardado. Quer finalizar? Se precisar de ajuda, é só responder aqui.',
  exemploCorpo: 'Maria', rodape: 'Vessel Brasil',
  textoLink: 'Finalizar compra', baseLink: 'https://loja.vesselbrasil.com.br/', exemploLink: '77052313848/checkouts/abc/def/recover?key=x&locale=pt-BR',
  textoResposta: 'Não quero receber',
}

test('montarTemplate: formato da API da Meta (BODY com exemplo, FOOTER, BUTTONS com link dinâmico e resposta rápida)', () => {
  assert.deepEqual(montarTemplate(BASE), {
    name: 'recuperacao_checkout_v2', language: 'pt_BR', category: 'MARKETING',
    components: [
      { type: 'BODY', text: BASE.corpo, example: { body_text: [['Maria']] } },
      { type: 'FOOTER', text: 'Vessel Brasil' },
      { type: 'BUTTONS', buttons: [
        // ⚠️ O botão de link é o PRIMEIRO: o robô preenche o botão na posição 0.
        { type: 'URL', text: 'Finalizar compra', url: 'https://loja.vesselbrasil.com.br/{{1}}', example: ['77052313848/checkouts/abc/def/recover?key=x&locale=pt-BR'] },
        { type: 'QUICK_REPLY', text: 'Não quero receber' },
      ] },
    ],
  })
})

test('⚠️ o exemplo do link é só o valor da variável (como na documentação), nunca a URL inteira', () => {
  const [, , btns] = montarTemplate(BASE).components
  assert.ok(!btns.buttons[0].example[0].startsWith('http'))
})

test('sem rodapé, o componente FOOTER não entra', () => {
  const t = montarTemplate({ ...BASE, rodape: '' })
  assert.deepEqual(t.components.map((c) => c.type), ['BODY', 'BUTTONS'])
})

test('validarTemplate: os modelos A e B do projeto são válidos', () => {
  assert.deepEqual(validarTemplate(TEMPLATE_A), [])
  assert.deepEqual(validarTemplate(TEMPLATE_B), [])
})

test('o modelo A é o texto completo, com o nome recuperacao_checkout_v1 e o botão de link primeiro', () => {
  assert.equal(TEMPLATE_A.nome, 'recuperacao_checkout_v1')
  assert.match(TEMPLATE_A.corpo, /^Oi, \{\{1\}\}! Você deixou seu carrinho na Vessel esperando por você\./)
  assert.match(TEMPLATE_A.corpo, /a gente ajuda\.$/)
  const [, , btns] = montarTemplate(TEMPLATE_A).components
  assert.deepEqual(btns.buttons.map((b) => b.type), ['URL', 'QUICK_REPLY'])
})

test('⚠️ dá para criar o mesmo texto com OUTRO nome (a Meta trava o nome de um modelo já usado), sem mexer no resto', () => {
  const novo = montarTemplate({ ...TEMPLATE_A, nome: 'recuperacao_checkout_a2' })
  assert.equal(novo.name, 'recuperacao_checkout_a2')
  assert.deepEqual(novo.components, montarTemplate(TEMPLATE_A).components)
})

test('⚠️ validarTemplate: variável no começo ou no fim do corpo é recusada pela Meta, então é problema', () => {
  assert.ok(validarTemplate({ ...BASE, corpo: '{{1}}, seu carrinho ficou guardado.' }).some((p) => /começo/.test(p)))
  assert.ok(validarTemplate({ ...BASE, corpo: 'Seu carrinho ficou guardado, {{1}}' }).some((p) => /fim/.test(p)))
})

test('validarTemplate: exatamente UMA variável {{1}} no corpo (o robô só manda o primeiro nome)', () => {
  assert.ok(validarTemplate({ ...BASE, corpo: 'Oi! Seu carrinho ficou guardado.' }).some((p) => /variável/.test(p)))
  assert.ok(validarTemplate({ ...BASE, corpo: 'Oi, {{1}}! Código {{2}} para você.' }).some((p) => /variável/.test(p)))
})

test('⚠️ validarTemplate: limites da Meta e formato do link', () => {
  assert.ok(validarTemplate({ ...BASE, corpo: 'Oi, {{1}}! ' + 'a'.repeat(1030) }).some((p) => /1024/.test(p)))
  assert.ok(validarTemplate({ ...BASE, rodape: 'x'.repeat(61) }).some((p) => /rodapé/i.test(p)))
  assert.ok(validarTemplate({ ...BASE, textoLink: 'x'.repeat(26) }).some((p) => /botão de link/i.test(p)))
  assert.ok(validarTemplate({ ...BASE, textoResposta: 'x'.repeat(26) }).some((p) => /resposta/i.test(p)))
  assert.ok(validarTemplate({ ...BASE, baseLink: 'https://loja.vesselbrasil.com.br' }).some((p) => /baseLink/.test(p)))
  assert.ok(validarTemplate({ ...BASE, baseLink: 'http://loja.com.br/' }).some((p) => /baseLink/.test(p)))
  assert.ok(validarTemplate({ ...BASE, exemploLink: 'https://loja.vesselbrasil.com.br/77/x' }).some((p) => /exemploLink/.test(p)))
  assert.ok(validarTemplate({ ...BASE, nome: 'Recuperacao-V2' }).some((p) => /nome/.test(p)))
})
