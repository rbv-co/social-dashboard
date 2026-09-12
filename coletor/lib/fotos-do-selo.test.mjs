import test from 'node:test'
import assert from 'node:assert/strict'
import {
  pastaDoLote, enderecoDaFoto, loteEstaFaltando, lotesParaOlhar,
  imagensGrandesDoProduto, corDoProduto, produtoQueBate, achatar, pastasDisputadas,
} from './fotos-do-selo.mjs'

test('a pasta do lote bate com as que JA existem no site', () => {
  // Estas seis pastas existem em `vessel-brasil/fotos/selo/`. Se o criterio
  // mudar, o robo cria uma pasta nova ao lado da que ja tem as fotos e baixa
  // tudo de novo.
  assert.equal(pastaDoLote({ modelo: 'Handbag Linear', cor: 'Caramelo' }), 'handbag-linear-caramelo')
  assert.equal(pastaDoLote({ modelo: 'Clutch Maelle', cor: 'Bege' }), 'clutch-maelle-bege')
  assert.equal(pastaDoLote({ modelo: 'Handbag Solene', cor: 'Black and White' }),
    'handbag-solene-black-and-white')
})

test('a pasta aguenta acento, espaco duplo e pontuacao', () => {
  // "De Mão Média Lódz" é um modelo real, e ele tem acento em três palavras
  assert.equal(pastaDoLote({ modelo: 'De Mão Média Lódz', cor: 'Memphis  Preto' }),
    'de-mao-media-lodz-memphis-preto')
  assert.equal(pastaDoLote({ modelo: 'Bolsa (nova)', cor: 'Café/Fendi' }), 'bolsa-nova-cafe-fendi')
})

test('lote sem cor ainda tem pasta; lote sem nada nenhum nao inventa', () => {
  assert.equal(pastaDoLote({ modelo: 'Handbag Lunea' }), 'handbag-lunea')
  assert.equal(pastaDoLote({ modelo: '', cor: '' }), null)
  assert.equal(pastaDoLote(null), null)
})

test('o endereco da foto e exatamente o que a pagina da cliente carrega', () => {
  assert.equal(enderecoDaFoto('handbag-linear-caramelo', 1),
    'https://vesselbrasil.com.br/fotos/selo/handbag-linear-caramelo/1.jpg')
  assert.equal(enderecoDaFoto('x', 0), null, 'foto zero nao existe')
  assert.equal(enderecoDaFoto('', 1), null)
  assert.equal(enderecoDaFoto('x', 1.5), null)
})

test('o robo so olha lote COM SKU e faltando alguma coisa', () => {
  const lotes = [
    { sku: 'SS1025', fotos: [], cor: 'Rum' },              // falta foto
    { sku: 'SS1162', fotos: ['a.jpg'], cor: '' },          // falta cor
    { sku: 'H0015S', fotos: ['a.jpg'], cor: 'Caramelo' },  // completo
    { sku: '', fotos: [], cor: '' },                       // sem SKU: nao ha o que buscar
  ]
  assert.deepEqual(lotesParaOlhar(lotes).map((l) => l.sku), ['SS1025', 'SS1162'])
})

test('lote completo NAO e rebaixado', () => {
  // rebaixar a cada rodada gasta a cota do Bling e sobrescreveria foto que
  // alguem trocou a mao — que e o caminho das bolsas manuais do dono
  assert.equal(loteEstaFaltando({ fotos: ['a'], cor: 'Preto' }).precisa, false)
  assert.equal(loteEstaFaltando({ fotos: [], cor: 'Preto' }).faltaFoto, true)
  assert.equal(loteEstaFaltando({ fotos: ['a'], cor: '   ' }).faltaCor, true)
  assert.equal(loteEstaFaltando(null).precisa, true)
})

test('pega a imagem GRANDE e joga fora a miniatura', () => {
  // ⚠️ O DEFEITO QUE ISTO IMPEDE: a miniatura do Bling tem 70x70 pixels e 1,3 KB
  // (medido em 03/09/2026). Ela ficaria borrada ocupando meia tela do
  // certificado, e a diferenca entre as duas URLs e uma letra (`/t/`).
  const produto = { midia: { imagens: {
    internas: [{ link: 'https://s3/grande-1.jpg', linkMiniatura: 'https://s3/t/pequena-1.jpg' }],
    externas: [{ link: 'https://s3/grande-2.jpg' }],
  } } }
  const urls = imagensGrandesDoProduto(produto)
  assert.deepEqual(urls, ['https://s3/grande-1.jpg', 'https://s3/grande-2.jpg'])
  assert.ok(!urls.some((u) => u.includes('/t/')), 'entrou miniatura na lista')
})

test('produto sem imagem devolve lista vazia, e nao quebra', () => {
  // ⚠️ ESTE E O CASO NORMAL HOJE: medido, 28 de 100 produtos tem imagem, e do
  // catalogo novo (SS) sao 3 de 9. O robo achar pouco nao e defeito dele.
  assert.deepEqual(imagensGrandesDoProduto({ midia: { imagens: { externas: [], internas: [], imagensURL: [] } } }), [])
  assert.deepEqual(imagensGrandesDoProduto({}), [])
  assert.deepEqual(imagensGrandesDoProduto(null), [])
  assert.deepEqual(imagensGrandesDoProduto({ midia: { imagens: { internas: [{ link: null }] } } }), [])
})

test('o produto tem de bater EXATO — nada de prefixo', () => {
  // aqui um casamento frouxo poe a foto de OUTRA bolsa no certificado da
  // cliente, que e pior do que certificado sem foto
  const lista = [{ codigo: 'SS1025-Fly Rum' }, { codigo: 'SS1025' }, { codigo: 'SS1162' }]
  assert.equal(produtoQueBate(lista, 'SS1025-Fly Rum').codigo, 'SS1025-Fly Rum')
  assert.equal(produtoQueBate(lista, 'ss1025 fly rum').codigo, 'SS1025-Fly Rum',
    'caixa e pontuacao nao podem reprovar')
  assert.equal(produtoQueBate(lista, 'SS10'), null, 'prefixo NAO pode casar')
  assert.equal(produtoQueBate(lista, ''), null)
  assert.equal(produtoQueBate(null, 'SS1025'), null)
})

test('a cor sai do que o Bling JA diz, nunca de palpite sobre o nome', () => {
  // ⚠️ ADIVINHAR COR PELO NOME JA DEU DEFEITO NESTA CASA em 01/09. Palpite
  // errado escrito no certificado e pior que campo vazio: vazio a pessoa ve e
  // corrige; errado ela le e acredita.
  assert.equal(corDoProduto({ cor: 'Caramelo' }), 'Caramelo')
  assert.equal(corDoProduto({ variacao: { nome: 'Preto' } }), 'Preto')
  assert.equal(corDoProduto({ nome: 'Bolsa De Mão Média Lódz Memphis Preto' }), null,
    'a cor NAO pode ser deduzida do nome do produto')
  assert.equal(corDoProduto({}), null)
})

test('a cor NAO aceita HTML nem texto comprido — a forma REAL que o Bling manda', () => {
  // ⚠️ ISTO E O PRODUTO DE VERDADE `SS1025-Fly Rum`, encurtado. A rodada seca de
  // 03/09/2026 pegou: `descricaoCurta` vinha com cinco paragrafos de HTML
  // listando as dimensoes da bolsa, e a primeira versao gravaria isso no campo
  // COR — a cliente leria um bloco de codigo onde deveria estar "Caramelo".
  const real = '<p style="font-family: Montserrat, sans-serif; box-sizing: border-box;">'
    + '<span style="font-weight: bolder;">Dimensões</span></p>\n<p>Largura: 37cm</p>'
  assert.equal(corDoProduto({ descricaoCurta: real }), null)
  assert.equal(corDoProduto({ cor: real }), null, 'nem se vier no campo certo')
  assert.equal(corDoProduto({ cor: 'Preto <b>novo</b>' }), null, 'nada de HTML')
  assert.equal(corDoProduto({ cor: 'Caramelo\nescuro' }), null, 'nada de quebra de linha')
  assert.equal(corDoProduto({ cor: 'x'.repeat(41) }), null, 'nada de texto comprido')
  assert.equal(corDoProduto({ cor: 'Black and White' }), 'Black and White',
    'e uma cor de verdade continua passando')
})

test('achatar aguenta acento, caixa e pontuacao', () => {
  assert.equal(achatar('SS-1162-Memphis Preto'), 'SS1162MEMPHISPRETO')
  assert.equal(achatar('ss 1162 memphis preto'), 'SS1162MEMPHISPRETO')
  assert.equal(achatar(null), '')
})

test('⚠️ duas bolsas na mesma pasta: nenhuma leva foto', () => {
  /* Regra do dono, 08/09/2026: "se ficar na duvida, deixe sem foto — melhor do
   * que com foto errada". A pasta e MODELO + COR, e nao o SKU: dois cadastros
   * com o mesmo modelo e a mesma cor se sobrescrevem, e um dos dois certificados
   * passa a mostrar a bolsa do outro sem erro nenhum aparecer. */
  const disputadas = pastasDisputadas([
    { sku: 'SS0008HB.M4', modelo: 'HandBag Lunea Medium', cor: 'Pinhão' },
    { sku: 'SS0009HB.M4', modelo: 'HandBag Lunea Medium', cor: 'Pinhão' },
    { sku: 'SS0008HB.M5', modelo: 'HandBag Lunea Medium', cor: 'Fendi' },
  ])
  assert.ok(disputadas.has('handbag-lunea-medium-pinhao'))
  assert.ok(!disputadas.has('handbag-lunea-medium-fendi'), 'pasta de um SKU so continua valendo')
})

test('o MESMO SKU em dois lotes nao e disputa — e a mesma bolsa', () => {
  // Acontece de verdade: o catalogo tem lotes repetidos do mesmo SKU.
  const disputadas = pastasDisputadas([
    { sku: 'SS0008HB.M1', modelo: 'HandBag Lunea Medium', cor: 'Preto c/ Bordô' },
    { sku: 'ss0008hb.m1', modelo: 'HandBag Lunea Medium', cor: 'Preto c/ Bordô' },
  ])
  assert.equal(disputadas.size, 0)
})
