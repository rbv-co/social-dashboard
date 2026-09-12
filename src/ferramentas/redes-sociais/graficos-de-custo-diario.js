// QUAL GRÁFICO DIÁRIO CADA CARTÃO DE CUSTO GANHA, e com que palavras.
//
// A seção 02 troca os cartões conforme o balde (ver cartoes-do-balde.js). Todo
// cartão de CUSTO POR RESULTADO — conversa, cadastro, visita, venda, interação,
// curtida e mil impressões — é a mesma conta com um denominador diferente, e por
// isso todos usam a MESMA série (montarSerieDeCustoPorResultado). O que muda de
// um para o outro é só isto aqui: de qual coluna do dia sai o denominador e como
// o indicador se chama em português.
//
// PURO: sem rede, sem tela. O teste ao lado confere contra cartoes-do-balde.js
// que nenhum cartão de custo ficou sem gráfico — é essa guarda que impede um
// balde novo de nascer com um cartão mudo.
//
// FORA DAQUI, de propósito:
//   • investimento — não é custo por resultado, é o próprio dinheiro
//     (montarSerieDeInvestimento);
//   • custo por seguidor — o denominador dele não vem de campaign_insights, vem
//     da série de seguidores (montarSerieDeCustoPorSeguidor).

// `campo` é a coluna de campaign_insights com period_days = 0 (a contagem DO DIA).
// `divisor` só não é 1 no custo por mil impressões, cujo denominador é
// impressões ÷ 1000.
// Os nomes são os que aparecem para o dono, com gênero, para as frases saírem em
// português de verdade ("nenhuma conversa", "nenhum cadastro").
export const GRAFICO_POR_CARTAO = {
  cpi: {
    campo: 'post_engagement', divisor: 1,
    nomeDoCusto: 'custo por interação', resultado: 'interação', resultadoPlural: 'interações',
    denominadorNaConta: 'interações do dia', nenhum: 'nenhuma',
  },
  cpl: {
    campo: 'likes', divisor: 1,
    nomeDoCusto: 'custo por curtida', resultado: 'curtida', resultadoPlural: 'curtidas',
    denominadorNaConta: 'curtidas do dia', nenhum: 'nenhuma',
  },
  custo_conversa: {
    campo: 'conversas', divisor: 1,
    nomeDoCusto: 'custo por conversa', resultado: 'conversa', resultadoPlural: 'conversas',
    denominadorNaConta: 'conversas do dia', nenhum: 'nenhuma',
  },
  custo_cadastro: {
    campo: 'cadastros', divisor: 1,
    nomeDoCusto: 'custo por cadastro', resultado: 'cadastro', resultadoPlural: 'cadastros',
    denominadorNaConta: 'cadastros do dia', nenhum: 'nenhum',
  },
  custo_visita: {
    campo: 'visitas', divisor: 1,
    nomeDoCusto: 'custo por visita', resultado: 'visita', resultadoPlural: 'visitas',
    denominadorNaConta: 'visitas do dia', nenhum: 'nenhuma',
  },
  custo_venda: {
    campo: 'compras', divisor: 1,
    nomeDoCusto: 'custo por venda', resultado: 'venda', resultadoPlural: 'vendas',
    denominadorNaConta: 'vendas do dia', nenhum: 'nenhuma',
  },
  // O TÍTULO fala em MIL impressões, e a frase de "não deu para calcular" fala em
  // impressão: o que faltou no dia foi impressão, não "mil impressões".
  cpm: {
    campo: 'impressions', divisor: 1000,
    nomeDoCusto: 'custo por mil impressões', resultado: 'impressão', resultadoPlural: 'impressões',
    denominadorNaConta: 'mil impressões do dia', nenhum: 'nenhuma',
    tituloDoCusto: 'mil impressões',
  },
};

/** A receita do gráfico deste cartão, ou null quando ele não é custo por resultado. */
export function graficoDoCartao(cartaoId) {
  if (!cartaoId) return null;
  return GRAFICO_POR_CARTAO[cartaoId] || null;
}

const maiuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * As palavras do gráfico deste cartão — título, rótulos, legenda e as frases de
 * quando NÃO há gráfico. Devolve null para cartão que não tem gráfico aqui.
 *
 * `diasComCusto` muda a frase do vazio, e isso não é detalhe: dizer "nenhum dia"
 * quando houve um dia medido é a tela mentindo sobre o próprio dado. São TRÊS
 * situações diferentes, com três frases — e o número sai escrito, não deduzido do
 * mínimo. Um `>= 1` no lugar do `=== 1` só está certo enquanto o mínimo for 2:
 * subindo para 3, dois dias medidos sairiam como "Só um dia deste período", que é
 * a tela mentindo baixinho — exatamente o defeito que esta obra combate.
 *
 * O número que chega aqui é o de dias que AUTORIZAM o gráfico (com investimento E
 * resultado no mesmo dia), e é por isso que a frase pode dizer "teve investimento
 * e conversa ao mesmo tempo" sem exagerar: dia de graça não entra nessa conta.
 *
 * `temMeta` manda na legenda pelo mesmo motivo do gráfico de investimento: sem
 * meta não há linha desenhada, e a legenda não pode prometer o que não está lá.
 */
export function opcoesDoGrafico(cartaoId, { temMeta = false, diasComCusto = 0 } = {}) {
  const g = graficoDoCartao(cartaoId);
  if (!g) return null;
  const oQueOCustoCompra = g.tituloDoCusto || g.resultado;
  return {
    titulo: 'Quanto custou cada ' + oQueOCustoCompra + ', dia a dia',
    rotuloValor: maiuscula(g.nomeDoCusto) + ' no dia',
    rotuloMeta: 'Meta máxima',
    legendaBase: 'Cada barra é um dia (investido no dia ÷ ' + g.denominadorNaConta + ')'
      + (temMeta
        ? ' · a linha é a meta máxima · barra vermelha = custou mais caro que a meta'
        : ' · sem meta definida para este indicador, então não há linha de meta'),
    // O texto que entra no lugar do gráfico quando ele não vale o espaço.
    textoVazio: diasComCusto === 0
      ? 'Nenhum dia deste período teve investimento e ' + g.resultado + ' ao mesmo tempo — sem ' + g.nomeDoCusto + ' pra mostrar.'
      : diasComCusto === 1
        ? 'Só um dia deste período teve investimento e ' + g.resultado + ' ao mesmo tempo — um dia sozinho não mostra tendência nenhuma, então não há gráfico.'
        : 'Só ' + diasComCusto + ' dias deste período tiveram investimento e ' + g.resultadoPlural + ' ao mesmo tempo — poucos dias pra mostrar tendência, então não há gráfico.',
    // O que cada buraco do gráfico quer dizer, no toque longo da barrinha.
    textoSemDado: {
      'sem-coleta': 'sem informação coletada neste dia',
      'sem-resultado': g.nenhum + ' ' + g.resultado + ' neste dia — sem como calcular o custo',
    },
    // A contagem que entra na legenda embaixo do gráfico.
    rotuloDiasSemResultado: (n) => n === 1
      ? '1 dia sem ' + g.resultado + ' (não dá pra calcular o custo)'
      : n + ' dias sem ' + g.resultadoPlural + ' (não dá pra calcular o custo)',
  };
}
