import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* ⚠️⚠️ TRAVA: DECIDIR O PERÍODO SÓ PELO NÚMERO QUEBRA O INTERVALO ESCOLHIDO.
 *
 * Ao escolher datas na tela, `period` CONTINUA com o valor antigo (0, 1, 7, 30…).
 * Qualquer decisão tomada só por ele trata o intervalo escolhido como se fosse o
 * período anterior.
 *
 * ISTO QUEBROU TRÊS VEZES NO MESMO DIA (09/09/2026), sempre com o dono achando:
 *   1. `_rolante` — o personalizado ganhava barras de ontem e hoje coladas no fim,
 *      e a barra do dia 8 aparecia DUAS VEZES;
 *   2. `ehGraficoDeContexto` — eu criei a função para o caso 1 e escrevi a 2 sem
 *      as datas: o card do personalizado mostrava o dia em vez do intervalo;
 *   3. `isHoje` — "Hoje" selecionado + datas escolhidas recortava a janela do
 *      card em um dia só.
 *
 * O dono, na terceira: "que bosta em velho, tem que ficar pedindo pra vc corrigir
 * as coisas". Ele está certo. Este teste existe para que a quarta não aconteça.
 */

const TELA = readFileSync(new URL('./tela-de-redes-sociais.vue', import.meta.url), 'utf8')

test('⚠️ `isHoje` e `isOntem` olham as datas escolhidas', () => {
  assert.match(TELA, /const ehCustom = !!\(customStart && customEnd\)/)
  assert.match(TELA, /const isHoje = !ehCustom && period === 0/)
  assert.match(TELA, /const isOntem = !ehCustom && period === 1/)
})

test('⚠️ o recorte do card não usa `period === 1` solto', () => {
  // Era `else if (period === 1) { followStart = followEnd = _ontemBRT }`, que com
  // datas escolhidas jogava a janela inteira em cima de ontem.
  assert.ok(!/else if \(period === 1\) \{ followStart = followEnd/.test(TELA))
  assert.match(TELA, /else if \(isOntem\) \{ followStart = followEnd = _ontemBRT \}/)
})

test('⚠️ o número do card decide por `ehGraficoDeContexto`, COM as datas', () => {
  assert.match(TELA, /ehGraficoDeContexto\(period, currentStartDate, currentEndDate\)/)
  assert.ok(!/ehGraficoDeContexto\(period\)/.test(TELA),
    'chamar sem as datas é o defeito de 09/09/2026')
  assert.match(TELA, /const ehRecenteLive = !!d\.live && _ehContexto/)
  assert.match(TELA, /const _somaBarras = _ehContexto \? null : totalPelasBarras\(d\.chart\)/)
})

test('⚠️ o ramo rolante do gráfico decide por `ehRecorteRolante`, COM as datas', () => {
  assert.match(TELA, /ehRecorteRolante\(currentPeriod, currentStartDate, currentEndDate\)/)
  assert.ok(!/const _rolante = \[0, 1, 3, 7, 14, 30\]\.includes/.test(TELA),
    'voltou a decidir só pelo número')
})

test('⚠️ o mês corrente também olha as datas', () => {
  assert.match(TELA, /const isCalMonth = !ehCustom &&/)
  assert.match(TELA, /const _mesAtual = !_ehCustom &&/)
})
