import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ultimaRevisao, estadoDaRevisao, revisoesDoVeiculo, resumoDeRevisoes,
  problemasDoItem, avisoAoDesativar, FATIA_DE_AVISO, ordenarCarrosPorUrgencia,
} from './revisoes.js'

const PLANO = [
  { id: 'a', item: 'Troca de óleo', a_cada_km: 7000, ativo: true },
  { id: 'b', item: 'Correia dentada', a_cada_km: 60000, ativo: true },
  { id: 'c', item: 'Item desligado', a_cada_km: 1000, ativo: false },
]
const CARRO = { id: 'v1', nome: 'Fiat Doblo' }

test('a última troca é a de MAIOR quilometragem, não a de data mais nova', () => {
  // Data digitada errada acontece o tempo todo; o odômetro só anda pra frente.
  const revs = [
    { veiculo_id: 'v1', item: 'Troca de óleo', km: 130000, feita_em: '2026-07-01' },
    { veiculo_id: 'v1', item: 'Troca de óleo', km: 120000, feita_em: '2026-12-01' },
  ]
  assert.equal(ultimaRevisao(revs, 'v1', 'Troca de óleo').km, 130000)
})

test('revisão de outro carro ou de outro item não conta', () => {
  const revs = [
    { veiculo_id: 'v2', item: 'Troca de óleo', km: 999999 },
    { veiculo_id: 'v1', item: 'Velas', km: 999999 },
  ]
  assert.equal(ultimaRevisao(revs, 'v1', 'Troca de óleo'), null)
  assert.equal(ultimaRevisao([], 'v1', 'Troca de óleo'), null)
  assert.equal(ultimaRevisao(null, 'v1', 'x'), null)
})

test('revisão sem KM registrado é ignorada — não vira zero', () => {
  // Tratar como zero diria "trocou com 0 km" e deixaria tudo vencido pra sempre.
  const revs = [{ veiculo_id: 'v1', item: 'Troca de óleo', km: null, feita_em: '2026-07-01' }]
  assert.equal(ultimaRevisao(revs, 'v1', 'Troca de óleo'), null)
})

/* ── A conta ─────────────────────────────────────────────────────────────── */

test('em dia: falta bastante', () => {
  const e = estadoDaRevisao({ item: 'Troca de óleo', aCadaKm: 7000, ultimaKm: 100000, kmAtual: 102000 })
  assert.equal(e.situacao, 'em-dia')
  assert.equal(e.alvo, 107000)
  assert.equal(e.faltam, 5000)
  assert.match(e.texto, /Faltam 5\.000 km/)
})

test('o aviso é PROPORCIONAL ao intervalo, não um número fixo', () => {
  // 500 km antes seria tarde pra uma correia e cedo demais pro óleo.
  const oleo = estadoDaRevisao({ item: 'Troca de óleo', aCadaKm: 7000, ultimaKm: 100000, kmAtual: 106400 })
  assert.equal(oleo.situacao, 'perto', 'faltando 600 de 7.000 já avisa')

  const correia = estadoDaRevisao({ item: 'Correia dentada', aCadaKm: 60000, ultimaKm: 100000, kmAtual: 154000 })
  assert.equal(correia.situacao, 'perto', 'faltando 6.000 de 60.000 avisa')

  const correiaLonge = estadoDaRevisao({ item: 'Correia dentada', aCadaKm: 60000, ultimaKm: 100000, kmAtual: 150000 })
  assert.equal(correiaLonge.situacao, 'em-dia', 'faltando 10.000 de 60.000 ainda não')
  assert.equal(FATIA_DE_AVISO, 0.10)
})

test('vencida diz QUANTO passou, não só que passou', () => {
  const e = estadoDaRevisao({ item: 'Troca de óleo', aCadaKm: 7000, ultimaKm: 100000, kmAtual: 108500 })
  assert.equal(e.situacao, 'vencida')
  assert.match(e.texto, /Passou 1\.500 km/)
})

test('bater exatamente no alvo já é vencida', () => {
  const e = estadoDaRevisao({ item: 'Troca de óleo', aCadaKm: 7000, ultimaKm: 100000, kmAtual: 107000 })
  assert.equal(e.situacao, 'vencida')
})

test('sem quilometragem do carro, NÃO inventa alerta', () => {
  // O Fiesta Sedan e o Honda Fit estão assim na planilha. Chutar "vencida"
  // faria a pessoa levar o carro à oficina à toa.
  const e = estadoDaRevisao({ item: 'Troca de óleo', aCadaKm: 7000, ultimaKm: 100000, kmAtual: null })
  assert.equal(e.situacao, 'sem-km')
  assert.equal(e.alvo, null)
  assert.match(e.texto, /primeira devolução/)
})

test('sem histórico da troca, diz isso em vez de fingir que está em dia', () => {
  const e = estadoDaRevisao({ item: 'Troca de óleo', aCadaKm: 7000, ultimaKm: null, kmAtual: 100000 })
  assert.equal(e.situacao, 'sem-registro')
  assert.match(e.texto, /Nunca foi registrada/)
})

/* ── A lista de um carro ─────────────────────────────────────────────────── */

test('item desativado sai da conta', () => {
  const itens = revisoesDoVeiculo({ veiculo: CARRO, kmAtual: 100000, plano: PLANO, revisoes: [] })
  assert.ok(!itens.some((i) => i.item === 'Item desligado'))
  assert.equal(itens.length, 2)
})

test('plano vazio: revisoesDoVeiculo já devolve [], então "Chegando a hora" some o carro sozinho', () => {
  // Confirma (não supõe) que o card de plano vazio fica invisível em
  // "Chegando a hora" mesmo com resumoDeRevisoes([]) agora dando 'sem-registro'
  // em vez de 'em-dia'. tela-de-frota.vue monta `revisoesPorVeiculo` assim:
  //   const todos = revisoesDoVeiculo({ veiculo, kmAtual, plano, revisoes })
  //   const itens = todos.filter((i) => i.situacao === 'vencida' || i.situacao === 'perto')
  //   ...depois: .filter((r) => r.itens.length)
  // Com plano:[], `revisoesDoVeiculo` já não tem itens pra devolver — logo
  // `itens` fica [] independente do nível do resumo, e o `.filter` final tira
  // o carro da lista. O card só aparece na sanfona "Todos os carros" (D30),
  // que não tem esse filtro — e é lá que precisa dizer "Sem plano de revisão".
  const todos = revisoesDoVeiculo({ veiculo: CARRO, kmAtual: 100000, plano: [], revisoes: [] })
  assert.deepEqual(todos, [])
  const itens = todos.filter((i) => i.situacao === 'vencida' || i.situacao === 'perto')
  assert.equal(itens.length, 0, '"Chegando a hora" descarta este carro pelo itens.length, não pelo nivel')
})

test('o que dói primeiro aparece primeiro', () => {
  const revisoes = [
    { veiculo_id: 'v1', item: 'Troca de óleo', km: 90000 },      // vencida
    { veiculo_id: 'v1', item: 'Correia dentada', km: 99000 },     // em dia
  ]
  const itens = revisoesDoVeiculo({ veiculo: CARRO, kmAtual: 100000, plano: PLANO, revisoes })
  assert.deepEqual(itens.map((i) => i.situacao), ['vencida', 'em-dia'])
})

test('duas vencidas: a mais atrasada primeiro', () => {
  const plano = [
    { item: 'A', a_cada_km: 7000, ativo: true },
    { item: 'B', a_cada_km: 7000, ativo: true },
  ]
  const revisoes = [
    { veiculo_id: 'v1', item: 'A', km: 90000 },   // passou 3.000
    { veiculo_id: 'v1', item: 'B', km: 85000 },   // passou 8.000
  ]
  const itens = revisoesDoVeiculo({ veiculo: CARRO, kmAtual: 100000, plano, revisoes })
  assert.deepEqual(itens.map((i) => i.item), ['B', 'A'])
})

test('o resumo do cartão: vencida ganha de "chegando"', () => {
  assert.equal(resumoDeRevisoes([{ situacao: 'vencida' }, { situacao: 'perto' }]).nivel, 'vencida')
  assert.equal(resumoDeRevisoes([{ situacao: 'vencida' }, { situacao: 'vencida' }]).texto, '2 revisões vencidas')
  assert.equal(resumoDeRevisoes([{ situacao: 'perto' }, { situacao: 'em-dia' }]).texto, '1 revisão chegando')
  assert.equal(resumoDeRevisoes([{ situacao: 'em-dia' }]).nivel, 'em-dia')
})

test('plano vazio não é "em dia" — é o que uma consulta que FALHOU devolve', () => {
  // Medido: antes desta correção, resumoDeRevisoes([]) caía direto no
  // `return` final e dava nivel:'em-dia'. Isso não é hipotético — é
  // literalmente o que tela-de-frota.vue produz quando a consulta ao plano
  // falha: `plano.value = pl && !pl.error ? (pl.data || []) : []`. Permissão
  // negada ou rede fora vira `[]`, e o accordion adicionado nesta fase (sem o
  // `.filter((r) => r.itens.length)` que a versão antiga tinha) deixa isso
  // chegar até a tela: os 10 carros mostrariam selo verde sobre uma sanfona
  // vazia — exatamente a mentira que esta função existe pra impedir.
  const r = resumoDeRevisoes([])
  assert.equal(r.nivel, 'sem-registro')
  assert.equal(r.texto, 'Sem plano de revisão')
})

test('carro sem histórico nenhum não diz "em dia" — seria mentira', () => {
  const r = resumoDeRevisoes([{ situacao: 'sem-registro' }, { situacao: 'sem-registro' }])
  assert.equal(r.nivel, 'sem-registro')
  assert.match(r.texto, /Sem histórico/)
})

/* ── O editor de limiares ─────────────────────────────────────────────────── */

const EXISTENTES = [{ id: 'a', item: 'Troca de óleo' }, { id: 'b', item: 'Correia dentada' }]

test('item novo válido passa limpo', () => {
  assert.deepEqual(problemasDoItem({ item: 'Filtro de ar', aCadaKm: 20000, existentes: EXISTENTES }), [])
})

test('nome repetido é barrado, mesmo com outra caixa', () => {
  // Dois itens com o mesmo nome dariam dois alertas pra mesma troca.
  const p = problemasDoItem({ item: '  troca de ÓLEO ', aCadaKm: 7000, existentes: EXISTENTES })
  assert.equal(p.length, 1)
  assert.match(p[0], /Já existe/)
})

test('editar o próprio item não acusa nome repetido consigo mesmo', () => {
  assert.deepEqual(
    problemasDoItem({ item: 'Troca de óleo', aCadaKm: 7000, existentes: EXISTENTES, idAtual: 'a' }),
    [])
})

test('sem nome e sem intervalo não grava', () => {
  const p = problemasDoItem({ item: '', aCadaKm: null, existentes: [] })
  assert.equal(p.length, 2)
  assert.match(p.join(' '), /nome/i)
  assert.match(p.join(' '), /quilômetros/i)
})

test('intervalo absurdo é dedo errado, e o texto diz isso', () => {
  assert.match(problemasDoItem({ item: 'X', aCadaKm: 70, existentes: [] }).join(' '), /dedo errado/i)
  assert.match(problemasDoItem({ item: 'X', aCadaKm: 9000000, existentes: [] }).join(' '), /nunca/i)
  assert.match(problemasDoItem({ item: 'X', aCadaKm: 0, existentes: [] }).join(' '), /quilômetros/i)
  assert.match(problemasDoItem({ item: 'X', aCadaKm: 7000.5, existentes: [] }).join(' '), /quilômetros/i)
})

test('desativar avisa que o histórico NÃO some', () => {
  const a = avisoAoDesativar('Troca de óleo')
  assert.match(a, /continuam no histórico/)
  assert.match(a, /reativar/)
})

test('sem quilometragem NENHUMA, não diz "em dia" — seria mentira', () => {
  // O caso real da frota hoje: nenhum carro tem devolução registrada, então o
  // KM é desconhecido em todos. Dizer "revisões em dia" faz o carro sumir do
  // alerta e ninguém revisa. É a pior resposta possível: parece boa notícia.
  const r = resumoDeRevisoes([{ situacao: 'sem-km' }, { situacao: 'sem-km' }])
  assert.equal(r.nivel, 'sem-km')
  assert.match(r.texto, /quilometragem/i)
  assert.ok(!/em dia/i.test(r.texto))
})

test('misturar sem-km com sem-registro também não vira "em dia"', () => {
  const r = resumoDeRevisoes([{ situacao: 'sem-km' }, { situacao: 'sem-registro' }])
  assert.ok(!/em dia/i.test(r.texto), 'nenhum dos dois estados é conhecimento')
})

test('um item em dia entre desconhecidos ainda conta como em dia', () => {
  // Aqui SE SABE de alguma coisa, e nada está vencendo.
  const r = resumoDeRevisoes([{ situacao: 'em-dia' }, { situacao: 'sem-km' }])
  assert.equal(r.nivel, 'em-dia')
})

/* ── A ordem da aba Revisões quando ela mostra TUDO (D30) ───────────────── */

const cartao = (nome, nivel) => ({ linha: { veiculo: { id: nome, nome } }, itens: [], resumo: { nivel } })

test('o que dói primeiro vem primeiro, e nada é descartado', () => {
  // A aba antiga jogava fora o carro inteiro que não tivesse item vencendo.
  // Medido em 12/08: isso escondia 8 dos 10 carros.
  const fora = [cartao('BMW', 'em-dia'), cartao('Doblo', 'sem-km'),
    cartao('XC60', 'vencida'), cartao('Porsche', 'perto'), cartao('Fit', 'sem-registro')]
  const dentro = ordenarCarrosPorUrgencia(fora)
  assert.deepEqual(dentro.map((c) => c.linha.veiculo.nome),
    ['XC60', 'Porsche', 'BMW', 'Fit', 'Doblo'])
  assert.equal(dentro.length, 5, 'nenhum carro pode sumir da aba')
})

test('empate de urgência desempata pelo nome, pra a lista não dançar a cada carregada', () => {
  const dentro = ordenarCarrosPorUrgencia([cartao('Volvo', 'vencida'), cartao('Fiat', 'vencida')])
  assert.deepEqual(dentro.map((c) => c.linha.veiculo.nome), ['Fiat', 'Volvo'])
})

test('lista vazia não quebra', () => {
  assert.deepEqual(ordenarCarrosPorUrgencia([]), [])
  assert.deepEqual(ordenarCarrosPorUrgencia(null), [])
})
