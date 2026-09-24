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

/**
 * A PILHA de `<template ...>` ainda abertos num ponto do arquivo — a tag de
 * abertura de cada um, do mais de fora para o mais de dentro.
 *
 * ⚠️ POR QUE PILHA E NÃO SALDO (24/09/2026): com os botões redistribuídos em
 * grupos (pedido do dono, "mais evidentes"), cada ação passou a ter o próprio
 * portão. O saldo de aberturas menos fechamentos PASSAVA com um botão FORA do
 * portão dele, desde que outro `<template>` qualquer estivesse aberto no mesmo
 * nível — medido nesta mesma entrega: a versão antiga deste teste continuou
 * verde depois da reorganização por pura coincidência de contagem. A pilha diz
 * QUAL portão envolve o botão, não só quantos.
 */
function templatesAbertosEm(fonte, idx) {
  const pilha = []
  const re = /<template\b[^>]*>|<\/template>/g
  let m
  while ((m = re.exec(fonte)) && m.index < idx) {
    if (m[0].startsWith('</')) pilha.pop()
    else pilha.push(m[0])
  }
  return pilha
}

const portao = (acao) => `<template v-if="podeExecutarAcao('${acao}', podeEditar)">`

test('⚠️ cada botão que escreve mora DENTRO do portão da própria ação (pilha, não saldo)', () => {
  const fonte = ler()
  const casos = [
    ['cadastrar_lead', '/>Cadastrar lead</button>'],
    ['editar', '/>Editar…</button>'],
    ['encerrar', '/>Encerrar…</button>'],
    ['encerrar', '/>Reabrir</button>'],
    ['arquivar', 'rotuloDeArquivar(s.arquivada)'],
    ['apagar', '/>Apagar…</button>'],
    ['apagar', '/>Apagar de vez</button>'],
  ]
  for (const [acao, marcador] of casos) {
    const idx = fonte.indexOf(marcador)
    assert.ok(idx !== -1, `não achei o botão "${marcador}" na tela`)
    assert.equal(fonte.indexOf(marcador, idx + 1), -1, `o botão "${marcador}" aparece duas vezes`)
    const pilha = templatesAbertosEm(fonte, idx)
    assert.ok(pilha.includes(portao(acao)),
      `"${marcador}" está FORA do portão ${portao(acao)} — pilha: ${JSON.stringify(pilha)}`)
  }
})

test('⚠️ a guarda da pilha pega o botão tirado de dentro do portão (prova por mutação)', () => {
  const fonte = ler()
  // Tira o "Apagar…" de dentro dos portões, colando-o logo depois do fecho do
  // grupo do fim: é exatamente o defeito que a guarda existe para pegar.
  const marcador = '/>Apagar…</button>'
  const semOBotao = fonte.replace(/<button v-if="apagando !== s\.codigo"[^]*?\/>Apagar…<\/button>/, '')
  const fimDoGrupo = semOBotao.indexOf('<p v-if="erroDeArquivar')
  const mutante = semOBotao.slice(0, fimDoGrupo)
    + '<button class="btn btn-perigo" @click="apagando = s.codigo"><icone-do-bloco nome="lixeira" />Apagar…</button>'
    + semOBotao.slice(fimDoGrupo)
  const idx = mutante.indexOf(marcador)
  assert.ok(idx !== -1)
  assert.ok(!templatesAbertosEm(mutante, idx).includes(portao('apagar')),
    'a pilha deveria acusar o "Apagar…" fora do portão')
})

test('⚠️ arquivar e apagar ficam no grupo do FIM, separados das ações da sessão', () => {
  const fonte = ler()
  const sessao = fonte.indexOf('class="bs-acoes bs-acoes-sessao"')
  const fim = fonte.indexOf('class="bs-acoes bs-acoes-fim"')
  assert.ok(sessao !== -1 && fim !== -1 && sessao < fim)
  for (const m of ['/>Cadastrar lead</button>', '/>Editar…</button>', '/>Encerrar…</button>', '/>Reabrir</button>']) {
    const i = fonte.indexOf(m)
    assert.ok(i > sessao && i < fim, `"${m}" tem de estar no grupo da sessão`)
  }
  for (const m of ['rotuloDeArquivar(s.arquivada)', '/>Apagar…</button>']) {
    assert.ok(fonte.indexOf(m) > fim, `"${m}" tem de estar no grupo do fim`)
  }
})

test('⚠️ um principal só no cartão: "Cadastrar lead"; o QR entra como apoio', () => {
  const fonte = ler()
  assert.match(fonte, /<qr-para-baixar[^>]*\bapoio\b/, 'o QR do cartão tem de vir como grupo de apoio')
  assert.match(fonte, /class="btn btn-principal id-btn-principal" :disabled="s\.arquivada"/)
  // um só principal no grupo da sessão (o "Cadastrar" do formulário é outro bloco)
  const grupo = fonte.slice(fonte.indexOf('class="bs-acoes bs-acoes-sessao"'), fonte.indexOf('<p v-if="erroAoMexer'))
  assert.equal((grupo.match(/btn-principal/g) || []).length, 2, 'btn-principal + id-btn-principal, num botão só')
})

test('⚠️ o cadastro trava contra duplo toque e mostra o erro do banco', () => {
  const fonte = ler()
  assert.match(fonte, /if \(cadastrando\.value\) return/, 'a função tem de recusar entrar duas vezes')
  assert.match(fonte, /:disabled="cadastrando === s\.codigo"[^>]*\s*@click="cadastrar\(s\)"/, 'o botão tem de travar')
  assert.match(fonte, /recadoDoCadastro\(resposta \|\| \{ ok: false, situacao: `o banco respondeu \$\{r\.status\}` \}\)/,
    'resposta que não é 200 tem de virar recado com o código do banco')
})

// ── UM QR SÓ POR SESSÃO (23/09/2026) ────────────────────────────────────────
// ⚠️ O dono decidiu: "concordo em ser só da mesa". O defeito que esta guarda
// pega é o QR do cartão voltando pela porta dos fundos — um segundo link na
// tela é um segundo QR indo para a gráfica, e a conta da sessão volta a sair
// dividida em dois números que ninguém soma.
test('⚠️ a tela mostra UM QR por sessão (o da mesa), pelo MESMO componente do Material Gráfico', () => {
  const fonte = ler()
  assert.doesNotMatch(fonte, /enderecoDoCartao/, 'o link do cartão voltou para a tela')
  assert.doesNotMatch(fonte, /Os dois QR/, 'o bloco "Os dois QR" voltou')
  assert.equal((fonte.match(/<qr-para-baixar\b/g) || []).length, 1, 'tem de haver exatamente um <qr-para-baixar>')
  assert.match(fonte, /<qr-para-baixar[^>]*:endereco="itemDaBeauty\(s\)\.endereco"/,
    'o QR da tela tem de vir de itemDaBeauty — o mesmo item do Material Gráfico')
  assert.match(fonte, /name: 'material-grafico'/, 'falta o atalho "Ver no Material Gráfico"')
})

test('⚠️ "Leram o QR" é UM número (mesa + cartão), nas sessões e no conjunto', () => {
  const fonte = ler()
  assert.doesNotMatch(fonte, /Leram na mesa|Leram o cartão/, 'os dois números separados voltaram')
  assert.match(fonte, /conta\(s\)\.leituras/, 'a sessão tem de mostrar resumoDaSessao().leituras (a soma)')
  assert.match(fonte, /conjunto\.totalLeituras/, 'o conjunto tem de mostrar totalLeituras (a soma)')
  assert.equal((fonte.match(/bs-numero-rotulo">Leram o QR</g) || []).length, 2, 'um "Leram o QR" na sessão e um no conjunto')
})

// ── O SISTEMA DE BOTÕES COM SENTIDO (para as outras ferramentas usarem) ─────
test('⚠️ os sete sentidos existem na folha de identidade, pela variável, sem hex', () => {
  const css = readFileSync(new URL('../../estilos/identidade-da-ferramenta.css', import.meta.url), 'utf8')
  const bloco = css.slice(css.indexOf('BOTÕES COM SENTIDO (24/09/2026)'))
  for (const c of ['principal', 'editar', 'apoio', 'parar', 'voltar', 'arquivar', 'perigo']) {
    assert.match(bloco, new RegExp(`\\.btn\\.id-btn-${c}\\b`), `falta .id-btn-${c}`)
  }
  assert.doesNotMatch(bloco, /#[0-9a-f]{3,8}\b/i, 'cor cravada em hex no sistema de botões')
  assert.match(bloco, /--tom-btn: var\(--tom-acao, var\(--modulo\)\)/, 'o tom tem de vir da ferramenta')
  // ⚠️ nunca `--tom`: é a cor da SITUAÇÃO do cartão
  assert.doesNotMatch(bloco, /var\(--tom\)/)
})
