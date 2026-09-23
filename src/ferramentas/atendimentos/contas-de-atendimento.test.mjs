import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTAM_NA_TAXA, SITUACOES, SELO_DE_ENSAIO, resumoDosAtendimentos, comprasDaVisita,
  porDia, janelaDoPeriodo, diaLocal, horaCurta, diaCurto, telefoneLegivel,
  marcacoesDe, podeCancelar,
} from './contas-de-atendimento.js'

const HOJE = new Date(2026, 8, 17) // 17/09/2026, meia-noite LOCAL

test('⚠️ pedido de horário NÃO conta como agendamento (módulo 16 do plano)', () => {
  // Contar `solicitado` afundaria a taxa com gente que nunca teve horário.
  assert.ok(!CONTAM_NA_TAXA.includes('solicitado'))
  const r = resumoDosAtendimentos([
    { status: 'solicitado' }, { status: 'solicitado' },
    { status: 'confirmado' }, { status: 'realizado' },
  ])
  assert.equal(r.naBase, 2, 'só confirmado + realizado entram na base')
  assert.equal(r.pediramHorario, 2)
  assert.equal(r.taxa, 0.5)
})

test('remarcado e cancelado ficam de fora — senão a mesma pessoa conta duas vezes', () => {
  const r = resumoDosAtendimentos([
    { status: 'remarcado' }, { status: 'cancelado' }, { status: 'realizado' },
  ])
  assert.equal(r.naBase, 1)
  assert.equal(r.taxa, 1)
  assert.equal(r.total, 3, 'a lista continua mostrando os três')
})

test('⚠️ sem base a taxa é NULA, nunca zero', () => {
  // 0% é um fato ("marcaram e ninguém veio"); "ainda não dá para dizer" é
  // outro. Mostrar 0% numa semana vazia manda a loja correr atrás de nada.
  assert.equal(resumoDosAtendimentos([]).taxa, null)
  assert.equal(resumoDosAtendimentos([{ status: 'solicitado' }]).taxa, null)
  assert.equal(resumoDosAtendimentos([{ status: 'no_show' }]).taxa, 0, 'aqui 0% é verdade')
})

test('a janela mostra o que ainda VAI acontecer, não só o que passou', () => {
  const semana = janelaDoPeriodo('semana', HOJE)
  assert.equal(semana.de, '2026-09-10')
  assert.equal(semana.ate, '2026-09-24')
  assert.deepEqual(janelaDoPeriodo('hoje', HOJE), { de: '2026-09-17', ate: '2026-09-17' })
  assert.equal(janelaDoPeriodo('proximos', HOJE).de, '2026-09-17')
})

test('⚠️ o dia sai do calendário LOCAL, não de UTC', () => {
  // 23h do dia 17 em Campinas é 02h do dia 18 em UTC. `toISOString` diria 18.
  assert.equal(diaLocal(new Date(2026, 8, 17, 23, 30)), '2026-09-17')
  assert.equal(diaLocal('nao-e-data'), null)
})

test('a compra casa da visita até 7 dias depois — e nunca ANTES', () => {
  const visita = { pessoa_id: 7, quando: '2026-09-22T18:00:00Z' }
  const pedidos = [
    { pessoa_id: 7, data_da_venda: '2026-09-21', receita_liquida: 900 },  // antes: fora
    { pessoa_id: 7, data_da_venda: '2026-09-22', receita_liquida: 1400 }, // no dia
    { pessoa_id: 7, data_da_venda: '2026-09-29', receita_liquida: 100 },  // 7 dias: dentro
    { pessoa_id: 7, data_da_venda: '2026-09-30', receita_liquida: 500 },  // 8 dias: fora
    { pessoa_id: 9, data_da_venda: '2026-09-22', receita_liquida: 999 },  // outra pessoa
  ]
  const r = comprasDaVisita(visita, pedidos)
  assert.equal(r.total, 1500)
  assert.equal(r.pedidos.length, 2)
})

test('⚠️ a conta usa a receita LÍQUIDA, não o total do Bling', () => {
  // O `total_do_bling` não desconta o desconto do ITEM e sai ~6% maior — usá-lo
  // inflaria a conversão de toda visita.
  const visita = { pessoa_id: 1, quando: '2026-09-22T12:00:00Z' }
  const r = comprasDaVisita(visita, [
    { pessoa_id: 1, data_da_venda: '2026-09-22', receita_liquida: 1000, total_do_bling: 1060 },
  ])
  assert.equal(r.total, 1000)
})

test('visita sem pessoa ou sem data não inventa compra', () => {
  assert.deepEqual(comprasDaVisita({ quando: '2026-09-22' }, [{ pessoa_id: 1 }]), { pedidos: [], total: 0 })
  assert.deepEqual(comprasDaVisita({ pessoa_id: 1 }, []), { pedidos: [], total: 0 })
  assert.deepEqual(comprasDaVisita(null, null), { pedidos: [], total: 0 })
})

test('a lista vem por dia, do mais recente para o mais antigo', () => {
  const g = porDia([
    { id: 1, quando: '2026-09-20T14:00:00Z' },
    { id: 2, quando: '2026-09-22T11:00:00Z' },
    { id: 3, quando: '2026-09-22T19:00:00Z' },
  ])
  assert.deepEqual(g.map((x) => x.dia), ['2026-09-22', '2026-09-20'])
  assert.deepEqual(g[0].itens.map((x) => x.id), [3, 2], 'dentro do dia, o mais tarde primeiro')
})

test('atendimento sem data não some da lista', () => {
  // Sumir da tela é pior que aparecer sem data: ninguém procura o que não sabe
  // que existe.
  const g = porDia([{ id: 1 }])
  assert.equal(g.length, 1)
  assert.equal(g[0].dia, 'sem-data')
  assert.equal(diaCurto('sem-data'), 'sem data')
})

test('telefone sai legível, com e sem o 55 na frente', () => {
  assert.equal(telefoneLegivel('5519996170272'), '(19) 99617-0272')
  assert.equal(telefoneLegivel('19996170272'), '(19) 99617-0272')
  assert.equal(telefoneLegivel('1936541234'), '(19) 3654-1234')
  assert.equal(telefoneLegivel(''), '')
})

test('hora e dia curtos', () => {
  assert.equal(horaCurta(new Date(2026, 8, 22, 15, 30).toISOString()), '15:30')
  assert.equal(horaCurta(null), '')
  assert.equal(horaCurta('nao-e-data'), '')
  assert.equal(diaCurto('2026-09-22', HOJE), '22/09')
  assert.equal(diaCurto('2025-09-22', HOJE), '22/09/2025', 'ano que não é o corrente aparece')
})

test('⚠️ toda classe de selo usada EXISTE na folha de estilos', async () => {
  // Classe de CSS que não existe não dá erro: ela simplesmente não pinta. Na
  // primeira versão desta tela eu escrevi `selo-aviso`, que não existe, e os
  // selos "Confirmado" e "ensaio" saíram sem cor — só apareceu na foto.
  const { readFileSync } = await import('node:fs')
  const folha = readFileSync(new URL('../../estilos/estilos-globais.css', import.meta.url), 'utf8')
  const usadas = [...Object.values(SITUACOES).map((s) => s.selo), SELO_DE_ENSAIO]
  for (const classe of usadas)
    assert.ok(folha.includes(`.${classe}`), `${classe} não existe em estilos-globais.css`)
})

test('FIAÇÃO: cada situação tem um tom, e o tom tem a classe na folha comum', async () => {
  // Mesma armadilha do `selo-aviso`: `id-tom-x` que não existe não dá erro, o
  // filete do cartão só deixa de aparecer.
  const { readFileSync } = await import('node:fs')
  const folha = readFileSync(new URL('../../estilos/identidade-da-ferramenta.css', import.meta.url), 'utf8')
  for (const [k, s] of Object.entries(SITUACOES)) {
    assert.ok(s.tom, `${k} sem tom`)
    assert.match(folha, new RegExp(`\\.id-tom-${s.tom}\\s*\\{`), `falta .id-tom-${s.tom}`)
  }
  assert.equal(SITUACOES.no_show.tom, 'faltou')
  assert.equal(SITUACOES.realizado.tom, 'viva')
})

test('a linha nunca oferece o que ela já é', () => {
  assert.deepEqual(marcacoesDe('realizado').map((m) => m.situacao), ['no_show', 'remarcado'])
  assert.deepEqual(marcacoesDe('no_show').map((m) => m.situacao), ['realizado', 'remarcado'])
  assert.deepEqual(marcacoesDe('confirmado').map((m) => m.situacao), ['realizado', 'no_show', 'remarcado'])
})

test('⚠️ cancelar por engano TEM volta: a linha cancelada oferece as três', () => {
  // Esconder as marcações de uma linha cancelada transformaria um clique errado
  // em linha morta para sempre.
  assert.deepEqual(marcacoesDe('cancelado').map((m) => m.situacao), ['realizado', 'no_show', 'remarcado'])
  assert.equal(podeCancelar('cancelado'), false, 'mas cancelar de novo não faz sentido')
  assert.equal(podeCancelar('confirmado'), true)
})

test('⚠️ cancelado SAI da taxa — é o conserto do convite repetido', () => {
  // Dois cartões para a mesma cliente no mesmo dia: o fantasma contava como
  // alguém que não veio e afundava a taxa.
  const antes = resumoDosAtendimentos([{ status: 'confirmado' }, { status: 'confirmado' }, { status: 'realizado' }])
  assert.equal(antes.naBase, 3)
  assert.equal(Math.round(antes.taxa * 100), 33)
  const depois = resumoDosAtendimentos([{ status: 'cancelado' }, { status: 'confirmado' }, { status: 'realizado' }])
  assert.equal(depois.naBase, 2)
  assert.equal(depois.taxa, 0.5)
})
