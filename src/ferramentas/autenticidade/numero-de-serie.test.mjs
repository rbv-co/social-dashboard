/* O NÚMERO DE SÉRIE — a regra pura, e o porquê de cada guarda.
 *
 * A DECISÃO DO DONO, 02/09/2026: os campos REFERÊNCIA e PEÇA viram um número
 * só, colado — a referência seguida da sequência da peça:
 *
 *     referência H0015S, peça 1   →  H0015S001
 *     referência SS0001HB.M1, peça 1  →  SS0001HBM1001
 *
 * ⚠️ AS LETRAS ENTRAM, e isso mudou em 07/09/2026. Antes só os dígitos contavam,
 * e as letras que dizem a CATEGORIA sumiam: `SS0001HB.M1`, `SS0001CB.M1`,
 * `SS0001SB.S1` e `SS0001L.1` viravam todos `00011`, e a peça 1 de cada um dava
 * `00011001`. Medido no banco no dia da correção: 14 números já estavam em uso
 * por mais de um produto ENTRE PEÇAS GRAVADAS — `00011001` sozinho em oito
 * peças de cinco produtos.
 *
 * ⚠️ A TRAVA. Colado só não é ambíguo ENQUANTO TODA REFERÊNCIA TIVER A MESMA
 * QUANTIDADE DE DÍGITOS. Hoje são quatro (0011, 0012, 0015), então "001512" só
 * pode ser a referência 0015 na peça 12. No dia em que entrar uma de três ou de
 * cinco, "001512" passa a poder ser 0015+12 OU 00151+2 — e um número de série
 * que aponta para duas bolsas não é número de série. O dono escolheu o formato
 * sabendo disso; `serieAmbigua` existe para a tela avisar antes que aconteça.
 *
 * ESTA REGRA JÁ EXISTE DO OUTRO LADO, na página pública do certificado
 * (`vessel-brasil/verify/regras.js`). As duas são a MESMA conta de propósito: o
 * número que a etiqueta manda para a cliente e o número que o painel imprime na
 * bancada têm de ser o mesmo, senão a bolsa da mão não bate com a bolsa da tela.
 * Se um dia uma mudar, a outra muda junto — não há terceira dona da regra.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  numeroDeSerie,
  rotuloDaSerie, prefixoDaSerie, descricaoDaPeca, linhasDaListaDoLote,
  fraseDaPecaNaMao,
} from './lotes.js'

/* ── 1. O FORMATO QUE O DONO ESCOLHEU ─────────────────────────────────────── */

test('o número de série é A REFERÊNCIA INTEIRA colada na sequência da peça', () => {
  assert.equal(numeroDeSerie('H0015S', 1), 'H0015S001')
  assert.equal(numeroDeSerie('H0015S', 12), 'H0015S012')
  assert.equal(numeroDeSerie('C0011S', 3), 'C0011S003')
  // O ponto do SKU novo não entra: ele separa, não identifica.
  assert.equal(numeroDeSerie('SS0001HB.M1', 1), 'SS0001HBM1001')
})

test('⚠️ PRODUTOS DE CATEGORIAS DIFERENTES NÃO COLIDEM MAIS', () => {
  /* O defeito que esta mudança conserta, com os quatro SKUs reais que colidiam.
   * Todos davam `00011001` quando só os dígitos contavam. */
  const quatro = ['SS0001HB.M1', 'SS0001CB.M1', 'SS0001SB.S1', 'SS0001L.1']
    .map((sku) => numeroDeSerie(sku, 1))
  assert.equal(new Set(quatro).size, 4, 'produtos diferentes com o mesmo número: ' + quatro)
})

test('⚠️ nem TAMANHOS diferentes do mesmo modelo colidem', () => {
  // Small e Medium do mesmo modelo: as letras S e M é que os separam.
  assert.notEqual(numeroDeSerie('SS0001HB.S1', 1), numeroDeSerie('SS0001HB.M1', 1))
})

test('⚠️ a sequência tem LARGURA FIXA de 3 casas', () => {
  /* ESTE TESTE ERA O CONTRÁRIO ATÉ 04/09/2026: exigia que a peça 1 saísse como
   * "1", sem enchimento. A decisão mudou porque colar dois números de tamanho
   * variável não tem leitura de volta.
   *
   * TRÊS CASAS BASTAM E ISSO É DEMONSTRÁVEL, não estimado: o banco recusa lote
   * acima de 500 peças, então peça 1000 não existe. */
  assert.equal(numeroDeSerie('H0015S', 1), 'H0015S001')
  assert.equal(numeroDeSerie('H0015S', 9), 'H0015S009')
  assert.equal(numeroDeSerie('H0015S', 10), 'H0015S010')
  assert.equal(numeroDeSerie('H0015S', 500), 'H0015S500')
})

test('⚠️ REFERENCIAS DE TAMANHOS DIFERENTES NAO COLIDEM MAIS', () => {
  /* É o teste que prova que o defeito acabou, e não só que o formato mudou.
   * Antes: 0015 + peça 12 = "001512" = 00151 + peça 2. O mesmo número para duas
   * bolsas diferentes. */
  const quatro = numeroDeSerie('H0015S', 12)   // referência 0015, peça 12
  const cinco = numeroDeSerie('H00151S', 2)    // referência 00151, peça 2
  assert.notEqual(quatro, cinco, 'duas bolsas com o mesmo número de série')
  assert.equal(quatro, 'H0015S012')
  assert.equal(cinco, 'H00151S002')

  // E a leitura de volta é única: tira as 3 últimas, sobra a REFERÊNCIA INTEIRA —
  // não os dígitos dela. Dá para voltar do número de série ao SKU do Bling.
  assert.equal(quatro.slice(0, -3), 'H0015S')
  assert.equal(cinco.slice(0, -3), 'H00151S')
})

test('⚠️ AS LETRAS DA REFERÊNCIA ENTRAM — mudou em 07/09/2026', () => {
  /* ATÉ 07/09/2026 ERA O CONTRÁRIO: só os dígitos entravam, e as letras eram
   * jogadas fora. Foi assim que `SS0001HB.M1`, `SS0001CB.M1`, `SS0001SB.S1` e
   * `SS0001L.1` — quatro produtos diferentes no Bling — viraram todos `00011001`.
   *
   * MEDIDO NO BANCO ANTES DE MUDAR, não estimado: 14 números repetidos entre
   * peças JÁ GRAVADAS, e o `00011001` sozinho em 8 peças de 5 produtos.
   *
   * O que sobra da referência agora são as letras e os dígitos, em maiúscula:
   * some só a pontuação, que é enfeite de escrita e não identifica nada. */
  assert.equal(numeroDeSerie('LV1021', 7), 'LV1021007')
  assert.equal(numeroDeSerie('h0015s', 7), 'H0015S007')     // minúscula sobe
  assert.equal(numeroDeSerie(' H0015S ', 7), 'H0015S007')   // espaço sai
  assert.equal(numeroDeSerie('H-0015/S', 7), 'H0015S007')   // pontuação sai
})

/* ── 2. SEM REFERÊNCIA NÃO HÁ NÚMERO DE SÉRIE ─────────────────────────────── */

test('referência vazia, nula ou só de pontuação não produz número de série', () => {
  // a tela mostra então o que já mostrava (`nº 3`), que é a verdade que se tem —
  // e nunca um traço, que não diz nada
  assert.equal(numeroDeSerie('', 3), '')
  assert.equal(numeroDeSerie(null, 3), '')
  assert.equal(numeroDeSerie(undefined, 3), '')
  assert.equal(numeroDeSerie('- / .', 3), '')
})

test('⚠️ REFERÊNCIA SÓ DE LETRAS AGORA PRODUZ NÚMERO — e isso é decisão', () => {
  /* ATÉ 07/09/2026 `SEMNUMERO` devolvia vazio. Não porque uma referência de
   * letras fosse inválida: é que, jogando as letras fora, não sobrava NADA para
   * montar o número. A guarda era consequência da regra velha, não uma decisão.
   *
   * Agora as letras entram, então sobra referência e o número existe. Um SKU
   * assim IDENTIFICA a bolsa tão bem quanto um com dígitos.
   *
   * MEDIDO: nenhum dos 66 lotes do banco tem referência sem dígito, então isto
   * não muda número de peça nenhuma que exista hoje. Está aqui para que o dia em
   * que aparecer uma, ela ganhe número em vez de cair no `nº 3`. */
  assert.equal(numeroDeSerie('SEMNUMERO', 3), 'SEMNUMERO003')
})

/* ── 3. A GUARDA QUE `Number.isFinite` DEIXAVA PASSAR ─────────────────────── */

test('`Number(null)` é ZERO e é finito — a guarda exige inteiro MAIOR QUE ZERO', () => {
  // Este teste é o que pegou o defeito do outro lado: com `Number.isFinite`, a
  // peça sem número saía como "0015null" na cara da pessoa. Não é sutileza de
  // tipo: é um número de série publicado com a palavra "null" dentro.
  for (const ruim of [null, undefined, '', 0, -1, 1.5, NaN, Infinity, 'abc', {}, []]) {
    const saida = numeroDeSerie('H0015S', ruim)
    assert.equal(saida, '', `numeroDeSerie('H0015S', ${JSON.stringify(ruim)}) devia ser vazio`)
    assert.doesNotMatch(saida, /null|undefined|NaN/,
      'nunca pode sair um número de série com "null" dentro')
  }
})

test('sequência escrita como texto de um inteiro vale — é o que vem do banco', () => {
  assert.equal(numeroDeSerie('H0015S', '12'), 'H0015S012')
})

/* ── 4. A TRAVA DA AMBIGUIDADE ────────────────────────────────────────────── */

test('com referência, o rótulo é o número de série', () => {
  assert.equal(rotuloDaSerie({ numero_na_serie: 12 }, { sku: 'H0015S' }), 'nº de série H0015S012')
})

test('SEM referência o rótulo volta a ser o `nº 3` de sempre', () => {
  // a verdade que se tem, em vez de um traço que não diz nada
  assert.equal(rotuloDaSerie({ numero_na_serie: 3 }, { sku: '' }), 'nº 3')
  assert.equal(rotuloDaSerie({ numero_na_serie: 3 }, null), 'nº 3')
  assert.equal(rotuloDaSerie({ numero_na_serie: 3 }, {}), 'nº 3')
})

test('`curto` é só o número, para onde o cabeçalho da coluna já diz o que ele é', () => {
  assert.equal(rotuloDaSerie({ numero_na_serie: 12 }, { sku: 'H0015S' }, { curto: true }), 'H0015S012')
})

test('o `curto` NÃO encurta o fallback: sem referência a célula continua dizendo `nº 3`', () => {
  // é esse "nº" que avisa que ali não há número de série. Um "3" pelado embaixo
  // do cabeçalho "Nº DE SÉRIE" seria a tela dizendo que a série desta bolsa é 3.
  assert.equal(rotuloDaSerie({ numero_na_serie: 3 }, null, { curto: true }), 'nº 3')
})

test('sem peça e sem número não sai rótulo nenhum — nem "nº undefined"', () => {
  assert.equal(rotuloDaSerie(null, { sku: 'H0015S' }), '')
  assert.equal(rotuloDaSerie({}, { sku: 'H0015S' }), '')
  assert.equal(rotuloDaSerie({ numero_na_serie: null }, null), '')
})

/* ── 6. ONDE A PEÇA É NOMEADA, ELA É NOMEADA PELO NÚMERO DE SÉRIE ─────────── */

test('descricaoDaPeca nomeia a bolsa pelo número de série quando há referência', () => {
  const f = descricaoDaPeca(
    { numero_na_serie: 7, codigo: 'k7m4x9qp2r' },
    { modelo: 'Mônaco', cor: 'Quartz', sku: 'H0015S' })
  assert.equal(f, 'Mônaco · Quartz · nº de série H0015S007 — K7M4X9QP2R')
})

test('descricaoDaPeca sem referência continua dizendo `nº 7`, como sempre disse', () => {
  const f = descricaoDaPeca(
    { numero_na_serie: 7, codigo: 'k7m4x9qp2r' },
    { modelo: 'Mônaco', cor: 'Quartz' })
  assert.equal(f, 'Mônaco · Quartz · nº 7 — K7M4X9QP2R')
})

/* ── 7. A LISTA QUE SE BAIXA EM PLANILHA ──────────────────────────────────── */

test('a lista do lote ganha a coluna do número de série, e ELA VEM PRIMEIRO', () => {
  // quem arquiva a ordem de produção procura pelo número que está na bolsa
  const csv = linhasDaListaDoLote(
    [{ numero_na_serie: 12, codigo: 'AAA111' }], { sku: 'H0015S' })
  const [cab, linha] = csv.split('\n')
  assert.equal(cab, 'numero de serie;numero;codigo;endereco;estado;gravada em;motivo da baixa')
  assert.match(linha, /^H0015S012;12;AAA111;/)
})

test('a coluna do NÚMERO DA PEÇA continua na planilha — nada se perde', () => {
  // PADRÃO item 8. O número de série carrega a referência INTEIRA, mas o número
  // da peça é o que casa com a ordem de produção antiga — e é por isso que a
  // coluna dele continua na planilha.'
  const csv = linhasDaListaDoLote([{ numero_na_serie: 12, codigo: 'AAA111' }], { sku: 'H0015S' })
  assert.match(csv.split('\n')[0], /numero de serie;numero;/)
})

test('lote sem referência: a coluna existe e sai VAZIA, nunca com "null" dentro', () => {
  const csv = linhasDaListaDoLote([{ numero_na_serie: 12, codigo: 'AAA111' }])
  const [cab, linha] = csv.split('\n')
  assert.match(cab, /^numero de serie;/)
  assert.match(linha, /^;12;AAA111;/)
  assert.doesNotMatch(csv, /null|undefined|NaN/)
})

/* ── 7½. O RÓTULO SÓ SOME ONDE O CABEÇALHO O SUBSTITUI ────────────────────
 * No computador a lista de peças é TABELA, e a coluna "Nº DE SÉRIE" diz o que
 * o número é. No celular a MESMA lista vira cartão e o cabeçalho some
 * (`display:none` na regra-base) — e ali "00151" encostado em "K7M4X001QP"
 * são dois amontoados de caractere sem nada dizendo qual é qual.
 * O prefixo é separado do número justamente para poder sumir só onde há
 * cabeçalho, em vez de sumir sempre. */

test('o prefixo existe quando há número de série, e não quando não há', () => {
  assert.equal(prefixoDaSerie({ numero_na_serie: 12 }, { sku: 'H0015S' }), 'nº de série ')
  // sem referência o número já sai como "nº 3": um prefixo aqui daria "nº de série nº 3"
  assert.equal(prefixoDaSerie({ numero_na_serie: 3 }, null), '')
  assert.equal(prefixoDaSerie({}, { sku: 'H0015S' }), '')
  assert.equal(prefixoDaSerie(null, null), '')
})

test('prefixo + número curto formam exatamente o rótulo longo', () => {
  // as duas formas não podem divergir: são a mesma frase, montada em dois
  // pedaços só para o pedaço da frente poder sumir no computador
  for (const lote of [{ sku: 'H0015S' }, { sku: '' }, null]) {
    for (const n of [1, 12, 500]) {
      const peca = { numero_na_serie: n }
      assert.equal(prefixoDaSerie(peca, lote) + rotuloDaSerie(peca, lote, { curto: true }),
        rotuloDaSerie(peca, lote))
    }
  }
})

/* ── 8. NA TELA ───────────────────────────────────────────────────────────
 * A regra pura acima é metade: o que decide se a pessoa vê o número de série é
 * o template. Estes testes leem o arquivo da tela — é o mesmo motor das provas
 * de tela das irmãs, e é o que impede que a regra fique certa e a tela velha.
 */
const tela = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8')
const template = tela.slice(0, tela.indexOf('<script setup>'))

test('as confirmações de excluir e de dar baixa nomeiam a peça pelo número de série', () => {
  // do outro lado destas duas perguntas há uma bolsa de couro. Perguntar "dar
  // baixa na peça 3?" com três lotes abertos é perguntar sobre três bolsas.
  assert.match(template, /Excluir a peça \{\{ rotuloDaSerie\(proxima, loteAtual\) \}\}, de código/)
  assert.match(template, /Dar baixa na peça \{\{ rotuloDaSerie\(proxima, loteAtual\) \}\}\?/)
})

test('a lista das peças baixadas nomeia a peça pelo número de série', () => {
  assert.match(template, /Peça \{\{ rotuloDaSerie\(pc, loteAtual\) \}\} — \{\{ rotuloDoMotivo/)
})

test('no celular o número de série leva o rótulo junto; no computador, o cabeçalho', () => {
  // a lista de peças é tabela no computador e cartão no celular. O cabeçalho
  // "Nº DE SÉRIE" nasce `display:none` e só o `@media (min-width)` o acende —
  // então é no computador, e SÓ nele, que o prefixo pode sumir.
  assert.match(template, /<span class="au-rot-serie">\{\{ prefixoDaSerie\(pc, l\) \}\}<\/span>/)
  const grande = estilo.slice(estilo.indexOf('@media (min-width:900px){'),
    estilo.lastIndexOf('@media (max-width:520px){'))
  assert.match(grande, /\.au-tabela-pecas \.au-rot-serie\{display:none\}/,
    'o prefixo tem de sumir no computador, onde o cabeçalho da coluna já o diz')
  assert.doesNotMatch(estilo.slice(0, estilo.indexOf('@media (min-width:900px){')),
    /\.au-rot-serie\{display:none\}/,
    'o prefixo sumiu na regra-base: aí ele some no celular também, que é onde ele serve')
})

test('nenhum lugar da tela escreve `nº {{ …numero_na_serie }}` à mão', () => {
  // varredura do arquivo INTEIRO, e não da lista que eu lembrei de conferir: é
  // assim que sobra um canto com o número velho depois de a regra ter mudado.
  //
  // ⚠️ ATÉ 03/09/2026 ESTA LISTA TINHA UMA EXCEÇÃO: o número grande da bancada,
  // que é POSIÇÃO e não identidade, era montado à mão aqui. Ele continua sendo
  // posição — a decisão não mudou —, mas quem monta a frase agora é
  // `fraseDaPecaNaMao`, porque a série passou a aceitar buraco e `nº 10 de 9`
  // precisou virar `nº 10`. A decisão é guardada logo abaixo, pela função.
  const sobras = [...template.matchAll(/nº \{\{ ([^}]+?)\.numero_na_serie \}\}/g)]
    .map((m) => m[0])
  assert.deepEqual(sobras, [],
    'sobrou um lugar mostrando o número da peça cru em vez do número de série')
})

/* ── 9. O NÚMERO GRANDE DA BANCADA CONTINUA SENDO A POSIÇÃO ──────────────── */

test('o "nº 8 de 20" da bancada NÃO virou número de série, e isso é decisão', () => {
  /* ELE NÃO IDENTIFICA A BOLSA: aponta a posição na fila. É a resposta para
   * "qual peça está na minha mão agora", lida de pé, de longe, no meio de um
   * gesto — e o número de série é PIOR nessa única coisa. Duas peças seguidas
   * são "001517" e "001518": a 32px, do outro lado da bancada, são a mesma
   * mancha, e só o último dígito separa uma da outra. "7 de 20" e "8 de 20" não
   * se confundem. E o "de 20" só existe com a sequência: "001518 de 20" não é
   * frase nenhuma.
   *
   * Quem identifica a bolsa ali é o endereço ao lado, o código, e a fila logo
   * abaixo — que desde esta entrega diz o número de série de cada peça.
   *
   * Este teste existe para que a próxima pessoa que "padronizar" a tela tenha
   * de apagar a decisão de propósito, e não de passagem. */
  assert.match(template,
    /class="au-bancada-peca">\s*\{\{ fraseDaPecaNaMao\(proxima, loteAtual\) \}\}/,
    'o número grande da bancada mudou de dono: quem monta a frase é fraseDaPecaNaMao')

  // e a função continua entregando a POSIÇÃO, não o número de série — medido
  // pelo que ela devolve, não pelo nome dela. Um lote com referência conta a
  // história inteira: se algum dia isto virar série, `00158` aparece aqui.
  assert.equal(fraseDaPecaNaMao({ numero_na_serie: 8 }, { sku: 'H0015S', quantidade: 20 }),
    'nº 8 de 20',
    'o número grande da bancada virou número de série: ele é a POSIÇÃO na fila, '
    + 'não a identidade da bolsa')
})

/* ── 10. A TRAVA DA AMBIGUIDADE, NA TELA ─────────────────────────────────── */

const script = tela.slice(tela.indexOf('<script setup>'))
const estilo = tela.slice(tela.indexOf('<style'))

test('o cartão do lote mantém a referência CRUA', () => {
  // PADRÃO item 8: o número de série leva a referência inteira, mas COLADA na
  // sequência. Esta linha é o único lugar que mostra o SKU como ele é escrito no
  // Bling, com a pontuação — que é como quem procura o produto lá o digita.
  assert.match(template, /<span v-if="l\.sku" class="au-ref">ref\. \{\{ l\.sku \}\}<\/span>/,
    'a referência crua sumiu do cartão: as letras dela não moram em mais lugar nenhum')
  // O selo "Nº de série ambíguo" saiu em 04/09/2026 junto com a ambiguidade —
  // ver o teste da remoção, no fim deste arquivo.
})

test('fraseDaPecaNaMao: o caso normal continua igual', () => {
  assert.equal(fraseDaPecaNaMao({ numero_na_serie: 8 }, { quantidade: 20 }), 'nº 8 de 20')
  assert.equal(fraseDaPecaNaMao({ numero_na_serie: 1 }, { quantidade: 1 }), 'nº 1 de 1')
})

test('fraseDaPecaNaMao: o "de N" SAI quando o número não cabe no total', () => {
  // é este o caso que a série com buraco cria — e a frase impossível que ele
  // colocaria na maior letra da tela
  assert.equal(fraseDaPecaNaMao({ numero_na_serie: 10 }, { quantidade: 9 }), 'nº 10')
  assert.equal(fraseDaPecaNaMao({ numero_na_serie: 50 }, { quantidade: 3 }), 'nº 50')
})

test('fraseDaPecaNaMao: sem total confiável, mostra só o número', () => {
  // lote ainda carregando, ou `quantidade` que voltou nula do banco: melhor um
  // número sozinho do que "nº 8 de undefined"
  assert.equal(fraseDaPecaNaMao({ numero_na_serie: 8 }, null), 'nº 8')
  assert.equal(fraseDaPecaNaMao({ numero_na_serie: 8 }, { quantidade: null }), 'nº 8')
  assert.equal(fraseDaPecaNaMao({ numero_na_serie: 8 }, { quantidade: '20' }), 'nº 8')
})

test('fraseDaPecaNaMao: peça sem número nenhum não vira "nº undefined"', () => {
  assert.equal(fraseDaPecaNaMao({}, { quantidade: 20 }), '')
  assert.equal(fraseDaPecaNaMao(null, { quantidade: 20 }), '')
})

test('⚠️ O AVISO DE AMBIGUIDADE NAO EXISTE MAIS — porque o defeito nao existe', () => {
  /* Ate 04/09/2026 a tela AVISAVA quando a referencia nao tinha quatro digitos:
   * a sequencia ia sem enchimento, e "001512" podia ser duas bolsas.
   *
   * Com a sequencia em largura fixa isso acabou. Manter o aviso seria ALARME
   * FALSO — e alarme que aparece sem causa cega para os que tem causa. Por isso
   * `serieAmbigua` e `avisoDeSerieAmbigua` foram REMOVIDOS, e nao apenas
   * desligados.
   *
   * Este teste guarda a remocao: se alguem trouxer o aviso de volta sem trazer
   * de volta o defeito, ele reprova e pergunta por que. */
  const fonte = readFileSync(new URL('./lotes.js', import.meta.url), 'utf8')
  assert.doesNotMatch(fonte, /export function serieAmbigua/)
  assert.doesNotMatch(fonte, /export function avisoDeSerieAmbigua/)

  const tela = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(tela, /avisoDaSerie|serieAmbigua/,
    'a tela voltou a mostrar um aviso cuja causa nao existe mais')
})

test('⚠️ O SUFIXO DE VARIACAO ENTRA no numero de serie, e isso e DECISAO', () => {
  /* `SS0008HB.M5` vira `00085`, e nao `0008`. Parece descuido e nao e —
   * decidido em 05/09/2026, com os dois caminhos medidos lado a lado.
   *
   * NO BLING CADA PRODUTO TEM SKU PROPRIO: `.M5` e `.M6` sao produtos
   * diferentes, cores diferentes do mesmo molde. Pegando so o primeiro grupo de
   * digitos, os dois virariam referencia `0008` e a peca 1 de cada um daria
   * `0008001` — duas bolsas distintas com o MESMO numero de serie. Este teste
   * existe para que a "limpeza" obvia reprove antes de chegar numa bolsa. */
  assert.equal(numeroDeSerie('SS0008HB.M5', 1), 'SS0008HBM5001')
  assert.equal(numeroDeSerie('SS0008HB.M6', 1), 'SS0008HBM6001')
  assert.notEqual(numeroDeSerie('SS0008HB.M5', 1), numeroDeSerie('SS0008HB.M6', 1),
    'duas variacoes do mesmo molde com o MESMO numero de serie')
})

test('referencia sem sufixo tambem entra inteira', () => {
  // MEDIDO em 07/09/2026: dos 66 lotes do banco, 65 tem SKU no formato
  // `SS0001HB.M1` e um so tem `H0009S`. Os dois formatos passam por aqui.
  for (const [sku, esperado] of [['H0015S','H0015S001'], ['C0011S','C0011S001'],
                                 ['LV1021','LV1021001']]) {
    assert.equal(numeroDeSerie(sku, 1), esperado, sku)
  }
})
