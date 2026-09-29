import test from 'node:test'
import assert from 'node:assert/strict'
import {
  primeiroNome, normalizarTelefone, dentroDaJanela, sufixoDoLink, montarTemplateParams, decidirEnvio,
} from './mensagem-de-abandono.js'

test('primeiroNome: só o primeiro nome, com fallback e teto', () => {
  assert.equal(primeiroNome('Luis Magrin'), 'Luis')
  assert.equal(primeiroNome('  Ana   Paula '), 'Ana')
  for (const v of [null, undefined, '', '   ', 42]) assert.equal(primeiroNome(v), 'cliente')
  assert.equal(primeiroNome('A'.repeat(80)).length, 30)
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

test('decidirEnvio: fora do horário espera (e só depois de validar o resto)', () => {
  const noite = new Date('2026-09-30T02:00:00Z') // 23:00
  assert.deepEqual(decidir(linha(), { agora: noite }), { acao: 'esperar', motivo: 'fora_da_janela' })
  assert.equal(decidir(linha({ telefone: null }), { agora: noite }).acao, 'ignorar')
})
