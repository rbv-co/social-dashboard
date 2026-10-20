// "Estoque que nunca zera" (plano 05, item B). `gc_estoque_item` só recebia as linhas que o Bling lista com saldo > 0
// (`blingSaldoFoco`), então produto que zerou ou trocou de chave (`codigo || id`) ficava com o saldo velho para sempre.
// Aqui mora a regra que corrige: linha de produto QUE ESTÁ NO CATÁLOGO ATIVO e que uma rodada COMPLETA não viu com
// saldo > 0 vale 0. Linha de produto fora do catálogo (inativado, código morto) NÃO é tocada: não sabemos o saldo dele.
// Nunca apaga linha; a linha zerada mantém produto/categoria e ganha o carimbo da conferência.

/** Chaves de `gc_estoque_item.sku` que um produto do catálogo ativo pode ter tido: o código, o id, e a atual (`codigo || id`). */
export function chavesConhecidas(prodMap) {
  const k = new Set();
  for (const [id, p] of Object.entries(prodMap)) { k.add(String(id)); if (p?.codigo) k.add(String(p.codigo)); }
  return k;
}

/** Linhas com saldo ≠ 0, de produto do catálogo, que a rodada não viu. existentes: [{sku, saldo}] de UM depósito. */
export function linhasParaZerar(existentes, vistas, conhecidas) {
  return existentes.filter((l) => Number(l.saldo) !== 0 && !vistas.has(String(l.sku)) && conhecidas.has(String(l.sku)));
}

/**
 * Por que NÃO zerar agora (texto para o log), ou null se pode. Zerar por ausência só vale com leitura completa:
 * catálogo lido do Bling até o fim, nenhum lote de saldo perdido e ao menos uma linha lida no depósito (depósito sem
 * NENHUMA linha viva é indistinguível de resposta quebrada do Bling).
 */
export function motivoParaNaoZerar({ catalogoIncompleto, lotesComFalha, produtos, linhasLidasNoDeposito }) {
  if (!produtos) return 'catálogo vazio';
  if (catalogoIncompleto) return 'catálogo não veio completo do Bling';
  if (lotesComFalha) return `${lotesComFalha} lote(s) de saldo falharam`;
  if (!linhasLidasNoDeposito) return 'nenhuma linha lida neste depósito';
  return null;
}

/**
 * Zera as linhas do depósito que a rodada não viu (ver o topo). `buscar(caminho)` lê JSON do REST e `gravar(tabela, conflito,
 * linhas)` faz o upsert. Depois de gravar as vivas, como `limparSobrasDoMes`: se a rodada morrer no meio, o saldo fica velho
 * (ruim), não zerado (pior). Devolve quantas zerou (0 se pulou).
 */
export async function zerarOQueSumiu({ depositoId, canal, vivas, leitura, prodMap, carimbo, buscar, gravar, log = console }) {
  const motivo = motivoParaNaoZerar({
    catalogoIncompleto: leitura.incompleto, lotesComFalha: leitura.lotesComFalha,
    produtos: Object.keys(prodMap).length, linhasLidasNoDeposito: vivas.length,
  });
  if (motivo) { log.warn(`  ${canal}: NÃO zerei o que sumiu (${motivo})`); return 0; }
  const antigas = await buscar(`/gc_estoque_item?select=sku,saldo&deposito_id=eq.${depositoId}&saldo=neq.0&limit=20000`);
  const vistas = new Set(vivas.map((r) => r.sku));
  const zerar = linhasParaZerar(antigas, vistas, chavesConhecidas(prodMap));
  const foraDoCatalogo = antigas.filter((l) => !vistas.has(String(l.sku))).length - zerar.length;
  if (foraDoCatalogo) log.log(`    ${foraDoCatalogo} linha(s) de produto fora do catálogo ativo não foram tocadas`);
  if (!zerar.length) return 0;
  await gravar('gc_estoque_item', 'deposito_id,sku', zerar.map((l) => ({
    deposito_id: Number(depositoId), sku: l.sku, saldo: 0, atualizado_em: carimbo,
  })));
  log.log(`    ${zerar.length} linha(s) que o Bling não lista mais com saldo foram zeradas`);
  return zerar.length;
}
