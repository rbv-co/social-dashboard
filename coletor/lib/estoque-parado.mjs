// "Estoque que nunca zera" (plano 05, item B). `gc_estoque_item` só recebia as linhas que o Bling lista com saldo > 0
// (`blingSaldoFoco`), então produto que zerou, sumiu da lista de ativos ou trocou de chave (`codigo || id`) ficava com o
// saldo velho para sempre. Aqui mora a regra que corrige: o que uma rodada COMPLETA não viu com saldo > 0 vale 0.
// Nunca apaga linha; a linha zerada mantém produto/categoria e ganha o carimbo da conferência.

/** Linhas com saldo ≠ 0 que a rodada não viu. existentes: [{sku, saldo}] de UM depósito; vistas: Set de sku. */
export function linhasParaZerar(existentes, vistas) {
  return existentes.filter((l) => Number(l.saldo) !== 0 && !vistas.has(String(l.sku)));
}

/**
 * Por que NÃO zerar agora (texto para o log), ou null se pode. Zerar por ausência só vale com leitura completa:
 * catálogo lido até o fim, nenhum lote de saldo perdido e ao menos uma linha lida no depósito (depósito sem NENHUMA
 * linha viva é indistinguível de resposta quebrada do Bling).
 */
export function motivoParaNaoZerar({ catalogoIncompleto, lotesComFalha, produtos, linhasLidasNoDeposito }) {
  if (!produtos) return 'catálogo vazio';
  if (catalogoIncompleto) return 'catálogo do Bling lido pela metade';
  if (lotesComFalha) return `${lotesComFalha} lote(s) de saldo falharam`;
  if (!linhasLidasNoDeposito) return 'nenhuma linha lida neste depósito';
  return null;
}
