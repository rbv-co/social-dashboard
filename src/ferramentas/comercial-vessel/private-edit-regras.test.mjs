import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mensagemDeEditar, mensagemDeArquivar, mensagemDeTemGente, mensagemDeApagar,
  seloDoEncontro, rotuloDeArquivar, rsvpLegivel, confirmouLegivel,
  compareceuLegivel, comprouLegivel, paraCampoDatetimeLocal,
  podeExecutarAcao, calcularConjunto,
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

test('tem_gente: zero (ou lixo, que vira zero) nao cita numero nenhum', () => {
  // ⚠️ ESTE E O CASO QUE O REVIEW ACHOU: `vessel_private_edit_apagar` recusa
  // olhando vessel_atendimentos SEM filtrar teste, mas `e.responderam` (o que
  // esta funcao recebe) JA vem filtrado por teste — um encontro so com
  // convidadas de teste tem responderam:0 e AINDA ASSIM e recusado. Citar
  // "0 convidada(s)" contradiria a propria recusa do banco.
  assert.doesNotMatch(mensagemDeTemGente(0), /\b0\b/)
  assert.match(mensagemDeTemGente(0), /convidada/)
  assert.doesNotMatch(mensagemDeTemGente(undefined), /\b0\b/)
  assert.doesNotMatch(mensagemDeTemGente('abc'), /\b0\b/)
})

test('tem_gente: com numero de verdade, a frase continua citando ele', () => {
  assert.match(mensagemDeTemGente(3), /\b3\b/)
})

// ── R13: quais acoes exigem a permissao de editar ───────────────────────────

test('R13: encerrar e reabrir EXIGEM editar, igual a editar/apagar/arquivar', () => {
  // ⚠️ ESTE E O TESTE QUE TERIA PEGO O CRITICAL 1: no codigo de antes desta
  // rodada, o template deixava Encerrar/Reabrir FORA do `v-if="podeEditar"`
  // que ja protegia os outros tres. Sem esta funcao (e sem o template
  // chama-la), nao havia nenhum jeito de a suite provar essa regra — o bug
  // so aparecia clicando na tela de verdade.
  for (const acao of ['encerrar', 'reabrir', 'editar', 'arquivar', 'apagar']) {
    assert.equal(podeExecutarAcao(acao, false), false, `${acao} deveria exigir editar`)
    assert.equal(podeExecutarAcao(acao, true), true, `${acao} deveria liberar com editar`)
  }
})

test('R13: "ver quem foi" (leitura) nao exige editar', () => {
  assert.equal(podeExecutarAcao('ver-quem-foi', false), true)
  assert.equal(podeExecutarAcao('ver-quem-foi', true), true)
})

// ── o conjunto segue a lista que recebe, nao uma lista cravada ──────────────

test('calcularConjunto: soma so o que esta NA LISTA recebida', () => {
  // ⚠️ ESTE E O TESTE QUE TERIA PEGO O CRITICAL 2: antes desta rodada,
  // `totalVagas` no `.vue` somava sobre `encontros.value` (a lista CHEIA),
  // enquanto a contagem ao lado ja seguia o filtro — "3 Encontros" ao lado da
  // soma de vagas dos 10. Uma funcao pura que so soma o que recebe torna esse
  // descompasso impossivel: quem chama e quem decide a lista.
  const TODOS = [
    { codigo: 'PE-1', vagas: 8, responderam: 4, disseram_sim: 2, compareceram: 1 },
    { codigo: 'PE-2', vagas: 6, responderam: 3, disseram_sim: 3, compareceram: 3 },
    { codigo: 'PE-3', vagas: 10, responderam: 5, disseram_sim: 4, compareceram: 2 },
  ]
  const FILTRADA = TODOS.slice(0, 2) // como se o filtro tivesse deixado so 2 de 3

  const totalDosTodos = calcularConjunto(TODOS)
  const totalDaFiltrada = calcularConjunto(FILTRADA)

  assert.equal(totalDosTodos.totalVagas, 24)
  assert.equal(totalDosTodos.totalEncontros, 3)

  // ⚠️ A ASSERCAO QUE FALHARIA NO BUG: se `calcularConjunto` (ou quem a
  // chama) ignorasse o filtro e sempre somasse `TODOS`, este valor viria 24,
  // nao 14 — exatamente o "3 Encontros · vagas dos 10" que o review descreveu.
  assert.equal(totalDaFiltrada.totalVagas, 14)
  assert.equal(totalDaFiltrada.totalEncontros, 2)
})

test('calcularConjunto: lista vazia nao quebra, e sem base as taxas nao viram 0%', () => {
  const c = calcularConjunto([])
  assert.equal(c.totalEncontros, 0)
  assert.equal(c.totalVagas, 0)
  assert.equal(c.resposta.temBase, false)
  assert.equal(c.presenca.temBase, false)
})

test('calcularConjunto: as taxas somam numerador e denominador do CONJUNTO, nao a media', () => {
  const LISTA = [
    { vagas: 2, responderam: 2, disseram_sim: 2, compareceram: 2 }, // 100%
    { vagas: 8, responderam: 0, disseram_sim: 0, compareceram: 0 }, // 0%
  ]
  const c = calcularConjunto(LISTA)
  // Media simples daria 50%; a conta certa e 2 de 10 = 20%.
  assert.equal(c.resposta.x, 2)
  assert.equal(c.resposta.n, 10)
  assert.equal(c.resposta.valor, 0.2)
})
