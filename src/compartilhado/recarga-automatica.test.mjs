import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirNoTique, decidirAoVoltar } from './recarga-automatica.js'

const CINCO_MIN = 5 * 60 * 1000

test('aba visivel recarrega: quem esta olhando quer o numero vivo', () => {
  assert.equal(decidirNoTique({ visivel: true }), 'recarregar')
})

test('aba escondida PULA — e este é o caso que motivou o módulo', () => {
  // Uma conta sozinha fez 92% das chamadas ao Bling, ativa nas 24 horas do dia.
  // Era aba esquecida recarregando de madrugada.
  assert.equal(decidirNoTique({ visivel: false }), 'pular')
})

test('sem saber se esta visivel, NAO recarrega', () => {
  // `document.hidden` é `false` em navegador que suporta; ausente vira
  // `undefined`. Tratar "não sei" como visível manteria o desperdício de pé
  // exatamente onde ele não pode ser detectado.
  assert.equal(decidirNoTique({}), 'pular')
  assert.equal(decidirNoTique({ visivel: undefined }), 'pular')
})

test('voltou para a aba com dado VELHO: recarrega na hora', () => {
  // O contrário disto trocaria "gasta demais" por "mostra número velho", que
  // numa tela de dinheiro é o defeito mais caro (padrão, item 9).
  assert.equal(decidirAoVoltar({ msDesdeAUltimaRecarga: CINCO_MIN, intervaloMs: CINCO_MIN }), 'recarregar')
  assert.equal(decidirAoVoltar({ msDesdeAUltimaRecarga: 3 * 60 * 60 * 1000, intervaloMs: CINCO_MIN }), 'recarregar')
})

test('voltou para a aba com dado NOVO: espera o proximo tique', () => {
  // Trocar de aba e voltar em 10 segundos não pode disparar uma busca inteira —
  // senão alt-tab vira o novo desperdício.
  assert.equal(decidirAoVoltar({ msDesdeAUltimaRecarga: 10_000, intervaloMs: CINCO_MIN }), 'esperar')
  assert.equal(decidirAoVoltar({ msDesdeAUltimaRecarga: CINCO_MIN - 1, intervaloMs: CINCO_MIN }), 'esperar')
})

test('na duvida, recarrega: nunca carregou, ou relogio sem sentido', () => {
  for (const caso of [
    { msDesdeAUltimaRecarga: null, intervaloMs: CINCO_MIN },
    { msDesdeAUltimaRecarga: undefined, intervaloMs: CINCO_MIN },
    { msDesdeAUltimaRecarga: NaN, intervaloMs: CINCO_MIN },
    { msDesdeAUltimaRecarga: 1000, intervaloMs: 0 },
    { msDesdeAUltimaRecarga: 1000, intervaloMs: -5 },
    {},
  ]) {
    assert.equal(decidirAoVoltar(caso), 'recarregar', JSON.stringify(caso))
  }
})

test('relogio para tras nao trava a recarga para sempre', () => {
  // Horário de verão, ajuste de relógio: o decorrido pode dar negativo. O certo
  // é buscar, não ficar preso com número velho até o próximo tique.
  assert.equal(decidirAoVoltar({ msDesdeAUltimaRecarga: -60_000, intervaloMs: CINCO_MIN }), 'esperar')
})

test('a noite inteira escondida NAO gasta uma chamada', () => {
  // A conta do estrago: 12 tiques por hora, 7 horas.
  let recarregas = 0
  for (let i = 0; i < 12 * 7; i++) if (decidirNoTique({ visivel: false }) === 'recarregar') recarregas++
  assert.equal(recarregas, 0)
  // E ao voltar de manhã, UMA recarga põe tudo em dia.
  assert.equal(decidirAoVoltar({ msDesdeAUltimaRecarga: 7 * 60 * 60 * 1000, intervaloMs: CINCO_MIN }), 'recarregar')
})
