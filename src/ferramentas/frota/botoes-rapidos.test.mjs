import { test } from 'node:test'
import assert from 'node:assert/strict'
import { botoesDoMotorista, botoesDaGestao } from './botoes-rapidos.js'

/* Os números são os reais medidos em 12/08/2026: 10 veículos, 2 sem dono,
 * 8 posses abertas, 0 checklists hoje, 2 requisições pendentes. */

const acha = (lista, chave) => lista.find((b) => b.chave === chave)

test('o motorista vê o nome do carro dele e que o checklist falta hoje', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [{}, {}, {}], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'FIAT BRAVO BLACKMOTION',
  })
  assert.equal(acha(b, 'meu-checklist').rotulo, 'Fazer meu checklist')
  assert.equal(acha(b, 'meu-checklist').estado, 'BRAVO BLACKMOTION · falta hoje')
})

test('checklist já feito hoje diz que está feito — e não some', () => {
  // Sumir o botão faria a pessoa achar que perdeu a função. Ele fica, dizendo.
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'feito', nomeDoMeuCarro: 'HONDA FIT',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'HONDA FIT · feito hoje')
})

test('quem não tem carro fixo não recebe uma promessa vazia', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [{}], comOutros: [] },
    checklistDeHoje: null, nomeDoMeuCarro: null,
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'você não tem carro fixo')
})

test('"preciso usar um carro" conta os livres, no singular e no plural', () => {
  const um = botoesDoMotorista({ painel: { comigo: [], livres: [{}], comOutros: [] } })
  assert.equal(acha(um, 'preciso-carro').estado, '1 carro livre')
  const tres = botoesDoMotorista({ painel: { comigo: [], livres: [{}, {}, {}], comOutros: [] } })
  assert.equal(acha(tres, 'preciso-carro').estado, '3 carros livres')
})

test('sem carro livre, o botão DIZ isso em vez de sumir', () => {
  const b = botoesDoMotorista({ painel: { comigo: [], livres: [], comOutros: [] } })
  assert.equal(acha(b, 'preciso-carro').estado, 'nenhum carro livre agora')
})

test('a gestão vê quantos faltam conferir hoje', () => {
  // Medido em 12/08: 0 checklists hoje, 10 veículos.
  const b = botoesDaGestao({
    linhas: Array.from({ length: 10 }, () => ({ disponivel: false })),
    cobranca: Array.from({ length: 10 }, (_, i) => ({ fez: i < 2 })),
    fila: [],
  })
  assert.equal(acha(b, 'conferir-checklists').estado, 'faltam 8 de 10 hoje')
})

test('todos conferidos vira uma frase boa, não "faltam 0"', () => {
  const b = botoesDaGestao({
    linhas: [{ disponivel: false }], cobranca: [{ fez: true }], fila: [],
  })
  assert.equal(acha(b, 'conferir-checklists').estado, 'todos conferidos hoje')
})

test('sem quadro de cobrança carregado, o botão fica calado', () => {
  // `null` é "não sei", e não sei não vira número.
  const b = botoesDaGestao({ linhas: [{}], cobranca: null, fila: [] })
  assert.equal(acha(b, 'conferir-checklists').estado, null)
})

test('"veículos do grupo" mostra o total e quantos estão livres', () => {
  const b = botoesDaGestao({
    linhas: [{ disponivel: true }, { disponivel: false }, { disponivel: true }],
    cobranca: [], fila: [],
  })
  assert.equal(acha(b, 'veiculos').estado, '3 veículos · 2 livres')
})

// `podeReservar: true` nos dois: sem a permissão o botão não existe (ver os
// testes de permissão no fim do arquivo), e o que se mede aqui é a FRASE dele.
test('reservar avisa quando há pedido esperando decisão', () => {
  const b = botoesDaGestao({ linhas: [], cobranca: [], fila: [{}, {}], podeReservar: true })
  assert.equal(acha(b, 'reservar').estado, '2 pedidos esperando')
})

test('sem fila, reservar não inventa aviso', () => {
  const b = botoesDaGestao({ linhas: [], cobranca: [], fila: [], podeReservar: true })
  assert.equal(acha(b, 'reservar').estado, null)
})

test('toda tecla e toda ação são únicas — botão repetido é bug de menu', () => {
  for (const lista of [botoesDoMotorista({ painel: {} }), botoesDaGestao({ linhas: [] })]) {
    const chaves = lista.map((b) => b.chave)
    assert.equal(new Set(chaves).size, chaves.length)
    for (const b of lista) assert.ok(b.rotulo && b.acao, 'botão sem rótulo ou sem ação')
  }
})

/* Frota real medida em 12/08/2026: 10 veículos de 5 marcas. Regra: tira marca
 * (primeira palavra) só quando há 3+ palavras. Não toca em maiúscula/minúscula
 * porque case-fold quebra um subconjunto diferente a cada carro novo comprado. */

test('FIAT BRAVO BLACKMOTION: 3 palavras, marca cai', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'FIAT BRAVO BLACKMOTION',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'BRAVO BLACKMOTION · falta hoje')
})

test('FIAT BRAVO ESSENCE: 3 palavras, marca cai, fica distinto do BLACKMOTION', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'FIAT BRAVO ESSENCE',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'BRAVO ESSENCE · falta hoje')
})

test('FORD FIESTA SEDAN: 3 palavras, marca cai', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'FORD FIESTA SEDAN',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'FIESTA SEDAN · falta hoje')
})

test('PORSCHE CAYENNE PHEV: 3 palavras, marca cai, maiúsculas intactas', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'PORSCHE CAYENNE PHEV',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'CAYENNE PHEV · falta hoje')
})

test('VOLVO XC60: 2 palavras, marca fica', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'VOLVO XC60',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'VOLVO XC60 · falta hoje')
})

test('VOLVO XC90: 2 palavras, marca fica', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'VOLVO XC90',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'VOLVO XC90 · falta hoje')
})

test('BMW X1: 2 palavras, marca fica, modelo com dígito não some', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'BMW X1',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'BMW X1 · falta hoje')
})

test('FIAT PUNTO: 2 palavras, marca fica', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'FIAT PUNTO',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'FIAT PUNTO · falta hoje')
})

test('FIAT DOBLO: 2 palavras, marca fica', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'FIAT DOBLO',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'FIAT DOBLO · falta hoje')
})

/* ── Permissão: botão que a pessoa não pode usar não aparece ────────────────
 *
 * Estes botões SUBSTITUÍRAM controles que já eram protegidos: o "+ Acrescentar
 * veículo" era `v-if="pode('criar')"` e o "Reservar" de cada carro é
 * `v-if="podeEditar"`. A aba Gestão aparece pra quem tem `criar` OU `excluir`
 * (areas-da-frota.js), então quem tem só `excluir` CHEGA aqui — e chegaria a um
 * botão que não devia ver. Sem estes testes a permissão sumiria em silêncio, que
 * é o defeito mais caro desta base. */

test('quem não pode criar não vê "Acrescentar um veículo"', () => {
  const b = botoesDaGestao({ linhas: [], cobranca: [], fila: [], podeCriar: false, podeReservar: true })
  assert.equal(acha(b, 'acrescentar'), undefined)
})

test('quem não pode reservar não vê "Reservar um carro"', () => {
  const b = botoesDaGestao({ linhas: [], cobranca: [], fila: [], podeCriar: true, podeReservar: false })
  assert.equal(acha(b, 'reservar'), undefined)
})

test('quem pode os dois vê os quatro', () => {
  const b = botoesDaGestao({ linhas: [], cobranca: [], fila: [], podeCriar: true, podeReservar: true })
  assert.equal(b.length, 4)
})

test('sem dizer nada, a tela nasce FECHADA — nunca aberta por esquecimento', () => {
  // Quem esquecer de passar a permissão recebe a tela mais fechada. O contrário
  // (nascer liberado) é como uma permissão vaza sem ninguém notar.
  const b = botoesDaGestao({ linhas: [], cobranca: [], fila: [] })
  assert.equal(acha(b, 'acrescentar'), undefined)
  assert.equal(acha(b, 'reservar'), undefined)
  assert.equal(b.length, 2, 'só os dois que apenas rolam a tela')
})

test('os que só rolam a tela aparecem pra quem chegou na aba', () => {
  const b = botoesDaGestao({ linhas: [], cobranca: [], fila: [] })
  assert.ok(acha(b, 'conferir-checklists'))
  assert.ok(acha(b, 'veiculos'))
})

test('nenhum botão devolvido carrega a marca de exigência pra fora', () => {
  // `exige` é decisão interna: vazar faria a tela conferir permissão de novo,
  // e duas respostas pra mesma pergunta é como as duas listas de superadmin
  // desta base passaram a divergir.
  const b = botoesDaGestao({ linhas: [], cobranca: [], fila: [], podeCriar: true, podeReservar: true })
  for (const x of b) assert.equal('exige' in x, false)
})
