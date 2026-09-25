// supabase/functions/_shared/estoque-do-site.js
// A REGRA do estoque do site (Shopify) a partir da loja do Iguatemi (Bling).
// Lógica pura, sem rede — é o que os testes provam. Quem busca e grava: a edge
// estoque-do-site (a cada minuto, pelo cron) e coletor/estoque-do-site.mjs (à mão).
//
// POR QUE EXISTE (25/09/2026): a venda feita no balcão baixa o Bling e NÃO baixa
// o Shopify. Medido nesse dia: Maelle Bege e Elara Big Caramelo vendidas na loja
// (Bling 0) seguiam "Disponível" no site com 1 e 2 unidades. O site vendia peça
// que não existia mais.
//
// A REGRA, do dono: site = loja − 1. A última peça da loja é o MOSTRUÁRIO e não
// vai para o site. Acabou na loja (ou sobrou só o mostruário) → esgota no site.

// Uma unidade fica na vitrine da loja e nunca é oferecida no site.
export const PECAS_DE_MOSTRUARIO = 1;

export function quantidadeNoSite(saldoLoja) {
  const s = Math.floor(Number(saldoLoja));
  if (!Number.isFinite(s)) return null;           // saldo ilegível: NÃO decide nada
  return Math.max(s - PECAS_DE_MOSTRUARIO, 0);
}

// variantes: [{ sku, inventoryItemId, noLocal: bool, disponivel: number|null }]
// saldoPorSku: Map sku → saldo físico no depósito do Iguatemi. SKU que o Bling
//   conhece mas não tem saldo no depósito DEVE vir com 0 — ausência do Map
//   significa "não sei", e "não sei" nunca esgota nada.
// Devolve { ajustes, semBling, iguais } — ajustes: [{ sku, inventoryItemId, de, para, ativar }]
export function calcularAjustes(variantes, saldoPorSku) {
  const ajustes = [], semBling = [], iguais = [];
  for (const v of variantes) {
    const sku = String(v.sku || '').trim();
    if (!sku) continue;
    if (!saldoPorSku.has(sku)) { semBling.push(sku); continue; }
    const para = quantidadeNoSite(saldoPorSku.get(sku));
    if (para === null) { semBling.push(sku); continue; }
    const de = v.noLocal ? Number(v.disponivel) || 0 : 0;
    if (!v.noLocal && para === 0) { iguais.push(sku); continue; }   // já não vende por esse local
    if (v.noLocal && de === para) { iguais.push(sku); continue; }
    ajustes.push({ sku, inventoryItemId: v.inventoryItemId, de, para, ativar: !v.noLocal });
  }
  return { ajustes, semBling, iguais };
}
