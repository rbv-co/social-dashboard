//
// Lógica pura da tela Funil de Carrinho: transforma as linhas cruas que vêm
// do Supabase (carrinho_eventos, carrinho_abandonados) em ranking pronto pra
// tabela. Sem rede aqui — a tela busca, isto agrega.

// Sem `.limit()` explícito, o PostgREST corta em 1000 linhas por padrão —
// SEM erro, devolvendo uma lista incompleta que parece completa (mesmo
// defeito já documentado em src/ferramentas/acessos/auditoria-corte.js).
// A tela usa este teto na consulta E chama foiCortado() pra avisar, em vez
// de deixar o ranking parecer completo quando não está.
export const LIMITE_CARRINHO = 5000

export function foiCortado(linhas) {
  return Array.isArray(linhas) && linhas.length === LIMITE_CARRINHO
}

/**
 * Ranking de produtos por número de eventos (não soma quantidade: cada
 * evento é UMA vez que alguém adicionou/removeu, e é isso que a spec pediu
 * — "contagem", não "unidades").
 * @param {{produto_titulo: string|null}[]} linhas
 * @returns {{produto_titulo: string, contagem: number}[]} do maior pro menor
 */
export function rankearProdutos(linhas) {
  const contagem = new Map()
  for (const linha of linhas || []) {
    const titulo = linha?.produto_titulo || '(sem título)'
    contagem.set(titulo, (contagem.get(titulo) || 0) + 1)
  }
  return [...contagem.entries()]
    .map(([produto_titulo, contagem]) => ({ produto_titulo, contagem }))
    .sort((a, b) => b.contagem - a.contagem)
}

/**
 * Carrinhos abandonados prontos pra tabela: um por linha da view
 * carrinho_abandonados, ordenados do mais recente pro mais antigo.
 * @param {{cart_token:string, iniciado_em:string, ultimo_evento:string}[]} linhas
 */
export function ordenarAbandonados(linhas) {
  return [...(linhas || [])].sort((a, b) => new Date(b.ultimo_evento) - new Date(a.ultimo_evento))
}
