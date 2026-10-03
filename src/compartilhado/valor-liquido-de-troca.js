//
// A ponte entre as TELAS e a regra do valor líquido de troca.
//
// A REGRA em si mora em `supabase/functions/_shared/valor-liquido-de-troca.js`,
// porque a Edge e os robôs não alcançam `src/`. Aqui fica só o que é do
// navegador: buscar as linhas no Supabase pelo cliente logado. Mesmo arranjo
// de valor-corrigido.js.
import { aplicarValorLiquidoDeTroca } from '../../supabase/functions/_shared/valor-liquido-de-troca.js'

export { aplicarValorLiquidoDeTroca, ehDevolucaoDeMercadoria } from '../../supabase/functions/_shared/valor-liquido-de-troca.js'

// ── Busca as devoluções ──────────────────────────────────────────────────
// Lê só a fatia `eh_devolucao=true` de bling_pedido_forma_pagamento — é de
// exceção (a maioria dos pedidos não tem troca), e filtrar por `in(<ids>)`
// traria de volta o corte de 500 ids que já morde o cache de vendedores.
//
// Devolve null quando não deu para consultar — null significa "não sei", e
// quem chama mantém a tela como está. Uma tela de vendas nunca pode ficar
// vazia por causa deste ajuste.
export async function buscarDevolucoes(sbClient) {
  const linhas = [];
  const PAGINA = 1000;   // o PostgREST corta em 1000 sem avisar — paginar sempre
  try {
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await sbClient
        .from('bling_pedido_forma_pagamento')
        .select('pedido_id,valor')
        .eq('eh_devolucao', true)
        .range(inicio, inicio + PAGINA - 1);
      if (error) return null;
      linhas.push(...(data || []));
      if (!data || data.length < PAGINA) break;
    }
  } catch { return null; }
  return linhas;
}

// ── O atalho que as telas usam ───────────────────────────────────────────
export async function aplicarDevolucaoDeTroca(sbClient, pedidos) {
  const linhas = await buscarDevolucoes(sbClient);
  if (linhas === null) {
    return { pedidos: pedidos || [], ajustados: 0, semBanco: true };
  }
  return { ...aplicarValorLiquidoDeTroca(pedidos, linhas), semBanco: false };
}
