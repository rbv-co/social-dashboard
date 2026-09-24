import { test } from 'node:test'
import assert from 'node:assert/strict'
// podeEntrar mora em ./guarda-de-rotas.js (não em ./mapa-de-enderecos.js): esse
// módulo importa vue-router + a cadeia do Supabase, que fazem coisas no
// escopo do módulo (createWebHistory le window.location, conectar-no-banco-
// -de-dados.js chama window.supabase.createClient()) — inviável de stubar
// direito no node. mapa-de-enderecos.js reexporta podeEntrar por
// compatibilidade, mas o teste importa da fonte pura.
import { podeEntrar } from './guarda-de-rotas.js'

const permiteTudo = () => true
const negaTudo = () => false

test('sem sessao vai pro login', () => {
  assert.deepEqual(podeEntrar({ name: 'inicio', meta: {} }, false, permiteTudo), { name: 'login' })
})

test('o proprio login e acessivel sem sessao', () => {
  assert.equal(podeEntrar({ name: 'login', meta: {} }, false, permiteTudo), true)
})

test('rota sem recurso declarado so exige sessao', () => {
  assert.equal(podeEntrar({ name: 'inicio', meta: {} }, true, negaTudo), true)
})

test('rota com recurso exige a permissao', () => {
  const rota = { name: 'claude-status', meta: { recurso: 'claude.status' } }
  assert.equal(podeEntrar(rota, true, permiteTudo), true)
  assert.deepEqual(podeEntrar(rota, true, negaTudo), { name: 'inicio' })
})

test('noticias exige a permissao noticias', () => {
  const rota = { name: 'noticias', meta: { recurso: 'noticias' } }
  assert.deepEqual(podeEntrar(rota, true, negaTudo), { name: 'inicio' })
})

test('conteudo exige a permissao conteudo', () => {
  const rota = { name: 'conteudo', meta: { recurso: 'conteudo' } }
  assert.equal(podeEntrar(rota, true, permiteTudo), true)
  assert.deepEqual(podeEntrar(rota, true, negaTudo), { name: 'inicio' })
})

test('a tela de uma peca so e o mesmo gate da central', () => {
  // Ela é o destino do push: se o gate fosse mais frouxo aqui, o link da
  // notificação viraria a porta dos fundos da ferramenta.
  const rota = { name: 'conteudo-peca', meta: { recurso: 'conteudo' } }
  assert.deepEqual(podeEntrar(rota, true, negaTudo), { name: 'inicio' })
  assert.deepEqual(podeEntrar(rota, false, permiteTudo), { name: 'login' })
})

test('a permissao checada e a declarada na rota', () => {
  const vistos = []
  const espiao = (r) => { vistos.push(r); return true }
  podeEntrar({ name: 'claude-status', meta: { recurso: 'claude.status' } }, true, espiao)
  assert.deepEqual(vistos, ['claude.status'])
})

test('rota inexistente com sessao vai pro inicio, nao da tela branca', () => {
  assert.deepEqual(podeEntrar({ name: undefined, meta: {} }, true, permiteTudo), { name: 'inicio' })
})

// ── 24/09/2026: portas, super-admin e rota fora do catálogo ─────────────────
test('porta (menu) abre para quem ve QUALQUER ferramenta de dentro', () => {
  const rota = { name: 'comercial-vessel', meta: { qualquerDe: ['atendimentos', 'carrinho'] } }
  assert.equal(podeEntrar(rota, true, (k) => k === 'carrinho'), true)
  assert.deepEqual(podeEntrar(rota, true, negaTudo), { name: 'inicio' })
})

test('rota de super-admin nao abre para quem so tem permissoes', () => {
  const rota = { name: 'admin', meta: { superadmin: true } }
  assert.deepEqual(podeEntrar(rota, true, permiteTudo, false), { name: 'inicio' })
  assert.equal(podeEntrar(rota, true, permiteTudo, true), true)
})

test('rota que o catalogo nao conhece fica fechada, nunca aberta por omissao', () => {
  const rota = { name: 'tela-nova', meta: { foraDoCatalogo: true } }
  assert.deepEqual(podeEntrar(rota, true, permiteTudo, true), { name: 'inicio' })
})
