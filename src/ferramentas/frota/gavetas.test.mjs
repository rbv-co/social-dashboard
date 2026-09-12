import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lerPreferencias, gravarPreferencias, estaAberta, gavetasVisiveis, resumoDaGaveta,
} from './gavetas.js'

/* Um armazém de mentira, no molde do que tutorial-visto.test.mjs já usa. */
const armazem = (inicial = {}) => {
  const dados = { ...inicial }
  return {
    dados,
    getItem: (k) => (k in dados ? dados[k] : null),
    setItem: (k, v) => { dados[k] = String(v) },
  }
}
const quebrado = { getItem: () => { throw new Error('modo privado') }, setItem: () => { throw new Error('x') } }

// ── A regra que impede a gaveta de virar esconderijo ────────────────────────

test('gaveta com algo esperando a pessoa ABRE, mesmo que ela tenha fechado antes', () => {
  // É a guarda principal: um problema que apareceu hoje não pode ficar atrás
  // de uma decisão tomada ontem.
  assert.equal(estaAberta({ preferencia: false, urgente: true, padraoAberta: false }), true)
})

test('sem urgência, o que a pessoa escolheu vence o padrão', () => {
  assert.equal(estaAberta({ preferencia: false, padraoAberta: true }), false)
  assert.equal(estaAberta({ preferencia: true, padraoAberta: false }), true)
})

test('quem nunca mexeu recebe o padrão da gaveta', () => {
  assert.equal(estaAberta({ padraoAberta: true }), true)
  assert.equal(estaAberta({ padraoAberta: false }), false)
  assert.equal(estaAberta({}), false, 'sem padrão declarado, fechada')
})

test('preferência que não é booleano é ignorada — vale o padrão', () => {
  // Guarda contra dado estragado no armazém virar "gaveta meio aberta".
  assert.equal(estaAberta({ preferencia: 'sim', padraoAberta: true }), true)
  assert.equal(estaAberta({ preferencia: null, padraoAberta: false }), false)
})

// ── A lista pronta pra tela ─────────────────────────────────────────────────

const DEFS = [
  { chave: 'fila', titulo: 'Aguardando sua decisão', estado: '2 pedidos', urgente: true, padraoAberta: false },
  { chave: 'cobranca', titulo: 'Checklist de hoje', estado: 'faltam 8 de 10 hoje', padraoAberta: false },
  { chave: 'veiculos', titulo: 'Veículos do grupo', estado: '10 veículos · 2 livres', padraoAberta: true },
]

test('a gaveta urgente vem aberta E travada aberta', () => {
  // Travada: deixar fechar o que está gritando devolveria o esconderijo.
  const g = gavetasVisiveis(DEFS, { fila: false })
  const fila = g.find((x) => x.chave === 'fila')
  assert.equal(fila.aberta, true)
  assert.equal(fila.travadaAberta, true)
})

test('gaveta comum não fica travada, e respeita a escolha da pessoa', () => {
  const g = gavetasVisiveis(DEFS, { veiculos: false })
  const v = g.find((x) => x.chave === 'veiculos')
  assert.equal(v.aberta, false, 'ela fechou, fica fechada')
  assert.equal(v.travadaAberta, false)
})

test('gaveta vazia some da lista em vez de abrir pro nada', () => {
  const g = gavetasVisiveis([...DEFS, { chave: 'zoho', titulo: 'Cópias', vazia: true }], {})
  assert.equal(g.find((x) => x.chave === 'zoho'), undefined)
  assert.equal(g.length, 3)
})

test('"não carregou" NÃO é vazia — quem chama decide, e a gaveta continua lá', () => {
  // Sumir com a gaveta porque a consulta falhou seria a tela dizendo que está
  // tudo bem sobre o que ela não conseguiu ler.
  const g = gavetasVisiveis([{ chave: 'x', titulo: 'X', estado: null, vazia: false }], {})
  assert.equal(g.length, 1)
  assert.equal(g[0].aberta, false)
})

test('lista vazia ou nula não quebra', () => {
  assert.deepEqual(gavetasVisiveis([], {}), [])
  assert.deepEqual(gavetasVisiveis(null, null), [])
})

// ── O resumo do título fechado ──────────────────────────────────────────────

test('o título fechado carrega o estado — a resposta antes do clique', () => {
  assert.equal(resumoDaGaveta({ estado: 'faltam 8 de 10 hoje' }), 'faltam 8 de 10 hoje')
})

test('estado desconhecido não vira texto nenhum — nunca um "0" inventado', () => {
  assert.equal(resumoDaGaveta({ estado: null }), null)
  assert.equal(resumoDaGaveta({ estado: '' }), null)
  assert.equal(resumoDaGaveta({}), null)
  assert.equal(resumoDaGaveta(null), null)
})

// ── A memória, por pessoa ───────────────────────────────────────────────────

test('o que a pessoa deixou volta na próxima vez', () => {
  const a = armazem()
  gravarPreferencias(a, 'u1', { veiculos: true, cobranca: false })
  assert.deepEqual(lerPreferencias(a, 'u1'), { veiculos: true, cobranca: false })
})

test('a arrumação de uma pessoa não vaza pra outra no mesmo aparelho', () => {
  const a = armazem()
  gravarPreferencias(a, 'u1', { veiculos: true })
  assert.deepEqual(lerPreferencias(a, 'u2'), {}, 'u2 começa no padrão')
})

test('armazém bloqueado devolve o padrão em vez de quebrar a tela', () => {
  // Modo privado: a pessoa perde a memória, não a ferramenta.
  assert.deepEqual(lerPreferencias(quebrado, 'u1'), {})
  assert.deepEqual(lerPreferencias(null, 'u1'), {})
  gravarPreferencias(quebrado, 'u1', { x: true })   // não lança
})

test('conteúdo estragado no armazém não esconde gaveta nenhuma', () => {
  // Uma gaveta que não abre por causa de um JSON quebrado seria informação
  // escondida por defeito técnico.
  for (const lixo of ['{quebrado', '[]', 'null', '"texto"', '42']) {
    assert.deepEqual(lerPreferencias(armazem({ 'frota:gavetas:u1': lixo }), 'u1'), {})
  }
})

test('valor estranho dentro do objeto é descartado, o resto continua valendo', () => {
  const a = armazem({ 'frota:gavetas:u1': '{"veiculos":true,"cobranca":"talvez"}' })
  assert.deepEqual(lerPreferencias(a, 'u1'), { veiculos: true })
})
