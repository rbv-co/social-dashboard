import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mensagemDeEditar, mensagemDeArquivar, mensagemDeTemGente, mensagemDeApagar,
  seloDoEncontro, rotuloDeArquivar, rsvpLegivel, confirmouLegivel,
  compareceuLegivel, comprouLegivel, paraCampoDatetimeLocal,
} from './private-edit-regras.js'

test('editar: as quatro situacoes, cada uma com a sua frase', () => {
  assert.equal(mensagemDeEditar('ok'), '')
  assert.match(mensagemDeEditar('sem_permissao'), /permissão/)
  assert.match(mensagemDeEditar('nao_achei'), /achei mais este encontro/)
  assert.match(mensagemDeEditar('stylist_nao_achei'), /stylist/)
  // ⚠️ A quarta situação nao pode cair na mesma frase da segunda so porque as
  // duas comecam com "nao_achei" no nome: sao coisas diferentes (o encontro
  // sumiu vs. o codigo da stylist esta errado).
  assert.notEqual(mensagemDeEditar('nao_achei'), mensagemDeEditar('stylist_nao_achei'))
})

test('editar: uma situacao desconhecida ainda devolve uma frase, nunca undefined', () => {
  assert.equal(typeof mensagemDeEditar('algo_novo_que_o_banco_inventou'), 'string')
  assert.notEqual(mensagemDeEditar('algo_novo_que_o_banco_inventou'), '')
})

test('arquivar: tres situacoes, cada uma com a sua frase, e nao reusa as de editar', () => {
  assert.equal(mensagemDeArquivar('ok'), '')
  assert.match(mensagemDeArquivar('sem_permissao'), /permissão/)
  assert.match(mensagemDeArquivar('nao_achei'), /achei mais este encontro/)
})

test('tem_gente: a frase muda no singular e no plural', () => {
  assert.match(mensagemDeTemGente(1), /1 convidada\b/)
  assert.match(mensagemDeTemGente(1), /\bela\b/)
  assert.match(mensagemDeTemGente(5), /5 convidada\(s\)/)
  assert.match(mensagemDeTemGente(5), /\belas\b/)
})

test('tem_gente: as duas saidas de verdade estao na frase', () => {
  const f = mensagemDeTemGente(3)
  assert.match(f, /encerrar/)
  assert.match(f, /arquivar/)
})

test('tem_gente: zero ou lixo nao quebra a frase', () => {
  assert.doesNotThrow(() => mensagemDeTemGente(0))
  assert.doesNotThrow(() => mensagemDeTemGente(undefined))
  assert.doesNotThrow(() => mensagemDeTemGente('abc'))
})

test('apagar: as situacoes que NAO sao tem_gente tem frase propria', () => {
  assert.equal(mensagemDeApagar('ok'), '')
  assert.match(mensagemDeApagar('sem_permissao'), /permissão/)
  assert.match(mensagemDeApagar('nao_achei'), /achei mais este encontro/)
})

test('selo: arquivada vence ativa, mesmo se as duas estiverem marcadas', () => {
  // ⚠️ ESTE E O CASO QUE SEPARA "ARQUIVADA" DE "ENCERRADA": uma linha
  // arquivada E encerrada (ativa:false, arquivada:true) tem de dizer
  // "Arquivada" — nao "Encerrada", que sugeriria que ela ainda conta.
  const selo = seloDoEncontro({ ativa: false, arquivada: true })
  assert.equal(selo.texto, 'Arquivada')
})

test('selo: encerrada (nao arquivada) diz Encerrada', () => {
  assert.equal(seloDoEncontro({ ativa: false, arquivada: false }).texto, 'Encerrada')
})

test('selo: aberta diz Aceitando', () => {
  assert.equal(seloDoEncontro({ ativa: true, arquivada: false }).texto, 'Aceitando')
})

test('selo: campos ausentes (undefined) contam como aberta, nunca como encerrada', () => {
  // ⚠️ Um `e.ativa === false` estrito trata undefined como "nao esta fechada".
  // Se um dia a leitura do banco parar de mandar o campo, o pior que acontece
  // e a tela mostrar "Aceitando" a mais — nunca "Encerrada" ou "Arquivada" a
  // mais, que esconderia um encontro de verdade da lista de quem procura.
  assert.equal(seloDoEncontro({}).texto, 'Aceitando')
  assert.equal(seloDoEncontro(undefined).texto, 'Aceitando')
})

test('rotulo de arquivar e o oposto do estado atual', () => {
  assert.equal(rotuloDeArquivar(false), 'Arquivar…')
  assert.equal(rotuloDeArquivar(true), 'Desarquivar')
})

test('rsvp legivel', () => {
  assert.equal(rsvpLegivel('sim'), 'Sim')
  assert.equal(rsvpLegivel('nao'), 'Não')
  assert.equal(rsvpLegivel(null), '—')
  assert.equal(rsvpLegivel('lixo'), '—')
})

test('confirmou e compareceu sao perguntas DIFERENTES sobre o mesmo status', () => {
  // ⚠️ no_show confirma e nao comparece — se as duas colunas lessem o mesmo
  // jeito, "confirmou" e "compareceu" virariam a mesma informacao repetida.
  assert.equal(confirmouLegivel('no_show'), 'Sim')
  assert.equal(compareceuLegivel('no_show'), 'Não veio')
  assert.equal(confirmouLegivel('confirmado'), 'Sim')
  assert.equal(compareceuLegivel('confirmado'), '—')
  assert.equal(confirmouLegivel('realizado'), 'Sim')
  assert.equal(compareceuLegivel('realizado'), 'Sim')
  assert.equal(confirmouLegivel(null), '—')
  assert.equal(compareceuLegivel(null), '—')
})

test('comprou e Sim ou travessao, nunca "Nao"', () => {
  assert.equal(comprouLegivel(true), 'Sim')
  assert.equal(comprouLegivel(false), '—')
  assert.equal(comprouLegivel(null), '—')
})

test('paraCampoDatetimeLocal: hora LOCAL, nao UTC', () => {
  // 2026-09-19T22:00:00Z e 19h em Sao Paulo (UTC-3) -- mas o teste nao pode
  // cravar o fuso da maquina que roda a suite, entao compara contra o que o
  // proprio motor JS le como hora local do MESMO instante.
  const iso = '2026-09-19T22:00:00.000Z'
  const d = new Date(iso)
  const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-`
    + `${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:`
    + `${String(d.getMinutes()).padStart(2, '0')}`
  assert.equal(paraCampoDatetimeLocal(iso), esperado)
})

test('paraCampoDatetimeLocal: vazio ou invalido devolve string vazia, nunca "Invalid Date"', () => {
  assert.equal(paraCampoDatetimeLocal(''), '')
  assert.equal(paraCampoDatetimeLocal(null), '')
  assert.equal(paraCampoDatetimeLocal('lixo'), '')
})
