import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  timesDaPessoa, oQueVeDeVendas, podeMudarEscopo, avisoDaMudancaDeEscopo,
} from './acesso-do-membro.js'

// Os times e canais REAIS, como ficaram no banco em 04/08/2026 — o mesmo
// conjunto que equipes.test.mjs usa, para as duas suítes não contarem
// histórias diferentes sobre a mesma loja.
const TIVOLI = { id: 't1', nome: 'Tivoli', tipo: 'loja', canal_loja_id: 205834140 }
const DOMPEDRO = { id: 't2', nome: 'Dom Pedro', tipo: 'loja', canal_loja_id: 205657609 }
const IGUATEMI = { id: 't3', nome: 'Iguatemi Campinas', tipo: 'loja', canal_loja_id: null }
const TIMES = [TIVOLI, DOMPEDRO, IGUATEMI]
const CANAIS = [
  { loja_id: 205834140, nome: "Loja Santa Bárbara d'Oeste" },
  { loja_id: 205657609, nome: 'Loja Dom Pedro' },
]

const PRESA = { id: 'u1', name: 'Vendedora', escopo_por_equipe: true }
const SOLTA = { id: 'u2', name: 'Viewer antigo', escopo_por_equipe: false }

// ── Os times da pessoa ──────────────────────────────────────────────────────

test('devolve os times em que a pessoa esta, e so eles', () => {
  const membros = [
    { equipe_id: 't1', profile_id: 'u1', papel: 'vendedora' },
    { equipe_id: 't2', profile_id: 'u9', papel: 'vendedora' },
  ]
  assert.deepEqual(timesDaPessoa('u1', TIMES, membros).map((t) => t.nome), ['Tivoli'])
  assert.deepEqual(timesDaPessoa('u9', TIMES, membros).map((t) => t.nome), ['Dom Pedro'])
  assert.deepEqual(timesDaPessoa('u1', TIMES, []), [])
})

test('id nulo nao devolve time nenhum (e nao devolve TODOS)', () => {
  // O erro que este teste fecha: `String(undefined) === String(undefined)`
  // casaria membro sem profile_id, e a pessoa "sem id" herdaria times.
  const membros = [{ equipe_id: 't1', profile_id: null, papel: 'vendedora' }]
  assert.deepEqual(timesDaPessoa(null, TIMES, membros), [])
  assert.deepEqual(timesDaPessoa(undefined, TIMES, membros), [])
})

test('o id vem como texto ou como numero e da no mesmo', () => {
  const membros = [{ equipe_id: 7, profile_id: 42 }]
  const times = [{ id: '7', nome: 'Sete', canal_loja_id: null }]
  assert.deepEqual(timesDaPessoa('42', times, membros).map((t) => t.nome), ['Sete'])
})

// ── A frase do acesso às vendas ─────────────────────────────────────────────

test('quem NAO esta limitada ve todos os canais, mesmo sem time', () => {
  const r = oQueVeDeVendas({ pessoa: SOLTA, times: TIMES, membros: [], canais: CANAIS })
  assert.equal(r.presa, false)
  assert.match(r.frase, /TODOS os canais/)
  assert.equal(r.grave, false)
})

test('limitada e sem time nenhum: nao ve venda nenhuma, e isso e GRAVE', () => {
  // É o estado em que toda conta nova nasce (`escopo_por_equipe` default true).
  // Sem esta frase, a pessoa entra, vê tudo zerado, e abre chamado.
  const r = oQueVeDeVendas({ pessoa: PRESA, times: TIMES, membros: [], canais: CANAIS })
  assert.equal(r.presa, true)
  assert.equal(r.grave, true)
  assert.match(r.frase, /Não vê venda nenhuma/)
  assert.match(r.frase, /não está em time nenhum/)
})

test('limitada e com time: diz o NOME DO CANAL, que nao e o nome da casa', () => {
  // O nó que define este sistema: o time "Tivoli" vende pelo canal "Loja Santa
  // Bárbara d'Oeste". Mostrar só "Tivoli" esconde justamente a amarra que faz
  // o faturamento aparecer.
  const membros = [{ equipe_id: 't1', profile_id: 'u1' }]
  const r = oQueVeDeVendas({ pessoa: PRESA, times: TIMES, membros, canais: CANAIS })
  assert.equal(r.frase, "Vê as vendas de: Loja Santa Bárbara d'Oeste (time Tivoli).")
  assert.equal(r.grave, false)
})

test('dois times somam os dois canais', () => {
  const membros = [{ equipe_id: 't1', profile_id: 'u1' }, { equipe_id: 't2', profile_id: 'u1' }]
  const r = oQueVeDeVendas({ pessoa: PRESA, times: TIMES, membros, canais: CANAIS })
  assert.match(r.frase, /Loja Santa Bárbara d'Oeste \(time Tivoli\)/)
  assert.match(r.frase, /Loja Dom Pedro \(time Dom Pedro\)/)
  assert.equal(r.itens.length, 2)
})

test('time SEM canal do Bling e dito por escrito, e sozinho zera a venda', () => {
  // O caso que MAIS confunde: tudo parece certo, ela está no time, e o
  // faturamento aparece zerado.
  const membros = [{ equipe_id: 't3', profile_id: 'u1' }]
  const r = oQueVeDeVendas({ pessoa: PRESA, times: TIMES, membros, canais: CANAIS })
  assert.equal(r.grave, true)
  assert.match(r.frase, /Não vê venda nenhuma/)
  assert.match(r.frase, /Iguatemi Campinas/)
  assert.match(r.frase, /não tem canal do Bling/)
})

test('um time com canal e outro sem: mostra o que ve E avisa do que falta', () => {
  const membros = [{ equipe_id: 't1', profile_id: 'u1' }, { equipe_id: 't3', profile_id: 'u1' }]
  const r = oQueVeDeVendas({ pessoa: PRESA, times: TIMES, membros, canais: CANAIS })
  assert.equal(r.grave, false)
  assert.match(r.frase, /Loja Santa Bárbara d'Oeste/)
  assert.match(r.frase, /O time Iguatemi Campinas não tem canal do Bling/)
})

test('canal que a lista de canais nao conhece nao vira frase muda', () => {
  // `bling_lojas` pode não ter carregado (ou o canal ter sido apagado lá).
  // Dizer "Vê as vendas de: (time Tivoli)" seria pior que dizer o número.
  const membros = [{ equipe_id: 't1', profile_id: 'u1' }]
  const r = oQueVeDeVendas({ pessoa: PRESA, times: TIMES, membros, canais: [] })
  assert.match(r.frase, /canal 205834140 \(time Tivoli\)/)
})

test('coluna ausente vale como LIMITADA, nunca como "ve tudo"', () => {
  // Se alguém esquecer `escopo_por_equipe` no select, a tela não pode dizer
  // que a pessoa vê tudo. Errar para o lado restritivo é o erro barato.
  const r = oQueVeDeVendas({ pessoa: { id: 'u3', name: 'Sem coluna' }, times: TIMES, membros: [], canais: CANAIS })
  assert.equal(r.presa, true)
  const rNulo = oQueVeDeVendas({ pessoa: { id: 'u3', escopo_por_equipe: null }, times: TIMES, membros: [], canais: CANAIS })
  assert.equal(rNulo.presa, true)
})

// ── Quem pode mexer na chave ────────────────────────────────────────────────

test('so o dono mexe no escopo — nem o gestor do time', () => {
  // Desligar o escopo abre TODOS os canais, inclusive os de times que quem
  // clica não administra. É a regra de ouro dos times ao contrário.
  assert.equal(podeMudarEscopo({ is_superadmin: true }), true)
  assert.equal(podeMudarEscopo({ is_superadmin: false }), false)
  assert.equal(podeMudarEscopo(null), false)
})

test('o aviso diz o TAMANHO do estrago, nos dois sentidos', () => {
  // A pessoa do fixture precisa ESTAR no time do fixture: `u2` (SOLTA) é quem
  // está prestes a ser fechada, então é o profile_id que o membro carrega.
  const membros = [{ equipe_id: 't1', profile_id: 'u1' }, { equipe_id: 't1', profile_id: 'u2' }]
  const abrir = avisoDaMudancaDeEscopo({ pessoa: PRESA, ligar: false, times: TIMES, membros })
  assert.match(abrir, /TODOS os canais/)
  assert.match(abrir, /sistema inteiro/)
  const fechar = avisoDaMudancaDeEscopo({ pessoa: SOLTA, ligar: true, times: TIMES, membros })
  assert.match(fechar, /SOMENTE as vendas dos times dela/)
  assert.match(fechar, /Tivoli/)
})

test('fechar o escopo de quem nao tem time avisa que ela fica sem NADA', () => {
  const r = avisoDaMudancaDeEscopo({ pessoa: SOLTA, ligar: true, times: TIMES, membros: [] })
  assert.match(r, /sem ver venda alguma/)
})
