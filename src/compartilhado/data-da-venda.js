// A ponte entre as TELAS e a regra da data da venda.
//
// A REGRA em si mora em `supabase/functions/_shared/data-da-venda.js`, porque a
// Edge da notificação de vendas roda no Deno e não alcança `src/`. Aqui fica só
// o que é do navegador: buscar as linhas no Supabase pelo cliente logado.
// Mesmo arranjo de `checklist.js` na Frota.
import { ajustarPelaDataDaNota } from '../../supabase/functions/_shared/data-da-venda.js'

export { ajustarPelaDataDaNota }

const soDia = (v) => String(v ?? '').slice(0, 10);

// ── Busca as linhas que tocam a janela ────────────────────────────────────
// Traz tanto as que ENTRAM (data da nota na janela) quanto as que SAEM (data do
// pedido na janela), numa consulta só.
//
// Devolve null quando não deu para consultar — e null significa "não sei",
// que o chamador trata mantendo a tela como está hoje. Uma tela de vendas nunca
// pode ficar vazia por causa deste ajuste.
export async function buscarLinhasDaJanela(sbClient, di, df) {
  const a = soDia(di), b = soDia(df);
  if (!a || !b) return null;
  const linhas = [];
  const PAGINA = 1000;   // o PostgREST corta em 1000 sem avisar — paginar sempre
  try {
    for (let inicio = 0; inicio < 20000; inicio += PAGINA) {
      const { data, error } = await sbClient
        .from('bling_pedido_nota')
        .select('pedido_id,pedido_numero,data_pedido,data_da_venda,total,loja_id')
        .or(`and(data_da_venda.gte.${a},data_da_venda.lte.${b}),and(data_pedido.gte.${a},data_pedido.lte.${b})`)
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
// vieram (com `dataDoPedido` preenchido, que as telas usam para gravar cache).
export async function aplicarDataDaVenda(sbClient, pedidos, di, df) {
  const linhas = await buscarLinhasDaJanela(sbClient, di, df);
  if (linhas === null) {
    return {
      pedidos: (pedidos || []).map(p => ({ ...p, dataDoPedido: soDia(p?.data) })),
      trazidos: 0, removidos: 0, semResposta: (pedidos || []).length, semBanco: true,
    };
  }
  return { ...ajustarPelaDataDaNota(pedidos, linhas, di, df), semBanco: false };
}
