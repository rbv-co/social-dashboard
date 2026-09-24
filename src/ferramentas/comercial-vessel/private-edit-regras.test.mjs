import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  mensagemDeEditar, mensagemDeArquivar, mensagemDeTemGente, mensagemDeApagar,
  seloDoEncontro, rotuloDeArquivar, rsvpLegivel, confirmouLegivel,
  compareceuLegivel, comprouLegivel, paraCampoDatetimeLocal,
  podeExecutarAcao, calcularConjunto, encontroAceitaConvite,
} from './private-edit-regras.js'

const telaFonte = () => readFileSync(new URL('./tela-de-private-edit.vue', import.meta.url), 'utf8')

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
    { codigo: 'PE-1', vagas: 8, responderam: 4, disseram_sim: 2, confirmadas: 2, compareceram: 1 },
    { codigo: 'PE-2', vagas: 6, responderam: 3, disseram_sim: 3, confirmadas: 3, compareceram: 3 },
    { codigo: 'PE-3', vagas: 10, responderam: 5, disseram_sim: 4, confirmadas: 4, compareceram: 2 },
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
    { vagas: 7, convidadas: 2, responderam: 2, disseram_sim: 2, compareceram: 2 }, // 100%
    { vagas: 8, convidadas: 8, responderam: 0, disseram_sim: 0, compareceram: 0 }, // 0%
  ]
  const c = calcularConjunto(LISTA)
  // Media simples daria 50%; a conta certa e 2 de 10 = 20%.
  assert.equal(c.resposta.x, 2)
  assert.equal(c.resposta.n, 10)
  assert.equal(c.resposta.valor, 0.2)
})

test('calcularConjunto: a presença soma só os encontros que ACONTECERAM', () => {
  const LISTA = [
    { status: 'realizado', confirmadas: 4, compareceram: 3 },
    { status: 'cancelado', confirmadas: 6, compareceram: 0 },  // nunca pôde ir
    { status: 'agendado', confirmadas: 5, compareceram: 0 },   // ainda não foi
    { status: 'realizado', confirmadas: 2, compareceram: 2 },
  ]
  const c = calcularConjunto(LISTA)
  // Com todos: 5 de 17. Só os realizados: 5 de 6.
  assert.equal(c.presenca.x, 5)
  assert.equal(c.presenca.n, 6)
  // A contagem de encontros continua sendo a da lista inteira.
  assert.equal(c.totalEncontros, 4)
  // Nenhum realizado: sem base, e não 0%.
  assert.equal(calcularConjunto([{ status: 'cancelado', confirmadas: 3, compareceram: 0 }]).presenca.temBase, false)
})

test('encontroAceitaConvite: só enquanto o link da convidada abre', () => {
  assert.equal(encontroAceitaConvite({ status: 'agendado', ativa: true, arquivada: false }), true)
  assert.equal(encontroAceitaConvite({ status: 'confirmado' }), true)
  for (const st of ['cancelado', 'nao_realizado', 'realizado']) {
    assert.equal(encontroAceitaConvite({ status: st, ativa: true }), false, st)
  }
  assert.equal(encontroAceitaConvite({ status: 'agendado', arquivada: true }), false)
  assert.equal(encontroAceitaConvite({ status: 'agendado', ativa: false }), false)
  assert.equal(encontroAceitaConvite(null), false)
})

test('FIACAO: o botão "Cartão e mensagem" mora dentro de encontroAceitaConvite(e)', () => {
  const fonte = telaFonte()
  const i = fonte.indexOf('>Cartão e mensagem</button>')
  const abre = fonte.lastIndexOf('<button', i)
  assert.ok(i > 0 && abre > 0)
  assert.match(fonte.slice(abre, i), /v-if="encontroAceitaConvite\(e\)"/)
})

// ── guardas de FIAÇÃO no .vue (texto-fonte, não execução) ───────────────────
//
// ⚠️ POR QUE ISTO EXISTE, E POR QUE UM TESTE DE FUNÇÃO PURA NÃO BASTA: os dois
// Critical da rodada anterior não estavam em `calcularConjunto` nem em
// `podeExecutarAcao` — as duas funções sempre estiveram certas. O defeito
// morava no TEMPLATE: ele somava sobre a lista errada (`encontros.value` em
// vez de `encontrosNaTela.value`) e deixava Encerrar/Reabrir fora do
// `v-if` que chama `podeExecutarAcao('encerrar', ...)`. Um teste que só
// chama `calcularConjunto(list)` diretamente NUNCA vê qual lista o `.vue`
// decidiu entregar a ela — a fiação entre o template e a função é invisível
// para um teste de unidade, e é exatamente aí que os dois bugs viveram.
// Como `.vue` não roda na suíte (`npm test` só pega `.js`/`.mjs`), a única
// rede que alcança essa fiação é ler o arquivo como TEXTO e exigir a
// chamada certa — o mesmo padrão já usado em `navegacao.test.mjs` e
// `largura.test.mjs` para este mesmo motivo.
test('FIACAO: o conjunto e calculado sobre a lista FILTRADA, nunca a cheia', () => {
  const fonte = telaFonte()
  assert.ok(fonte.includes('calcularConjunto(encontrosNaTela.value)'),
    'a tela precisa chamar calcularConjunto(encontrosNaTela.value) — sem isso, ' +
    'o conjunto pode voltar a somar sobre a lista sem filtro')
  assert.ok(!fonte.includes('calcularConjunto(encontros.value)'),
    'a tela NAO pode chamar calcularConjunto com a lista cheia (encontros.value) — ' +
    'e exatamente o Critical 2 da rodada anterior')
})

/**
 * Quantos `<template>` a mais foram ABERTOS do que FECHADOS entre dois
 * pontos do arquivo. Zero quer dizer "tudo que abriu aqui dentro também
 * fechou aqui dentro" — ou seja, o ponto de chegada ainda está dentro de
 * QUALQUER template que já estivesse aberto antes do ponto de partida.
 */
function saldoDeTemplates(fonte, doIndex, ateIndex) {
  const trecho = fonte.slice(doIndex, ateIndex)
  const aberturas = (trecho.match(/<template\b/g) || []).length
  const fechamentos = (trecho.match(/<\/template>/g) || []).length
  return aberturas - fechamentos
}

test('FIACAO: Encerrar/Reabrir passam pela mesma trava de editar que os outros tres', () => {
  const fonte = telaFonte()
  const tagDoGate = `<template v-if="podeExecutarAcao('encerrar', podeEditar)">`
  const idxGate = fonte.indexOf(tagDoGate)
  assert.ok(idxGate !== -1, `a tela precisa ter a tag ${tagDoGate}`)
  const inicioDoConteudo = idxGate + tagDoGate.length

  const idxEncerrar = fonte.indexOf('>Encerrar…<', inicioDoConteudo)
  assert.ok(idxEncerrar !== -1, 'o botão "Encerrar…" precisa estar dentro do gate')
  const idxReabrir = fonte.indexOf('>Reabrir<', inicioDoConteudo)
  assert.ok(idxReabrir !== -1, 'o botão "Reabrir" precisa estar depois do gate no arquivo')

  // ⚠️⚠️ POR QUE CONTAR `<template>` EM VEZ DE SÓ `fonte.includes(gate)`: a
  // versão anterior deste teste só conferia que a STRING do gate existisse
  // EM ALGUM LUGAR do arquivo inteiro — nem posição, nem aninhamento. Medido
  // ao vivo (achado na T12, na tela irmã Stylist Circle, e replicado aqui):
  // mover a abertura do gate para DENTRO do `<template v-if="e.ativa !==
  // false">` — ou seja, o MESMO Critical 1 que este teste afirma proteger,
  // só que disfarçado — deixa a string do gate presente no arquivo do mesmo
  // jeito, e a versão antiga deste teste PASSAVA com essa mutação. Só a
  // conta de saldo de `<template>`/`</template>` pega: um gate que fechou
  // antes de chegar em "Reabrir" deixa saldo 0 (nível do gate), não o saldo
  // ≥1 esperado quando o botão ainda está dentro do `e.ativa !== false`
  // aninhado por dentro do gate.
  const saldoAteEncerrar = saldoDeTemplates(fonte, inicioDoConteudo, idxEncerrar)
  assert.ok(saldoAteEncerrar >= 1,
    `o botão "Encerrar…" precisa estar dentro de pelo menos um <template> aninhado ` +
    `ainda aberto (o de e.ativa !== false) — saldo veio ${saldoAteEncerrar}`)
  const saldoAteReabrir = saldoDeTemplates(fonte, inicioDoConteudo, idxReabrir)
  assert.equal(saldoAteReabrir, 0,
    'o botão "Reabrir" não está mais dentro do template do gate (saldo de <template> quebrado) — ' +
    'é o Critical 1 desta tela, só que com o gate movido para DENTRO do if de ativa')

  const antesDoGate = fonte.slice(0, idxGate)
  assert.doesNotMatch(antesDoGate, />Reabrir</,
    '"Reabrir" apareceu ANTES do gate de encerrar — está solto, sem trava')
  assert.doesNotMatch(antesDoGate, />Encerrar…</,
    '"Encerrar…" apareceu ANTES do gate de encerrar — está solto, sem trava')
})

// ⚠️ AS DUAS GUARDAS ABAIXO FALTAVAM NESTA TELA (achado da revisão final da
// branch): a T11/T12 levaram as duas — o v-for sobre a lista FILTRADA e o
// gate forte de editar/arquivar/apagar — para as telas irmãs (Beauty
// Sessions, Stylist Circle), mas a Private Edit, por ser a tela mais antiga,
// nunca as recebeu. Sem elas, a mesma mutação de gate-no-aninhamento-errado
// que o R21 achou nas duas irmãs passaria batida aqui, sem ninguém notar —
// e é exatamente sobre o botão destrutivo (Apagar).

test('FIACAO: o v-for dos encontros itera sobre a lista FILTRADA, nao a cheia', () => {
  const fonte = telaFonte()
  assert.match(fonte, /v-for="e in encontrosNaTela"/,
    'o v-for dos encontros precisa iterar sobre encontrosNaTela, não encontros')
  assert.doesNotMatch(fonte, /v-for="e in encontros"/,
    'o v-for NAO pode iterar sobre a lista cheia (encontros) — é o mesmo Critical do conjunto, só que na lista renderizada')
})

test('FIACAO: editar, arquivar e apagar vivem atrás do MESMO gate de editar (aninhamento, não só texto por perto)', () => {
  const fonte = telaFonte()
  const tagDoGate = `<template v-if="podeExecutarAcao('editar', podeEditar)">`
  // ⚠️ é o SEGUNDO uso desta tag: o primeiro abre o formulário inline de
  // editar (`editando === e.codigo`), o segundo é o bloco de ações.
  const idxGate = fonte.lastIndexOf(tagDoGate)
  assert.ok(idxGate !== -1, `a tela precisa ter a tag ${tagDoGate} no bloco de ações`)
  const inicioDoConteudo = idxGate + tagDoGate.length

  const idxEditar = fonte.indexOf('>Editar…<', inicioDoConteudo)
  assert.ok(idxEditar !== -1, 'o botão "Editar…" precisa estar dentro do gate')
  const idxArquivar = fonte.indexOf('rotuloDeArquivar(e.arquivada)', inicioDoConteudo)
  assert.ok(idxArquivar !== -1, 'o botão de arquivar (rotuloDeArquivar) precisa estar dentro do gate')
  const idxApagar = fonte.indexOf('>Apagar…<', inicioDoConteudo)
  assert.ok(idxApagar !== -1, 'o botão "Apagar…" precisa estar dentro do gate')

  // ⚠️ POR QUE CONTAR <template> EM VEZ DE SÓ `fonte.includes(gate)` OU UMA
  // JANELA FIXA DE CARACTERES: qualquer uma dessas duas passa mesmo quando o
  // `</template>` que fecha o gate foi movido para ANTES do bloco de Apagar —
  // o texto ">Apagar…<" continua existindo (e perto) no arquivo, só que fora
  // da proteção de verdade. É o Critical destrutivo que a revisão final
  // apontou: apagar remove um encontro PARA SEMPRE, e era exatamente o botão
  // que ficaria sem trava se essa guarda não existisse. Só a conta de saldo
  // de `<template>`/`</template>` pega — o saldo no ponto de "Apagar…" cai de
  // 1 (ainda dentro do gate de editar E do `<template v-if="!bloqueioDeApagar
  // ...">` aninhado por dentro dele) para 0 (o gate já fechou cedo demais, e
  // só o `bloqueioDeApagar` ficou de pé).
  const saldoAteEditar = saldoDeTemplates(fonte, inicioDoConteudo, idxEditar)
  assert.equal(saldoAteEditar, 0,
    `o botão "Editar…" precisa estar no MESMO nível do gate (saldo 0) — saldo veio ${saldoAteEditar}`)
  const saldoAteArquivar = saldoDeTemplates(fonte, inicioDoConteudo, idxArquivar)
  assert.equal(saldoAteArquivar, 0,
    `o botão de arquivar precisa estar no MESMO nível do gate (saldo 0) — saldo veio ${saldoAteArquivar}`)
  const saldoAteApagar = saldoDeTemplates(fonte, inicioDoConteudo, idxApagar)
  assert.equal(saldoAteApagar, 1,
    'o botão "Apagar…" precisa estar dentro de mais um <template> aninhado (o de ' +
    `!bloqueioDeApagar), ainda por dentro do gate de editar — saldo veio ${saldoAteApagar}`)

  const antesDoGate = fonte.slice(0, idxGate)
  assert.doesNotMatch(antesDoGate, />Editar…</,
    '"Editar…" apareceu ANTES do gate de editar — está solto, sem trava')
  assert.doesNotMatch(antesDoGate, />Apagar…</,
    '"Apagar…" apareceu ANTES do gate de editar — está solto, sem trava')
})

test('T11: o comparecimento do conjunto é sobre quem CONFIRMOU, não sobre quem disse sim', () => {
  // Uma convidada confirmada por telefone (sem "sim" no convite) que veio.
  const c = calcularConjunto([{ status: 'realizado', vagas: 8, responderam: 1, disseram_sim: 0, confirmadas: 1, compareceram: 1 }])
  assert.equal(c.presenca.n, 1)
  assert.equal(c.presenca.valor, 1)
})

test('T11: mudar a situação e convidar exigem editar; marcar convite e presença não', () => {
  for (const a of ['situacao', 'convidar']) assert.equal(podeExecutarAcao(a, false), false)
  for (const a of ['marcar-convite', 'marcar-presenca']) assert.equal(podeExecutarAcao(a, false), true)
})

test('T11: a resposta é sobre as CONVIDADAS — convidar mais que as vagas não passa de 100%', () => {
  const c = calcularConjunto([{ vagas: 8, convidadas: 9, responderam: 9, confirmadas: 8, compareceram: 7 }])
  assert.equal(c.resposta.n, 9)
  assert.equal(c.resposta.valor, 1)
})

// ── 24/09/2026: a base do Private Edit (só as liberadas) ───────────────────
import {
  stylistsLiberadas, stylistsParaEditar, notaDaBaseDoPrivateEdit, vazioDaBaseDoPrivateEdit, mensagemDeCriar,
} from './private-edit-regras.js'

test('base do Private Edit: o seletor novo só tem as liberadas; o da edição mantém a anfitriã de hoje', () => {
  const lista = [
    { codigo: 'STY-0001', libera_private_edit: true }, { codigo: 'STY-0002', libera_private_edit: false }, { codigo: 'STY-0003' },
  ]
  assert.deepEqual(stylistsLiberadas(lista).map((s) => s.codigo), ['STY-0001'])
  assert.deepEqual(stylistsParaEditar(lista, 'STY-0002').map((s) => s.codigo), ['STY-0001', 'STY-0002'])
  assert.deepEqual(stylistsLiberadas(null), [])
})

test('base do Private Edit: a nota diz as etapas de hoje; sem nenhuma, diz como liberar', () => {
  assert.equal(notaDaBaseDoPrivateEdit(['Ativada']), 'Só aparecem as parceiras em etapas que liberam Private Edit (hoje: Ativada).')
  assert.match(notaDaBaseDoPrivateEdit(['Ativada', 'VIP']), /hoje: Ativada e VIP/)
  assert.match(notaDaBaseDoPrivateEdit([]), /Nenhuma etapa libera Private Edit/)
  assert.match(vazioDaBaseDoPrivateEdit(['Ativada']), /Nenhuma parceira está em Ativada ainda/)
  assert.equal(vazioDaBaseDoPrivateEdit([]), '')
})

test('recusa de criar e de editar com stylist não liberada: frase em português', () => {
  assert.equal(mensagemDeCriar({ situacao: 'stylist_nao_liberada', erro: 'Do banco.' }), 'Do banco.')
  assert.match(mensagemDeCriar({ situacao: 'stylist_nao_liberada' }), /Ativada/)
  assert.match(mensagemDeEditar('stylist_nao_liberada'), /anfitriã/)
  assert.notEqual(mensagemDeEditar('stylist_nao_liberada'), mensagemDeEditar('algo_novo'))
})
