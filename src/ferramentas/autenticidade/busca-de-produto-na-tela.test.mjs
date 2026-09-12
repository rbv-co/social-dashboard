import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ─────────────────────────────────────────────────────────────────────────
// O CAMINHO DE FALHA DA BUSCA, e o Enter que criava lote.
//
// A tradução do erro em duas frases se prova por comportamento em
// `src/compartilhado/chamada-do-bling.test.mjs` (`avisoDoErro`). O que se prova
// AQUI é a ligação: que a tela usa aquele caminho em vez de refazê-lo à mão —
// foi refazendo-o à mão que ela mandou `[object Object]` para a pessoa e culpou
// o Bling por um 403 de crachá.
//
// É pelo código-fonte porque `node --test` não compila `.vue` — mesma técnica de
// `gravar-marca-a-peca-certa.test.mjs`.
// ─────────────────────────────────────────────────────────────────────────
const TELA = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8')

test('carregarProdutos traduz a falha pelo caminho de sempre, nao a mao', () => {
  assert.match(TELA, /erroProdutos\.value = avisoDoErro\(e, \{ ehAdmin/,
    'o catch tem de passar o ERRO para o avisoDoErro')
  assert.doesNotMatch(TELA, /textoDoAviso\(e\.message/,
    '`e.message` é o texto TÉCNICO: nenhuma causa casa com ele, e todo erro virava "O Bling não respondeu"')

  // O AVISO TEM DE USAR O MESMO PODER QUE ABRE O FORMULÁRIO. Quem entra aqui
  // entrou por `podeCriar`; passando `podeEditar`, quem tem `criar` sem
  // `editar` caía no ramo não-admin do `textoDoAviso` e lia "Não foi possível
  // buscar as VENDAS agora." — numa tela de etiqueta, que não tem venda
  // nenhuma. Ver `src/compartilhado/chamada-do-bling.js`.
  assert.match(TELA, /avisoDoErro\(e, \{ ehAdmin: podeCriar\.value \}\)/,
    'o aviso segue quem PODE CRIAR, que é quem abre o formulário')
})

test('o aviso de falha mostra as DUAS frases, nunca o objeto inteiro', () => {
  assert.match(TELA, /\{\{ erroProdutos\.titulo \}\}/)
  assert.match(TELA, /\{\{ erroProdutos\.detalhe \}\}/)
  assert.doesNotMatch(TELA, /\{\{ erroProdutos \}\}/,
    'o objeto inteiro num `{{ }}` é a pessoa lendo `[object Object]`')
})

test('⚠️ Enter na busca de produto NAO cria o lote', () => {
  /* O botão de criar é `type="submit"`: Enter em qualquer campo DENTRO do
   * `<form @submit.prevent="gerarLote">` grava as peças no banco sem ninguém
   * pedir. A defesa é o `@keydown.enter.prevent` no campo.
   *
   * ESTE TESTE FOI E VOLTOU NO MESMO DIA, e vale registrar por quê. Em 04/09 eu
   * tirei a busca do formulário para um modal próprio, e troquei a asserção por
   * "o campo não está no form" — que era mais forte NAQUELE desenho. O dono
   * reprovou o desenho (o modal abria atrás do outro, e ele queria o formulário
   * inteiro maior, não um segundo modal). Com a busca de volta dentro do form, a
   * defesa antiga volta a ser a certa.
   *
   * A lição não é "não mude testes": é que uma asserção acompanha o DESENHO, e
   * desenho reprovado leva a asserção junto de volta. */
  const campo = TELA.slice(TELA.indexOf('v-model="buscaProduto"'))
  assert.match(campo.slice(0, campo.indexOf('</label>')), /@keydown\.enter\.prevent/)
})

test('a lista e os avisos da busca acompanham o recuo dos campos', () => {
  // A `.au-folha` tem `padding:22px 0` — cada filho paga o seu recuo lateral.
  // Sem isto a lista e os avisos encostavam na borda com o resto do formulário
  // recuado em 24px (16px no celular).
  assert.match(TELA, /\.au-escolha-produto > \.au-aviso-menor\{padding-left:24px/)
  assert.match(TELA, /\.au-produtos\{[^}]*padding:0 16px/)
  // O `@media` que vale é o do FIM do arquivo: as regras-base deste bloco vêm
  // depois do `@media` de cima e, com a mesma especificidade, o ganhador é o
  // último. Este teste lê a partir da regra-base, então só passa com o `@media`
  // colocado DEPOIS dela.
  const celular = TELA.slice(TELA.indexOf('.au-produtos{list-style'))
  assert.match(celular, /\.au-escolha-produto > \.au-aviso-menor\{padding-left:16px/)
  assert.match(celular, /\.au-produtos\{padding-left:8px/)
})

test('nada e importado sem ser usado — o caso do chamarBling', () => {
  /* A INTENÇÃO DESTE TESTE NUNCA FOI PROIBIR O `chamarBling`: era proibir IMPORT
   * MORTO, que engana quem for ler depois. Ele nasceu quando a função estava
   * importada e não era usada por ninguém.
   *
   * Em 04/09/2026 ela passou a ser usada de verdade — é ela que busca a foto
   * GRANDE do produto no detalhe (`produtos/{id}`), quando se clica na lupa. A
   * asserção passa a exigir o que ela sempre quis dizer: se está importado,
   * tem de ser usado. */
  const importado = /import\s*\{[^}]*\bchamarBling\b[^}]*\}/.test(TELA)
  if (!importado) return
  const usos = (TELA.match(/\bchamarBling\s*\(/g) || []).length
  assert.ok(usos > 0,
    'chamarBling importado e nunca chamado — import morto engana quem for ler depois')
})

// ══════════════════════════════════════════════════════════════════════════
// OS DOIS DEFEITOS DO MODAL DE PRODUTOS — 04/09/2026
// ══════════════════════════════════════════════════════════════════════════
// "ficou uma bosta o modal, travou, não ficou ocupando quase toda a tela no
// pc/notebook, eu clico no botão escolher produto e não abre nada."
// Eram dois, e os dois eram invisíveis lendo o código de perto.

test('⚠️ a variante LARGA vem DEPOIS da base no CSS', () => {
  // `.au-folha` e `.au-folha-larga` têm a MESMA especificidade — uma classe cada
  // — então quem vence é quem vem DEPOIS. Escrita antes, a variante existia no
  // arquivo, parecia certa, e era inteiramente sobrescrita pelo `max-width:420px`
  // da base. O modal saía estreito e não havia nada de errado à vista.
  const base = TELA.indexOf('\n.au-folha{')
  const larga = TELA.indexOf('\n.au-folha-larga{')
  assert.ok(base > 0 && larga > 0, 'sumiu uma das duas regras')
  assert.ok(larga > base,
    'a variante larga está ANTES da base: o max-width de 420px a sobrescreve inteira')
})

test('⚠️ o campo de busca NAO fica desabilitado enquanto carrega', () => {
  /* O DEFEITO ORIGINAL: o controle que abre a lista era `:disabled` enquanto os
   * produtos carregavam, e a busca pode levar dezenas de chamadas ao Bling. O
   * dono clicou num controle morto e concluiu, com razão, que travou.
   *
   * O controle mudou — era um botão "Escolher produto", virou o próprio campo de
   * busca, porque o desenho de dois modais foi reprovado. A preocupação seguiu
   * junto: o que quer que abra a lista NÃO pode nascer desligado. Quem avisa que
   * está carregando é o texto de dentro do campo e a contagem. */
  const campo = TELA.slice(TELA.indexOf('v-model="buscaProduto"'))
  const ateOFim = campo.slice(0, campo.indexOf('</label>'))
  assert.doesNotMatch(ateOFim, /:disabled/,
    'campo desligado por dezenas de segundos é indistinguível de programa travado')
  assert.match(ateOFim, /carregandoProdutos/,
    'sem dizer que está carregando, um campo vazio parece um Bling vazio')
})

test('a espera e VISIVEL: o modal conta os produtos lidos', () => {
  // Tela parada é indistinguível de tela travada. O número cresce a cada página.
  assert.match(TELA, /produtosLidos/, 'sem contador, a espera vira travamento aos olhos')
  assert.match(TELA, /aoProgredir/, 'a paginação precisa avisar a cada página')
})

test('⚠️ a linha da lista NAO tem regra duplicada brigando consigo mesma', () => {
  /* TRES VEZES no mesmo dia (04/09/2026) um defeito visual foi ORDEM de CSS, e
   * nao a regra em si: duas regras da mesma classe, mesma especificidade, e a
   * ultima do arquivo vencendo em silencio. A regra nova ficava la, parecendo
   * certa, sem efeito nenhum.
   *
   * `.au-produto-texto` chegou a ter DUAS: a nova em `row` (nome e referencia
   * lado a lado, que e o pedido) e a velha em `column`, escrita depois — e a
   * velha vencia. Este teste exige UMA regra por classe aqui, que e a forma mais
   * simples de nao haver disputa. */
  for (const classe of ['au-produto-texto', 'au-produto-foto', 'au-produto-lupa']) {
    const quantas = (TELA.match(new RegExp('\\.' + classe + '\\{', 'g')) || []).length
    assert.equal(quantas, 1, `.${classe} tem ${quantas} regras: a ultima vence e a outra engana`)
  }
})

test('a linha e horizontal: foto, texto e lupa lado a lado', () => {
  const bloco = TELA.slice(TELA.indexOf('.au-produto-texto{'))
  assert.match(bloco.slice(0, bloco.indexOf('}')), /flex-direction:row/,
    'nome e referência empilhados: o pedido era tudo numa linha só')
})

test('⚠️ a rolagem MORRE no fim da lista, e nao vaza para o formulario', () => {
  /* "quando vou rolando e chega ao fim, força rolar abaixo e aí sai da lista,
   * desce para o resto dos campos" — 04/09/2026.
   *
   * Isso é ENCADEAMENTO DE ROLAGEM: ao terminar uma área que rola, o navegador
   * entrega o resto do gesto ao pai, e o formulário deslizava por baixo da lista.
   * `overscroll-behavior:contain` faz o gesto morrer ali. É a MESMA linha que o
   * PADRÃO item 4 exige nos fundos de modal, pelo mesmo motivo. */
  /* ⚠️ OLHA A REGRA QUE VENCE, e nao a primeira do arquivo. `.au-produtos` tem
   * mais de uma regra (a base, e a que ajusta a altura), e a que manda e a
   * ULTIMA. Ler a primeira foi o erro que eu cometi escrevendo este proprio
   * teste — ele reprovava com o CSS correto na tela. */
  const regras = [...TELA.matchAll(/\.au-produtos\{([^}]*)\}/g)].map((m) => m[1])
  assert.ok(regras.length > 0, 'sumiu a regra da lista')
  assert.ok(regras.some((r) => /overscroll-behavior:\s*contain/.test(r)),
    'sem isto, chegar ao fim da lista arrasta o formulário para dentro da tela')
})

test('⚠️ os NUMEROS de pagina ficam sempre a vista', () => {
  /* Eu subi a altura da lista para 70dvh e empurrei os números para fora da
   * tela — tendo escrito, no comentário da própria regra, que a lista rolava por
   * dentro PARA os números continuarem à vista. O dono viu na hora.
   *
   * Duas defesas, porque só uma não basta: a lista cede altura, E os números
   * grudam no rodapé — numa tela baixa, ou com o zoom de letra do sistema
   * aumentado, só encolher a lista deixaria eles saírem de novo. */
  const paginas = TELA.slice(TELA.indexOf('.au-paginas{'))
  const regra = paginas.slice(0, paginas.indexOf('}'))
  assert.match(regra, /position:\s*sticky/, 'sem sticky, os números somem em tela baixa')
  assert.match(regra, /bottom:\s*0/)
  assert.match(regra, /background:/, 'sem fundo, a lista passa por baixo e some os números')

  const listas = [...TELA.matchAll(/\.au-produtos\{([^}]*)\}/g)].map((m) => m[1])
  const altura = listas.find((r) => /max-height/.test(r) && /dvh/.test(r))
  const dvh = Number((altura.match(/(\d+)dvh/) || [])[1])
  assert.ok(dvh <= 60, `lista com ${dvh}dvh não deixa espaço para os números no modal`)
})
