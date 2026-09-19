/* AS CONTAS DE PROPORÇÃO DO COMERCIAL VESSEL.
 *
 * POR QUE ESTE ARQUIVO EXISTE: as telas desta família mostram taxas de conversão
 * calculadas sobre bases MINÚSCULAS — uma Beauty Session tem dezenas de
 * leituras, uma Private Edit tem 5 a 8 convidadas, uma stylist nova tem três
 * clientes. "33% de conversão" sobre 3 pessoas não é uma taxa: é uma pessoa.
 *
 * Quem lê essas telas decide onde pôr dinheiro. Mostrar um percentual sem dizer
 * de quantos ele saiu é o jeito mais barato de fazer alguém agir com confiança
 * que o dado não tem.
 *
 * As três regras que este arquivo impõe:
 *
 *   1. TODA TAXA VIAJA COM O DENOMINADOR. Nunca "20%", sempre "20% (9 de 46)".
 *   2. BASE ZERO NÃO É ZERO POR CENTO. Sem ninguém no denominador não existe
 *      taxa — e "0%" faria uma sessão que ninguém abriu parecer uma que
 *      fracassou. São coisas diferentes, e só a segunda pede decisão.
 *   3. A MARGEM ANDA JUNTO. Com base pequena, a taxa observada e a taxa real
 *      podem estar muito longe uma da outra, e a tela precisa dizer isso.
 */

/**
 * O intervalo de confiança de 95% de uma proporção, pelo método de WILSON.
 *
 * ⚠️ WILSON, E NÃO A FÓRMULA DE LIVRO-TEXTO (Wald, `p ± 1.96·√(p(1-p)/n)`).
 * A de livro-texto quebra exatamente onde estas telas vivem:
 *   · com p = 0 ou p = 1 ela devolve margem ZERO — "0% de conversão, sem
 *     margem de erro", sobre 4 pessoas. É falso e é convincente, a pior
 *     combinação;
 *   · com n pequeno ela devolve limites abaixo de 0% e acima de 100%.
 * Wilson não faz nenhuma das duas, e é o método recomendado para n pequeno.
 *
 * Devolve `null` quando não há base — ausência de dado não é um intervalo.
 */
export function intervaloDeWilson(sucessos, total, z = 1.96) {
  const n = Number(total) || 0
  const x = Number(sucessos) || 0
  if (n <= 0) return null
  const p = x / n
  const z2 = z * z
  const denominador = 1 + z2 / n
  const centro = (p + z2 / (2 * n)) / denominador
  const margem = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominador
  return {
    de: Math.max(0, centro - margem),
    ate: Math.min(1, centro + margem),
  }
}

/**
 * Acima de quantos pontos percentuais de largura a taxa deixa de servir para
 * decidir alguma coisa.
 *
 * ⚠️ É UM CORTE ESCOLHIDO, NÃO UMA LEI. 20 pontos de largura quer dizer que a
 * taxa real pode ser, por exemplo, 20% ou 40% — dois mundos diferentes para
 * quem vai decidir imprimir cartão ou contratar stylist. O número está aqui,
 * num lugar só, para ser discutido e mudado de propósito, e não redescoberto
 * espalhado por três telas.
 */
export const LARGURA_MAXIMA_UTIL = 0.20

/**
 * Uma proporção pronta para a tela, com tudo que ela precisa carregar.
 *
 * Devolve sempre o mesmo formato, inclusive quando não há base — quem desenha
 * não precisa lembrar de tratar o caso vazio.
 */
export function proporcao(sucessos, total) {
  const n = Number(total) || 0
  const x = Number(sucessos) || 0
  if (n <= 0) {
    return { temBase: false, n: 0, x: 0, valor: null, intervalo: null, confiavel: false }
  }
  const intervalo = intervaloDeWilson(x, n)
  const largura = intervalo.ate - intervalo.de
  return {
    temBase: true,
    n,
    x,
    valor: x / n,
    intervalo,
    largura,
    // "Confiável" aqui quer dizer só uma coisa: a margem é estreita o bastante
    // para a taxa separar um cenário do outro. Não quer dizer que o dado é bom.
    confiavel: largura <= LARGURA_MAXIMA_UTIL,
  }
}

/** "20%" — sem base, o traço. Nunca "0%" para base vazia. */
export function emPorcento(valor, casas = 0) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—'
  return `${(valor * 100).toFixed(casas)}%`
}

/**
 * A frase inteira: taxa, de quantos, e a margem quando ela importa.
 *
 * ⚠️ O DENOMINADOR NÃO É OPCIONAL. Foi ele que faltou em toda tela que já levou
 * alguém a decidir errado neste projeto: um número grande e sozinho passa por
 * verdade estabelecida.
 */
export function taxaEscrita(p) {
  if (!p || !p.temBase) return 'sem base ainda'
  return `${emPorcento(p.valor)} (${p.x} de ${p.n})`
}

/** A margem, dita só quando ela muda a leitura. */
export function margemEscrita(p) {
  if (!p || !p.temBase) return ''
  if (p.confiavel) return ''
  return `base pequena — entre ${emPorcento(p.intervalo.de)} e ${emPorcento(p.intervalo.ate)}`
}

/**
 * Soma um campo de uma lista de linhas, com o denominador junto.
 * Serve para o total de uma tela: a taxa do conjunto NÃO é a média das taxas.
 *
 * ⚠️ MÉDIA DE TAXAS É ERRADA e é o erro mais comum aqui: três sessões com 50%,
 * 50% e 10% não dão 36,7% de conversão no conjunto — dão o que a soma dos
 * numeradores der sobre a soma dos denominadores. Uma sessão com 2 leituras
 * pesaria igual a uma com 200.
 */
export function proporcaoDoConjunto(linhas, campoSucesso, campoTotal) {
  const lista = Array.isArray(linhas) ? linhas : []
  const x = lista.reduce((s, l) => s + (Number(l?.[campoSucesso]) || 0), 0)
  const n = lista.reduce((s, l) => s + (Number(l?.[campoTotal]) || 0), 0)
  return proporcao(x, n)
}

/**
 * Dinheiro em reais, sem centavos — a tela decide orçamento, não fecha caixa.
 */
export function emReais(valor) {
  const n = Number(valor) || 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/**
 * A frase da janela de venda, que vem DENTRO da resposta do banco.
 *
 * ⚠️ ELA NUNCA É CRAVADA NA TELA. Não existe no dado nenhum campo dizendo "esta
 * compra veio daquele encontro" — o que existe é a mesma cliente comprando
 * perto da visita. Chamar isso de conversão sem dizer a régua é inventar
 * precisão, e a régua viaja na resposta justamente para não divergir da conta.
 */
export function janelaEscrita(dias) {
  // ⚠️ `Number(null)` é 0, e 0 é finito: sem esta linha, "não veio janela"
  // virava "compra em até 0 dias da visita" — uma régua inventada com cara de
  // régua real, que é exatamente o que este arquivo existe para impedir.
  if (dias === null || dias === undefined || dias === '') return ''
  const d = Number(dias)
  if (!Number.isFinite(d) || d < 0) return ''
  if (d === 0) return 'compra no mesmo dia da visita'
  return d === 1 ? 'compra em até 1 dia da visita' : `compra em até ${d} dias da visita`
}

/**
 * UMA RAZÃO, que é coisa diferente de uma proporção.
 *
 * ⚠️ POR QUE ISTO EXISTE SEPARADO: "pedidos ÷ clientes" NÃO é uma proporção.
 * A mesma cliente pode pedir visita duas vezes, então o resultado pode passar
 * de 1 — e passar de 100% num campo rotulado como taxa é o tipo de número que
 * faz quem lê desconfiar da tela inteira, com razão.
 *
 * Intervalo de confiança de proporção (Wilson) NÃO se aplica aqui: ele
 * pressupõe que cada unidade do denominador dá sim ou não uma vez só. Por isso
 * esta função não devolve intervalo nenhum — prefere não dizer a dizer errado.
 *
 * Use `proporcao` quando cada unidade do denominador vira sim/não uma vez
 * (compareceu ou não, respondeu ou não). Use `razao` quando o numerador pode
 * contar a mesma unidade mais de uma vez.
 */
export function razao(numerador, denominador) {
  const n = Number(denominador) || 0
  const x = Number(numerador) || 0
  if (n <= 0) return { temBase: false, n: 0, x: 0, valor: null }
  return { temBase: true, n, x, valor: x / n }
}

/** "1,4 por cliente" — com uma casa, porque duas fingem precisão que não há. */
export function razaoEscrita(r, unidade = '') {
  if (!r || !r.temBase) return 'sem base ainda'
  const v = r.valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return unidade ? `${v} ${unidade} (${r.x} em ${r.n})` : `${v} (${r.x} em ${r.n})`
}
