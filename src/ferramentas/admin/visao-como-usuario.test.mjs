import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Este módulo puxa, na cadeia de imports (controle-de-login-e-usuario.js →
// conectar-no-banco-de-dados.js), uma chamada a window.supabase.createClient()
// que roda assim que o arquivo carrega. No navegador window existe; aqui no
// node, não — fingimos um mínimo ANTES do import, por isso ele é dinâmico
// (mesmo padrão de controle-de-login-e-usuario.test.mjs).
globalThis.window = { supabase: { createClient: () => ({}) } }
const { visaoComoUsuario } = await import('./visao-como-usuario.js')

const aqui = dirname(fileURLToPath(import.meta.url))

const cartao = (lista, id) => lista.find((c) => c.id === id)

test('quem não tem nada não vê card nenhum', () => {
  const lista = visaoComoUsuario({ permissions: {}, is_superadmin: false })
  assert.ok(lista.every((c) => c.visivel === false))
})

test('super-admin vê todos os cards, inclusive Administração', () => {
  const lista = visaoComoUsuario({ permissions: {}, is_superadmin: true })
  assert.ok(lista.every((c) => c.visivel === true))
  assert.equal(cartao(lista, 'admin').frase, 'Controle total da Central de Inteligência.')
})

test('só quem é super-admin vê o card de Administração', () => {
  const lista = visaoComoUsuario({ permissions: { banco: ['ver'] }, is_superadmin: false })
  assert.equal(cartao(lista, 'admin').visivel, false)
})

test('Gestão Interna aparece com só UM submódulo concedido, e lista só esse', () => {
  const lista = visaoComoUsuario({ permissions: { frota: ['ver'] }, is_superadmin: false })
  const gi = cartao(lista, 'gestao-interna')
  assert.equal(gi.visivel, true)
  assert.equal(gi.ferramentas.length, 1)
  assert.equal(gi.ferramentas[0].label, 'Frota')
  assert.match(gi.ferramentas[0].frase, /Enxerga os carros/)
})

test('o degrau concedido decide a frase (mexer, não só ver)', () => {
  const lista = visaoComoUsuario({ permissions: { frota: ['ver', 'editar'] }, is_superadmin: false })
  const gi = cartao(lista, 'gestao-interna')
  assert.match(gi.ferramentas[0].frase, /Pega e devolve carro/)
})

test('card de grupo (Meta Ads) usa a chave concedida, não a primeira da lista', () => {
  const lista = visaoComoUsuario({ permissions: { 'meta.gestor': ['ver'] }, is_superadmin: false })
  const meta = cartao(lista, 'meta')
  assert.equal(meta.visivel, true)
  assert.match(meta.frase, /Acompanha o gasto/)
})

test('nenhum card usa uma chave que a tela de Início real não gateia', () => {
  // Trava a divergência que já aconteceu duas vezes na porta da Gestão
  // Interna (Frota 19/08, Autenticidade 01/09): uma lista escrita à mão aqui
  // que envelhece sem ninguém perceber.
  const inicio = readFileSync(join(aqui, '..', 'inicio', 'tela-de-inicio.vue'), 'utf8')
  const chavesUsadasNoModulo = [
    'social', 'social.relatorio', 'conteudo',
    'sales.gestao', 'sales.analise',
    'meta.campanha', 'meta.gestor',
    'banco', 'noticias', 'gestor', 'claude.status',
  ]
  for (const chave of chavesUsadasNoModulo) {
    assert.match(inicio, new RegExp(`hasPermission\\('${chave.replace('.', '\\.')}'`),
      `"${chave}" é usada na Visão Como mas não aparece em tela-de-inicio.vue`)
  }
})
