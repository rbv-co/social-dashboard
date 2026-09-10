// POR QUANTOS SEGUIDORES O CUSTO POR SEGUIDOR DIVIDE.
//
// A régua desta seção já estava escrita em cartoes-do-balde.js, e vale para os
// DOIS lados da divisão:
//
//   "Custo que não divide o número impresso logo acima dele é custo que ninguém
//    consegue conferir."
//
// Ela foi aplicada só ao NUMERADOR quando os baldes nasceram (o investimento
// passou a ser o do cartão, ao vivo). O denominador continuou vindo do coletor —
// e os dois lados passaram a falar de momentos diferentes.
//
// O QUE ISSO FEZ, medido na produção em 20/08/2026 (Raíssa, período HOJE):
// o cartão de seguidores mostrava 53 (a contagem ao vivo de agora menos a de
// ontem) e o custo dividia R$ 435,88 por 26 (o que o coletor tinha fotografado
// na última passada dele). Saiu R$ 16,76 onde a conta na mão dá R$ 8,22 — quase
// o dobro, sem nenhum selo avisando que aquele número não estava fechado.
// O dinheiro era do minuto; os seguidores, da manhã.
//
// A REGRA, ENTÃO: o denominador sai da MESMA fonte do número que está impresso
// no cartão de seguidores. Ao vivo com ao vivo, coletado com coletado.
// PURO: sem rede, sem tela.

// De onde veio o denominador. A tela usa isto para decidir o selo, e o teste
// para afirmar qual caminho foi tomado.
export const FONTES = {
  // HOJE e 1D: a Meta ainda não publicou a quebra "quem seguiu / quem saiu"
  // desses dias, então o ÚNICO número de seguidor que existe na tela é o líquido
  // pela variação da contagem — e é ele que o cartão imprime. Dividir por
  // qualquer outra coisa é imprimir um custo que não se confere.
  impressoAoVivo: 'impresso-ao-vivo',
  // 7D/14D/30D/mês com o ao vivo respondendo: o cartão mostra "Seguidores" e
  // "Deixaram de seguir" vindos da Meta agora. O custo divide o BRUTO (quem
  // seguiu), que é a régua de sempre — só que da mesma leitura, não do banco.
  brutoAoVivo: 'bruto-ao-vivo',
  // Sem ao vivo, a tela inteira cai no coletado. Aí os dois lados da divisão
  // voltam a ser da mesma foto e batem de novo, como sempre bateram.
  coletado: 'coletado',
};

// Número que serve de denominador, ou null. Zero e negativo NÃO são denominador:
// quem trata isso é o `div()` de cartoes-do-balde.js, que devolve "—" em vez de
// inventar um custo infinito. Aqui só se recusa o que não é número.
//
// `null` e `''` saem ANTES do Number(): `Number(null)` é 0, e 0 aqui seria "não
// seguiu ninguém" — uma afirmação — onde a verdade é "não veio leitura". É a
// mesma armadilha que já pintou R$ 0,00 nesta seção.
const numeroOuNulo = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {object} entrada
 * @param {{seguiu:number, anteriorSeguiu:number|null}|null} entrada.live
 *        O bruto AO VIVO — `live.novos.seguiu` e `live.anterior.novos.seguiu`.
 *        null quando a Meta não respondeu e a tela caiu no coletado.
 * @param {boolean} entrada.ehRecenteLive  HOJE ou 1D com o ao vivo respondendo.
 * @param {number}  entrada.numeroImpresso O número que o cartão de seguidores
 *        está mostrando (o `headlineVal` da tela).
 * @param {{bruto:number, brutoAnterior:number|null, previa:boolean}} entrada.coletado
 *        O caminho de sempre: soma de `gained` do período, e o mesmo do período
 *        anterior. `previa` é o `cpsPrevia` que a tela já calculava.
 * @returns {{valor:number|null, anterior:number|null, previa:boolean, fonte:string}}
 */
export function seguidoresDoCusto({ live, ehRecenteLive, numeroImpresso, estimado, coletado } = {}) {
  const col = coletado || {};
  // Sem ao vivo não há escolha a fazer: é o caminho de sempre, inteiro —
  // inclusive o selo de prévia que a tela já sabia calcular.
  if (!live) {
    return {
      valor: numeroOuNulo(col.bruto),
      anterior: numeroOuNulo(col.brutoAnterior),
      previa: !!col.previa,
      fonte: FONTES.coletado,
    };
  }
  if (ehRecenteLive) {
    return {
      valor: numeroOuNulo(numeroImpresso),
      // NÃO COMPARA COM O PERÍODO ANTERIOR. O de hoje é o líquido pela contagem;
      // o de ontem, o bruto que a Meta já fechou. São medidas diferentes, e
      // pôr uma seta verde entre elas seria afirmar uma melhora que ninguém mediu.
      anterior: null,
      // SEMPRE PRÉVIA. Este número é a variação da contagem, e ele se ajusta
      // quando o Instagram fecha o dia. Sem o selo, ele sai no mesmo azul
      // confiante de um número fechado.
      previa: true,
      fonte: FONTES.impressoAoVivo,
    };
  }
  return {
    valor: numeroOuNulo(live.seguiu),
    anterior: numeroOuNulo(live.anteriorSeguiu),
    // ⚠️ O DENOMINADOR CONTINUA SENDO O BRUTO (quem seguiu) — custo de aquisição
    // não divide por líquido, senão quem saiu entra na conta de quem foi
    // conquistado. Decisão do dono, 09/09/2026.
    //
    // ⚠️ MAS O BRUTO VEM SUBESTIMADO QUANDO FALTA DIA. O dia que a Meta não
    // publicou soma ZERO no agregado (medido: janela [05/09, 09/09), quatro dias,
    // o dia 08 ausente, agregado dos três publicados). Dividir por um bruto menor
    // faz o custo por seguidor sair ALTO DEMAIS — e saía sem aviso nenhum. Não dá
    // para consertar o número (a quebra seguiu/saiu do dia é justamente o que não
    // existe), mas dá para não afirmar que ele está fechado.
    previa: !!estimado,
    fonte: FONTES.brutoAoVivo,
  };
}
