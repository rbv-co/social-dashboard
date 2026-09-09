import test from 'node:test'
import assert from 'node:assert/strict'
import { canalApareceNoPeriodo, ocultosNoPeriodo, dataDigitadaParaISO, dataISOparaBR } from './canal-fechado.js'

/* ⚠️ LOJA QUE FECHOU SAI DO MENU DAQUI PRA FRENTE, E CONTINUA NO PASSADO.
 *
 * Pedido do dono, 09/09/2026: "oculte os canais de vendas, dom pedro pq
 * fecharam, deixe somente o histórico pra trás". Decidido com ele: o corte da
 * Loja Dom Pedro é 31/08/2026, e o canal VOLTA a aparecer quando o período
 * escolhido alcança dias em que a loja operava — senão o gráfico do ano fica
 * com um buraco e os meses deixam de ser comparáveis.
 *
 * A conta é sobre a DATA INICIAL do período. Se a janela inteira começa depois
 * do fechamento, não há venda possível ali e o canal só polui o menu. Se ela
 * começa antes, houve loja aberta dentro da janela — e o número tem de aparecer
 * com o nome certo.
 */

const DOM_PEDRO = { loja_id: '205657609', nome: 'Loja Dom Pedro', fechado_em: '2026-08-31' }
const TIVOLI = { loja_id: '205834140', nome: "Loja Santa Bárbara d'Oeste", fechado_em: null }

test('loja aberta aparece em qualquer período', () => {
  for (const di of ['2026-09-09', '2026-01-01', '2025-12-01']) {
    assert.equal(canalApareceNoPeriodo(TIVOLI, di), true)
  }
})

test('loja fechada some quando o período começa DEPOIS do fechamento', () => {
  // "hoje", "7 dias", "mês atual" em 09/09/2026 — todos começam depois de 31/08.
  assert.equal(canalApareceNoPeriodo(DOM_PEDRO, '2026-09-09'), false, 'hoje')
  assert.equal(canalApareceNoPeriodo(DOM_PEDRO, '2026-09-02'), false, '7 dias')
  assert.equal(canalApareceNoPeriodo(DOM_PEDRO, '2026-09-01'), false, 'mês atual')
})

test('loja fechada VOLTA quando o período alcança os dias em que operava', () => {
  assert.equal(canalApareceNoPeriodo(DOM_PEDRO, '2026-08-01'), true, 'mês passado')
  assert.equal(canalApareceNoPeriodo(DOM_PEDRO, '2026-08-10'), true, '30 dias')
  assert.equal(canalApareceNoPeriodo(DOM_PEDRO, '2025-12-01'), true, 'o ano todo')
})

test('o próprio dia do fechamento ainda conta', () => {
  // A loja operou no dia 31; a venda do dia 31 é dela.
  assert.equal(canalApareceNoPeriodo(DOM_PEDRO, '2026-08-31'), true)
})

test('⚠️ sem data inicial o canal APARECE — falta de dado não esconde loja', () => {
  /* O contrário seria pior: uma tela que ainda não sabe o período esconderia
   * canal vivo, e o dono veria o faturamento cair sem explicação. Esconder é a
   * exceção, e exceção precisa de prova. */
  assert.equal(canalApareceNoPeriodo(DOM_PEDRO, null), true)
  assert.equal(canalApareceNoPeriodo(DOM_PEDRO, ''), true)
  assert.equal(canalApareceNoPeriodo(DOM_PEDRO, undefined), true)
})

test('data de fechamento estragada não esconde nada', () => {
  // Campo digitado à mão na Config de Admin: texto que não é data tem de ser
  // ignorado, e não virar comparação de strings que esconde a loja errada.
  for (const ruim of ['ontem', '31/08/2026', '2026-13-99', 0, {}]) {
    assert.equal(canalApareceNoPeriodo({ loja_id: '1', fechado_em: ruim }, '2026-09-09'), true,
      `"${JSON.stringify(ruim)}" não é data e não pode esconder`)
  }
})

test('ocultosNoPeriodo devolve os ids a tirar do menu, como NÚMERO', () => {
  /* As telas guardam o id do canal como número (`parseInt` no universo de
   * exibição). Devolver texto aqui faria o `has()` falhar sempre — e o canal
   * continuaria na tela sem ninguém entender por quê. */
  const ocultos = ocultosNoPeriodo([DOM_PEDRO, TIVOLI], '2026-09-09')
  assert.ok(ocultos.has(205657609), 'o Dom Pedro sai')
  assert.equal(ocultos.has(205834140), false, 'o Tivoli fica')
  assert.equal(ocultos.size, 1)
})

test('ocultosNoPeriodo vem vazio quando o período alcança o passado', () => {
  assert.equal(ocultosNoPeriodo([DOM_PEDRO, TIVOLI], '2026-08-01').size, 0)
})

test('ocultosNoPeriodo aguenta lista vazia, nula e linha sem id', () => {
  assert.equal(ocultosNoPeriodo([], '2026-09-09').size, 0)
  assert.equal(ocultosNoPeriodo(null, '2026-09-09').size, 0)
  assert.equal(ocultosNoPeriodo([{ fechado_em: '2026-01-01' }], '2026-09-09').size, 0,
    'linha sem loja_id não vira id NaN no conjunto')
})

/* ── A DATA DIGITADA NA CONFIG DE ADMIN ─────────────────────────────────────
 * O dono digita "31/08/2026", não "2026-08-31". A conversão mora aqui, com a
 * recusa junto: data que a tela não entendeu NÃO pode virar `null` calado, que
 * seria "reabrir a loja" sem ninguém pedir. */

test('aceita a data como o dono digita', () => {
  assert.deepEqual(dataDigitadaParaISO('31/08/2026'), { ok: true, iso: '2026-08-31' })
  assert.deepEqual(dataDigitadaParaISO(' 31/8/2026 '), { ok: true, iso: '2026-08-31' })
  assert.deepEqual(dataDigitadaParaISO('2026-08-31'), { ok: true, iso: '2026-08-31' })
})

test('vazio REABRE a loja, e isso é explícito', () => {
  assert.deepEqual(dataDigitadaParaISO(''), { ok: true, iso: null })
  assert.deepEqual(dataDigitadaParaISO('   '), { ok: true, iso: null })
})

test('⚠️ data impossível é RECUSADA, nunca vira nulo calado', () => {
  for (const ruim of ['31/02/2026', '99/99/9999', 'ontem', '31-08-2026', '2026-13-01', '08/2026']) {
    const r = dataDigitadaParaISO(ruim)
    assert.equal(r.ok, false, `"${ruim}" tinha de ser recusada`)
    assert.match(r.mensagem, /\d{2}\/\d{2}\/\d{4}/, 'a recusa mostra o formato certo')
    assert.equal(r.iso, undefined, 'recusa não devolve data')
  }
})

test('31/02 não vira 03/03 — o mês é conferido de volta', () => {
  // `new Date(2026, 1, 31)` rola para março sem reclamar. Sem a conferência de
  // volta, o dono digitaria uma data que não existe e a tela guardaria outra.
  assert.equal(dataDigitadaParaISO('31/02/2026').ok, false)
  assert.equal(dataDigitadaParaISO('30/02/2026').ok, false)
  assert.deepEqual(dataDigitadaParaISO('29/02/2024'), { ok: true, iso: '2024-02-29' }, 'ano bissexto existe')
})

test('a data volta para a tela como o dono escreve', () => {
  assert.equal(dataISOparaBR('2026-08-31'), '31/08/2026')
  assert.equal(dataISOparaBR(null), '')
  assert.equal(dataISOparaBR('qualquer coisa'), '', 'lixo não vira data invertida na tela')
})
