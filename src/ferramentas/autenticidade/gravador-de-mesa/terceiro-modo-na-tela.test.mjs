/* O TERCEIRO MODO NA TELA: "gravar pelo leitor de mesa".
 *
 * Ao lado de "gravar encostando o celular" e "gravar pelo aplicativo". Ele só
 * aparece dentro do programa da janela (gravador/janela/), que abre ESTA MESMA
 * tela e empresta o ACR122U para ela.
 *
 * É pelo código-fonte porque `node --test` não compila `.vue` — mesma técnica de
 * `gravar-marca-a-peca-certa.test.mjs`. O que É a regra (ler antes, planejar em
 * cima do que leu, escrever, conferir, marcar) se prova de verdade em
 * `gravar-pelo-leitor-de-mesa.test.mjs`, com a porta injetada. O que fica aqui é
 * a LIGAÇÃO: que a tela chama aquilo, que o modo só aparece quando o programa
 * está, e que nada do que já existia se perdeu.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fonte = readFileSync(new URL('../tela-de-autenticidade.vue', import.meta.url), 'utf8')
const template = fonte.slice(0, fonte.indexOf('<script setup>'))
const script = fonte.slice(fonte.indexOf('<script setup>'), fonte.indexOf('</script>'))
const estilo = fonte.slice(fonte.indexOf('<style scoped>'))

function corpoDaFuncao(nome) {
  const abre = script.indexOf(`function ${nome}(`)
  assert.notEqual(abre, -1, `função ${nome} sumiu da tela`)
  let nivel = 0
  const i = script.indexOf('{', abre)
  for (let j = i; j < script.length; j += 1) {
    if (script[j] === '{') nivel += 1
    else if (script[j] === '}') { nivel -= 1; if (nivel === 0) return script.slice(i, j + 1) }
  }
  throw new Error(`não achei o fim de ${nome}`)
}

/* ── O MODO SÓ EXISTE ONDE O PROGRAMA ESTÁ ────────────────────────────────── */

test('a tela pergunta ao navegador se o programa está do outro lado', () => {
  assert.match(script, /import \{[^}]*temLeitorDeMesa[^}]*\} from '\.\/gravador-de-mesa\/porta-do-gravador-de-mesa\.js'/s,
    'a porta do leitor de mesa é a única que fala com `window.gravadorDeMesa`')
  assert.match(script, /const temLeitorDeMesaAqui = temLeitorDeMesa\(\)/)
})

test('e ONDE ELE EXISTE, ele é o preferido: nasce ligado', () => {
  // é o caminho automático da bancada — lê, grava, confere e marca sozinho.
  // Nascendo desligado, quem abriu o programa ainda teria de procurar o botão.
  assert.match(script, /const gravaPorMesa = ref\(temLeitorDeMesaAqui\)/)
})

test('fora da janela do programa, nada do modo novo aparece na tela', () => {
  // `temLeitorDeMesaAqui` é falso no navegador comum, e todo botão que leva ao
  // modo novo está atrás dele. Botão que não faz nada é pior que botão nenhum.
  //
  // ⚠️ ERAM DOIS BOTÕES, E É UM DESDE 01/09/2026. Trocar o jeito de gravar
  // aparecia duas vezes porque a aba tinha dois blocos de gravação — um para os
  // modos ao vivo e outro para o do aplicativo. A aba virou a bancada: há UM
  // painel, e trocar de jeito de gravar é decisão de ANTES, que mora atrás do
  // "Mais opções deste lote". O jeito EM USO continua escrito no alto do painel.
  let de = 0
  let quantos = 0
  for (;;) {
    const onde = template.indexOf('Gravar pelo leitor de mesa', de)
    if (onde === -1) break
    de = onde + 1
    quantos += 1
    const atributos = template.slice(template.lastIndexOf('<button', onde), onde)
    assert.match(atributos, /v-if="[^"]*temLeitorDeMesaAqui/,
      'este botão apareceria num navegador comum, onde ele não faz nada')
  }
  assert.equal(quantos, 1, 'a porta de entrada do leitor de mesa sumiu, ou virou duas de novo')
})

test('o botão de gravar diz o que vai acontecer em cada modo', () => {
  // "Gravar nesta etiqueta" com o leitor na mesa faria a pessoa procurar onde
  // encostar o celular.
  //
  // ⚠️ O RÓTULO MUDOU DE CASA, e não de conteúdo. Ele era um ternário no
  // template mais um `textoDeGravando` desta tela — e o MESMO par de frases já
  // existia, provado, em `acaoDaBancada`. Duas cópias da mesma frase é como uma
  // delas fica para trás. Agora o botão desenha o que a conta pura mandou, e
  // quem guarda as frases é `modo-bancada.test.mjs`.
  assert.match(template, /\{\{ acaoDaBancadaAgora\.rotulo \}\}/,
    'o botão parou de desenhar o rótulo que a conta pura decidiu')
  assert.doesNotMatch(script, /const textoDeGravando = computed\(/,
    'voltou uma segunda cópia do rótulo dentro da tela')
})

/* ── OS TRÊS MODOS, E NENHUM ESTADO IMPOSSÍVEL ────────────────────────────── */

test('os três modos continuam alcançáveis a partir de cada um dos outros', () => {
  // PADRAO-DA-CENTRAL item 8: nada do que existia se perde. O modo do aplicativo
  // é o do iPhone, e ele não pode ficar sem porta de saída nem de entrada.
  assert.match(template, /Gravar pelo aplicativo/)
  assert.match(template, /Gravar encostando o celular/)
  assert.match(template, /Gravar pelo leitor de mesa/)
  for (const funcao of ['usarOLeitorDeMesa', 'usarOCelular', 'usarOAplicativo']) {
    assert.match(template, new RegExp(`@click="${funcao}"`), `ninguém chama ${funcao}`)
  }
})

test('trocar de modo mexe nos DOIS interruptores, sempre', () => {
  // com um só, dá para ficar com os dois ligados — e a tela mostra o bloco de um
  // modo com os botões do outro
  for (const funcao of ['usarOLeitorDeMesa', 'usarOCelular', 'usarOAplicativo']) {
    const corpo = corpoDaFuncao(funcao)
    assert.match(corpo, /gravaPorMesa\.value =/, `${funcao} esqueceu do leitor de mesa`)
    assert.match(corpo, /gravaPorNfc\.value =/, `${funcao} esqueceu do celular`)
  }
})

test('trocar de modo apaga o recado do modo anterior', () => {
  // o recado fala de uma etiqueta que não está mais na história — e o "PARE:
  // esta etiqueta já tem OUTRA peça" lido sob outro modo é pior que nenhum
  for (const funcao of ['usarOLeitorDeMesa', 'usarOCelular']) {
    assert.match(corpoDaFuncao(funcao), /recadoNfc\.value = ''/, `${funcao} deixou o recado velho`)
  }
})

test('trocar de modo fica travado durante a gravação', () => {
  // sair do modo no meio apaga o bloco onde o recado é desenhado
  for (const marca of ['Gravar pelo aplicativo', 'Gravar pelo leitor de mesa', 'Gravar encostando o celular']) {
    let de = 0
    for (;;) {
      const onde = template.indexOf(marca, de)
      if (onde === -1) break
      de = onde + 1
      const atributos = template.slice(template.lastIndexOf('<button', onde), onde)
      // o modo do aplicativo não grava nada, e lá não há gravação para atrapalhar
      if (!atributos.includes('gravando')) {
        assert.ok(atributos.includes('temSuporte()') || atributos.includes('temLeitorDeMesaAqui'),
          `"${marca}" troca de modo no meio da gravação`)
      }
    }
  }
})

/* ── A LIGAÇÃO COM A SEQUÊNCIA QUE SE PROVA ───────────────────────────────── */

test('um botão só, e quem escolhe o caminho é o modo em uso', () => {
  // O @click do template virou `tocarNaBancada`: ele é a ÚNICA ação principal da
  // bancada, e a `chave` que a conta pura devolveu é quem diz se aquele toque
  // grava, marca ou manda escolher outro lote. `gravarAgora` continua sendo quem
  // separa os dois caminhos de gravação — um lugar só, como sempre foi.
  assert.match(template, /@click="tocarNaBancada"/)
  assert.match(corpoDaFuncao('tocarNaBancada').replace(/\/\/[^\n]*/g, ''), /gravarAgora\(\)/)
  const corpo = corpoDaFuncao('gravarAgora').replace(/\s+/g, ' ')
  assert.match(corpo, /gravaPorMesa\.value \? gravarNoLeitorDeMesa\(\) : gravarNaEtiqueta\(\)/)
})

test('a tela NÃO reescreve a sequência: ela chama a que se prova', () => {
  // ler antes, planejar em cima do que leu, escrever, ler de volta, conferir e
  // só então marcar. Uma segunda cópia dessa ordem dentro do `.vue` não teria
  // teste nenhum — `node --test` não compila `.vue`.
  const corpo = corpoDaFuncao('gravarNoLeitorDeMesa')
  assert.match(corpo, /await gravarPeloLeitorDeMesa\(\{/)
  assert.doesNotMatch(corpo, /porta\.gravar\(/,
    'a tela voltou a escrever na etiqueta por conta própria, sem a ordem que protege')
  assert.doesNotMatch(corpo, /planoDeGravacao\(/,
    'montar o plano aqui é montar sem a memória lida — é o estrago de 01/09/2026')
})

test('marca SEMPRE a peça que a função escolheu, nunca `proxima.value` de novo', () => {
  // sem o argumento, `marcarGravada()` relê `proxima.value`, que pode ter virado
  // outra peça enquanto a pessoa segurava a etiqueta no leitor
  // sem os comentários: eles CITAM `marcarGravada()` para explicar o perigo, e
  // procurar a citação em vez do código é como nasce defeito falso
  const corpo = corpoDaFuncao('gravarNoLeitorDeMesa').replace(/\/\/[^\n]*/g, '')
  assert.match(corpo, /marcar: \(\) => marcarGravada\(peca\.codigo\)/)
  assert.doesNotMatch(corpo, /marcarGravada\(\)/)
})

test('sem o programa do outro lado, o modo se desliga em vez de travar', () => {
  const corpo = corpoDaFuncao('gravarNoLeitorDeMesa').replace(/\s+/g, ' ')
  assert.match(corpo, /if \(!porta\) \{ gravaPorMesa\.value = false; return \}/)
})

test('nenhuma saída do leitor de mesa fica sem sinal, e nenhuma ganha dois', () => {
  const corpo = corpoDaFuncao('gravarNoLeitorDeMesa').replace(/\s+/g, ' ')
  // os estados que passaram pelo banco já tiveram o sinal aceso por
  // `marcarGravada`; acender de novo daria dois sinais para a mesma gravação
  assert.match(corpo, /const passouPeloBanco = \['gravada', 'ja-era-dela', 'gravada-sem-marcar'\]/)
  assert.match(corpo, /if \(!passouPeloBanco\) avisarNaTela\('falha'\)/)
  // e a falha do cabo, que não chega a estado nenhum
  assert.match(corpo, /catch \(erro\) \{ recadoNfc\.value = traduzirFalhaDoLeitorDeMesa\(erro\)/)
})

test('a gravação sempre destrava a tela, mesmo dando errado', () => {
  assert.match(corpoDaFuncao('gravarNoLeitorDeMesa').replace(/\s+/g, ' '),
    /finally \{ gravando\.value = false \}/,
    'sem isto, uma falha deixa o botão desligado e a bancada para')
})

/* ── A ETIQUETA QUE JÁ TEM OUTRA PEÇA ─────────────────────────────────────── */

test('etiqueta com outra peça abre a MESMA pergunta do caminho do celular', () => {
  const corpo = corpoDaFuncao('gravarNoLeitorDeMesa')
  assert.match(corpo, /if \(r\.estado === 'outra-peca'\)/)
  assert.match(corpo, /abrirPerguntaDeSobrescrita\(peca, r\.codigoAntigo\)/)
})

test('a pergunta de sobrescrever é montada em UM lugar só na tela inteira', () => {
  // duas cópias divergem, e a que fica para trás pergunta sobre a bolsa errada
  // antes de apagar a identidade dela
  assert.equal((script.match(/sobrescrita\.value = \{/g) || []).length, 1)
})

test('a sobrescrita no leitor de mesa também é BANCO PRIMEIRO, ETIQUETA DEPOIS', () => {
  const corpo = corpoDaFuncao('sobrescreverEtiqueta')
  const registro = corpo.indexOf("rpc('vessel_sobrescrever_etiqueta'")
  const mesa = corpo.indexOf('escreverEConferir({ porta')
  assert.ok(registro !== -1 && mesa !== -1, 'faltou um dos dois passos')
  assert.ok(registro < mesa,
    'gravar antes de registrar deixa duas bolsas com a mesma identidade se a segunda metade falhar')
})

test('no modo de mesa a sobrescrita NÃO desiste por falta de NFC no navegador', () => {
  // o computador da bancada não grava NFC pelo navegador: `criarGravador()`
  // devolve nulo. Sem esta condição a sobrescrita desistia calada, com a
  // pergunta ainda na tela e a pessoa esperando.
  const corpo = corpoDaFuncao('sobrescreverEtiqueta').replace(/\s+/g, ' ')
  assert.match(corpo, /const gravador = gravaPorMesa\.value \? null : criarGravador\(\)/)
  assert.match(corpo, /if \(!gravaPorMesa\.value && !gravador\)/)
})

test('a etiqueta é solta mesmo quando a sobrescrita de mesa dá errado', () => {
  const corpo = corpoDaFuncao('sobrescreverEtiqueta').replace(/\s+/g, ' ')
  assert.match(corpo, /finally \{ await porta\.desconectar\(\) \}/,
    'leitor preso à etiqueta que já saiu da mesa trava a peça seguinte')
})

/* ── A TRAVA PERMANENTE NÃO SE OFERECE ONDE ELA NÃO EXISTE ────────────────── */

test('o interruptor de travar a etiqueta some no modo do leitor de mesa', () => {
  // travar mexe na página 40 e no Capability Container, é irreversível, e o
  // motor do leitor de mesa não faz isso. Um interruptor que não trava nada
  // seria uma promessa falsa numa ação que não tem volta.
  //
  // A CONDIÇÃO SUBIU UM NÍVEL em 01/09/2026: o interruptor ganhou um título de
  // seção ("A trava da etiqueta"), e título sozinho sem o interruptor embaixo
  // seria um cabeçalho apontando para o nada. Os dois entram e saem juntos, num
  // `<template v-if>` em volta — mesma condição, mesmo comportamento.
  const onde = template.indexOf('class="au-trava"')
  assert.notEqual(onde, -1, 'sumiu o interruptor da trava')
  const antes = template.slice(0, onde)
  assert.match(antes.slice(antes.lastIndexOf('<template v-if=')), /^<template v-if="!gravaPorMesa">/,
    'a trava tem de continuar atrás de `!gravaPorMesa`, com o título dela')
})

/* ── O PADRÃO DA CENTRAL ──────────────────────────────────────────────────── */

test('os botões novos usam a classe da tela, sem `style` solto e com 40px de alvo', () => {
  for (const marca of ['Gravar pelo leitor de mesa', 'Gravar no leitor de mesa']) {
    let de = 0
    for (;;) {
      const onde = template.indexOf(marca, de)
      if (onde === -1) break
      de = onde + 1
      const atributos = template.slice(template.lastIndexOf('<button', onde), onde)
      assert.match(atributos, /class="au-botao/, `"${marca}" fora da classe da tela`)
      assert.doesNotMatch(atributos, /style=/, `"${marca}" com \`style\` solto`)
    }
  }
  // `.au-botao` já garante os 40px, e é o mesmo botão dos outros dois modos
  assert.match(estilo, /\.au-botao\{[^}]*min-height:40px/)
})

test('nenhum hex de cor novo entrou com o modo novo', () => {
  // PADRAO-DA-CENTRAL item 2: só token. O modo do leitor de mesa não trouxe
  // estilo nenhum — ele reaproveita as classes da tela, que já estão medidas
  // nos dois temas.
  //
  // `.au-recado-nfc` SAIU DA LISTA em 01/09/2026: o recado da gravação tinha um
  // bloco só dele, logo acima do bloco de estado que dizia a MESMA coisa em
  // outras palavras. Ele agora é o `detalhe` do estado — mesmo texto, mesmo
  // `recadoNfc`, um lugar só.
  for (const classe of ['au-endereco', 'au-botao', 'au-bancada-detalhe']) {
    assert.ok(estilo.includes(`.${classe}`), `a classe .${classe} sumiu do estilo`)
  }
  const semComentario = estilo.replace(/\/\*[^]*?\*\//g, '')
  assert.doesNotMatch(semComentario, /#[0-9a-fA-F]{3,8}\b/, 'hex de cor na tela')
})
