import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DURACAO_DO_PRIVATE_EDIT_EM_HORAS, CHAVES_DO_ITEM, hojeEmSaoPaulo, somarDias, diaDaSemana, gradeDoMes,
  limitesDoMes, periodoParaPedir, diasDaLista, outroMes, nomeDoMes, diaPorExtenso, agruparPorDia,
  lugaresDaAgenda, filtrarAgenda, sobrepoe, diaTemSobreposicao, linhaDoItem, horarioDoItem, detalhesDoItem,
  linhaDoConflito, linhaDoContexto, valoresQueFicam, mudouHoraOuLugar, nomeDoLugar,
} from './agenda-regras.js'

/* ⚠️ AS AMOSTRAS TÊM A FORMA DA RESPOSTA DE VERDADE (`vessel_agenda_das_lojas`):
 * as 18 chaves, nenhuma a mais, montadas por `item()` a partir de
 * `CHAVES_DO_ITEM` — a mesma lista que o aplicador da migration confere no
 * banco. Campo a mais na amostra é teste provando uma realidade que não existe
 * (memória "teste com a forma real da resposta"). */
const item = (o) => {
  const base = Object.fromEntries(CHAVES_DO_ITEM.map((k) => [k, null]))
  for (const k of Object.keys(o)) assert.ok(CHAVES_DO_ITEM.includes(k), `amostra com chave que o banco não manda: ${k}`)
  return { ...base, ...o }
}
const PE = (o) => item({ tipo: 'private_edit', sobrepoe: [], ...o })

test('a duração do encontro: 4 horas, e o banco diz o MESMO número', () => {
  assert.equal(DURACAO_DO_PRIVATE_EDIT_EM_HORAS, 4)
  const sql = readFileSync(new URL('../../../db/migrations/2026-09-25-vessel-agenda-do-private-edit.sql', import.meta.url), 'utf8')
  const m = /function public\.vessel_private_edit_duracao\(\)[\s\S]*?select interval '(\d+) hours'/.exec(sql)
  assert.ok(m, 'a migration não tem a duração no lugar de sempre')
  assert.equal(Number(m[1]), DURACAO_DO_PRIVATE_EDIT_EM_HORAS, 'a tela e o banco discordam da duração')
})

test('o hoje é o de São Paulo: 23h30 de Campinas ainda é o mesmo dia (em UTC já é o seguinte)', () => {
  assert.equal(hojeEmSaoPaulo(new Date('2026-09-24T23:30:00-03:00')), '2026-09-24')
  assert.equal(hojeEmSaoPaulo(new Date('2026-09-25T02:30:00Z')), '2026-09-24')
  assert.equal(hojeEmSaoPaulo(new Date('2026-09-25T03:00:00Z')), '2026-09-25')
})

test('contas de calendário: somar dias atravessa mês e ano; a semana começa no domingo', () => {
  assert.equal(somarDias('2026-09-30', 1), '2026-10-01')
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01')
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28')
  assert.equal(diaDaSemana('2026-09-27'), 0) // domingo
  assert.equal(diaDaSemana('2026-09-25'), 5) // sexta
  assert.deepEqual(outroMes({ ano: 2026, mes: 12 }, 1), { ano: 2027, mes: 1 })
  assert.deepEqual(outroMes({ ano: 2026, mes: 1 }, -1), { ano: 2025, mes: 12 })
  assert.equal(nomeDoMes({ ano: 2026, mes: 9 }), 'Setembro de 2026')
  assert.equal(diaPorExtenso('2026-09-25'), 'sexta, 25 de setembro')
})

test('a grade do mês: semanas inteiras, de domingo a sábado, com as bordas', () => {
  const g = gradeDoMes({ ano: 2026, mes: 9 }) // 1º/09/2026 é terça
  assert.equal(g[0][0], '2026-08-30')
  assert.equal(g.at(-1)[6], '2026-10-03')
  assert.ok(g.every((s) => s.length === 7 && diaDaSemana(s[0]) === 0))
  assert.ok(g.flat().includes('2026-09-30'))
  assert.deepEqual(limitesDoMes({ ano: 2026, mes: 2 }), { de: '2026-02-01', ate: '2026-02-28' })
})

test('o período pedido ao banco: a grade, e no mês de hoje também os próximos 30 dias', () => {
  assert.deepEqual(periodoParaPedir({ ano: 2026, mes: 9 }, '2026-09-24'), { de: '2026-08-30', ate: '2026-10-24' })
  assert.deepEqual(periodoParaPedir({ ano: 2026, mes: 11 }, '2026-09-24'), { de: '2026-11-01', ate: '2026-12-05' })
})

test('a lista do celular: no mês de hoje, de hoje a 30 dias; nos outros, o mês inteiro — só dias com alguma coisa', () => {
  const porDia = agruparPorDia([PE({ dia: '2026-09-20', hora: '19:00' }), PE({ dia: '2026-09-25', hora: '19:00' }),
    PE({ dia: '2026-10-24', hora: '10:00' }), PE({ dia: '2026-10-25', hora: '10:00' })])
  assert.deepEqual(diasDaLista(porDia, { ano: 2026, mes: 9 }, '2026-09-24'), ['2026-09-25', '2026-10-24'])
  assert.deepEqual(diasDaLista(porDia, { ano: 2026, mes: 10 }, '2026-09-24'), ['2026-10-24', '2026-10-25'])
})

test('⚠️ o dia é o que o BANCO diz, nunca o do `inicio`: o encontro das 22h fica no dia dele', () => {
  // 22h de 25/09 em São Paulo = 01h UTC de 26/09. A tela agrupa por `dia`.
  const pe = PE({ codigo: 'PE-20260925-CPS-01', dia: '2026-09-25', hora: '22:00', hora_fim: '02:00',
    inicio: '2026-09-26T01:00:00+00:00', fim: '2026-09-26T05:00:00+00:00', loja: 'iguatemi', lugar: 'iguatemi' })
  const porDia = agruparPorDia([pe])
  assert.deepEqual([...porDia.keys()], ['2026-09-25'])
  const fonte = readFileSync(new URL('./agenda-regras.js', import.meta.url), 'utf8')
  assert.ok(!/\.getDate\(\)|\.getHours\(\)/.test(fonte), 'a agenda não pode tirar dia/hora do relógio do navegador')
})

test('agrupar: dentro do dia, a sessão (o dia todo) primeiro, depois pela hora', () => {
  const porDia = agruparPorDia([
    item({ tipo: 'private_appointment', id: 9, dia: '2026-09-25', hora: '10:00', loja: 'iguatemi', lugar: 'iguatemi' }),
    PE({ codigo: 'PE-B', dia: '2026-09-25', hora: '19:00', loja: 'iguatemi' }),
    item({ tipo: 'beauty_session', codigo: 'BS-1', dia: '2026-09-25', loja: 'iguatemi', lugar: 'iguatemi' }),
  ])
  assert.deepEqual(porDia.get('2026-09-25').map((i) => i.tipo), ['beauty_session', 'private_appointment', 'private_edit'])
})

test('o filtro de loja sai do que veio; sem loja, o lugar do banco (praça + lugar escrito)', () => {
  const itens = [
    PE({ codigo: 'A', dia: '2026-09-25', loja: 'iguatemi', praca: 'CPS', lugar: 'iguatemi' }),
    PE({ codigo: 'B', dia: '2026-09-25', loja: null, praca: 'CPS', local: 'Hotel X', lugar: 'praca:CPS|hotel x' }),
    item({ tipo: 'beauty_session', codigo: 'BS', dia: '2026-09-25', loja: 'tivoli', praca: 'SBO', lugar: 'tivoli' }),
  ]
  assert.deepEqual(lugaresDaAgenda(itens), [
    { chave: 'praca:CPS|hotel x', rotulo: 'Campinas · Hotel X' },
    { chave: 'iguatemi', rotulo: 'Iguatemi' },
    { chave: 'tivoli', rotulo: 'Tivoli' },
  ])
  assert.deepEqual(filtrarAgenda(itens, { lugar: 'iguatemi', soPrivateEdit: false }).map((i) => i.codigo), ['A'])
  assert.deepEqual(filtrarAgenda(itens, { lugar: '', soPrivateEdit: true }).map((i) => i.codigo), ['A', 'B'])
  assert.equal(nomeDoLugar(item({ tipo: 'private_edit' })), 'Sem lugar')
})

test('sobrepõe: só Private Edit com a lista cheia; sessão e visita nunca são conflito', () => {
  assert.equal(sobrepoe(PE({ sobrepoe: ['PE-X'] })), true)
  assert.equal(sobrepoe(PE({ sobrepoe: [] })), false)
  assert.equal(sobrepoe(item({ tipo: 'beauty_session', sobrepoe: null })), false)
  assert.equal(diaTemSobreposicao([item({ tipo: 'beauty_session' }), PE({ sobrepoe: ['PE-X'] })]), true)
  assert.equal(diaTemSobreposicao([PE({ sobrepoe: [] })]), false)
})

test('as linhas do chip e do quadrinho — sem o nome da cliente na visita', () => {
  const pe = PE({ hora: '19:00', hora_fim: '23:00', anfitria: 'Marina (exemplo)', loja: 'iguatemi' })
  assert.equal(linhaDoItem(pe), '19:00 · Marina (exemplo) · Iguatemi')
  assert.equal(horarioDoItem(pe), '19:00–23:00')
  const bs = item({ tipo: 'beauty_session', codigo: 'BS-1', dia: '2026-09-29', loja: 'iguatemi', parceiro: null, status: 'aberta' })
  assert.equal(linhaDoItem(bs), 'o dia todo · Beauty Session · Iguatemi')
  assert.equal(horarioDoItem(bs), 'O dia todo')
  assert.deepEqual(detalhesDoItem(bs), [['Quando', '29/09/2026 · O dia todo'], ['Loja', 'Iguatemi'],
    ['Parceiro', 'Ainda sem o nome confirmado'], ['Código', 'BS-1'], ['Situação', 'Aberta']])
  const pa = item({ tipo: 'private_appointment', id: 5, dia: '2026-09-26', hora: '16:00', loja: 'tivoli', client_advisor: 'Beatriz', status: 'confirmado' })
  assert.equal(linhaDoItem(pa), '16:00 · Private Appointment — Beatriz · Tivoli')
  assert.equal(horarioDoItem(pa), '16:00')
  assert.deepEqual(detalhesDoItem(pa).map(([k]) => k), ['Quando', 'Loja', 'Client Advisor', 'Situação'])
})

test('o aviso: cada encontro que cruza com código, anfitriã, loja e horário; a nota do resto', () => {
  // A forma de `vessel_encontros_que_sobrepoem` (o `sobrepoe` da resposta de criar/editar/perguntar).
  const o = { codigo: 'PE-20260929-CPS-01', stylist: 'STY-0001', anfitria: 'Marina (exemplo)', inicio: '', fim: '',
    dia: '2026-09-29', hora: '19:00', hora_fim: '23:00', loja: 'iguatemi', praca: 'CPS', local: null, status: 'agendado' }
  assert.equal(linhaDoConflito(o), 'PE-20260929-CPS-01 · Marina (exemplo) · Iguatemi · 29/09/2026 19:00–23:00')
  assert.equal(linhaDoContexto({ tipo: 'beauty_session', codigo: 'BS', dia: '2026-09-29', hora: null, loja: 'iguatemi',
    praca: 'CPS', parceiro: 'Salão (exemplo)', client_advisor: null, status: null }),
  'Beauty Session — Salão (exemplo) no mesmo dia (Iguatemi)')
  assert.equal(linhaDoContexto({ tipo: 'private_appointment', codigo: null, dia: '2026-09-29', hora: '20:30', loja: 'iguatemi',
    praca: null, parceiro: null, client_advisor: 'Carolina', status: 'confirmado' }),
  'Private Appointment às 20:30 com Carolina (Iguatemi)')
})

test('editar: o que vale é o que vai ficar gravado (campo vazio = "não mexe"), e só confere se mudou', () => {
  const e = { codigo: 'PE-1', quando: '2026-09-29T22:00:00.000Z', loja: 'iguatemi', praca: 'CPS', local: 'Loja' }
  const ficam = valoresQueFicam(e, { loja: '', praca: '', local: '' }, null)
  assert.deepEqual(ficam, { quando: e.quando, loja: 'iguatemi', praca: 'CPS', local: 'Loja' })
  assert.equal(mudouHoraOuLugar(e, ficam), false)
  assert.equal(mudouHoraOuLugar(e, valoresQueFicam(e, {}, '2026-09-29T19:00:00-03:00')), false, 'a mesma hora escrita de outro jeito não é mudança')
  assert.equal(mudouHoraOuLugar(e, valoresQueFicam(e, {}, '2026-09-29T20:00:00-03:00')), true)
  assert.equal(mudouHoraOuLugar(e, valoresQueFicam(e, { loja: 'tivoli' }, null)), true)
  const semLoja = { ...e, loja: null, local: 'Hotel X' }
  assert.equal(mudouHoraOuLugar(semLoja, valoresQueFicam(semLoja, { local: '  hotel   x ' }, null)), false,
    'sem loja, o lugar compara como o banco: sem maiúscula nem espaço a mais')
})
