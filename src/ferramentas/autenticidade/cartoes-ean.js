// A LÓGICA DA ABA "CARTÕES EAN" — sem tela, sem rede, sem banco.
//
// O cartão é o papel que vai DENTRO da bolsa: nome do modelo, foto da peça,
// número de série e o código de barras EAN-13 do produto. Quem o desenha é
// `montar-puro.mjs`, do repositório do site — o MESMO arquivo que o robô usa
// para gerar o que vai para a gráfica. Aqui mora só a pergunta anterior: quais
// peças podem ter cartão, quais já têm, e o que a tela manda para a fila.
//
// ⚠️ A PRÉVIA É O CARTÃO, e não uma imitação dele. Esta é a decisão que governa
// o arquivo inteiro: nenhuma medida, nenhum enquadramento e nenhuma tipografia
// são recalculados aqui. Se fossem, acertariam no começo e divergiriam depois,
// caladas — o dono aprovaria uma composição na tela e a gráfica imprimiria
// outra, e ninguém descobriria até o cartão estar colado na peça.

import { numeroDeSerie } from './lotes.js'

/** O endereço dos recursos publicados (foto tratada, desenho, CSS, fonte). */
export const BASE_DOS_RECURSOS = 'https://vesselbrasil.com.br/fotos/cartao/'

/**
 * A CHAVE DO PRODUTO: só letra e dígito, em maiúscula.
 *
 * ⚠️ É A MESMA NORMALIZAÇÃO de `numeroDeSerie` e de `vessel_chave_do_produto`
 * no banco — e tem de continuar sendo. "SS0001HB.B1" e "ss0001hb b1" imprimem o
 * MESMO número de série; se aqui elas virassem produtos diferentes, a tela
 * diria "sem foto" para uma bolsa cuja foto está publicada, e o cartão dela
 * nunca sairia.
 */
export const chaveDoProduto = (sku) =>
  String(sku ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * O verbete do produto dentro do índice publicado, achado pela CHAVE.
 *
 * O índice é gravado com o SKU como está na pasta do Zoho; o lote guarda o SKU
 * como foi digitado. Procurar pelo texto cru deixa de fora todo lote em que
 * alguém trocou um ponto por um espaço.
 */
export function verbeteDoProduto(indice, sku) {
  const chave = chaveDoProduto(sku)
  if (!chave || !indice) return null
  if (indice[sku]) return indice[sku]
  for (const [k, v] of Object.entries(indice)) {
    if (chaveDoProduto(k) === chave) return v
  }
  return null
}

/**
 * POR QUE ESTA PEÇA NÃO PODE TER CARTÃO — ou `null`, se pode.
 *
 * Devolve o motivo, e não sim/não: botão desabilitado calado faz a pessoa achar
 * que a ferramenta quebrou, e aqui há duas causas com conselhos diferentes.
 */
export function impedimentoDoCartao(peca, lote, indice) {
  if (!lote || !String(lote.sku ?? '').trim()) return 'sem_sku'
  if (!verbeteDoProduto(indice, lote.sku)) return 'sem_foto'
  // Sem número de série não há o que imprimir: o cartão é a identidade da peça.
  if (!numeroDeSerie(lote.sku, peca?.numero_na_serie)) return 'sem_numero'
  return null
}

export const MOTIVO_DO_IMPEDIMENTO = {
  sem_sku: 'Este lote não tem código de produto. Edite o lote e informe o SKU: '
    + 'sem ele não há código de barras nem foto.',
  sem_foto: 'Este produto ainda não tem foto tratada publicada. '
    + 'A foto entra pelo robô das fotos; sem ela o cartão sairia com um vazio no lugar da bolsa.',
  sem_numero: 'Esta peça está sem número de série. Recarregue a tela: '
    + 'o lote pode ter acabado de ser renumerado.',
}

/**
 * UMA LINHA POR PEÇA, do jeito que a tela lista.
 *
 * `jaTemCartao` vem de `cartao_gerado_em`, que é marcado pelo ROBÔ e só depois
 * de o arquivo existir no Zoho — não no momento do pedido. Peça cujo cartão
 * falhou no meio continua aparecendo como pendente, que é a verdade.
 */
export function linhasDeCartao(pecas, lotesPorId, indice) {
  return (pecas || []).map((p) => {
    const lote = lotesPorId?.[p.lote_id] || null
    const impedimento = impedimentoDoCartao(p, lote, indice)
    const verbete = lote ? verbeteDoProduto(indice, lote.sku) : null
    return {
      codigo: p.codigo,
      loteId: p.lote_id,
      sku: lote?.sku || '',
      modelo: verbete?.modelo || lote?.modelo || '',
      nome: verbete?.nome || [lote?.modelo, lote?.cor].filter(Boolean).join(' '),
      numeroNaSerie: p.numero_na_serie,
      numeroDeSerie: lote ? numeroDeSerie(lote.sku, p.numero_na_serie) : '',
      jaTemCartao: Boolean(p.cartao_gerado_em),
      cartaoGeradoEm: p.cartao_gerado_em || null,
      // Gravada ou com garantia: a peça já saiu. Não impede o cartão — impede
      // que o NÚMERO mude, que é outra coisa. Fica aqui só para a tela mostrar.
      jaSaiu: Boolean(p.gravada_em),
      impedimento,
      podeGerar: impedimento === null,
    }
  })
}

/**
 * O QUE VEM MARCADO AO ABRIR: as peças que ainda não têm cartão.
 *
 * ⚠️ REFAZER É PERMITIDO (cartão rasga, mancha, some), mas nunca por padrão.
 * Vindo marcado, um clique em "Gerar" reimprimiria a leva inteira — e o Zoho
 * voltaria com o dobro dos arquivos, sem ninguém saber qual é o bom.
 */
export function marcadasPorPadrao(linhas) {
  return (linhas || []).filter((l) => l.podeGerar && !l.jaTemCartao).map((l) => l.codigo)
}

/** O resumo que a tela mostra acima do botão. */
export function resumoDoPedido(linhas, marcadas) {
  const escolhidas = new Set(marcadas || [])
  const daVez = (linhas || []).filter((l) => escolhidas.has(l.codigo))
  return {
    total: daVez.length,
    refazendo: daVez.filter((l) => l.jaTemCartao).length,
    // ⚠️ MARCAR O QUE NÃO PODE É ERRO DA TELA, não do pedido. Se acontecer, o
    // banco recusaria a leva INTEIRA e a pessoa perderia a seleção toda.
    impedidas: daVez.filter((l) => !l.podeGerar).length,
    arquivos: daVez.length * 4, // frente e verso, PNG e PDF
  }
}

/**
 * OS DADOS DA PEÇA NO FORMATO QUE O DESENHO DO CARTÃO ESPERA.
 *
 * ⚠️ O GTIN SAI DO ÍNDICE PUBLICADO, e não de uma chamada ao Bling na hora de
 * abrir a prévia. Duas razões: a prévia tem de abrir instantânea, e o número
 * que aparece na tela tem de ser o MESMO que o robô vai imprimir — e o robô lê
 * o índice. Bling fora do ar não pode mudar o que o cartão diz.
 */
export function pecaParaODesenho(linha, indice) {
  const verbete = verbeteDoProduto(indice, linha.sku)
  if (!verbete) return null
  return {
    sku: linha.sku,
    nomeCompleto: verbete.nome,
    modelo: verbete.modelo,
    gtin: verbete.gtin,
    numeroDaPeca: linha.numeroNaSerie,
    numeroDeSerie: linha.numeroDeSerie,
  }
}

/** Os recursos do desenho, apontando para o que está publicado no site. */
export function recursosDoDesenho(linha, indice, css, base = BASE_DOS_RECURSOS) {
  const verbete = verbeteDoProduto(indice, linha.sku)
  if (!verbete) return null
  return {
    css,
    foto: base + verbete.foto,
    ilustracao: verbete.desenho ? base + verbete.desenho : null,
    assinatura: base + 'assinatura.png',
    logo: base + 'logo.png',
    medidaDaFoto: verbete.medidaDaFoto,
    ehLenco: verbete.ehLenco,
  }
}

/**
 * O CSS do cartão, com a fonte apontando para o arquivo publicado.
 *
 * ⚠️ A MONTSERRAT PRECISA DO `@font-face` ESCRITO AQUI. O `cartao.css` publicado
 * não o traz: no arquivo que vai para a gráfica a fonte entra EMBUTIDA, em
 * base64, para o cartão ser um arquivo só. Sem esta linha a prévia cai numa
 * fonte substituta — e ela não dá erro, sai parecida, e o nome do modelo muda
 * de largura sem ninguém ver.
 */
export function cssDoCartao(cssPublicado, base = BASE_DOS_RECURSOS) {
  return '@font-face{font-family:Montserrat;'
    + `src:url("${base}montserrat-variavel.woff2") format('woff2');`
    + 'font-weight:200 600;font-style:normal;font-display:block}\n'
    + String(cssPublicado ?? '')
}

/** A frase de uma recusa vinda de `vessel_pedir_cartoes`. */
export function fraseDoPedidoRecusado(motivo, dados = {}) {
  switch (motivo) {
    case 'sem_permissao':
      return 'Você não tem permissão para gerar cartões nesta ferramenta.'
    case 'nenhuma_peca':
      return 'Marque ao menos uma peça antes de gerar.'
    case 'demais':
      return `São ${dados.pedidas} peças de uma vez, e o máximo por leva é ${dados.teto}. `
        + 'Gere em levas menores — assim, se uma der problema, você não perde a leva inteira.'
    case 'peca_nao_existe':
      return 'Algumas peças marcadas não existem mais no sistema: '
        + `${(dados.pecas || []).join(', ')}. Recarregue a tela e marque de novo.`
    default:
      return 'Não foi possível gerar os cartões agora. Recarregue a tela e tente de novo.'
  }
}

/** Como a tela descreve um pedido da fila. */
export function situacaoDoPedido(pedido) {
  const n = (pedido?.pecas || []).length
  switch (pedido?.situacao) {
    case 'na_fila':  return { rotulo: 'Na fila', detalhe: `${n} cartão(ões) esperando o robô.` }
    case 'rodando':  return { rotulo: 'Gerando', detalhe: `${n} cartão(ões) sendo desenhados agora.` }
    case 'pronto':   return { rotulo: 'Pronto', detalhe: pedido.pasta ? `No Zoho, em ${pedido.pasta}.` : 'Entregue no Zoho.' }
    case 'falhou':   return { rotulo: 'Falhou', detalhe: pedido.erro || 'O robô não conseguiu terminar.' }
    default:         return { rotulo: '—', detalhe: '' }
  }
}
