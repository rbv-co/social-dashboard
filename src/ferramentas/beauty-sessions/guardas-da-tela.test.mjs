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

test('⚠️ R13: Encerrar E Reabrir vivem atrás do MESMO gate de editar que os outros três', () => {
  const fonte = ler()
  const gate = "podeExecutarAcao('encerrar', podeEditar)"
  const idxGate = fonte.indexOf(gate)
  assert.ok(idxGate !== -1, `a tela precisa ter o gate ${gate}`)

  // O próximo gate de ação (editar) marca o fim do bloco de encerrar/reabrir
  // no template — tudo que fica ENTRE os dois gates está atrás do primeiro.
  const gateEditar = "podeExecutarAcao('editar', podeEditar)"
  const idxGateEditar = fonte.indexOf(gateEditar, idxGate + gate.length)
  assert.ok(idxGateEditar !== -1 && idxGateEditar > idxGate,
    'não achei o gate de editar depois do gate de encerrar')

  const trecho = fonte.slice(idxGate, idxGateEditar)
  assert.match(trecho, />Encerrar…?</, 'o botão "Encerrar…" precisa estar dentro do gate')
  assert.match(trecho, />Reabrir</, 'o botão "Reabrir" precisa estar dentro do MESMO gate')

  // ⚠️ E OS DOIS BOTÕES NÃO PODEM APARECER FORA DO GATE, antes dele — o
  // defeito da tela irmã era exatamente "Reabrir" solto, sem v-if nenhum.
  const antesDoGate = fonte.slice(0, idxGate)
  assert.doesNotMatch(antesDoGate, />Reabrir</,
    '"Reabrir" apareceu ANTES do gate de encerrar — está solto, sem trava')
  assert.doesNotMatch(antesDoGate, />Encerrar…?</,
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
