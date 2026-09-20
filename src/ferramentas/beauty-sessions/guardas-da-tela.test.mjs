import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* AS GUARDAS DA TELA DE BEAUTY SESSIONS — no estilo de
 * `../comercial-vessel/navegacao.test.mjs` e `../comercial-vessel/largura.test.mjs`:
 * leem o `.vue` de verdade e conferem o FIO que liga a tela à regra pura.
 *
 * ⚠️ POR QUE ISTO EXISTE: um teste de unidade sobre `calcularConjunto` ou
 * `podeExecutarAcao` (beauty-sessions-regras.test.mjs) prova que a FUNÇÃO está
 * certa — nunca prova que o `.vue` chama ela com a lista certa, nem que o
 * botão certo está atrás do `v-if` certo. Foram exatamente essas duas coisas
 * que escaparam na tela irmã (Private Edit, private-edit-regras.js): o total
 * de vagas somando a lista CHEIA enquanto a contagem ao lado já seguia o
 * filtro, e "Encerrar"/"Reabrir" fora do `v-if` que já protegia
 * Editar/Arquivar/Apagar. As duas rodadas de review dela custaram porque
 * ninguém tinha um teste que lesse o TEMPLATE.
 */

const CAMINHO = new URL('./tela-de-beauty-sessions.vue', import.meta.url)
const ler = () => readFileSync(CAMINHO, 'utf8')

test('⚠️ o conjunto soma sobre a lista FILTRADA (sessoesNaTela), não a cheia (sessoes)', () => {
  const fonte = ler()
  assert.match(fonte, /calcularConjunto\(\s*sessoesNaTela\.value\s*\)/,
    'a tela precisa chamar calcularConjunto(sessoesNaTela.value)')
  // ⚠️ A REGRA NÃO É SÓ "existe uma chamada certa" — é "NENHUMA chamada errada".
  // `calcularConjunto(sessoes.value)` (a lista cheia, sem filtro) é exatamente
  // o Critical que a tela irmã cometeu.
  assert.doesNotMatch(fonte, /calcularConjunto\(\s*sessoes\.value\s*\)/,
    'a tela não pode somar o conjunto sobre a lista CHEIA (sessoes.value)')
})

test('⚠️ a lista renderizada (v-for) é a filtrada, não a cheia', () => {
  const fonte = ler()
  assert.match(fonte, /v-for="s in sessoesNaTela"/,
    'o v-for das sessões precisa iterar sobre sessoesNaTela, não sessoes')
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

test('⚠️ R13: Encerrar E Reabrir vivem atrás do MESMO gate de editar que os outros três', () => {
  const fonte = ler()
  const tagDoGate = `<template v-if="podeExecutarAcao('encerrar', podeEditar)">`
  const idxGate = fonte.indexOf(tagDoGate)
  assert.ok(idxGate !== -1, `a tela precisa ter a tag ${tagDoGate}`)
  const inicioDoConteudo = idxGate + tagDoGate.length

  const idxEncerrar = fonte.indexOf('>Encerrar…<', inicioDoConteudo)
  assert.ok(idxEncerrar !== -1, 'o botão "Encerrar…" precisa estar dentro do gate')
  const idxReabrir = fonte.indexOf('>Reabrir<', inicioDoConteudo)
  assert.ok(idxReabrir !== -1, 'o botão "Reabrir" precisa estar depois do gate no arquivo')

  // ⚠️⚠️ POR QUE CONTAR `<template>` EM VEZ DE FATIAR ATÉ O PRÓXIMO GATE: a
  // versão anterior deste teste cortava o texto do gate de encerrar até o
  // gate de editar e só conferia PRESENÇA de texto na fatia — não posição
  // nem aninhamento. Medido ao vivo (achado na T12, na tela irmã Stylist
  // Circle, e replicado aqui): mover a abertura do gate para DENTRO do
  // `<template v-if="s.ativa">` — o MESMO Critical que este teste afirma
  // proteger, só que disfarçado — deixa ">Reabrir<" caindo na MESMA fatia
  // (ele continua antes do gate de editar), e a versão antiga deste teste
  // PASSAVA com essa mutação. Só a conta de saldo de
  // `<template>`/`</template>` pega: um gate que fechou antes de chegar em
  // "Reabrir" deixa saldo 0 (nível do gate), não o saldo ≥1 esperado quando
  // o botão ainda está dentro do `s.ativa` aninhado por dentro do gate.
  const saldoAteEncerrar = saldoDeTemplates(fonte, inicioDoConteudo, idxEncerrar)
  assert.ok(saldoAteEncerrar >= 1,
    `o botão "Encerrar…" precisa estar dentro de pelo menos um <template> aninhado ` +
    `ainda aberto (o de s.ativa) — saldo veio ${saldoAteEncerrar}`)
  const saldoAteReabrir = saldoDeTemplates(fonte, inicioDoConteudo, idxReabrir)
  assert.equal(saldoAteReabrir, 0,
    'o botão "Reabrir" não está mais dentro do template do gate (saldo de <template> quebrado) — ' +
    'é o Critical desta tela, só que com o gate movido para DENTRO do if de ativa')

  // ⚠️ E OS DOIS BOTÕES NÃO PODEM APARECER FORA DO GATE, antes dele — o
  // defeito da tela irmã era exatamente "Reabrir" solto, sem v-if nenhum.
  const antesDoGate = fonte.slice(0, idxGate)
  assert.doesNotMatch(antesDoGate, />Reabrir</,
    '"Reabrir" apareceu ANTES do gate de encerrar — está solto, sem trava')
  assert.doesNotMatch(antesDoGate, />Encerrar…</,
    '"Encerrar…" apareceu ANTES do gate de encerrar — está solto, sem trava')
})

test('editar, arquivar e apagar vivem atrás do gate de editar', () => {
  const fonte = ler()
  const gate = "podeExecutarAcao('editar', podeEditar)"
  const idxGate = fonte.lastIndexOf(gate) // o segundo uso: o das ações (o primeiro é o do bloco inline de editar)
  assert.ok(idxGate !== -1, `a tela precisa ter o gate ${gate} nas ações`)
  const trecho = fonte.slice(idxGate, idxGate + 900)
  assert.match(trecho, />Editar…</)
  assert.match(trecho, /rotuloDeArquivar\(s\.arquivada\)/)
  assert.match(trecho, />Apagar…</)
})
