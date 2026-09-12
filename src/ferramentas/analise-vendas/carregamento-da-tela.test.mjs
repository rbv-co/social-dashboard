import { test } from 'node:test'
import assert from 'node:assert/strict'
import { corpoEstaVazio, deveMostrarCarregando, deveEscreverRecado } from './carregamento-da-tela.js'

// Um elemento de mentira: só o que estas funções olham.
const elem = (filhos) => ({ childElementCount: filhos })

test('corpo sem filhos está vazio; com filhos, não', () => {
  assert.equal(corpoEstaVazio(elem(0)), true)
  assert.equal(corpoEstaVazio(elem(3)), false)
})

test('elemento que nem existe conta como vazio (não pode explodir)', () => {
  assert.equal(corpoEstaVazio(null), true)
  assert.equal(corpoEstaVazio(undefined), true)
})

test('recarga automática com conteúdo na tela NÃO pisca o spinner', () => {
  assert.equal(deveMostrarCarregando({ corpoVazio: false, automatica: true }), false)
})

test('quando a pessoa pede (abrir a tela, trocar de período), mostra carregando', () => {
  // Mesmo com conteúdo do período anterior na tela: senão parece travada.
  assert.equal(deveMostrarCarregando({ corpoVazio: false, automatica: false }), true)
})

test('tela vazia sempre mostra carregando, automática ou não', () => {
  assert.equal(deveMostrarCarregando({ corpoVazio: true, automatica: true }), true)
  assert.equal(deveMostrarCarregando({ corpoVazio: true, automatica: false }), true)
})

// ── O defeito de 13/08/2026 ───────────────────────────────────────────────
// O render limpa o corpo e SÓ DEPOIS monta. Se ele explodir no meio, a tela
// fica vazia embora `_saRawData` já tenha valor. Quem decide é o corpo.
test('render explodiu depois de limpar a tela: o recado TEM de ser escrito', () => {
  assert.equal(deveEscreverRecado({ corpoVazio: true }), true)
})

test('com o gráfico anterior na tela, o recado não apaga nada', () => {
  assert.equal(deveEscreverRecado({ corpoVazio: false }), false)
})

test('sem argumento nenhum, o lado seguro é escrever o recado', () => {
  // Uma tela de venda em branco e muda é o pior resultado possível.
  assert.equal(deveEscreverRecado(), true)
  assert.equal(deveMostrarCarregando(), true)
})
