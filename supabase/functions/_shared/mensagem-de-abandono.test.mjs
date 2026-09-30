import test from 'node:test'
import assert from 'node:assert/strict'
import {
  primeiroNome, formatarNomeCompleto, normalizarTelefone, dentroDaJanela, sufixoDoLink, montarTemplateParams, decidirEnvio, validarConfig,
  montarTemplateParamsPedido, montarTemplateParamsInicio,
} from './mensagem-de-abandono.js'

test('⚠️ montarTemplateParamsInicio: MARKETING (não existe pedido ainda), corpo {1: primeiro nome} e NENHUM botão', () => {
  assert.deepEqual(
    montarTemplateParamsInicio({ nomeTemplate: 'checkout_iniciado_v1', idioma: 'pt_BR', nome: 'maysa priscila' }),
    { name: 'checkout_iniciado_v1', category: 'MARKETING', language: 'pt_BR', processed_params: { body: { '1': 'Maysa' } } })
  assert.equal(montarTemplateParamsInicio({ nomeTemplate: 't', idioma: 'pt_BR', nome: null }).processed_params.body['1'], 'cliente')
})

test('⚠️ montarTemplateParamsPedido: categoria UTILIDADE, corpo {1: primeiro nome, 2: número} e NENHUM botão', () => {
  assert.deepEqual(
    montarTemplateParamsPedido({ nomeTemplate: 'pedido_recebido_v1', idioma: 'pt_BR', nome: 'maysa priscila', numero: '#1001' }),
    { name: 'pedido_recebido_v1', category: 'UTILITY', language: 'pt_BR', processed_params: { body: { '1': 'Maysa', '2': '#1001' } } })
})

test('montarTemplateParamsPedido: sem nome vira "cliente" (a variável não pode ir vazia)', () => {
  assert.equal(montarTemplateParamsPedido({ nomeTemplate: 't', idioma: 'pt_BR', nome: null, numero: '#1' }).processed_params.body['1'], 'cliente')
})

test('⚠️ validarConfig com exigeLink false (pedido): não exige LINK_BASE, mas segue exigindo o resto', () => {
  const base = { modo: 'ligado', limite: 3, linkBase: '', templateNome: 't', chatwoot: { url: 'https://cw', contaId: '1', caixaId: '2', token: 'T' } }
  assert.ok(validarConfig(base).some((p) => /LINK_BASE/.test(p)))
  assert.deepEqual(validarConfig({ ...base, exigeLink: false }), [])
  assert.ok(validarConfig({ ...base, exigeLink: false, templateNome: '' }).some((p) => /TEMPLATE_NOME/.test(p)))
  assert.ok(validarConfig({ ...base, exigeLink: false, limite: 0 }).some((p) => /limite/i.test(p)))
})

test('primeiroNome: só o primeiro nome, com fallback e teto', () => {
  assert.equal(primeiroNome('Luis Magrin'), 'Luis')
  assert.equal(primeiroNome('  Ana   Paula '), 'Ana')
  for (const v of [null, undefined, '', '   ', 42]) assert.equal(primeiroNome(v), 'cliente')
  assert.equal(primeiroNome('A'.repeat(80)).length, 30)
})

test('⚠️ primeiroNome: tudo minúsculo ou tudo maiúsculo vira "Nome" (com acento, hífen e apóstrofo)', () => {
  const casos = {
    'maria da silva': 'Maria', 'MARIA': 'Maria', 'MARIA DA SILVA': 'Maria', 'joão': 'João', 'élcio': 'Élcio', 'ÁLVARO': 'Álvaro',
    'ana-clara': 'Ana-Clara', 'ANA-CLARA': 'Ana-Clara', "d'avila": "D'Avila", 'luis': 'Luis', '  luis   magrinho ': 'Luis',
  }
  for (const [entrada, esperado] of Object.entries(casos)) assert.equal(primeiroNome(entrada), esperado, `"${entrada}"`)
})

test('⚠️ primeiroNome: maiúsculas e minúsculas misturadas foram digitadas de propósito e ficam como vieram', () => {
  for (const nome of ['Maria', 'DeAndre', 'McKenzie', 'Ana-Clara', 'JoÃo']) assert.equal(primeiroNome(nome), nome)
})

test('⚠️ formatarNomeCompleto: cada palavra vira "Nome", com "da/de/do/das/dos/e" em minúsculas no meio', () => {
  const casos = {
    'maysa priscila': 'Maysa Priscila', 'MARIA DA SILVA': 'Maria da Silva', 'joão de souza e silva': 'João de Souza e Silva',
    'ana-clara dos santos': 'Ana-Clara dos Santos', '  maria   silva ': 'Maria Silva', 'da silva': 'Da Silva',
    'MARIA DAS DORES': 'Maria das Dores', 'maria mcKenzie': 'Maria mcKenzie',
  }
  for (const [entrada, esperado] of Object.entries(casos)) assert.equal(formatarNomeCompleto(entrada), esperado, `"${entrada}"`)
})

test('formatarNomeCompleto: palavra com maiúsculas misturadas fica como veio; vazio ou não-texto vira null (sem "cliente")', () => {
  assert.equal(formatarNomeCompleto('maria DeAndre'), 'Maria DeAndre')
  for (const v of [null, undefined, '', '   ', 42]) assert.equal(formatarNomeCompleto(v), null)
})

test('primeiroNome: número e emoji não quebram o formatador', () => {
  assert.equal(primeiroNome('123'), '123')
  assert.equal(primeiroNome('maria😊'), 'Maria😊')
})

test('montarTemplateParams: a variável do nome já vai formatada', () => {
  const tp = montarTemplateParams({ nomeTemplate: 't', idioma: 'pt_BR', nome: 'maysa priscila', sufixoUrl: 'x' })
  assert.equal(tp.processed_params.body['1'], 'Maysa')
})

test('⚠️ normalizarTelefone: só celular brasileiro válido (55 + DDD + 9 + 8 dígitos)', () => {
  assert.equal(normalizarTelefone('19982621828'), '5519982621828')
  assert.equal(normalizarTelefone('+5519982621828'), '5519982621828')
  assert.equal(normalizarTelefone('(19) 98262-1828'), '5519982621828')
  assert.equal(normalizarTelefone('+55 19 98262-1828'), '5519982621828')
  assert.equal(normalizarTelefone('005519982621828'), '5519982621828')
  for (const ruim of ['1932221828', '', 'abc', '5511', '551998262182', '5504982621828', null, 12345678901]) {
    assert.equal(normalizarTelefone(ruim), null, `deveria rejeitar ${ruim}`)
  }
})

test('⚠️ dentroDaJanela: 08:00 entra, 21:00 não (horário de Brasília, UTC-3)', () => {
  assert.equal(dentroDaJanela(new Date('2026-09-29T10:59:59Z')), false) // 07:59
  assert.equal(dentroDaJanela(new Date('2026-09-29T11:00:00Z')), true)  // 08:00
  assert.equal(dentroDaJanela(new Date('2026-09-29T23:59:59Z')), true)  // 20:59
  assert.equal(dentroDaJanela(new Date('2026-09-30T00:00:00Z')), false) // 21:00
  assert.equal(dentroDaJanela(new Date('2026-09-29T05:00:00Z')), false) // 02:00
})

test('sufixoDoLink: parte depois da base fixa; base diferente ou vazia vira null', () => {
  const base = 'https://loja.com.br/'
  assert.equal(sufixoDoLink('https://loja.com.br/123/checkouts/abc/recover?key=k', base), '123/checkouts/abc/recover?key=k')
  assert.equal(sufixoDoLink('https://outra.com/x', base), null)
  assert.equal(sufixoDoLink('https://loja.com.br/', base), null)
  assert.equal(sufixoDoLink(null, base), null)
})

test('montarTemplateParams: nome no corpo, sufixo no PRIMEIRO botão, categoria MARKETING', () => {
  assert.deepEqual(
    montarTemplateParams({ nomeTemplate: 'recuperacao_checkout_v1', idioma: 'pt_BR', nome: 'Luis Magrin', sufixoUrl: 'x/y' }),
    {
      name: 'recuperacao_checkout_v1', category: 'MARKETING', language: 'pt_BR',
      processed_params: { body: { '1': 'Luis' }, buttons: [{ type: 'url', parameter: 'x/y' }] },
    })
})

const BASE = 'https://loja.com.br/'
const linha = (extra = {}) => ({
  status: 'fila_envio', telefone: '19982621828', nome: 'Luis Magrin',
  url_de_recuperacao: BASE + '1/checkouts/t/recover?key=k', ...extra,
})
const DENTRO = new Date('2026-09-29T15:00:00Z') // 12:00
const decidir = (l, extra = {}) => decidirEnvio({ linha: l, bloqueados: new Set(), agora: DENTRO, baseLink: BASE, ...extra })

test('decidirEnvio: caminho feliz', () => {
  assert.deepEqual(decidir(linha()), { acao: 'enviar', telefone: '5519982621828', nome: 'Luis Magrin', sufixoUrl: '1/checkouts/t/recover?key=k' })
})

test('decidirEnvio: motivos de ignorar, na ordem certa', () => {
  assert.equal(decidir(linha({ status: 'comprou' })).motivo, 'nao_esta_mais_na_fila')
  assert.equal(decidir(linha({ telefone: null })).motivo, 'sem_telefone')
  assert.equal(decidir(linha({ telefone: '  ' })).motivo, 'sem_telefone')
  assert.equal(decidir(linha({ telefone: '1932221828' })).motivo, 'telefone_invalido')
  assert.equal(decidir(linha(), { bloqueados: new Set(['5519982621828']) }).motivo, 'pediu_para_nao_receber')
  assert.equal(decidir(linha({ url_de_recuperacao: 'https://outra.com/x' })).motivo, 'sem_link')
})

test('⚠️ decidirEnvio: sem base de link configurada NUNCA envia (senão o botão vira base + URL inteira)', () => {
  for (const baseLink of ['', undefined, null]) {
    assert.equal(decidir(linha(), { baseLink }).motivo, 'sem_link', `baseLink=${baseLink}`)
  }
})

const CONFIG_OK = {
  modo: 'ligado', limite: 10, linkBase: 'https://loja.com.br/', templateNome: 'recuperacao_checkout_v1',
  chatwoot: { url: 'https://cw.exemplo.com', contaId: '7', caixaId: '3', token: 'T' }, soPara: [],
}

test('validarConfig: configuração completa não tem problema, em qualquer modo ativo', () => {
  assert.deepEqual(validarConfig(CONFIG_OK), [])
  assert.deepEqual(validarConfig({ ...CONFIG_OK, modo: 'lista', soPara: ['5519982621828'] }), [])
  assert.deepEqual(validarConfig({ ...CONFIG_OK, modo: 'seco', chatwoot: {}, templateNome: '' }), []) // seco não fala com o Chatwoot
})

test('⚠️ validarConfig: limite inválido (NaN, 0, negativo, fracionado, gigante) é problema, não "sem limite"', () => {
  for (const limite of [NaN, 0, -1, 2.5, 101, undefined]) {
    assert.ok(validarConfig({ ...CONFIG_OK, limite }).some((p) => /limite/i.test(p)), `limite=${limite}`)
  }
})

test('⚠️ validarConfig: link base vazio ou sem barra final é problema (a URL final ficaria "//" ou quebrada)', () => {
  assert.ok(validarConfig({ ...CONFIG_OK, linkBase: '' }).some((p) => /LINK_BASE/.test(p)))
  assert.ok(validarConfig({ ...CONFIG_OK, linkBase: 'https://loja.com.br' }).some((p) => /LINK_BASE/.test(p)))
  assert.ok(validarConfig({ ...CONFIG_OK, modo: 'seco', linkBase: '' }).some((p) => /LINK_BASE/.test(p)))
})

test('⚠️ validarConfig: envio de verdade exige template e Chatwoot completos; lista exige números', () => {
  assert.ok(validarConfig({ ...CONFIG_OK, templateNome: '' }).some((p) => /TEMPLATE_NOME/.test(p)))
  assert.ok(validarConfig({ ...CONFIG_OK, chatwoot: { ...CONFIG_OK.chatwoot, token: '' } }).some((p) => /CHATWOOT_API_TOKEN/.test(p)))
  assert.ok(validarConfig({ ...CONFIG_OK, chatwoot: { ...CONFIG_OK.chatwoot, url: '' } }).some((p) => /CHATWOOT_URL/.test(p)))
  assert.ok(validarConfig({ ...CONFIG_OK, chatwoot: { ...CONFIG_OK.chatwoot, caixaId: 'abc' } }).some((p) => /CHATWOOT_CAIXA_ID/.test(p)))
  assert.ok(validarConfig({ ...CONFIG_OK, modo: 'lista', soPara: [] }).some((p) => /ENVIO_SO_PARA/.test(p)))
})

test('decidirEnvio: fora do horário espera (e só depois de validar o resto)', () => {
  const noite = new Date('2026-09-30T02:00:00Z') // 23:00
  assert.deepEqual(decidir(linha(), { agora: noite }), { acao: 'esperar', motivo: 'fora_da_janela' })
  assert.equal(decidir(linha({ telefone: null }), { agora: noite }).acao, 'ignorar')
})
