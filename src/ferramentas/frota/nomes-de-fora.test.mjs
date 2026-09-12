import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  nomesDeFora, problemasDoNomeDeFora, motoristaParaGravar, DE_FORA,
} from './nomes-de-fora.js'

const bloqueia = (p) => p.filter((x) => x.bloqueia)

/* O caso real, e ele está no banco: em 11/08/2026 o dono precisou registrar que
 * o Felipe, modelista contratado, ia usar a Bravo Essence por duas semanas. Não
 * havia onde escrever o nome dele, então ele pôs a SI MESMO como motorista e
 * escreveu a verdade na finalidade. Uma multa dessa quinzena cairia no nome
 * errado. */

// ── As sugestões ────────────────────────────────────────────────────────────

test('os nomes já digitados voltam como sugestão', () => {
  const linhas = [
    { pessoa_id: null, pessoa_nome: 'Felipe modelista' },
    { pessoa_id: null, pessoa_nome: 'Consultor da fábrica' },
  ]
  assert.deepEqual(nomesDeFora(linhas).sort(), ['Consultor da fábrica', 'Felipe modelista'])
})

test('quem É do cadastro não vira sugestão de nome de fora', () => {
  // Colaborador se escolhe na lista; oferecê-lo como texto livre criaria uma
  // segunda entrada pra mesma pessoa, sem elo com o cadastro dela.
  const linhas = [
    { pessoa_id: 'p1', pessoa_nome: 'Erick Martins' },
    { pessoa_id: null, pessoa_nome: 'Felipe modelista' },
  ]
  assert.deepEqual(nomesDeFora(linhas), ['Felipe modelista'])
})

test('a mesma pessoa escrita de jeitos diferentes conta como UMA', () => {
  // É a razão de existir da sugestão: sem ela, "Felipe", "felipe" e "FELIPE"
  // viram três pessoas no histórico.
  const linhas = [
    { pessoa_id: null, pessoa_nome: 'Felipe modelista' },
    { pessoa_id: null, pessoa_nome: 'felipe  modelista' },
    { pessoa_id: null, pessoa_nome: 'FELIPE MODELISTA' },
  ]
  assert.deepEqual(nomesDeFora(linhas), ['Felipe modelista'], 'e mantém a primeira grafia')
})

test('acento não separa a mesma pessoa em duas', () => {
  const linhas = [
    { pessoa_id: null, pessoa_nome: 'Fabio Terceirizado' },
    { pessoa_id: null, pessoa_nome: 'Fábio Terceirizado' },
  ]
  assert.equal(nomesDeFora(linhas).length, 1)
})

test('o mais usado vem primeiro, e o empate resolve pelo alfabeto', () => {
  // Sem desempate, a lista dançaria entre uma abertura e outra.
  const linhas = [
    { pessoa_id: null, pessoa_nome: 'Zeca' },
    { pessoa_id: null, pessoa_nome: 'Ana' },
    { pessoa_id: null, pessoa_nome: 'Felipe' },
    { pessoa_id: null, pessoa_nome: 'Felipe' },
  ]
  assert.deepEqual(nomesDeFora(linhas), ['Felipe', 'Ana', 'Zeca'])
})

test('nome em branco ou só espaço não vira sugestão', () => {
  const linhas = [
    { pessoa_id: null, pessoa_nome: '' },
    { pessoa_id: null, pessoa_nome: '   ' },
    { pessoa_id: null, pessoa_nome: null },
  ]
  assert.deepEqual(nomesDeFora(linhas), [])
})

test('a lista tem teto — sugestão não é catálogo', () => {
  const linhas = Array.from({ length: 40 }, (_, i) => ({ pessoa_id: null, pessoa_nome: `Pessoa ${i}` }))
  assert.equal(nomesDeFora(linhas).length, 12)
  assert.equal(nomesDeFora(linhas, 3).length, 3)
})

test('lista vazia ou nula não quebra', () => {
  assert.deepEqual(nomesDeFora([]), [])
  assert.deepEqual(nomesDeFora(null), [])
})

// ── O que barra e o que só empurra ──────────────────────────────────────────

test('sem nome não grava', () => {
  assert.equal(bloqueia(problemasDoNomeDeFora('')).length, 1)
  assert.equal(bloqueia(problemasDoNomeDeFora('   ')).length, 1)
})

test('nome curto demais não grava — ninguém reconhece "Fe" depois', () => {
  assert.equal(bloqueia(problemasDoNomeDeFora('Fe')).length, 1)
})

test('um nome só passa, mas com empurrão pro sobrenome', () => {
  // "Felipe" identifica hoje; numa multa daqui a três meses, talvez não.
  const p = problemasDoNomeDeFora('Felipe')
  assert.equal(bloqueia(p).length, 0)
  assert.ok(p.some((x) => /sobrenome|o que a pessoa faz/i.test(x.texto)))
})

test('nome com sobrenome passa limpo', () => {
  assert.deepEqual(problemasDoNomeDeFora('Felipe modelista'), [])
})

// ── O que vai pro banco ─────────────────────────────────────────────────────

test('colaborador grava com identificador E nome', () => {
  const m = motoristaParaGravar({ pessoaId: 'p1', nomeDaPessoa: () => 'Erick Martins' })
  assert.deepEqual(m, { pessoa_id: 'p1', pessoa_nome: 'Erick Martins' })
})

test('pessoa de fora grava SEM identificador, e com o nome', () => {
  // As duas colunas já aceitam nulo — o formato não é novo, só ganhou caminho.
  const m = motoristaParaGravar({ nomeDeFora: '  Felipe modelista  ' })
  assert.deepEqual(m, { pessoa_id: null, pessoa_nome: 'Felipe modelista' })
})

test('sem ninguém escolhido, grava nulo nos dois — e não uma string vazia', () => {
  assert.deepEqual(motoristaParaGravar({}), { pessoa_id: null, pessoa_nome: null })
  assert.deepEqual(motoristaParaGravar({ nomeDeFora: '   ' }), { pessoa_id: null, pessoa_nome: null })
})

test('o colaborador VENCE o nome de fora quando os dois vêm preenchidos', () => {
  // A tela troca um pelo outro, mas se um resíduo sobrar no formulário, quem
  // tem cadastro é a resposta mais confiável.
  const m = motoristaParaGravar({ pessoaId: 'p1', nomeDeFora: 'Felipe', nomeDaPessoa: () => 'Erick' })
  assert.equal(m.pessoa_id, 'p1')
  assert.equal(m.pessoa_nome, 'Erick')
})

test('a marca do seletor é um valor que nenhum identificador real teria', () => {
  assert.match(DE_FORA, /^__/)
})
