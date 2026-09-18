// src/ferramentas/autenticidade/garantia-pelo-material.js
// O PRAZO DA GARANTIA, PELO MATERIAL DA PEÇA — regra pura, sem DOM e sem rede.
//
// Decisão do dono, 18/09/2026:
//   - peça em CANVAS: 2 anos;
//   - peça em COURO:  6 meses;
//   - contados da DATA DA COMPRA;
//   - vale com a nota ou o cupom fiscal — NÃO depende de registro.
//
// O material mora no LOTE (`vessel_lotes.material`: 'canvas' | 'couro' | nulo).
// A data final de verdade é o banco quem calcula (`vessel_registros.garantia_ate`);
// aqui só se escreve o TEXTO do prazo.
//
// ⚠️ SEM MATERIAL, NADA DE PRAZO DA PEÇA. Nunca chutar "2 anos": uma data ou um
// prazo errado parece certo; um prazo que ainda não existe aparece como "falta
// preencher". Sem material, mostra-se a regra geral.

export const TEXTO_GERAL_DA_GARANTIA =
  'A garantia VESSEL é de 2 anos para peças em canvas e 6 meses para peças em couro, '
  + 'contados da data da compra, e vale com a nota ou o cupom fiscal.'

const PRAZOS = {
  canvas: '2 anos (canvas)',
  couro: '6 meses (couro)',
}

/** '2 anos (canvas)' | '6 meses (couro)' | null (sem material ou material desconhecido). */
export function prazoDoMaterial(material) {
  return PRAZOS[material] || null
}

/** O material do lote da peça, pelo código. Sem peça, sem lote ou sem material → null. */
export function materialDoCodigo(codigo, pecas, lotes) {
  const peca = (pecas || []).find((p) => p.codigo === codigo)
  if (!peca) return null
  const lote = (lotes || []).find((l) => l.id === peca.lote_id)
  return prazoDoMaterial(lote?.material) ? lote.material : null
}

/** O aviso embaixo da pergunta "Aprovar a garantia de Fulana nesta peça?". */
export function avisoDaAprovacao(material) {
  const prazo = prazoDoMaterial(material)
  if (prazo) return `A garantia passa a valer no nome dela: ${prazo}, contados da data da compra.`
  return 'A garantia passa a valer no nome dela. O lote desta peça ainda não tem material, '
    + 'então a data final fica em branco até alguém escolher o material. '
    + TEXTO_GERAL_DA_GARANTIA
}

/**
 * O resto do aviso da troca de dono, depois de "A garantia NÃO RECOMEÇA:" (que
 * fica no template, em negrito). `dataFinal` já vem escrita (DD/MM/AAAA) ou nula
 * — nula quando o lote não tem material, e aí não se escreve "até —".
 */
export function avisoDaTroca(dataFinal) {
  if (dataFinal) return `continua valendo até ${dataFinal}, contando da compra original.`
  return 'continua contando da compra original. '
    + 'Esta peça ainda não tem data final porque o lote não tem material.'
}
