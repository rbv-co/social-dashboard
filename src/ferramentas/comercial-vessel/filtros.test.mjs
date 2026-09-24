import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filtrar, PERIODOS, FILTRO_VAZIO, precisaDoBanco } from './filtros.js'
import { proporcaoDoConjunto } from './estatistica.js'

const CAMPOS = { busca: ['codigo', 'nome'], situacao: 'situacao', loja: 'loja' }

/* ── datas relativas a HOJE, nunca cravadas ──────────────────────────────
 * ⚠️ Uma data escrita por extenso ("2026-09-10") envelhece: o teste que hoje
 * prova "dentro dos 30 dias" vira, meses depois, um teste provando o
 * contrário sem que ninguém tenha mexido em nada. Construindo a partir de
 * `new Date()` — em componentes locais, nunca via `toISOString()` (que passa
 * por UTC e pode empurrar a data para o dia seguinte à noite) — o teste
 * continua válido não importa quando rodar. */
function formatarData(d) {
  const ano = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}
function diasAtras(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return formatarData(d)
}
const diasNaFrente = (n) => diasAtras(-n)

const LISTA = [
  { codigo: 'PE-1', nome: 'Ana',   loja: 'iguatemi', ativa: true,  arquivada: false, quando: diasAtras(9), responderam: 4, disseram_sim: 2 },
  { codigo: 'PE-2', nome: 'Bruna', loja: 'tivoli',   ativa: false, arquivada: false, quando: diasAtras(7), responderam: 6, disseram_sim: 3 },
  { codigo: 'PE-3', nome: 'Carla', loja: 'iguatemi', ativa: true,  arquivada: true,  quando: diasAtras(5), responderam: 9, disseram_sim: 9 },
]

test('sem filtro nenhum, a lista volta inteira menos as arquivadas', () => {
  const r = filtrar(LISTA, FILTRO_VAZIO, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['PE-2', 'PE-1'])
})

test('a arquivada so aparece quando alguem pede por ela', () => {
  const r = filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'arquivadas' }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['PE-3'])
})

test('encerrada e diferente de arquivada', () => {
  const r = filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'encerradas' }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['PE-2'])
})

test('a busca nao liga para maiuscula nem para acento', () => {
  assert.deepEqual(filtrar(LISTA, { ...FILTRO_VAZIO, busca: 'ANA' }, CAMPOS).map((l) => l.codigo), ['PE-1'])
  assert.deepEqual(filtrar(LISTA, { ...FILTRO_VAZIO, busca: 'pe-2' }, CAMPOS).map((l) => l.codigo), ['PE-2'])
})

test('o filtro de loja recorta', () => {
  assert.deepEqual(filtrar(LISTA, { ...FILTRO_VAZIO, loja: 'tivoli' }, CAMPOS).map((l) => l.codigo), ['PE-2'])
})

test('a ordem mais nova primeiro e o padrao', () => {
  const r = filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'todas' }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['PE-3', 'PE-2', 'PE-1'])
})

test('da para pedir a mais antiga primeiro', () => {
  const r = filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'todas', ordem: 'data-antiga' }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['PE-1', 'PE-2', 'PE-3'])
})

// ⚠️ O TOTAL DO CONJUNTO ANDA JUNTO COM O FILTRO. Um total que nao acompanha o
// filtro e a tela mentindo com numero certo.
test('o total do conjunto muda quando o filtro muda', () => {
  // ⚠️ A FORMA REAL DA RESPOSTA: proporcaoDoConjunto() devolve {temBase, n, x,
  // valor, intervalo, largura, confiavel} — nao {total, proporcao}.
  const todas  = proporcaoDoConjunto(filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'todas' }, CAMPOS), 'disseram_sim', 'responderam')
  const so_igu = proporcaoDoConjunto(filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'todas', loja: 'iguatemi' }, CAMPOS), 'disseram_sim', 'responderam')
  assert.equal(todas.n, 19)    // 4 + 6 + 9
  assert.equal(todas.x, 14)    // 2 + 3 + 9
  assert.equal(so_igu.n, 13)   // 4 + 9
  assert.equal(so_igu.x, 11)   // 2 + 9
  assert.notEqual(todas.valor, so_igu.valor)
})

// ⚠️ BASE ZERO NAO E 0%. Sem ninguem no denominador nao ha taxa — "0%" faz um
// filtro que nao achou nada parecer um fracasso, e so o segundo pede decisao.
test('filtro que nao acha nada nao vira 0%', () => {
  const nada = proporcaoDoConjunto(filtrar(LISTA, { ...FILTRO_VAZIO, busca: 'ninguem' }, CAMPOS), 'disseram_sim', 'responderam')
  assert.equal(nada.temBase, false)
  assert.equal(nada.n, 0)
  assert.equal(nada.valor, null)
})

test('os periodos oferecidos incluem "tudo"', () => {
  assert.ok(PERIODOS.some((p) => p.dias === null))
  assert.deepEqual(PERIODOS.map((p) => p.dias), [7, 30, 90, null])
})

/* ── R10: o período recorta a LISTA, não o `p_dias` do banco ────────────── */

test('o filtro padrão (30 dias) já esconde o que é mais velho que isso', () => {
  const lista = [
    { codigo: 'VELHO', quando: diasAtras(40), ativa: true, arquivada: false },
    { codigo: 'NOVO',  quando: diasAtras(5),  ativa: true, arquivada: false },
  ]
  const r = filtrar(lista, FILTRO_VAZIO, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['NOVO'])
})

/* ── R17: "período" esconde o que é VELHO, nunca o que é FUTURO ──────────── */

test('⚠️ período nunca esconde um evento futuro, nem com o período mais curto', () => {
  // As três Beauty Sessions reais desta base estão marcadas para depois de
  // hoje — um corte com teto (só até hoje) apagaria a tela inteira.
  const lista = [
    { codigo: 'F-AMANHA',  quando: diasNaFrente(1),   ativa: true, arquivada: false },
    { codigo: 'F-SEMANA',  quando: diasNaFrente(6),   ativa: true, arquivada: false },
    { codigo: 'F-MES',     quando: diasNaFrente(27),  ativa: true, arquivada: false },
    { codigo: 'F-LONGE',   quando: diasNaFrente(400), ativa: true, arquivada: false },
  ]
  // "7 dias" é o período mais estreito — se algum futuro fosse cair fora de
  // um filtro, seria este.
  const r = filtrar(lista, { ...FILTRO_VAZIO, situacao: 'todas', dias: 7 }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo).sort(), lista.map((l) => l.codigo).sort())
})

test('"Tudo" nao esconde nem o evento antiguissimo', () => {
  const lista = [{ codigo: 'ANTIGO', quando: diasAtras(3650), ativa: true, arquivada: false }]
  const r = filtrar(lista, { ...FILTRO_VAZIO, situacao: 'todas', dias: null }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['ANTIGO'])
})

/* ── R18: a comparação de data não pode deslocar um dia ──────────────────── */

test('⚠️ evento exatamente no corte dos 30 dias fica — e o formato é data-só, sem hora', () => {
  // `quando` real chega assim: "AAAA-MM-DD", sem hora e sem fuso. Se a conta
  // usasse `new Date(string)` num valor deste tipo, o dia viraria meia-noite
  // UTC — no Brasil (UTC−3), 21h do dia ANTERIOR — e este evento, exatamente
  // no corte, pareceria um dia mais velho do que é e sumiria da lista.
  const noCorte = diasAtras(30)
  const lista = [{ codigo: 'B-NO-CORTE', quando: noCorte, ativa: true, arquivada: false }]
  const r = filtrar(lista, { ...FILTRO_VAZIO, situacao: 'todas', dias: 30 }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['B-NO-CORTE'])
})

test('um dia mais velho que o corte já não aparece', () => {
  const passouDoCorte = diasAtras(31)
  const lista = [{ codigo: 'B-FORA', quando: passouDoCorte, ativa: true, arquivada: false }]
  const r = filtrar(lista, { ...FILTRO_VAZIO, situacao: 'todas', dias: 30 }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), [])
})

/* ── R1: arquivada não é filtro de tela, é pedido novo ao banco ──────────── */

test('precisaDoBanco pede recarregar só para "Só arquivadas" e "Todas, inclusive arquivadas"', () => {
  assert.equal(precisaDoBanco('arquivadas'), true)
  assert.equal(precisaDoBanco('todas'), true)
  assert.equal(precisaDoBanco('abertas'), false)
  assert.equal(precisaDoBanco('encerradas'), false)
  assert.equal(precisaDoBanco('abertas_e_encerradas'), false)
})

// ── Stylist Circle (24/09/2026): ordenar pela faixa da nota ────────────────
test('ordem "faixa": A, B, C e por último sem nota; dentro da faixa, a nota maior primeiro', () => {
  const lista = [
    { codigo: 'STY-1', nome: 'Carla', faixa: 'C', nota: 50 },
    { codigo: 'STY-2', nome: 'Bia', faixa: null, nota: null },
    { codigo: 'STY-3', nome: 'Ana', faixa: 'A', nota: 78 },
    { codigo: 'STY-4', nome: 'Duda', faixa: 'A', nota: 90 },
    { codigo: 'STY-5', nome: 'Eva', faixa: 'B', nota: 60 },
  ]
  const r = filtrar(lista, { ...FILTRO_VAZIO, dias: null, ordem: 'faixa' }, { busca: ['nome'] })
  assert.deepEqual(r.map((s) => s.codigo), ['STY-4', 'STY-3', 'STY-5', 'STY-1', 'STY-2'])
})
