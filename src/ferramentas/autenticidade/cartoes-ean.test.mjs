import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chaveDoProduto, verbeteDoProduto, impedimentoDoCartao, MOTIVO_DO_IMPEDIMENTO,
  linhasDeCartao, marcadasPorPadrao, resumoDoPedido, pecaParaODesenho,
  recursosDoDesenho, cssDoCartao, fraseDoPedidoRecusado, situacaoDoPedido,
  BASE_DOS_RECURSOS, andamentoDaPeca, temPedidoAtivo, bolsasDoPedido,
  nomeDoArquivoBaixado, nomeDoArquivoDosDois, fraseDoDownloadRecusado,
} from './cartoes-ean.js'

// Um pedaço do índice publicado, com a forma REAL do arquivo que está no ar —
// conferido contra https://vesselbrasil.com.br/fotos/cartao/indice.json.
const INDICE = {
  'SS0001CB.M1': {
    modelo: 'MAELLE', nome: 'ClutchBag Maelle Medium Bege', gtin: '7901109709999',
    foto: 'SS0001CB.M1.webp',
    medidaDaFoto: { largura: 1016, altura: 630, corpo: { esquerda: 0.047, topo: 0.014, direita: 0.776, base: 0.9 } },
    desenho: 'desenhos/MAELLE.webp',
  },
  'SS0001L.1': {
    modelo: 'CAMPINAS', nome: 'Lenço Campinas', gtin: '7901109710001',
    foto: 'SS0001L.1.webp',
    medidaDaFoto: { largura: 900, altura: 900, corpo: { esquerda: 0, topo: 0, direita: 1, base: 1 } },
    ehLenco: true, desenho: null,
  },
}
const LOTES = {
  'lote-a': { id: 'lote-a', sku: 'SS0001CB.M1', modelo: 'Maelle', cor: 'Bege' },
  'lote-b': { id: 'lote-b', sku: 'SS0001L.1', modelo: 'Campinas', cor: 'Areia' },
  'lote-sem-sku': { id: 'lote-sem-sku', sku: null, modelo: 'Desconhecida', cor: null },
  'lote-sem-foto': { id: 'lote-sem-foto', sku: 'ZZ9999XX.T9', modelo: 'Nova', cor: 'Preta' },
}

test('⚠️ a chave do produto e a MESMA do numero de serie e da do banco', () => {
  // "SS0001HB.B1" e "ss0001hb b1" imprimem o mesmo numero de serie. Se aqui
  // virassem produtos diferentes, a tela diria "sem foto" para uma bolsa cuja
  // foto esta publicada — e o cartao dela nunca sairia.
  assert.equal(chaveDoProduto('SS0001HB.B1'), 'SS0001HBB1')
  assert.equal(chaveDoProduto('ss0001hb b1'), 'SS0001HBB1')
  assert.equal(chaveDoProduto('SS0001HB-B1'), chaveDoProduto('SS0001HB.B1'))
  assert.equal(chaveDoProduto(null), '')
})

test('⚠️ o verbete e achado pela CHAVE, e nao pelo texto cru do SKU', () => {
  assert.equal(verbeteDoProduto(INDICE, 'SS0001CB.M1').modelo, 'MAELLE')
  // O lote guarda o SKU como foi digitado; o indice, como esta na pasta do Zoho.
  assert.equal(verbeteDoProduto(INDICE, 'ss0001cb m1')?.modelo, 'MAELLE')
  assert.equal(verbeteDoProduto(INDICE, 'NAOEXISTE'), null)
  assert.equal(verbeteDoProduto(INDICE, ''), null)
})

test('o impedimento diz O MOTIVO, e ha frase para cada um', () => {
  assert.equal(impedimentoDoCartao({ numero_na_serie: 1 }, LOTES['lote-a'], INDICE), null)
  assert.equal(impedimentoDoCartao({ numero_na_serie: 1 }, LOTES['lote-sem-sku'], INDICE), 'sem_sku')
  assert.equal(impedimentoDoCartao({ numero_na_serie: 1 }, LOTES['lote-sem-foto'], INDICE), 'sem_foto')
  assert.equal(impedimentoDoCartao({ numero_na_serie: null }, LOTES['lote-a'], INDICE), 'sem_numero')
  assert.equal(impedimentoDoCartao({ numero_na_serie: 1 }, null, INDICE), 'sem_sku')
  // Botao desabilitado calado faz a pessoa achar que a ferramenta quebrou.
  for (const chave of ['sem_sku', 'sem_foto', 'sem_numero']) {
    assert.ok(MOTIVO_DO_IMPEDIMENTO[chave]?.length > 30, `${chave} sem frase que explique`)
  }
})

test('a linha traz o numero de serie que vai sair IMPRESSO', () => {
  const [l] = linhasDeCartao([{ codigo: 'AAA', lote_id: 'lote-a', numero_na_serie: 7 }], LOTES, INDICE)
  assert.equal(l.numeroDeSerie, 'SS0001CBM1007')
  assert.equal(l.modelo, 'MAELLE', 'o modelo vem do indice, que e o que o cartao desenha')
  assert.equal(l.podeGerar, true)
})

test('⚠️ "ja tem cartao" sai de cartao_gerado_em, que o ROBO marca', () => {
  // A marca entra depois de o arquivo existir no Zoho, e nao no pedido. Peca
  // cujo cartao falhou no meio continua pendente — que e a verdade.
  const linhas = linhasDeCartao([
    { codigo: 'A', lote_id: 'lote-a', numero_na_serie: 1, cartao_gerado_em: '2026-09-11T10:00:00Z' },
    { codigo: 'B', lote_id: 'lote-a', numero_na_serie: 2, cartao_gerado_em: null },
  ], LOTES, INDICE)
  assert.equal(linhas[0].jaTemCartao, true)
  assert.equal(linhas[1].jaTemCartao, false)
})

test('⚠️ so vem marcado o que AINDA NAO tem cartao', () => {
  // Refazer e permitido (cartao rasga, mancha, some), mas nunca por padrao:
  // vindo marcado, um clique reimprimiria a leva inteira e o Zoho voltaria com
  // o dobro dos arquivos, sem ninguem saber qual e o bom.
  const linhas = linhasDeCartao([
    { codigo: 'A', lote_id: 'lote-a', numero_na_serie: 1, cartao_gerado_em: '2026-09-11T10:00:00Z' },
    { codigo: 'B', lote_id: 'lote-a', numero_na_serie: 2 },
    { codigo: 'C', lote_id: 'lote-sem-foto', numero_na_serie: 1 },
  ], LOTES, INDICE)
  assert.deepEqual(marcadasPorPadrao(linhas), ['B'])
})

test('o resumo conta o que vai acontecer, inclusive o que esta sendo REFEITO', () => {
  const linhas = linhasDeCartao([
    { codigo: 'A', lote_id: 'lote-a', numero_na_serie: 1, cartao_gerado_em: '2026-09-11T10:00:00Z' },
    { codigo: 'B', lote_id: 'lote-a', numero_na_serie: 2 },
  ], LOTES, INDICE)
  const r = resumoDoPedido(linhas, ['A', 'B'])
  assert.equal(r.total, 2)
  assert.equal(r.refazendo, 1)
  assert.equal(r.impedidas, 0)
  // Frente e verso, PNG e PDF: e o que o dono recebe na pasta.
  assert.equal(r.arquivos, 8)
})

test('⚠️ o resumo acusa peca marcada que NAO pode gerar', () => {
  // O banco recusaria a leva INTEIRA por causa de uma, e a pessoa perderia a
  // selecao toda. Melhor a tela avisar antes.
  const linhas = linhasDeCartao([{ codigo: 'C', lote_id: 'lote-sem-foto', numero_na_serie: 1 }], LOTES, INDICE)
  assert.equal(resumoDoPedido(linhas, ['C']).impedidas, 1)
})

test('⚠️ os dados do desenho tem a forma que montar-puro.mjs exige', () => {
  // Estes seis campos sao lidos por `htmlDoCartaoComRecursos`. Faltando um, o
  // desenho lanca ("peca sem numero de serie", "GTIN invalido") ou desenha
  // errado — e a previa deixa de ser o cartao.
  const [l] = linhasDeCartao([{ codigo: 'A', lote_id: 'lote-a', numero_na_serie: 3 }], LOTES, INDICE)
  const p = pecaParaODesenho(l, INDICE)
  assert.deepEqual(Object.keys(p).sort(),
    ['gtin', 'modelo', 'nomeCompleto', 'numeroDaPeca', 'numeroDeSerie', 'sku'])
  assert.equal(p.numeroDeSerie, 'SS0001CBM1003')
  assert.equal(p.gtin, '7901109709999')
  assert.match(p.gtin, /^\d{13}$/, 'o desenho recusa GTIN que nao seja EAN-13')
})

test('⚠️ o GTIN sai do INDICE publicado, nao de uma chamada ao Bling', () => {
  // A previa tem de abrir instantanea, e o numero na tela tem de ser o MESMO
  // que o robo imprime — e o robo le o indice. Bling fora do ar nao pode mudar
  // o que o cartao diz.
  const [l] = linhasDeCartao([{ codigo: 'A', lote_id: 'lote-a', numero_na_serie: 1 }], LOTES, INDICE)
  assert.equal(pecaParaODesenho(l, INDICE).gtin, INDICE['SS0001CB.M1'].gtin)
  assert.equal(pecaParaODesenho({ ...l, sku: 'NAOEXISTE' }, INDICE), null)
})

test('os recursos apontam para o que esta publicado no site', () => {
  const [l] = linhasDeCartao([{ codigo: 'A', lote_id: 'lote-a', numero_na_serie: 1 }], LOTES, INDICE)
  const r = recursosDoDesenho(l, INDICE, 'body{}')
  assert.equal(r.foto, BASE_DOS_RECURSOS + 'SS0001CB.M1.webp')
  assert.equal(r.ilustracao, BASE_DOS_RECURSOS + 'desenhos/MAELLE.webp')
  assert.equal(r.logo, BASE_DOS_RECURSOS + 'logo.png')
  assert.equal(r.assinatura, BASE_DOS_RECURSOS + 'assinatura.png')
  // A medida diz onde o CORPO da peca esta dentro da imagem. Sem ela o
  // enquadramento cai no encaixe burro e a previa mostra outra composicao.
  assert.equal(r.medidaDaFoto, INDICE['SS0001CB.M1'].medidaDaFoto)
})

test('⚠️ produto sem desenho a lapis nao inventa um', () => {
  // Decisao do dono: bolsa sem desenho sai sem, para nao por a bolsa errada no
  // verso do cartao. `undefined` aqui viraria uma imagem quebrada.
  const [l] = linhasDeCartao([{ codigo: 'B', lote_id: 'lote-b', numero_na_serie: 1 }], LOTES, INDICE)
  const r = recursosDoDesenho(l, INDICE, 'body{}')
  assert.equal(r.ilustracao, null)
  assert.equal(r.ehLenco, true, 'o lenco gira, e quem sabe disso e o indice')
})

test('⚠️ o CSS da previa traz a Montserrat, senao ela cai numa substituta calada', () => {
  // O cartao.css publicado NAO traz o @font-face: no arquivo que vai para a
  // grafica a fonte entra embutida em base64. Sem esta linha a previa sai numa
  // fonte parecida, sem erro nenhum, e o nome do modelo muda de largura.
  const css = cssDoCartao('.cartao{color:#fff}')
  assert.match(css, /@font-face/)
  assert.match(css, /Montserrat/)
  assert.match(css, /montserrat-variavel\.woff2/)
  assert.match(css, /font-weight:200 600/, 'a fonte e variavel; sem a faixa os pesos somem')
  assert.match(css, /\.cartao\{color:#fff\}/, 'o CSS publicado continua inteiro')
})

test('cada recusa do banco vira frase que diz o que fazer', () => {
  assert.match(fraseDoPedidoRecusado('nenhuma_peca'), /[Mm]arque/)
  assert.match(fraseDoPedidoRecusado('demais', { pedidas: 900, teto: 500 }), /900/)
  assert.match(fraseDoPedidoRecusado('demais', { pedidas: 900, teto: 500 }), /500/)
  assert.match(fraseDoPedidoRecusado('peca_nao_existe', { pecas: ['XYZ'] }), /XYZ/)
  assert.match(fraseDoPedidoRecusado('sem_permissao'), /permiss[aã]o/i)
  // Motivo que ninguem previu nao pode virar tela em branco.
  assert.ok(fraseDoPedidoRecusado('coisa_nova').length > 20)
})

test('a fila se explica sozinha, inclusive quando falha', () => {
  assert.equal(situacaoDoPedido({ situacao: 'na_fila', pecas: ['A', 'B'] }).rotulo, 'Na fila')
  assert.match(situacaoDoPedido({ situacao: 'na_fila', pecas: ['A', 'B'] }).detalhe, /2/)
  assert.match(situacaoDoPedido({ situacao: 'pronto', pecas: ['A'], pasta: 'Cartões com EAN/2026-09-11' }).detalhe,
    /2026-09-11/)
  // Falha sem motivo escrito e a pior: a pessoa recarrega a tela as cegas.
  assert.ok(situacaoDoPedido({ situacao: 'falhou', pecas: ['A'] }).detalhe.length > 10)
  assert.equal(situacaoDoPedido({ situacao: 'falhou', pecas: ['A'], erro: 'o Zoho recusou' }).detalhe,
    'o Zoho recusou')
  assert.equal(situacaoDoPedido(null).rotulo, '—')
})

test('cada peça sabe em que ponto da fila está, sem inventar porcentagem', () => {
  const fila = [
    { situacao: 'rodando', pecas: ['A', 'B'] },
    { situacao: 'na_fila', pecas: ['C'] },
    { situacao: 'pronto', pecas: ['D'] },
    { situacao: 'falhou', pecas: ['E'] },
  ]
  assert.equal(andamentoDaPeca('A', fila), 'rodando')
  assert.equal(andamentoDaPeca('C', fila), 'na_fila')
  // Pedido que acabou (bem ou mal) não prende a peça numa barra que nunca anda.
  assert.equal(andamentoDaPeca('D', fila), null)
  assert.equal(andamentoDaPeca('E', fila), null)
  assert.equal(andamentoDaPeca('Z', fila), null)
  // Na fila e rodando ao mesmo tempo: vale o que está de fato acontecendo.
  assert.equal(andamentoDaPeca('A', [...fila, { situacao: 'na_fila', pecas: ['A'] }]), 'rodando')
  assert.equal(andamentoDaPeca('A', null), null)
})

test('o aviso do pedido diz QUAIS bolsas são, agrupadas por nome', () => {
  const linhas = [
    { codigo: 'A', nome: 'Linear Small Vermelha', numeroDeSerie: 'SS0001HBS2001' },
    { codigo: 'B', nome: 'Linear Small Vermelha', numeroDeSerie: 'SS0001HBS2002' },
    { codigo: 'C', nome: 'Maelle Bege', numeroDeSerie: 'SS0001CBM1001' },
  ]
  const r = bolsasDoPedido({ pecas: ['A', 'B', 'C'] }, linhas)
  assert.equal(r.grupos.length, 2)
  assert.deepEqual(r.grupos[0].codigos, ['A', 'B'], 'o primeiro código é o que o botão procura na lista')
  assert.deepEqual(r.grupos[0].series, ['SS0001HBS2001', 'SS0001HBS2002'])
  assert.equal(r.grupos[0].achada, true)
  assert.equal(r.alemDisso, 0)
  // Peça que não está na lista aparece pelo código e não promete botão.
  const sumida = bolsasDoPedido({ pecas: ['ZZ'] }, linhas)
  assert.equal(sumida.grupos[0].nome, 'ZZ')
  assert.equal(sumida.grupos[0].achada, false)
  // Pedido grande não vira 110 linhas: corta no máximo e diz quantos ficaram de fora.
  const muitas = Array.from({ length: 7 }, (_, i) => ({ codigo: 'P' + i, nome: 'Modelo ' + i, numeroDeSerie: 'S' + i }))
  const g = bolsasDoPedido({ pecas: muitas.map((m) => m.codigo) }, muitas, 4)
  assert.equal(g.grupos.length, 4)
  assert.equal(g.alemDisso, 3)
  assert.deepEqual(bolsasDoPedido(null, null), { grupos: [], alemDisso: 0 })
})

test('o arquivo baixado tem o nome que o robô entregou no Zoho', () => {
  const l = { sku: 'SS0001HB.S1', numeroNaSerie: 4 }
  assert.equal(nomeDoArquivoBaixado(l, 'frente', 'png'), 'SS0001HB.S1_cartao_04_frente.png')
  assert.equal(nomeDoArquivoBaixado({ sku: 'SS0003SB.B2', numeroNaSerie: 10 }, 'verso', 'pdf'), 'SS0003SB.B2_cartao_10_verso.pdf')
})

test('o download dos dois lados tem nome próprio: PDF único e zip dos PNGs', () => {
  const l = { sku: 'SS0001HB.S1', numeroNaSerie: 4 }
  assert.equal(nomeDoArquivoDosDois(l, 'pdf'), 'SS0001HB.S1_cartao_04.pdf')
  assert.equal(nomeDoArquivoDosDois(l, 'png'), 'SS0001HB.S1_cartao_04_png.zip')
})

test('sem resposta do servidor (rede/CORS) a frase diz isso, em vez de "erro"', () => {
  assert.match(fraseDoDownloadRecusado('sem_resposta'), /servidor/)
  assert.match(fraseDoDownloadRecusado('sem_resposta'), /localhost/)
})

test('cada recusa do download diz o que fazer, e motivo novo não vira tela muda', () => {
  assert.match(fraseDoDownloadRecusado('sem_cartao'), /Gere/)
  assert.match(fraseDoDownloadRecusado('arquivo_nao_achado'), /Zoho/)
  assert.match(fraseDoDownloadRecusado('sem_permissao'), /permiss[aã]o/)
  assert.match(fraseDoDownloadRecusado('zoho_desconectado'), /administrador/)
  assert.match(fraseDoDownloadRecusado('zoho_recusou'), /de novo/)
  assert.ok(fraseDoDownloadRecusado('coisa_nova').length > 20)
  assert.ok(fraseDoDownloadRecusado(undefined).length > 20)
})

test('a releitura da fila só liga enquanto há pedido a terminar', () => {
  assert.equal(temPedidoAtivo([{ situacao: 'pronto' }, { situacao: 'falhou' }]), false)
  assert.equal(temPedidoAtivo([{ situacao: 'pronto' }, { situacao: 'na_fila' }]), true)
  assert.equal(temPedidoAtivo([{ situacao: 'rodando' }]), true)
  assert.equal(temPedidoAtivo([]), false)
  assert.equal(temPedidoAtivo(undefined), false)
})
