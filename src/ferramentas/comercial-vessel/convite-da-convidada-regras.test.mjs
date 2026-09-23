import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  primeiroNome, linkDaConvidada, dataPorExtenso, horarioCurto, mensagemDoConvite,
  linkDoWhatsApp, nomeDoArquivo, textosDoCartao, LINHAS_DO_CONVITE,
} from './convite-da-convidada-regras.js'

const QUANDO = '2026-10-10T22:00:00Z' // 19h de São Paulo, sábado

test('primeiro nome', () => {
  assert.equal(primeiroNome('  Beatriz Montenegro Siqueira '), 'Beatriz')
  assert.equal(primeiroNome(''), '')
})
test('link só com as duas chaves no formato', () => {
  assert.equal(linkDaConvidada('k7q2m9tx', 'H3N8P4WZ'), 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ')
  assert.equal(linkDaConvidada('K7Q2M9TX', 'O0I1ABCD'), '')
  assert.equal(linkDaConvidada('', 'H3N8P4WZ'), '')
})
test('data e hora no fuso de São Paulo, não em UTC', () => {
  assert.equal(dataPorExtenso(QUANDO), 'sábado, 10 de outubro')
  assert.equal(horarioCurto(QUANDO), '19h')
  assert.equal(horarioCurto('2026-10-10T22:30:00Z'), '19h30')
  assert.equal(dataPorExtenso('2026-10-11T02:30:00Z'), 'sábado, 10 de outubro')
})
const BASE = { convidada: 'Beatriz Siqueira', stylist: 'Marina Castro', quando: QUANDO,
  local: 'Loja do Iguatemi Campinas', link: 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ' }
test('mensagem da stylist: o texto aprovado, palavra por palavra', () => {
  assert.equal(mensagemDoConvite({ ...BASE, quem: 'stylist' }),
    'Beatriz, estou preparando uma VESSEL Private Edit para um pequeno grupo de clientes. Vou apresentar uma '
    + 'seleção de bolsas sob o meu olhar, com a equipe da VESSEL à disposição. Será em sábado, 10 de outubro, '
    + 'às 19h, em Loja do Iguatemi Campinas. Gostaria muito de ter você comigo. Confirme sua presença por aqui: '
    + 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ')
})
test('mensagem da equipe: o texto aprovado, palavra por palavra', () => {
  assert.equal(mensagemDoConvite({ ...BASE, quem: 'equipe' }),
    'Beatriz, a Marina está preparando uma VESSEL Private Edit para um pequeno grupo de clientes e gostaria '
    + 'muito de ter você com ela. Será em sábado, 10 de outubro, às 19h, em Loja do Iguatemi Campinas, com uma '
    + 'seleção de bolsas preparada pela Marina e a equipe da VESSEL à disposição. Confirme sua presença por aqui: '
    + 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ')
})
test('sem local, a frase não fica com "em ,"', () => {
  assert.doesNotMatch(mensagemDoConvite({ ...BASE, local: null, quem: 'stylist' }), /em ,|em \./)
})
test('WhatsApp só com número brasileiro completo', () => {
  assert.equal(linkDoWhatsApp('5519999990000', 'Oi & tchau'), 'https://wa.me/5519999990000?text=Oi%20%26%20tchau')
  assert.equal(linkDoWhatsApp('19999990000', 'x'), '')
})
test('nome do arquivo sem acento e com a data do encontro', () => {
  assert.equal(nomeDoArquivo('Ângela Souza', QUANDO), 'private-edit_angela_2026-10-10.png')
})
test('textos do cartão: título, hosted by e o nome inteiro da convidada', () => {
  const t = textosDoCartao({ convidada: 'Beatriz Siqueira', stylist: 'Marina Castro', quando: QUANDO, local: 'Loja X' })
  assert.equal(t.titulo, 'PRIVATE EDIT')
  assert.equal(t.hosted, 'Hosted by Marina Castro')
  assert.equal(t.nome, 'Beatriz Siqueira')
  assert.equal(t.quando, 'SÁBADO, 10 DE OUTUBRO')
  assert.equal(t.horario, '19H')
  for (const l of LINHAS_DO_CONVITE) assert.ok(l.campo in t, `a linha ${l.campo} não tem texto`)
})
test('as linhas que vêm de fora encolhem para caber', () => {
  for (const campo of ['nome', 'hosted', 'local', 'quando']) {
    const l = LINHAS_DO_CONVITE.find((x) => x.campo === campo)
    assert.ok(l.larguraMaxima && l.tamanhoMinimo, `${campo} sem larguraMaxima/tamanhoMinimo`)
  }
})
