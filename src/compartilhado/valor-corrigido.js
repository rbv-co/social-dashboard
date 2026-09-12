// A ponte entre as TELAS e a regra do valor corrigido.
//
// A REGRA em si mora em `supabase/functions/_shared/valor-corrigido.js`, porque
// a Edge da notificação de vendas roda no Deno e não alcança `src/`. Aqui fica
// só o que é do navegador: buscar as linhas no Supabase pelo cliente logado.
// Mesmo arranjo de `data-da-venda.js`, e pelo mesmo motivo.
import { aplicarValorCorrigido } from '../../supabase/functions/_shared/valor-corrigido.js'

export { aplicarValorCorrigido }

// ── Busca os ajustes ──────────────────────────────────────────────────────
// Lê a tabela INTEIRA, sem filtrar pelos ids da janela. É de propósito: a
// tabela é de exceção (uma linha por venda que o Bling congelou errada), e
// filtrar por `in(<ids>)` traria de volta o corte de 500 ids que já morde o
// cache de vendedores da Gestão à Vista.
//
// Devolve null quando não deu para consultar — e null significa "não sei", que
// o chamador trata mantendo a tela como está. Uma tela de vendas nunca pode
// ficar vazia por causa deste ajuste.
export async function buscarAjustesDeValor(sbClient) {
  const linhas = [];
  const PAGINA = 1000;   // o PostgREST corta em 1000 sem avisar — paginar sempre
  try {
    for (let inicio = 0; inicio < 20000; inicio += PAGINA) {
      const { data, error } = await sbClient
        .from('bling_pedido_ajuste_valor')
        .select('pedido_id,total_corrigido')
        .range(inicio, inicio + PAGINA - 1);
      if (error) return null;
      linhas.push(...(data || []));
      if (!data || data.length < PAGINA) break;
    }
  } catch { return null; }
  return linhas;
}

// ── O atalho que as telas usam ────────────────────────────────────────────
// Devolve a lista pronta. Se não deu para consultar, devolve os pedidos como
// vieram — com o valor do Bling, que é o comportamento de sempre.
export async function aplicarAjusteDeValor(sbClient, pedidos) {
  const linhas = await buscarAjustesDeValor(sbClient);
  if (linhas === null) {
    return { pedidos: pedidos || [], ajustados: 0, semBanco: true };
  }
  return { ...aplicarValorCorrigido(pedidos, linhas), semBanco: false };
}
