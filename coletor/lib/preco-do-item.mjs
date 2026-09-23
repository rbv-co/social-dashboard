// O QUE CADA CAMPO DE UM ITEM DE PEDIDO DO BLING QUER DIZER.
//
// O Bling devolve, em `pedidos/vendas/{id}`, itens assim:
//
//   { codigo: 'LV1054-Caramelo', quantidade: 1, valor: 224.95, desconto: 50 }
//
// ⚠️ `valor` JÁ É O PREÇO COBRADO, com o desconto dentro dele. E `desconto` é a
// porcentagem que JÁ FOI aplicada — ela é informativa, não é uma conta a fazer.
// A prova é o próprio Bling: o `totalProdutos` do pedido é `qtd × valor`, sem
// tocar no desconto. No pedido 2649, as nove linhas somam exatamente os
// R$ 1.263,25 do cabeçalho — e a NF-e saiu por esse mesmo valor.
//
// ⚠️ ATÉ 22/09/2026 O COLETOR DESCONTAVA DE NOVO, e por um motivo que parecia
// bom: em 21 de 1.125 itens o `desconto` é MAIOR que o `valor`, o que em reais
// seria pagar para a cliente levar — logo, raciocinou-se, é porcentagem. A
// primeira metade estava certa (é porcentagem mesmo); a segunda não: sendo
// porcentagem de um preço que JÁ é o de venda, aplicá-la outra vez inventa
// desconto. Medido em 22/09: R$ 10.028,94 de desconto fantasma em 116 pedidos,
// e a `receita_liquida` não batia com o Bling, nem com a nota, nem com a tela.
//
// ⚠️ COMO SE DESCOBRIU QUAL ERA A FÓRMULA DO PREÇO CHEIO. Nos 171 itens com
// desconto, contadas as duas hipóteses pelo número de vezes que caem num preço
// de verdade (terminado em ,90 ou ,00):
//
//   A) valor é o cobrado    → tabela = valor / (1 - pct/100) ......... 105
//   B) desconto é o abatido → tabela = valor + desconto ................. 0
//
// A hipótese A acerta na bico: 224,95 a 50% → 449,90; 244,95 a 50% → 489,90;
// 331,42 a 15% → 389,91; 29,70 a 9,09% → 32,67. A B não acerta uma. Os 66 que
// não terminam em ,90 são atacado, onde o preço cheio não é preço de varejo.

const arredondar = (n) => Math.round(n * 100) / 100;
const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// As três contas de um item, a partir do que o Bling mandou.
//
// `totalDoItem` é DINHEIRO — é o que entra na receita e o que a nota cobra.
// `precoDeTabela` é INFORMAÇÃO — serve para responder "quanto de desconto a
// gente deu", e nunca para somar receita. Os dois separados de propósito: foi
// justamente misturar os dois que custou os R$ 10 mil.
export function contasDoItem(it) {
  const quantidade = numero(it?.quantidade);
  const unitario = numero(it?.valor);
  const percentual = numero(it?.desconto);

  // ⚠️ DESCONTO DE 100% OU MAIS NÃO TEM PREÇO CHEIO — a divisão daria infinito
  // ou número negativo. Nesse caso o preço de tabela é o próprio valor
  // cobrado: número torto vale menos que número sem graça, e uma coluna com
  // `Infinity` contamina toda soma que a encostar.
  const temDesconto = percentual > 0 && percentual < 100;
  const precoDeTabela = temDesconto
    ? arredondar(unitario / (1 - percentual / 100))
    : arredondar(unitario);

  return {
    quantidade,
    unitario,
    percentual,
    // ⚠️ SEM `(1 - pct/100)` AQUI. É esta linha, e só ela, o conserto de 22/09.
    totalDoItem: arredondar(quantidade * unitario),
    precoDeTabela,
  };
}
