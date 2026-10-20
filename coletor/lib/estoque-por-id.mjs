// Casa a chave de `gc_estoque_item.sku` com o id do produto no Bling (`produtos_bling.id_bling` do Core).
//
// POR QUE: o robô de estoque grava `sku = codigo || id do produto` (relatorios-comerciais.mjs). Produto
// sem código no Bling (insumo: tecido, alça, regulador) entra com o PRÓPRIO ID como chave. O Core guarda o
// estoque por id (`estoque_depositos.id_bling`), então casar por SKU perde esses itens (medido em
// 20/10/2026: 427 das 1.360 chaves). Casando por id: 1.340 de 1.360; as 20 restantes são código que
// deixou de existir no Bling.
//
// Código repetido no Core (55): o produto antigo fica inativo e o novo ativo. Vale o único ativo; se não
// houver exatamente um ativo, a chave fica ambígua e NÃO casa (melhor sem par do que par errado).

/** produtos: linhas de `produtos_bling` do espelho ({id_bling, codigo, id_situacaocadastro}). */
export function indiceDeProdutos(produtos) {
  const porId = new Set();
  const porCodigo = new Map();                      // codigo -> ids dos produtos
  for (const p of produtos) {
    const id = String(p.id_bling);
    porId.add(id);
    const codigo = String(p.codigo ?? '');
    if (!codigo) continue;
    if (!porCodigo.has(codigo)) porCodigo.set(codigo, []);
    porCodigo.get(codigo).push({ id, ativo: Number(p.id_situacaocadastro) === 1 });
  }
  return { porId, porCodigo };
}

/** O id do produto no Bling para uma chave de `gc_estoque_item`, ou null (sem par ou ambígua). */
export function idDoProdutoPelaChave(chave, { porId, porCodigo }) {
  const k = String(chave);
  const candidatos = porCodigo.get(k);
  if (candidatos) {
    if (candidatos.length === 1) return candidatos[0].id;
    const ativos = candidatos.filter((c) => c.ativo);
    return ativos.length === 1 ? ativos[0].id : null;
  }
  return porId.has(k) ? k : null;                   // chave numérica = id (produto sem código)
}
