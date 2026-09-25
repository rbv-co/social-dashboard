// A ponte entre as TELAS e a regra do vendedor corrigido.
//
// A REGRA em si mora em `supabase/functions/_shared/vendedor-corrigido.js`.
// Aqui fica só o que é do navegador: buscar as linhas no Supabase pelo cliente
// logado. Mesmo arranjo de `valor-corrigido.js`, e pelo mesmo motivo.
import { aplicarVendedorCorrigido } from '../../supabase/functions/_shared/vendedor-corrigido.js'

export { aplicarVendedorCorrigido }

// ── Busca os ajustes ──────────────────────────────────────────────────────
// Lê a tabela INTEIRA, sem filtrar pelos ids da janela — é de propósito, mesmo
// motivo do vizinho de valor: a tabela é de exceção (uma linha por venda cujo
// pedido o Bling congelou com o vendedor errado).
//
// Devolve null quando não deu para consultar — e null significa "não sei", que
// o chamador trata mantendo o mapa como está.
export async function buscarAjustesDeVendedor(sbClient) {
  const linhas = [];
  const PAGINA = 1000; // o PostgREST corta em 1000 sem avisar — paginar sempre
  try {
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await sbClient
        .from('bling_pedido_ajuste_vendedor')
        .select('pedido_id,vendor_id_corrigido')
        .range(inicio, inicio + PAGINA - 1);
      if (error) return null;
      linhas.push(...(data || []));
      if (!data || data.length < PAGINA) break;
    }
  } catch { return null; }
  return linhas;
}

// ── O atalho que as telas usam ────────────────────────────────────────────
// Devolve o mapa pronto. Se não deu para consultar, devolve o mapa como veio —
// comportamento de sempre, sem ajuste nenhum.
export async function aplicarAjusteDeVendedor(sbClient, mapaPedidoVendor) {
  const linhas = await buscarAjustesDeVendedor(sbClient);
  if (linhas === null) {
    return { mapa: mapaPedidoVendor || {}, corrigidosIds: new Set(), ajustados: 0, semBanco: true };
  }
  return { ...aplicarVendedorCorrigido(mapaPedidoVendor, linhas), semBanco: false };
}
