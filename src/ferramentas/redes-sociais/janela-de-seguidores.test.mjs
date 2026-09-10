import test from 'node:test'
import assert from 'node:assert/strict'
import { ehRecorteRolante, ehGraficoDeContexto } from './janela-de-seguidores.js'

/* ── QUEM É "ROLANTE" NÃO PODE IGNORAR O RECORTE PERSONALIZADO ──────────────
 *
 * Defeito visto pelo dono em 09/09/2026: filtrando 5 a 8 de setembro, a barra do
 * dia 8 apareceu DUAS VEZES.
 *
 * Ao escolher datas, `currentPeriod` continua com o valor antigo (7, 30…), e o
 * gráfico decidia o ramo só por ele: caía no dos rolantes, que cola "ontem" e
 * "hoje" no fim da série. Com a série indo até o dia 8, o 8 entrava como dia da
 * série E de novo como "ontem".
 *
 * ⚠️ O DEFEITO JÁ EXISTIA ANTES, mais discreto: a série ia até o dia 7 e o
 * gráfico mostrava barras dos dias 8 e 9 num período de 5 a 8. O dono chegou a
 * dizer "no dia 9: 302" — dia que ele não tinha pedido. Ninguém ligou os pontos.
 */

test('período personalizado NÃO é rolante, mesmo com period numérico', () => {
  assert.equal(ehRecorteRolante(7, '2026-09-05', '2026-09-08'), false)
  assert.equal(ehRecorteRolante(30, '2026-09-05', '2026-09-08'), false)
  assert.equal(ehRecorteRolante(0, '2026-09-05', '2026-09-08'), false)
})

test('sem datas, o rolante continua rolante', () => {
  for (const p of [0, 1, 3, 7, 14, 30]) assert.equal(ehRecorteRolante(p, null, null), true, `period ${p}`)
})

test('mês e mês passado não são rolantes', () => {
  for (const p of ['monthfull', 'sofar', 'month', 'lastmonth']) {
    assert.equal(ehRecorteRolante(p, null, null), false, p)
  }
})

test('só uma das duas datas não conta como personalizado', () => {
  // A tela só aplica quando as DUAS estão preenchidas; meia escolha mantém o
  // período que estava valendo.
  assert.equal(ehRecorteRolante(7, '2026-09-05', null), true)
  assert.equal(ehRecorteRolante(7, null, '2026-09-08'), true)
  assert.equal(ehRecorteRolante(7, '', ''), true)
})

/* ── HOJE E ONTEM: O GRÁFICO MOSTRA CONTEXTO, NÃO O PERÍODO ─────────────────
 *
 * Nesses dois períodos o gráfico desenha os ÚLTIMOS 7 DIAS de propósito — uma
 * barra só seria um retângulo sem leitura. O card, porém, é do DIA.
 *
 * Defeito visto pelo dono em 09/09/2026, logo depois de o card virar "a soma do
 * gráfico": "ontem" mostrava 1,7 mil (a semana somada) quando o dia foi 443, e
 * "hoje" mostrava 1,7 mil quando até então eram 336.
 */

test('hoje e ontem desenham contexto, e o card não pode somar tudo', () => {
  assert.equal(ehGraficoDeContexto(0), true, 'hoje')
  assert.equal(ehGraficoDeContexto(1), true, 'ontem')
})

test('nos demais períodos o gráfico É o período, e a soma vale', () => {
  for (const p of [3, 7, 14, 30, 'monthfull', 'sofar', 'month', 'lastmonth']) {
    assert.equal(ehGraficoDeContexto(p), false, String(p))
  }
})
