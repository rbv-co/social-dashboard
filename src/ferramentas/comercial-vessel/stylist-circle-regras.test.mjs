import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  podeExecutarAcao, calcularConjunto, precisaDasDesativadas,
  mensagemDeCriar, mensagemDeEditar, mensagemDeDesativar, rotuloDeDesativar,
  problemasDaParceira,
} from './stylist-circle-regras.js'

const telaFonte = () => readFileSync(new URL('./tela-de-stylist-circle.vue', import.meta.url), 'utf8')

// ── R13: quais acoes exigem a permissao de editar ───────────────────────────

test('R13: criar, editar, desativar E reativar EXIGEM editar', () => {
  // ⚠️ "reativar" e o mesmo risco que "Reabrir"/"Encerrar" levaram na tela
  // irma do Private Edit: um `v-else` sem o MESMO gate do `v-if` passa batido
  // num teste que so olhe a funcao pura chamada uma vez. Por isso ele entra
  // na MESMA lista que "desativar" — sao o mesmo botao, a mesma chamada, so
  // que com `p_ativa` trocado.
  for (const acao of ['criar', 'editar', 'desativar', 'reativar']) {
    assert.equal(podeExecutarAcao(acao, false), false, `${acao} deveria exigir editar`)
    assert.equal(podeExecutarAcao(acao, true), true, `${acao} deveria liberar com editar`)
  }
})

test('copiar o link (leitura) nao exige editar', () => {
  assert.equal(podeExecutarAcao('copiar-link', false), true)
  assert.equal(podeExecutarAcao('copiar-link', true), true)
})

// ── o conjunto segue a lista que recebe, nao uma lista cravada ──────────────

test('calcularConjunto: soma so o que esta NA LISTA recebida', () => {
  const TODAS = [
    { codigo: 'STY-0001', aberturas: 10, clientes: 4, receita: 500, janela_de_venda_em_dias: 7 },
    { codigo: 'STY-0002', aberturas: 5, clientes: 1, receita: 100, janela_de_venda_em_dias: 7 },
    { codigo: 'STY-0003', aberturas: 20, clientes: 8, receita: 900, janela_de_venda_em_dias: 7 },
  ]
  const FILTRADA = TODAS.slice(0, 2) // como se o filtro tivesse deixado so 2 de 3

  const totalDasTodas = calcularConjunto(TODAS)
  const totalDaFiltrada = calcularConjunto(FILTRADA)

  assert.equal(totalDasTodas.totalStylists, 3)
  assert.equal(totalDasTodas.totalAberturas, 35)
  assert.equal(totalDasTodas.totalReceita, 1500)

  // ⚠️ A ASSERCAO QUE FALHARIA NO BUG DA IRMA: se `calcularConjunto` (ou quem a
  // chama) ignorasse o filtro e sempre somasse TODAS, isto viria 35, nao 15.
  assert.equal(totalDaFiltrada.totalStylists, 2)
  assert.equal(totalDaFiltrada.totalAberturas, 15)
  assert.equal(totalDaFiltrada.totalReceita, 600)
})

test('calcularConjunto: lista vazia nao quebra, e sem base a taxa nao vira 0%', () => {
  const c = calcularConjunto([])
  assert.equal(c.totalStylists, 0)
  assert.equal(c.totalAberturas, 0)
  assert.equal(c.totalReceita, 0)
  assert.equal(c.conjuntoClientes.temBase, false)
  assert.equal(c.janela, null)
})

test('calcularConjunto: a taxa soma numerador e denominador do CONJUNTO, nao a media', () => {
  const LISTA = [
    { aberturas: 2, clientes: 2 }, // 100%
    { aberturas: 8, clientes: 0 }, // 0%
  ]
  const c = calcularConjunto(LISTA)
  // Media simples daria 50%; a conta certa e 2 de 10 = 20%.
  assert.equal(c.conjuntoClientes.x, 2)
  assert.equal(c.conjuntoClientes.n, 10)
  assert.equal(c.conjuntoClientes.valor, 0.2)
})

test('calcularConjunto: a janela vem da primeira linha da lista recebida', () => {
  const c = calcularConjunto([{ janela_de_venda_em_dias: 7 }, { janela_de_venda_em_dias: 7 }])
  assert.equal(c.janela, 7)
})

// ── precisaDasDesativadas: as duas situacoes que exigem re-fetch ────────────

test('⚠️ precisaDasDesativadas: so "encerradas" e "todas" pedem o banco de novo', () => {
  assert.equal(precisaDasDesativadas('abertas'), false)
  assert.equal(precisaDasDesativadas('encerradas'), true)
  assert.equal(precisaDasDesativadas('todas'), true)
  assert.equal(precisaDasDesativadas(undefined), false)
})

test('precisaDasDesativadas NAO E precisaDoBanco da irma: nao conhece "arquivadas"', () => {
  // ⚠️ O Stylist Circle nao tem arquivada — so ativa/desativada. Confundir as
  // duas funcoes faria "Só arquivadas" (que nem existe nesta tela) disparar
  // o re-fetch e "Só desativadas" (que existe) nao disparar nada.
  assert.equal(precisaDasDesativadas('arquivadas'), false)
})

// ── as frases de cada função ─────────────────────────────────────────────

test('criar: cada situacao tem a sua frase, e uma desconhecida ainda devolve string', () => {
  assert.equal(mensagemDeCriar('ok'), '')
  assert.match(mensagemDeCriar('sem_permissao'), /permissão/)
  assert.match(mensagemDeCriar('sem_nome'), /nome/)
  assert.match(mensagemDeCriar('whatsapp_invalido'), /WhatsApp/)
  assert.match(mensagemDeCriar('praca_invalida'), /praça/)
  assert.match(mensagemDeCriar('whatsapp_repetido'), /já existe/i)
  assert.match(mensagemDeCriar('sem_codigo_livre'), /instante/)
  assert.match(mensagemDeCriar('codigo_em_disputa'), /ao mesmo tempo/)
  assert.match(mensagemDeCriar('conflito_no_cadastro'), /instante/)
  assert.equal(typeof mensagemDeCriar('algo_novo_do_banco'), 'string')
  assert.notEqual(mensagemDeCriar('algo_novo_do_banco'), '')
})

test('editar: cada situacao tem a sua frase, incluindo as que criar tambem tem', () => {
  assert.equal(mensagemDeEditar('ok'), '')
  assert.match(mensagemDeEditar('sem_permissao'), /permissão/)
  assert.match(mensagemDeEditar('nao_achei'), /achei mais esta parceira/)
  assert.match(mensagemDeEditar('whatsapp_invalido'), /WhatsApp/)
  assert.match(mensagemDeEditar('whatsapp_repetido'), /já existe/i)
  assert.match(mensagemDeEditar('praca_invalida'), /praça/)
})

test('desativar: cada situacao tem a sua frase (serve para desativar E reativar)', () => {
  assert.equal(mensagemDeDesativar('ok'), '')
  assert.match(mensagemDeDesativar('sem_permissao'), /permissão/)
  assert.match(mensagemDeDesativar('nao_achei'), /achei mais esta parceira/)
})

test('rotulo de desativar/reativar e o oposto do estado atual', () => {
  assert.equal(rotuloDeDesativar(true), 'Desativar…')
  assert.equal(rotuloDeDesativar(undefined), 'Desativar…') // sem o campo, conta como ativa
  assert.equal(rotuloDeDesativar(false), 'Reativar')
})

test('problemasDaParceira: nome e whatsapp sao os dois obrigatorios no cliente', () => {
  assert.deepEqual(problemasDaParceira({ nome: 'Ana', whatsapp: '19999998888' }), [])
  assert.equal(problemasDaParceira({ nome: '', whatsapp: '19999998888' }).length, 1)
  assert.equal(problemasDaParceira({ nome: 'Ana', whatsapp: '' }).length, 1)
  assert.equal(problemasDaParceira({ nome: '  ', whatsapp: 'abc' }).length, 2)
  assert.equal(problemasDaParceira().length, 2)
})

test('problemasDaParceira: praça NÃO é exigida — é opcional em vessel_stylist_criar', () => {
  assert.deepEqual(problemasDaParceira({ nome: 'Ana', whatsapp: '19999998888', praca: '' }), [])
})

// ── guardas de FIAÇÃO no .vue (texto-fonte, não execução) ───────────────────
//
// ⚠️ POR QUE ISTO EXISTE: os Critical das duas telas irmãs não estavam nas
// funções puras — estavam no TEMPLATE (a lista errada num total, um botão
// fora do `v-if` certo). Um teste que só chama `calcularConjunto(lista)`
// diretamente nunca vê qual lista o `.vue` decidiu entregar a ela. Como
// `.vue` não roda na suíte, a única rede que alcança essa fiação é ler o
// arquivo como TEXTO — o mesmo padrão de `private-edit-regras.test.mjs`,
// `navegacao.test.mjs` e `largura.test.mjs`.

test('FIACAO: o conjunto e calculado sobre a lista FILTRADA (stylistsNaTela), nunca a cheia', () => {
  const fonte = telaFonte()
  assert.ok(fonte.includes('calcularConjunto(stylistsNaTela.value)'),
    'a tela precisa chamar calcularConjunto(stylistsNaTela.value) — sem isso, ' +
    'o conjunto pode voltar a somar sobre a lista sem filtro')
  assert.ok(!fonte.includes('calcularConjunto(stylists.value)'),
    'a tela NAO pode chamar calcularConjunto com a lista cheia (stylists.value)')
})

test('FIACAO: o v-for das stylists itera sobre a lista FILTRADA, nao a cheia', () => {
  const fonte = telaFonte()
  assert.match(fonte, /v-for="s in stylistsNaTela"/,
    'o v-for das stylists precisa iterar sobre stylistsNaTela, nao stylists')
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

test('FIACAO: Desativar E Reativar vivem atras do MESMO gate de editar', () => {
  const fonte = telaFonte()
  const tagDoGate = `<template v-if="podeExecutarAcao('desativar', podeEditar)">`
  const idxGate = fonte.indexOf(tagDoGate)
  assert.ok(idxGate !== -1, `a tela precisa ter a tag ${tagDoGate}`)
  const inicioDoConteudo = idxGate + tagDoGate.length

  const idxDesativar = fonte.indexOf('>Desativar…<', inicioDoConteudo)
  assert.ok(idxDesativar !== -1, 'o botão "Desativar…" precisa estar dentro do gate')
  const idxReativar = fonte.indexOf('>Reativar<', inicioDoConteudo)
  assert.ok(idxReativar !== -1, 'o botão "Reativar" precisa estar depois do gate no arquivo')

  // ⚠️ POR QUE CONTAR `<template>` EM VEZ DE SÓ PROCURAR O TEXTO: uma fatia
  // ingênua ("está tudo antes do próximo `</div>`?") PASSA MESMO QUANDO O
  // GATE FOI ENCOLHIDO — bastou mover a tag de abertura do gate para DENTRO
  // do `<template v-if="s.ativa !== false">` (o mesmo Critical das telas
  // irmãs, só que disfarçado) que o texto "Reativar" continuava aparecendo
  // na mesma fatia, sem estar mais protegido por permissão nenhuma. Medido
  // ao vivo: a versão anterior deste teste PASSAVA com essa mutação — só a
  // conta de saldo de `<template>`/`</template>` pega, porque um gate que
  // fechou antes de chegar em "Reativar" deixa um saldo NEGATIVO (mais
  // fechamentos que aberturas) no trecho entre o início do gate e o botão.
  // ⚠️ "Desativar…" fica DENTRO do `<template v-if="s.ativa !== false">`
  // aninhado — saldo 1 (esse template aberto, ainda não fechado). Um saldo
  // menor (0 ou negativo) só acontece se ELE, ou o gate por fora dele,
  // tiverem fechado cedo demais.
  const saldoAteDesativar = saldoDeTemplates(fonte, inicioDoConteudo, idxDesativar)
  assert.ok(saldoAteDesativar >= 1,
    `o botão "Desativar…" precisa estar dentro de pelo menos um <template> aninhado ` +
    `ainda aberto (o de s.ativa !== false) — saldo veio ${saldoAteDesativar}`)
  // ⚠️ "Reativar" fica de volta no nível do GATE: o template de `s.ativa`
  // já fechou (saldo líquido 0), mas o gate em si — cuja tag de abertura é
  // o ponto de partida da contagem — ainda não fechou.
  const saldoAteReativar = saldoDeTemplates(fonte, inicioDoConteudo, idxReativar)
  assert.equal(saldoAteReativar, 0,
    'o botão "Reativar" não está mais dentro do template do gate (saldo de <template> quebrado) — ' +
    'é exatamente o Critical das telas irmãs, só que com o gate movido para DENTRO do if de ativa')

  // ⚠️ E OS DOIS BOTÕES NÃO PODEM APARECER FORA DO GATE, antes dele.
  const antesDoGate = fonte.slice(0, idxGate)
  assert.doesNotMatch(antesDoGate, />Reativar</,
    '"Reativar" apareceu ANTES do gate de desativar — está solto, sem trava')
  assert.doesNotMatch(antesDoGate, />Desativar…?</,
    '"Desativar…" apareceu ANTES do gate de desativar — está solto, sem trava')
})

test('FIACAO: Editar (abrir o formulário de corrigir) vive atras do gate de editar', () => {
  const fonte = telaFonte()
  const tagDoGate = `<template v-if="podeExecutarAcao('editar', podeEditar)">`
  const idxGate = fonte.lastIndexOf(tagDoGate)
  assert.ok(idxGate !== -1, `a tela precisa ter a tag ${tagDoGate}`)
  const inicioDoConteudo = idxGate + tagDoGate.length

  const idxCorrigir = fonte.indexOf('>Corrigir…<', inicioDoConteudo)
  assert.ok(idxCorrigir !== -1, 'o botão "Corrigir…" precisa estar dentro do gate')

  // ⚠️ POR QUE CONTAR <template> EM VEZ DE UMA JANELA FIXA DE 600 CARACTERES
  // (a versão anterior deste teste): uma janela fixa a partir do índice do
  // gate PASSA mesmo quando o `</template>` que fecha o gate foi movido para
  // ANTES do botão "Corrigir…" — o texto continua caindo dentro da mesma
  // janela de 600 caracteres, só que fora da proteção de verdade. É o MESMO
  // defeito que o R21 já achou tentando derrubar a guarda de
  // Desativar/Reativar nesta tela (ver o teste logo acima), só que aqui não
  // há um `v-else` para esconder o furo — basta o gate fechar cedo demais.
  // Medido ao vivo: fechar o `<template>` logo depois de abri-lo (deixando o
  // botão de fora, sem trava nenhuma) faz o saldo cair de 0 para -1, e a
  // versão antiga deste teste continuava passando.
  const saldoAteCorrigir = saldoDeTemplates(fonte, inicioDoConteudo, idxCorrigir)
  assert.equal(saldoAteCorrigir, 0,
    `o botão "Corrigir…" precisa estar no MESMO nível do gate (saldo 0) — saldo veio ${saldoAteCorrigir}`)

  const antesDoGate = fonte.slice(0, idxGate)
  assert.doesNotMatch(antesDoGate, />Corrigir…</,
    '"Corrigir…" apareceu ANTES do gate de editar — está solto, sem trava')
})

test('FIACAO: a re-busca ao banco pede p_incluir_desativadas com precisaDasDesativadas', () => {
  const fonte = telaFonte()
  assert.ok(fonte.includes('precisaDasDesativadas(filtro.value.situacao)'),
    'a tela precisa decidir o re-fetch com precisaDasDesativadas(filtro.value.situacao)')
  assert.ok(fonte.includes('p_incluir_desativadas'),
    'a chamada ao banco precisa mandar p_incluir_desativadas')
})

test('FIACAO: a barra NAO mostra período nem loja — esta tela é de parceiras, não de eventos', () => {
  const fonte = telaFonte()
  const idxBarra = fonte.indexOf('<barra-de-lista')
  assert.ok(idxBarra !== -1, 'a tela precisa ter a barra-de-lista')
  const fimBarra = fonte.indexOf('/>', idxBarra)
  const trechoBarra = fonte.slice(idxBarra, fimBarra)
  assert.doesNotMatch(trechoBarra, /'periodo'/, 'a barra desta tela não pode mostrar período')
  assert.doesNotMatch(trechoBarra, /'loja'/, 'a barra desta tela não pode mostrar loja')
  assert.doesNotMatch(fonte, /watch\(\s*\(\)\s*=>\s*filtro\.value\.dias/,
    'não pode existir watcher algum sobre filtro.value.dias nesta tela')
})

test('FIACAO: codigo e origem NUNCA aparecem como campo do formulario de corrigir', () => {
  const fonte = telaFonte()
  // O bloco de editar vai do gate de editar (o de dentro do card, no v-if de
  // "editando === s.codigo") ate o </div> que fecha o cv-form.
  const idxForm = fonte.indexOf("editando === s.codigo")
  assert.ok(idxForm !== -1, 'a tela precisa ter o bloco de editar inline')
  const fimForm = fonte.indexOf('</div>', fonte.indexOf('cv-form', idxForm))
  const trechoForm = fonte.slice(idxForm, fimForm)
  assert.doesNotMatch(trechoForm, /rascunho\.codigo/, 'código não pode ser campo do formulário')
  assert.doesNotMatch(trechoForm, /rascunho\.origem/, 'origem não pode ser campo do formulário')
})
