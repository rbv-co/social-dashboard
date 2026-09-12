import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ehProdutoVessel, corDoProduto, modeloDoProduto, produtosParaEscolher, procurarProduto,
} from './produtos-do-bling.js'

// Os exemplos abaixo NAO sao inventados: sairam do Bling de verdade em
// 31/08/2026, de uma varredura dos 400 produtos ativos.

test('ehProdutoVessel: so o SKU do formato NOVO', () => {
  assert.equal(ehProdutoVessel('SS1088-Mostarda'), true)
  assert.equal(ehProdutoVessel('SS-00002-1.01.03.01.01'), true)
  assert.equal(ehProdutoVessel('LV1021-Quartz'), false, 'a linha antiga nao recebe etiqueta')
  assert.equal(ehProdutoVessel(''), false)
  assert.equal(ehProdutoVessel(null), false)
})

test('corDoProduto: um hifen, e a cor termina o nome', () => {
  assert.equal(corDoProduto('SS1088-Mostarda', 'Bolsa De Mão Média Bath Mostarda'), 'Mostarda')
})

test('corDoProduto: DOIS hifens — pega o pedaco que termina o nome', () => {
  // "Fly Amendoa" e o forro, nao a cor. Quem manda e o nome do produto.
  assert.equal(
    corDoProduto('SS1234-Caramelo-Fly Amendoa', 'Bolsa de Mão Angers Caramelo'),
    'Caramelo')
})

test('corDoProduto: sem acento e sem caixa, os dois lados', () => {
  assert.equal(corDoProduto('SS1088-Bordo', 'Bolsa Tote Grande Paris Bordô'), 'Bordo')
})

test('corDoProduto: quando o codigo NAO tem cor, volta VAZIO', () => {
  // Campo vazio a pessoa ve; campo errado ela nao. Foi assim que o catalogo
  // leu "Bolsa Tote Grande Florenca Caramelo" como modelo "Caramelo".
  assert.equal(corDoProduto('SS-00002-1.01.03.01.01', 'Bolsa Tote Grande Paris Bordô'), '')
})

test('corDoProduto: pedaco que NAO termina o nome nao vira cor', () => {
  assert.equal(corDoProduto('SS1088-Mostarda', 'Bolsa Bath Mostarda Especial'), '')
})

test('modeloDoProduto: tira o "Bolsa" da frente e a cor do fim', () => {
  assert.equal(
    modeloDoProduto('Bolsa De Mão Média Bath Mostarda', 'Mostarda'),
    'De Mão Média Bath')
})

test('modeloDoProduto: sem cor, tira so o "Bolsa"', () => {
  assert.equal(modeloDoProduto('Bolsa Tote Grande Paris Bordô', ''), 'Tote Grande Paris Bordô')
})

test('modeloDoProduto: nao deixa o modelo VAZIO', () => {
  // se o nome inteiro fosse a cor, cortar deixaria a pessoa sem nada na tela
  assert.equal(modeloDoProduto('Bolsa Mostarda', 'Mostarda'), 'Mostarda')
})

test('produtosParaEscolher: filtra a linha antiga e ordena por nome', () => {
  const doBling = [
    { codigo: 'LV1021-Quartz', nome: 'Bolsa De Ombro Grande Mônaco Quartz' },
    { codigo: 'SS1088-Mostarda', nome: 'Bolsa De Mão Média Bath Mostarda' },
    { codigo: 'SS1234-Caramelo-Fly Amendoa', nome: 'Bolsa de Mão Angers Caramelo' },
  ]
  const lista = produtosParaEscolher(doBling)
  assert.equal(lista.length, 2, 'a LV fica de fora')
  assert.deepEqual(lista.map((p) => p.codigo),
    ['SS1234-Caramelo-Fly Amendoa', 'SS1088-Mostarda'])
  assert.equal(lista[1].cor, 'Mostarda')
  assert.equal(lista[1].modelo, 'De Mão Média Bath')
})

test('produtosParaEscolher: entrada estranha nao quebra a tela', () => {
  assert.deepEqual(produtosParaEscolher(null), [])
  assert.deepEqual(produtosParaEscolher([{ codigo: 'SS1', nome: null }])[0].nome, '')
})

test('procurarProduto: acha sem acento e sem caixa', () => {
  const lista = produtosParaEscolher([
    { codigo: 'SS1088-Mostarda', nome: 'Bolsa De Mão Média Bath Mostarda' },
  ])
  assert.equal(procurarProduto(lista, 'MAO').length, 1, 'sem acento tem de achar')
  assert.equal(procurarProduto(lista, 'bath').length, 1)
  assert.equal(procurarProduto(lista, 'ss1088').length, 1, 'quem tem o SKU procura por ele')
  assert.equal(procurarProduto(lista, 'monaco').length, 0)
})

test('procurarProduto: busca vazia devolve a lista inteira', () => {
  const lista = [{ codigo: 'SS1', nome: 'a', cor: '', modelo: 'a' }]
  assert.equal(procurarProduto(lista, '').length, 1)
  assert.equal(procurarProduto(lista, '   ').length, 1)
})

// ─────────────────────────────────────────────────────────────────────────
// OS TESTES QUE FAZEM A REGRA ERRAR.
//
// Os treze de cima provam que a regra ACERTA. Nenhum tentava fazê-la errar, e
// foi por isso que dois defeitos passaram: a cor casava com PEDAÇO DE PALAVRA
// ("Ouro" dentro de "Couro") e a cor composta voltava pela metade ("Off-White"
// virava "White"). Os dois iam para a página que a cliente lê no celular.
// ─────────────────────────────────────────────────────────────────────────

test('corDoProduto: pedaco NAO casa dentro de outra palavra', () => {
  // "Couro" termina em "ouro". Sem fronteira de palavra a cor virava "Ouro" e o
  // modelo saía mutilado como "Tote Grande Paris C".
  assert.equal(corDoProduto('SS1234-Ouro', 'Bolsa Tote Grande Paris Couro'), '')
})

test('corDoProduto: pedaco de UMA letra nao vira cor', () => {
  // Tamanho (P/M/G) no fim do SKU é um pedaço de uma letra só, e uma letra
  // casa por acaso com quase um nome em dez.
  assert.equal(corDoProduto('SS1234-a', 'Bolsa Angers Seda'), '')

  // ESTE TESTE MUDOU DE LADO em 31/08/2026, e o motivo importa: ele afirmava
  // que "quando a letra É a última palavra do nome, ela continua valendo" —
  // consagrava o defeito como acerto. Não vale. NENHUMA COR EM PORTUGUÊS TEM
  // UMA LETRA SÓ: esse "G" é o tamanho, e o ERP escreve o mesmo tamanho no fim
  // do nome, então as duas fontes concordarem ali não prova nada. Quem encosta
  // o celular na etiqueta lia "Cor: G". O certo é voltar VAZIO e quem cria o
  // lote preencher: campo vazio a pessoa vê; campo errado ela não.
  assert.equal(corDoProduto('SS1234-G', 'Bolsa De Mão Média Bath Mostarda G'), '',
    'tamanho nao e cor — voltar vazio e deixar a pessoa preencher')
})

test('corDoProduto: pedaco so de numero nao vira cor', () => {
  // Códigos internos ("02") também terminam o nome por acaso. A cliente lia
  // "Cor: 02". Cor tem letra.
  assert.equal(corDoProduto('SS1-02', 'Bolsa Tote Paris 02'), '')
})

test('corDoProduto: a cor certa nao vem somada do tamanho solto', () => {
  // Aqui a junção "Mostarda P" terminava o nome inteirinha e a cor saía com um
  // "P" pendurado. O tamanho é ruído dos DOIS lados — do código e do nome — e
  // o que sobra depois de tirá-lo é a cor de verdade.
  assert.equal(corDoProduto('SS1234-Mostarda-P', 'Bolsa Bath Mostarda P'), 'Mostarda')
})

test('corDoProduto: cor composta partida pelo hifen volta INTEIRA', () => {
  assert.equal(corDoProduto('SS1500-Off-White', 'Bolsa De Mão Média Bath Off White'), 'Off White')
  assert.equal(corDoProduto('SS1234-Azul-Marinho', 'Bolsa Tote Azul Marinho'), 'Azul Marinho')
})

test('corDoProduto: a juncao mais longa ganha do pedaco solto', () => {
  // "Marinho" sozinho também termina o nome. Se o pedaço solto vencesse, a cor
  // sairia "Marinho" e o modelo levaria o "Azul" embora.
  const cor = corDoProduto('SS1234-Azul-Marinho', 'Bolsa Tote Azul Marinho')
  assert.equal(modeloDoProduto('Bolsa Tote Azul Marinho', cor), 'Tote')
})

test('modeloDoProduto: a cor nao corta no meio de uma palavra', () => {
  // Mesma fronteira de palavra do `corDoProduto`: sem ela, cortar "Ouro" de
  // "…Paris Couro" deixava o modelo em "Tote Grande Paris C".
  assert.equal(
    modeloDoProduto('Bolsa Tote Grande Paris Couro', 'Ouro'),
    'Tote Grande Paris Couro')
})

test('produtosParaEscolher: o produto de cor composta chega inteiro na tela', () => {
  const [p] = produtosParaEscolher([
    { codigo: 'SS1500-Off-White', nome: 'Bolsa De Mão Média Bath Off White' },
  ])
  assert.equal(p.cor, 'Off White')
  assert.equal(p.modelo, 'De Mão Média Bath')
})

test('corDoProduto: espaco digitado a mais no ERP nao parte a cor composta', () => {
  // O nome vem do ERP DIGITADO à mão, e dedo escorregado põe dois espaços. Como
  // o `semAcento` não juntava espaços repetidos, "off white" (um espaço, do
  // código) nunca terminava "off  white" (dois, do nome) — e a cor voltava pela
  // METADE, como "White", com o "Off" grudado no modelo. É o defeito da cor
  // composta inteiro, vivo para todo nome com espaço a mais.
  assert.equal(corDoProduto('SS1500-Off-White', 'Bolsa Bath Off  White'), 'Off White')
})

test('modeloDoProduto: acento decomposto (NFD) nao mutila o modelo', () => {
  // O Bling manda "ç" das duas formas: um caractere só (NFC) ou "c" + cedilha
  // solta (NFD). Cortar a cor CONTANDO LETRAS quebrava na segunda: a conta era
  // feita sobre o texto sem acento e aplicada sobre o texto COM acento, os dois
  // com comprimentos diferentes, e sobrava "Tote Grande F". É o defeito de
  // "cortar no meio da palavra" voltando pela porta dos fundos — por isso o
  // corte é por PALAVRAS, que não dependem de quantos code points cada uma tem.
  const nome = 'Bolsa Tote Grande Florença'.normalize('NFD')
  const cor = corDoProduto('SS1-Florenca', nome)
  assert.equal(cor, 'Florenca')
  assert.equal(modeloDoProduto(nome, cor), 'Tote Grande')
})

test('modeloDoProduto: o tamanho do fim sai junto com a cor', () => {
  // "Bolsa Bath Mostarda P" com cor "Mostarda": o "P" é ruído do ERP, e deixá-lo
  // ali devolveria o modelo com a cor dentro ("Bath Mostarda").
  assert.equal(modeloDoProduto('Bolsa Bath Mostarda P', 'Mostarda'), 'Bath')
})
