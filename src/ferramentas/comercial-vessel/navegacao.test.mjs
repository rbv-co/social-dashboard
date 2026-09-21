import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PAI_DA_TELA, paiDaTela, ROTULO_DO_PAI } from './navegacao.js'

test('as cinco telas da familia voltam para o menu do Comercial Vessel', () => {
  for (const tela of ['atendimentos', 'beauty-sessions', 'private-edit',
                      'stylist-circle', 'funil-carrinho']) {
    assert.equal(paiDaTela(tela), 'comercial-vessel', `${tela} volta para o lugar errado`)
  }
})

test('o menu da familia volta para a Central', () => {
  assert.equal(paiDaTela('comercial-vessel'), 'inicio')
})

test('tela que nao esta no mapa volta para a Central', () => {
  assert.equal(paiDaTela('nao-existe'), 'inicio')
})

test('todo pai tem rotulo escrito', () => {
  for (const pai of new Set(Object.values(PAI_DA_TELA))) {
    assert.ok(ROTULO_DO_PAI[pai], `falta o rotulo de ${pai}`)
  }
})

// ⚠️ A GUARDA: o defeito nao era o mapa, era a tela chamando `inicio` na mao.
// Um mapa certo com as telas ignorando ele nao conserta nada.
// O menu (tela-de-menu-comercial-vessel.vue) fica FORA desta lista de
// propósito: ele volta para `inicio` mesmo, é o pai da família toda.
const TELAS = [
  'src/ferramentas/atendimentos/tela-de-atendimentos.vue',
  'src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue',
  'src/ferramentas/comercial-vessel/tela-de-private-edit.vue',
  'src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue',
  'src/ferramentas/funil-carrinho/tela-de-funil-carrinho.vue',
]

test('nenhuma tela da familia empurra para inicio na mao', () => {
  for (const caminho of TELAS) {
    const fonte = readFileSync(new URL(`../../../${caminho}`, import.meta.url), 'utf8')
    // ⚠️ O alvo é o BOTÃO voltar, não qualquer redirecionamento da tela — o
    // atendimentos, por exemplo, manda pra 'inicio' quando falta permissão
    // no onMounted, e isso é correto e fora do escopo desta tarefa. Por isso
    // a régua pega só a LINHA que define a função/seta `voltar` (neste
    // código ela sempre cabe numa linha), não o arquivo inteiro.
    const linha = fonte.split('\n').find(l => /(?:function\s+voltar\s*\(|const\s+voltar\s*=)/.test(l))
    assert.ok(linha, `${caminho} nao tem uma definicao de voltar reconhecivel`)
    assert.ok(!/router\.push\(\s*\{\s*name:\s*'inicio'\s*\}\s*\)/.test(linha),
      `${caminho} ainda empurra para inicio na mao`)
  }
})
