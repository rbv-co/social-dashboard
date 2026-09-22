import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  precoPorLitro, problemasDoAbastecimento, trechosDeConsumo, consumoDoVeiculo, avisosDeConsumo,
  ultimoKmDeAbastecimento, tanqueMaisRecente, abastecimentoRecente,
} from './abastecimentos.js'

const bom = {
  km: 36900, kmConhecido: 36896, litros: 41.3, totalCentavos: 25000,
  tanqueDepois: 4, abastecidoEm: '2026-09-21T12:00:00Z', agoraIso: '2026-09-21T15:00:00Z',
}

test('o preço por litro é o que a pessoa confere no cupom', () => {
  assert.equal(precoPorLitro(25000, 41.3).toFixed(2), '6.05')
  assert.equal(precoPorLitro(25000, 0), null, 'sem litros não há preço — e não é zero')
  assert.equal(precoPorLitro(null, 41.3), null)
})

test('registro completo e coerente não barra nem avisa', () => {
  const r = problemasDoAbastecimento(bom)
  assert.deepEqual(r.barra, [])
  assert.deepEqual(r.avisa, [])
})

test('km menor que o já conhecido BARRA — o odômetro só anda pra frente', () => {
  const r = problemasDoAbastecimento({ ...bom, km: 30000 })
  assert.equal(r.barra.length, 1)
  assert.match(r.barra[0], /36\.896/, 'mostrar os dois números é o que faz achar o erro')
})

test('os quatro campos que fazem o registro valer BARRAM quando faltam', () => {
  for (const campo of ['km', 'litros', 'totalCentavos', 'tanqueDepois']) {
    const r = problemasDoAbastecimento({ ...bom, [campo]: null })
    assert.ok(r.barra.length >= 1, `${campo} vazio devia barrar`)
  }
})

test('data no futuro BARRA — abastecimento é coisa que já aconteceu', () => {
  const r = problemasDoAbastecimento({ ...bom, abastecidoEm: '2026-09-22T12:00:00Z' })
  assert.equal(r.barra.length, 1)
  assert.match(r.barra[0], /futuro/i)
})

test('litros acima do tanque do carro AVISA e deixa salvar', () => {
  const r = problemasDoAbastecimento({ ...bom, litros: 90, tanqueDoCarro: 50 })
  assert.deepEqual(r.barra, [], 'aviso não barra')
  assert.equal(r.avisa.length, 1)
})

test('preço por litro fora do pé AVISA — pega o dedo errado, não a variação', () => {
  assert.equal(problemasDoAbastecimento({ ...bom, totalCentavos: 650000 }).avisa.length, 1)
  assert.deepEqual(problemasDoAbastecimento({ ...bom, totalCentavos: 26500 }).avisa, [],
    'R$ 6,42 o litro é normal e não pode virar aviso')
})

test('sem km conhecido ainda dá para registrar — carro novo na frota', () => {
  const r = problemasDoAbastecimento({ ...bom, kmConhecido: null })
  assert.deepEqual(r.barra, [])
})

test('Reserva (0) é nível LEGÍTIMO e não pode barrar — a outra metade do bug', () => {
  // Par do teste "os quatro campos barram quando faltam": um conserta o outro.
  // `Number(null)` é 0 em JavaScript, e 0 é Reserva.
  const r = problemasDoAbastecimento({
    km: 36900, kmConhecido: 36896, litros: 41.3, totalCentavos: 25000,
    tanqueDepois: 0, abastecidoEm: '2026-09-21T12:00:00Z', agoraIso: '2026-09-21T15:00:00Z',
  })
  assert.deepEqual(r.barra, [], 'quem abasteceu R$ 20 para chegar no posto certo fica na reserva')
})

const ab = (km, litros, tanque, extra = {}) => ({
  id: `a-${km}`, veiculo_id: 'v1', km, litros, tanque_depois: tanque,
  total_centavos: Math.round(litros * 605), combustivel: 'GASOLINA',
  abastecido_em: `2026-09-${String(extra.dia || 1).padStart(2, '0')}T12:00:00Z`, ...extra,
})

test('D36 · o trecho vai de um CHEIO ao próximo CHEIO', () => {
  // 36.000 cheio → 36.400 cheio, com 40 litros no meio: 10 km/l.
  const t = trechosDeConsumo([ab(36000, 30, 4, { dia: 1 }), ab(36400, 40, 4, { dia: 10 })])
  assert.equal(t.length, 1)
  assert.equal(t[0].km, 400)
  assert.equal(t[0].litros, 40, 'os litros do PRIMEIRO cheio encheram o tanque que veio ANTES')
  assert.equal(t[0].kmPorLitro, 10)
})

test('D36 · o parcial do meio ENTRA na conta do trecho', () => {
  // cheio 36.000 → parcial 20 L → cheio 36.600 com 40 L = 60 L para 600 km.
  const t = trechosDeConsumo([
    ab(36000, 30, 4, { dia: 1 }), ab(36300, 20, 2, { dia: 5 }), ab(36600, 40, 4, { dia: 10 }),
  ])
  assert.equal(t.length, 1)
  assert.equal(t[0].litros, 60)
  assert.equal(t[0].kmPorLitro, 10)
})

test('D36 · com um cheio só, não há consumo — e a resposta é NULA, não zero', () => {
  assert.deepEqual(trechosDeConsumo([ab(36000, 30, 4)]), [])
  assert.equal(consumoDoVeiculo([ab(36000, 30, 4)]), null)
})

test('D37 · trecho com combustível diferente nas pontas não vira consumo', () => {
  // Etanol rende menos que gasolina: misturar os dois inventaria uma piora.
  const t = trechosDeConsumo([
    ab(36000, 30, 4, { dia: 1, combustivel: 'GASOLINA' }),
    ab(36400, 40, 4, { dia: 10, combustivel: 'ETANOL' }),
  ])
  assert.deepEqual(t, [])
})

test('o consumo do veículo devolve o trecho mais novo e a média', () => {
  const c = consumoDoVeiculo([
    ab(36000, 30, 4, { dia: 1 }), ab(36400, 40, 4, { dia: 10 }), ab(36900, 50, 4, { dia: 20 }),
  ])
  assert.equal(c.trechos.length, 2)
  assert.equal(c.kmPorLitro, 10, 'o mais novo: 500 km / 50 L')
  assert.equal(c.media, 10)
})

test('lista fora de ordem não quebra a conta', () => {
  const t = trechosDeConsumo([ab(36400, 40, 4, { dia: 10 }), ab(36000, 30, 4, { dia: 1 })])
  assert.equal(t.length, 1)
  assert.equal(t[0].kmPorLitro, 10)
})

test('nada quebra com entrada vazia', () => {
  assert.deepEqual(trechosDeConsumo([]), [])
  assert.deepEqual(trechosDeConsumo(null), [])
  assert.equal(consumoDoVeiculo(null), null)
})

test('D39 · consumo absurdo no trecho fechado AVISA', () => {
  // 400 km com 300 litros = 1,3 km/l: quase sempre litro digitado no lugar do
  // valor pago. Avisa, não barra — o registro do que aconteceu não se recusa.
  const a = [ab(36000, 30, 4, { dia: 1 }), ab(36400, 300, 4, { dia: 10 })]
  const avisos = avisosDeConsumo(a, 'v1')
  assert.equal(avisos.length, 1)
  assert.match(avisos[0], /1,3 km\/l/)
})

test('D39 · consumo normal não avisa nada', () => {
  const a = [ab(36000, 30, 4, { dia: 1 }), ab(36400, 40, 4, { dia: 10 })]
  assert.deepEqual(avisosDeConsumo(a, 'v1'), [], '10 km/l é normal')
})

test('D39 · sem trecho fechado não há aviso — a maioria dos casos', () => {
  assert.deepEqual(avisosDeConsumo([ab(36000, 30, 4)], 'v1'), [])
  assert.deepEqual(avisosDeConsumo([], 'v1'), [])
})

test('D39 · o aviso olha só o carro pedido', () => {
  const a = [
    ab(36000, 30, 4, { dia: 1 }), ab(36400, 300, 4, { dia: 10 }),
    { ...ab(1000, 30, 4, { dia: 1 }), veiculo_id: 'v2' },
  ]
  assert.equal(avisosDeConsumo(a, 'v2').length, 0, 'v2 não tem trecho fechado')
})

test('o maior km de abastecimento do carro, no molde de ultimoKmDeRevisao', () => {
  const lista = [
    { veiculo_id: 'v1', km: 36000 }, { veiculo_id: 'v1', km: 36900 },
    { veiculo_id: 'v2', km: 99999 }, { veiculo_id: 'v1', km: null },
  ]
  assert.equal(ultimoKmDeAbastecimento(lista, 'v1'), 36900, 'pelo MAIOR: odômetro só anda pra frente')
  assert.equal(ultimoKmDeAbastecimento(lista, 'v3'), null)
  assert.equal(ultimoKmDeAbastecimento(null, 'v1'), null)
})

test('D37 · a média é do MESMO combustível do trecho mais novo', () => {
  // Três trechos: dois de gasolina (10 e 12 km/l) e um de etanol (7 km/l) no
  // meio. A média de gasolina é 11 — o etanol não entra.
  const c = consumoDoVeiculo([
    ab(36000, 30, 4, { dia: 1 }),
    ab(36400, 40, 4, { dia: 5 }),                                  // gasolina, 10 km/l
    ab(36750, 50, 4, { dia: 9, combustivel: 'ETANOL' }),           // ponta trocada: descartado
    ab(37100, 50, 4, { dia: 13, combustivel: 'ETANOL' }),          // etanol, 7 km/l
    ab(37500, 40, 4, { dia: 17, combustivel: 'GASOLINA' }),        // ponta trocada: descartado
    ab(38100, 50, 4, { dia: 21, combustivel: 'GASOLINA' }),        // gasolina, 12 km/l
  ])
  assert.equal(c.kmPorLitro, 12, 'o mais novo é o de gasolina')
  assert.equal(c.media, 11, 'média só dos dois de gasolina: (10 + 12) / 2')
  assert.equal(c.trechos.length, 3, 'o histórico continua vindo inteiro')
})

test('D37 · com um combustível só, a média não muda de comportamento', () => {
  const c = consumoDoVeiculo([
    ab(36000, 30, 4, { dia: 1 }), ab(36400, 40, 4, { dia: 5 }), ab(36900, 50, 4, { dia: 9 }),
  ])
  assert.equal(c.media, 10, '(10 + 10) / 2')
})

/* ── D40/D38b: tanque mais recente e aviso de abastecimento recente ───────── */

test('D40 · o tanque vem do registro MAIS RECENTE entre abastecer e devolver', () => {
  // Quem abasteceu hoje sabe mais sobre o tanque do que quem devolveu semana
  // passada. Hoje só a devolução informa, e em 7 das 25 viagens.
  // `uso` é UM uso só, já escolhido por quem chama — nunca a lista inteira.
  const uso = { veiculo_id: 'v1', volta_em: '2026-09-10T18:00:00Z', tanque_quartos: 1 }
  const abast = [{ veiculo_id: 'v1', abastecido_em: '2026-09-20T12:00:00Z', tanque_depois: 4 }]
  assert.equal(tanqueMaisRecente(abast, uso, 'v1'), 4)
})

test('D40 · devolução mais nova que o abastecimento vence', () => {
  const uso = { veiculo_id: 'v1', volta_em: '2026-09-21T18:00:00Z', tanque_quartos: 1 }
  const abast = [{ veiculo_id: 'v1', abastecido_em: '2026-09-20T12:00:00Z', tanque_depois: 4 }]
  assert.equal(tanqueMaisRecente(abast, uso, 'v1'), 1)
})

test('D40 · sem nenhum dos dois, o tanque é NULO — travessão, nunca zero', () => {
  assert.equal(tanqueMaisRecente([], null, 'v1'), null)
  assert.equal(tanqueMaisRecente(null, null, 'v1'), null)
  // Uso que existe mas não informou o tanque também é NULO, não zero.
  assert.equal(tanqueMaisRecente([], { veiculo_id: 'v1', volta_em: '2026-09-10T18:00:00Z' }, 'v1'), null)
})

test('D38b · o abastecimento das últimas 12 horas é achado, para a tela avisar', () => {
  const agora = '2026-09-21T20:00:00Z'
  const lista = [{ veiculo_id: 'v1', abastecido_em: '2026-09-21T17:20:00Z', litros: 41.3, total_centavos: 25000 }]
  const achado = abastecimentoRecente(lista, 'v1', agora, 12)
  assert.ok(achado, 'três horas atrás tem de ser achado')
  assert.equal(achado.litros, 41.3)
})

test('D38b · o de ontem NÃO vira aviso — dois no mesmo dia acontecem de verdade', () => {
  const agora = '2026-09-21T20:00:00Z'
  const lista = [{ veiculo_id: 'v1', abastecido_em: '2026-09-20T08:00:00Z' }]
  assert.equal(abastecimentoRecente(lista, 'v1', agora, 12), null)
  assert.equal(abastecimentoRecente([], 'v1', agora, 12), null)
})

test('D40 · Reserva (0) do abastecimento mais novo vence devolução antiga com tanque cheio', () => {
  // Mesma prova, direto na função pura: `0` tem de vencer por ser mais
  // recente, e não pode ser confundido com "não informou".
  const uso = { veiculo_id: 'v1', volta_em: '2026-09-05T18:00:00Z', tanque_quartos: 4 }
  const abast = [{ veiculo_id: 'v1', abastecido_em: '2026-09-20T12:00:00Z', tanque_depois: 0 }]
  assert.equal(tanqueMaisRecente(abast, uso, 'v1'), 0)
})

test('⚠️ D40 · a lista inteira de usos NÃO entra — só o uso escolhido', () => {
  // A prova por MUTAÇÃO da assinatura: se alguém voltar a passar `usos` aqui,
  // esta chamada com um ARRAY tem de devolver nulo, e não o tanque da primeira
  // linha. Um array não tem `veiculo_id` nem `tanque_quartos`, então ele não é
  // candidato a nada — é assim que o defeito do "dia zero" fica impossível de
  // voltar calado.
  const usos = [
    { veiculo_id: 'v1', volta_em: '2026-07-01T18:00:00Z', tanque_quartos: 1 },
    { veiculo_id: 'v1', volta_em: '2026-09-10T18:00:00Z' },
  ]
  assert.equal(tanqueMaisRecente([], usos, 'v1'), null,
    'passar a lista inteira não pode mais achar tanque nenhum')
  assert.equal(tanqueMaisRecente([], usos[1], 'v1'), null,
    'e o uso escolhido, que não informou, continua sendo travessão')
})

/* ── D39: o aviso de consumo é sobre o registro NOVO, não sobre o passado ──── */

test('⚠️ D39 · trecho ruim já gravado NÃO reclama de novo a cada abastecimento', () => {
  // O defeito: `avisosDeConsumo` julgava `trechos[trechos.length-1]` sempre.
  // Com um trecho ruim no histórico, TODO abastecimento parcial seguinte
  // mostrava "Este trecho deu 1,3 km/l" falando de um cupom de meses atrás,
  // como se fosse o que a pessoa acabou de digitar. Aviso que aparece sempre
  // vira paisagem.
  const ruim = [
    { ...ab(36000, 30, 4, { dia: 1 }), id: 'a1' },
    { ...ab(36400, 300, 4, { dia: 10 }), id: 'a2' },   // 1,3 km/l, já gravado
  ]
  // Sem o id, a função responde como antes — e é por isso que ela reclamava.
  assert.equal(avisosDeConsumo(ruim, 'v1').length, 1, 'o comportamento antigo continua disponível')

  // A tela passa o id do rascunho. Este rascunho é PARCIAL: não fecha trecho
  // nenhum, então não há o que avisar sobre ELE.
  const rascunho = { ...ab(36500, 20, 2, { dia: 20 }), id: '__rascunho__' }
  assert.deepEqual(avisosDeConsumo([...ruim, rascunho], 'v1', '__rascunho__'), [],
    'o trecho ruim é de antes; o registro novo não fechou trecho nenhum')
})

test('⚠️ D39 · mas o trecho que o registro NOVO fecha continua avisando', () => {
  // A outra metade da prova: sem ela, "não avisa nunca" passaria verde.
  const lista = [
    { ...ab(36000, 30, 4, { dia: 1 }), id: 'a1' },
    { ...ab(36400, 300, 4, { dia: 10 }), id: '__rascunho__' },   // 1,3 km/l, é ELE
  ]
  const avisos = avisosDeConsumo(lista, 'v1', '__rascunho__')
  assert.equal(avisos.length, 1)
  assert.match(avisos[0], /1,3 km\/l/)
})
