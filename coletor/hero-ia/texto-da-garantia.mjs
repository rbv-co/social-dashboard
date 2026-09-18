// coletor/hero-ia/texto-da-garantia.mjs
//
// A pílula "2 anos de garantia" da arte do Hero-IA (render-html.mjs) passa a
// depender do MATERIAL da peça — decisão do dono, 18/09/2026:
//   - peça em CANVAS: 2 anos;
//   - peça em COURO:  6 meses.
//
// O material mora em `vessel_lotes.material` ('canvas' | 'couro' | nulo), por
// LOTE, com a coluna `sku`. Para um SKU vale o LOTE MAIS RECENTE que TEM
// material — a mesma regra já usada no banco pelo gatilho
// `vessel_lote_novo_herda_material` (db/migrations/2026-09-18-zz-vessel-
// garantia-pelo-material.sql): `order by criado_em desc, id desc`, só entre
// lotes com `material is not null`.
//
// ⚠️ SEM MATERIAL, SEM PÍLULA — nunca chutar "2 anos". Uma arte com prazo
// errado parece certa; uma arte sem pílula só está incompleta, e dá pra notar.
// Isto vale para: SKU sem lote nenhum, lote(s) sem material nenhum ainda, e
// falha de rede/banco na busca (ver `pilulaDeGarantiaDoSku`).

const TEXTOS = {
  canvas: '2 anos de garantia',
  couro: '6 meses de garantia',
}

/**
 * O texto da pílula pelo material — regra pura, sem rede e sem banco.
 * '2 anos de garantia' | '6 meses de garantia' | null (nulo, vazio, ou
 * qualquer valor que não seja exatamente 'canvas'/'couro' — o banco só grava
 * minúsculo; não se normaliza aqui para não mascarar dado sujo).
 */
export function textoDaPilula(material) {
  return TEXTOS[material] || null
}

/**
 * O material do LOTE MAIS RECENTE com material, para este SKU — via `sbGet`,
 * o mesmo helper REST (PostgREST) que `coletor/gerar-criativos.mjs` já usa
 * para todo o resto (sem conexão nova). Sem lote com material para o SKU
 * (SKU inédito, ou só lotes ainda sem material) -> null. Deixa o erro de rede
 * /banco subir — quem trata é `pilulaDeGarantiaDoSku`.
 */
export async function materialMaisRecenteDoSku(sku, sbGet) {
  const path = `/vessel_lotes?select=material&sku=eq.${encodeURIComponent(sku)}`
    + `&material=not.is.null&order=criado_em.desc,id.desc&limit=1`
  const linhas = await sbGet(path)
  return linhas?.[0]?.material ?? null
}

/**
 * A pílula pronta para um SKU: busca o material (via `sbGet`) e devolve o
 * texto, OU `null` se não houver material, OU se a busca falhar.
 *
 * ⚠️ NUNCA lança e NUNCA chuta "2 anos": erro de rede/banco também vira
 * `null` (sem pílula), com o motivo escrito no `log` — a arte segue sem a
 * pílula, nunca cai.
 */
export async function pilulaDeGarantiaDoSku(sku, sbGet, { log = console.warn } = {}) {
  try {
    const material = await materialMaisRecenteDoSku(sku, sbGet)
    return textoDaPilula(material)
  } catch (e) {
    log(`  pílula de garantia: falhou p/ ${sku} (${e.message}) — arte sai SEM pílula`)
    return null
  }
}
