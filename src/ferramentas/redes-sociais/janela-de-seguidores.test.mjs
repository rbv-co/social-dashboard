import test from 'node:test'
import assert from 'node:assert/strict'
import { janelaDoPersonalizado, ehRecorteRolante, notaDaDiferenca } from './janela-de-seguidores.js'

/* ⚠️ O PAINEL PROFISSIONAL DO INSTAGRAM ROTULA CADA DIA UM DIA À FRENTE DA API.
 *
 * Medido contra a API real em 09/09/2026, na conta da Vessel:
 *
 *   janela da API   seguiram  saíram
 *   04/09              44        7
 *   05/09             183        4
 *   06/09             339        8
 *   07/09             385       12
 *   08/09           sem dado  sem dado
 *
 * O painel, para "5 a 8 de setembro", mostra 951 seguiram e 31 saíram. A soma de
 * 04+05+06+07 dá EXATAMENTE 951 e 31 — os dois números, não só o total. Ou seja,
 * o "5 de setembro" do painel é o dia 4 da API.
 *
 * ⚠️ E NÃO É O DIA 8 FALTANDO, que foi a minha primeira hipótese. A contagem
 * total de seguidores foi de 15.877 (dia 7) para 16.320 (dia 8): o dia 8 rendeu
 * ~443 líquidos. Se ele fosse os 44/7 que faltam para 951, a contagem teria
 * subido 37. O dia 8 não está nos 951.
 *
 * O dono pediu (09/09/2026) que o período PERSONALIZADO apareça idêntico ao
 * painel — e SÓ ele: os rolantes (7D/14D/30D) já foram conferidos contra o
 * painel e batem sem deslocamento, e mexer neles quebraria o que funciona.
 */

test('o personalizado desloca um dia nos DOIS lados', () => {
  // O caso real que o dono trouxe: ele escolheu 05→08 e o painel mostrava 04→07.
  assert.deepEqual(janelaDoPersonalizado('2026-09-05', '2026-09-08'),
    { inicio: '2026-09-04', fim: '2026-09-07' })
})

test('atravessa a virada do mês', () => {
  assert.deepEqual(janelaDoPersonalizado('2026-09-01', '2026-09-10'),
    { inicio: '2026-08-31', fim: '2026-09-09' })
  assert.deepEqual(janelaDoPersonalizado('2026-03-01', '2026-03-31'),
    { inicio: '2026-02-28', fim: '2026-03-30' })
})

test('ano bissexto não escorrega', () => {
  assert.deepEqual(janelaDoPersonalizado('2024-03-01', '2024-03-05'),
    { inicio: '2024-02-29', fim: '2024-03-04' })
})

test('atravessa a virada do ano', () => {
  assert.deepEqual(janelaDoPersonalizado('2026-01-01', '2026-01-05'),
    { inicio: '2025-12-31', fim: '2026-01-04' })
})

test('um dia só continua sendo um dia', () => {
  assert.deepEqual(janelaDoPersonalizado('2026-09-08', '2026-09-08'),
    { inicio: '2026-09-07', fim: '2026-09-07' })
})

test('⚠️ data ruim devolve NULO — não desloca no escuro', () => {
  /* Deslocar uma data que não entendi produziria um recorte errado que ninguém
   * percebe: os números continuam saindo, só que de outros dias. Quem chama tem
   * de cair no comportamento antigo, e não numa janela inventada. */
  for (const ruim of [null, '', 'ontem', '08/09/2026', '2026-13-01', '2026-02-30']) {
    assert.equal(janelaDoPersonalizado(ruim, '2026-09-08'), null, `início "${ruim}"`)
    assert.equal(janelaDoPersonalizado('2026-09-05', ruim), null, `fim "${ruim}"`)
  }
})

test('⚠️ o fuso não pode roubar o dia', () => {
  /* `new Date('2026-09-05')` é MEIA-NOITE UTC, que no Brasil ainda é dia 4 —
   * uma conta feita assim erraria o deslocamento em mais um dia, e o erro só
   * apareceria para quem olhasse o número final. A conta é feita ao meio-dia. */
  assert.deepEqual(janelaDoPersonalizado('2026-09-05', '2026-09-05'),
    { inicio: '2026-09-04', fim: '2026-09-04' })
})

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

/* ── A NOTA QUE EXPLICA A DIFERENÇA ENTRE AS BARRAS E O CARD ────────────────
 *
 * ⚠️ O PRÓPRIO PAINEL DO INSTAGRAM NÃO FECHA COM ELE MESMO. Medido pelo dono em
 * 09/09/2026: filtrando 5 a 8 de setembro, o painel dá total 951 e o gráfico dele
 * vai só até o dia 7. O total é deslocado, as barras são do dia real — as duas
 * coisas ao mesmo tempo.
 *
 * Tentamos fazer a soma fechar rotulando as barras um dia à frente. O dono
 * derrubou, com razão: a barra "9" mostrava 443 (que é o dia 8) enquanto o filtro
 * "hoje" mostrava 326 para o mesmo dia 9. Decisão dele: "data real manda".
 *
 * Então a diferença EXISTE e é explicada, em vez de escondida.
 */

test('a nota aparece só quando há diferença de verdade', () => {
  assert.equal(notaDaDiferenca({ somaBarras: 1363, totalCard: 1363 }), null)
  assert.equal(notaDaDiferenca({ somaBarras: 0, totalCard: 0 }), null)
})

test('a nota diz os dois números e de onde vem cada um', () => {
  const t = notaDaDiferenca({ somaBarras: 1509, totalCard: 1363 })
  assert.match(t, /1\.509/, 'mostra a soma das barras')
  assert.match(t, /1\.363/, 'mostra o total do card')
  assert.match(t, /Instagram/, 'diz de quem é a régua do card')
})

test('⚠️ número que não é número não vira nota', () => {
  // Nota com "NaN" no meio é pior que nota nenhuma.
  for (const ruim of [null, undefined, NaN, 'muitos']) {
    assert.equal(notaDaDiferenca({ somaBarras: ruim, totalCard: 1363 }), null)
    assert.equal(notaDaDiferenca({ somaBarras: 1509, totalCard: ruim }), null)
  }
  assert.equal(notaDaDiferenca(), null)
})
