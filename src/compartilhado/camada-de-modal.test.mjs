import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  abrirCamada, fecharCamada, reiniciarCamadas, camadaAtual, CAMADA_BASE,
} from './camada-de-modal.js'

beforeEach(reiniciarCamadas)

/* O defeito que este módulo existe pra impedir, relatado pelo dono em 12/08:
 * "clico em um botão dentro do modal que abre e abre outro modal ATRÁS desse".
 * Acontecia porque cada tela escolhia o número da camada na mão. */

test('o segundo modal fica ACIMA do primeiro — a regra inteira', () => {
  const ficha = abrirCamada()
  const lancamento = abrirCamada()
  assert.ok(lancamento > ficha, 'quem abriu depois tem de cobrir quem já estava')
})

test('três empilhados continuam na ordem em que abriram', () => {
  const a = abrirCamada(), b = abrirCamada(), c = abrirCamada()
  assert.ok(a < b && b < c)
})

test('o primeiro modal já nasce acima dos números fixos que ainda existem', () => {
  // Enquanto houver tela com z-index escrito na mão (1000, 1100, 1300, 1400),
  // um modal novo não pode nascer atrás de um antigo.
  assert.ok(abrirCamada() > 1401)
  assert.ok(CAMADA_BASE > 1401)
})

test('fechar o de cima devolve a camada, e o próximo reaproveita', () => {
  const a = abrirCamada()
  const b = abrirCamada()
  fecharCamada(b)
  assert.equal(abrirCamada(), b, 'o número volta a ficar livre')
  assert.ok(a < b)
})

test('fechar um do MEIO não puxa quem está acima pra baixo', () => {
  // Fechar o do meio e rebaixar o topo faria o de cima empatar com o de baixo
  // na próxima abertura — e o empate é justamente o que produz o defeito.
  const a = abrirCamada()
  const b = abrirCamada()
  const c = abrirCamada()
  fecharCamada(b)
  assert.ok(abrirCamada() > c, 'o próximo continua acima de tudo que está aberto')
  assert.ok(a < c)
})

test('fechar demais não afunda abaixo do chão', () => {
  const a = abrirCamada()
  fecharCamada(a); fecharCamada(a); fecharCamada(a)
  assert.equal(camadaAtual(), CAMADA_BASE)
  assert.ok(abrirCamada() > CAMADA_BASE)
})

test('fechar uma camada que não é a do topo não muda nada', () => {
  abrirCamada()
  const antes = camadaAtual()
  fecharCamada(999)
  fecharCamada(null)
  fecharCamada(undefined)
  assert.equal(camadaAtual(), antes)
})

test('abrir e fechar em par volta ao começo — não sobe pra sempre', () => {
  // Sem isto, um dia de uso deixaria a camada num número absurdo.
  for (let i = 0; i < 50; i++) fecharCamada(abrirCamada())
  assert.equal(camadaAtual(), CAMADA_BASE)
})
