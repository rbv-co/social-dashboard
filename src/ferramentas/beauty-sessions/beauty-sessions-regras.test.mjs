import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACOES_QUE_EXIGEM_EDITAR, podeExecutarAcao, calcularConjunto,
  mensagemDeEditar, mensagemDeArquivar, mensagemDeApagar, mensagemDeTemGente,
  seloDaSessao, rotuloDeArquivar,
} from './beauty-sessions-regras.js'

// ── podeExecutarAcao (R13) ───────────────────────────────────────────────────

test('⚠️ R13: encerrar e reabrir exigem editar, igual arquivar/apagar/editar', () => {
  for (const acao of ACOES_QUE_EXIGEM_EDITAR) {
    assert.equal(podeExecutarAcao(acao, true), true, `${acao} deveria valer com editar=true`)
    assert.equal(podeExecutarAcao(acao, false), false, `${acao} deveria recusar com editar=false`)
  }
})

test('as cinco ações de escrever estão na lista, nem uma a mais nem a menos', () => {
  assert.deepEqual([...ACOES_QUE_EXIGEM_EDITAR].sort(),
    ['apagar', 'arquivar', 'editar', 'encerrar', 'reabrir'].sort())
})

test('uma ação de leitura não pedida na lista não exige editar', () => {
  assert.equal(podeExecutarAcao('ver', false), true)
  assert.equal(podeExecutarAcao('ver', true), true)
})

// ── calcularConjunto ─────────────────────────────────────────────────────────

test('calcularConjunto soma sobre a lista que recebe, e só ela', () => {
  const lista = [
    { leituras_mesa: 10, leituras_cartao: 5, pessoas: 3, compareceram: 1, receita: 100 },
    { leituras_mesa: 4, leituras_cartao: 1, pessoas: 2, compareceram: 2, receita: 50 },
  ]
  const c = calcularConjunto(lista)
  assert.equal(c.totalSessoes, 2)
  assert.equal(c.totalMesa, 14)
  assert.equal(c.totalCartao, 6)
  assert.equal(c.totalPessoas, 5)
  assert.equal(c.totalCompareceram, 3)
  assert.equal(c.totalReceita, 150)
})

test('⚠️ a conversão do conjunto soma numerador e denominador, não é a média das taxas', () => {
  // Sessão A: 2 leram, 2 se identificaram -> 100%. Sessão B: 8 leram, 0 -> 0%.
  // A média das taxas daria 50%; a soma dá 2 de 10 = 20%.
  const lista = [
    { leituras_mesa: 2, leituras_cartao: 0, pessoas: 2 },
    { leituras_mesa: 8, leituras_cartao: 0, pessoas: 0 },
  ]
  const c = calcularConjunto(lista)
  assert.equal(c.conversao.temBase, true)
  assert.equal(c.conversao.x, 2)
  assert.equal(c.conversao.n, 10)
  assert.equal(c.conversao.valor, 0.2)
})

test('calcularConjunto de lista vazia não quebra e não finge base', () => {
  const c = calcularConjunto([])
  assert.equal(c.totalSessoes, 0)
  assert.equal(c.totalMesa, 0)
  assert.equal(c.conversao.temBase, false)
})

test('calcularConjunto aceita entrada que não é array, sem lançar', () => {
  assert.equal(calcularConjunto(null).totalSessoes, 0)
  assert.equal(calcularConjunto(undefined).totalSessoes, 0)
})

// ── mensagens de erro ────────────────────────────────────────────────────────

test('mensagemDeEditar cobre as três situações e um padrão', () => {
  assert.equal(mensagemDeEditar('ok'), '')
  assert.match(mensagemDeEditar('sem_permissao'), /permissão/)
  assert.match(mensagemDeEditar('nao_achei'), /Não achei/)
  assert.match(mensagemDeEditar('explodiu'), /Não consegui salvar/)
})

test('mensagemDeArquivar cobre as três situações e um padrão', () => {
  assert.equal(mensagemDeArquivar('ok'), '')
  assert.match(mensagemDeArquivar('sem_permissao'), /permissão/)
  assert.match(mensagemDeArquivar('nao_achei'), /Não achei/)
  assert.match(mensagemDeArquivar('explodiu'), /Não consegui gravar/)
})

test('mensagemDeApagar cobre as três situações e um padrão', () => {
  assert.equal(mensagemDeApagar('ok'), '')
  assert.match(mensagemDeApagar('sem_permissao'), /permissão/)
  assert.match(mensagemDeApagar('nao_achei'), /Não achei/)
  assert.match(mensagemDeApagar('explodiu'), /Não consegui apagar/)
})

test('⚠️ mensagemDeTemGente cita o número de leituras, sem esconder o motivo', () => {
  assert.match(mensagemDeTemGente(3), /3 leitura\(s\)/)
  assert.match(mensagemDeTemGente(3), /encerrar/)
  assert.match(mensagemDeTemGente(3), /arquivar/)
})

test('mensagemDeTemGente no singular soa como português de gente', () => {
  assert.match(mensagemDeTemGente(1), /1 leitura/)
})

test('mensagemDeTemGente sem número vira zero, não quebra', () => {
  assert.match(mensagemDeTemGente(undefined), /0 leitura/)
  assert.match(mensagemDeTemGente(null), /0 leitura/)
})

// ── selo e rótulo ────────────────────────────────────────────────────────────

test('⚠️ arquivada não é encerrada — a arquivada vence mesmo se ativa=false', () => {
  assert.deepEqual(seloDaSessao({ arquivada: true, ativa: false }),
    { texto: 'Arquivada', classe: 'bs-selo-fim' })
  assert.deepEqual(seloDaSessao({ arquivada: true, ativa: true }),
    { texto: 'Arquivada', classe: 'bs-selo-fim' })
})

test('encerrada (não arquivada) é um selo diferente de arquivada', () => {
  assert.deepEqual(seloDaSessao({ arquivada: false, ativa: false }),
    { texto: 'Encerrada', classe: 'bs-selo-fim' })
})

test('sessão aberta e não arquivada mostra "Aceitando"', () => {
  assert.deepEqual(seloDaSessao({ arquivada: false, ativa: true }),
    { texto: 'Aceitando', classe: 'bs-selo-viva' })
})

test('rotuloDeArquivar é sempre o oposto do estado atual', () => {
  assert.equal(rotuloDeArquivar(false), 'Arquivar…')
  assert.equal(rotuloDeArquivar(true), 'Desarquivar')
})
