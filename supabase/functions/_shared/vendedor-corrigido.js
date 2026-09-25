// O vendedor de uma venda que o Bling não deixa mais corrigir.
//
// POR QUE ISTO EXISTE
// Mesmo problema do vizinho `valor-corrigido.js`, só que no campo vendedor:
// nota fiscal autorizada congela o pedido, e a tela do Bling passa a recusar
// edição nele. Quando a NFC/NFe saiu com o vendedor certo mas o PEDIDO ficou
// com outro, não tem mais como arrumar isso no Bling.
//
// A correção mora aqui: uma linha em `bling_pedido_ajuste_vendedor` diz qual é
// o vendedor real, e este módulo a aplica por cima do mapa pedido→vendedor que
// as telas já montam (cache do Supabase + o que o Bling devolveu ao vivo).
//
// POR QUE ELE MORA EM `supabase/functions/_shared/` E NÃO EM `src/`
// Mesmo motivo do vizinho: se um dia uma Edge ou um robô do coletor precisarem
// da mesma regra, ela já está aqui em vez de ganhar segunda cópia.
//
// DUAS REGRAS QUE PARECEM DETALHE E NÃO SÃO:
//
// 1. **Este ajuste nunca TRAZ pedido.** Uma linha cujo `pedido_id` não está no
//    mapa que a tela tem na mão é ignorada — não inventa uma venda para o
//    vendedor corrigido a partir do nada.
//
// 2. **Ajuste torto vale MENOS que o dado do Bling.** `vendor_id_corrigido`
//    vazio, não-número ou zero/negativo não passa: o pedido fica com o
//    vendedor que já tinha.

// `bigint` do Postgres também pode voltar como texto no PostgREST — daí o
// Number aqui. Vendedor não tem id zero nem negativo no Bling.
function vendorIdValido(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// ── O ajuste, puro e testável ─────────────────────────────────────────────
// mapaPedidoVendor : { [pedido_id]: vendor_id } — o mapa que a tela já tem
// ajustes          : linhas de bling_pedido_ajuste_vendedor
//                     [{ pedido_id, vendor_id_corrigido }]
// Devolve { mapa, corrigidosIds, ajustados }:
//   mapa         — CÓPIA do mapa de entrada, com os ids corrigidos sobrepostos
//   corrigidosIds — Set (string) dos pedido_id corrigidos, para quem escreve
//                    no mapa depois (enriquecimento em background vindo do
//                    Bling) saber que não pode sobrescrever essa entrada
export function aplicarVendedorCorrigido(mapaPedidoVendor, ajustes) {
  const mapa = { ...(mapaPedidoVendor || {}) };
  const corrigidosIds = new Set();
  let ajustados = 0;

  for (const a of ajustes || []) {
    const pedidoId = a?.pedido_id;
    if (pedidoId === null || pedidoId === undefined || pedidoId === '') continue; // regra 1
    const vendorId = vendorIdValido(a?.vendor_id_corrigido);
    if (vendorId === null) continue; // regra 2

    mapa[pedidoId] = vendorId;
    corrigidosIds.add(String(pedidoId));
    ajustados++;
  }

  return { mapa, corrigidosIds, ajustados };
}
