// O SKU DO LOTE CONTRA O CODIGO DO ITEM DO PEDIDO DE VENDA.
//
// Separado da edge porque e a regra que decide se uma cliente ganha a garantia
// na hora ou fica esperando na fila — e porque errar para o lado errado aqui da
// a garantia de uma bolsa a quem comprou outra coisa.
//
// ⚠️ OS DOIS NAO SAO IGUAIS, e isso foi MEDIDO contra a API do Bling em
// 03/09/2026, nao suposto: um item real de pedido veio com o codigo
// `LV102-peça unica`, enquanto o lote guarda `H0015S` ou `SS1025-F`. Comparar
// com `===` reprovaria compras verdadeiras e mandaria toda cliente para a fila,
// que e o mesmo que nao ter conferencia nenhuma.
//
// ⚠️ E ELE ERRA PARA O LADO SEGURO DE PROPOSITO. Errar dizendo "nao bateu" manda
// o pedido para a fila, onde uma pessoa olha e resolve em um minuto. Errar
// dizendo "bateu" da a garantia da bolsa a quem comprou outra coisa, calado.
// Por isso nada de comparacao "parecida" mais frouxa do que prefixo.

/** So letras e digitos, maiusculas, sem acento. */
export function achatar(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// O MINIMO DE QUATRO CARACTERES existe porque prefixo curto casa com meio
// catalogo: sem ele, um SKU `SS1` casaria com `SS1025-F`, `SS1162` e todo
// produto que comece com SS1 — e a cliente que comprou uma bolsa levaria a
// garantia de outra.
export const MINIMO_PARA_COMPARAR = 4

export function casaComOSku(codigoDoItem, sku) {
  const a = achatar(codigoDoItem)
  const b = achatar(sku)
  if (a.length < MINIMO_PARA_COMPARAR || b.length < MINIMO_PARA_COMPARAR) return false
  return a.startsWith(b) || b.startsWith(a)
}
