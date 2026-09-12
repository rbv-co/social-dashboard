// A PORTA DA GESTÃO INTERNA E O MENU DE DENTRO NÃO PODEM DIVERGIR.
//
// O defeito que estes testes travam é SILENCIOSO: a ferramenta funciona, a
// permissão está concedida, a tela abre se a pessoa digitar o endereço — mas
// não existe caminho de clique até ela, e o aplicativo diz "você ainda não tem
// acesso a nenhuma ferramenta". Quem concedeu jura que concedeu, e está certo.
//
// Aconteceu DUAS vezes: a Frota em 19/08/2026 (cinco pessoas afetadas) e a
// Autenticidade em 01/09/2026 (a conta estacaonfc@vesselbrasil.com.br, com a
// chave nos dois lugares do banco). Nas duas, o menu de dentro já mostrava o
// cartão; faltava a porta.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHAVES_DA_GESTAO_INTERNA, podeVerGestaoInterna } from './chaves-da-gestao-interna.js'

const aqui = dirname(fileURLToPath(import.meta.url))
const menu = readFileSync(join(aqui, 'tela-de-menu-gestao-interna.vue'), 'utf8')
const inicio = readFileSync(join(aqui, '..', 'inicio', 'tela-de-inicio.vue'), 'utf8')

test('TODO cartão do menu tem a chave na lista da porta', () => {
  // Sem isto, ferramenta nova entra no menu e fica inalcançável para quem só
  // tem ela — que é exatamente quem foi contratado para usá-la.
  const chavesDoMenu = [...menu.matchAll(/hasPermission\('([a-z0-9._-]+)'\s*,\s*'ver'\)/g)]
    .map((m) => m[1])
  assert.ok(chavesDoMenu.length >= 4, `o menu deveria ter 4+ cartões, achei ${chavesDoMenu.length}`)
  for (const chave of chavesDoMenu) {
    assert.ok(CHAVES_DA_GESTAO_INTERNA.includes(chave),
      `"${chave}" tem cartão no menu mas NÃO está em CHAVES_DA_GESTAO_INTERNA — `
      + 'quem tiver só essa chave vai ler "não tem acesso a nenhuma ferramenta"')
  }
})

test('a porta do Início NÃO tem lista própria', () => {
  // A regressão que este teste pega: alguém volta a escrever a lista à mão na
  // tela de Início, e ela envelhece na próxima ferramenta.
  assert.match(inicio, /podeVerGestaoInterna\(hasPermission\)/,
    'a porta da Gestão Interna precisa vir de chaves-da-gestao-interna.js')
  assert.doesNotMatch(inicio,
    /podeGestaoInterna\s*=\s*computed\(\(\)\s*=>\s*pode\w+\.value\s*\|\|/,
    'a porta voltou a ter lista própria — foi assim que a Frota e a Autenticidade sumiram')
})

test('quem tem SÓ autenticidade enxerga a porta', () => {
  // O caso do dono, em 01/09/2026: chave concedida, tela vazia.
  const so = (alvo) => (chave) => chave === alvo
  for (const chave of CHAVES_DA_GESTAO_INTERNA) {
    assert.equal(podeVerGestaoInterna(so(chave)), true,
      `quem tem só "${chave}" precisa enxergar a porta da Gestão Interna`)
  }
})

test('quem não tem nenhuma NÃO enxerga a porta', () => {
  assert.equal(podeVerGestaoInterna(() => false), false)
})

test('a porta pergunta pela ação "ver", não por outra', () => {
  // Pedir 'criar' aqui esconderia a porta de quem só consulta — e consultar é
  // um uso legítimo de todas as quatro ferramentas.
  const acoes = []
  podeVerGestaoInterna((chave, acao) => { acoes.push(acao); return false })
  assert.deepEqual([...new Set(acoes)], ['ver'])
})
