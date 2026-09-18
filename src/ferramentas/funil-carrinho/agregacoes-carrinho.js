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

/**
 * Agrupa os registros crus por cart_token, pra tela de Registros mostrar a
 * vida de um carrinho como uma linha só, expansível — em vez de uma lista
 * solta sem narrativa.
 *
 * ⚠️ Agrupa por cart_token, NÃO por session_id — decisão de 18/09/2026.
 * session_id (cookie _shopify_s) é o cookie MAIS FRÁGIL que temos: navegador
 * de privacidade (Brave, etc.) apaga ele por ser visto como rastreamento, e
 * a mesma visita vira duas "sessões" sem aviso. cart_token é o cookie MAIS
 * RESISTENTE — sem ele o checkout não funciona, então nenhum navegador
 * ousa bloqueá-lo. Por isso o carrinho, não a sessão, é a cola confiável
 * pra juntar adicionado → removido → checkout de uma mesma pessoa.
 * `sessao_iniciada` nunca tem cart_token (ainda não existe carrinho na
 * entrada) — por isso nunca agrupa, fica como número solto de "entrada".
 *
 * Regras:
 * - Sem cart_token nunca agrupa — vira linha solta.
 * - Carrinho com um evento só também não vira grupo — não tem o que expandir.
 * - Dentro do grupo, do mais antigo pro mais novo (é a ordem que a pessoa
 *   viveu: adicionou, tirou, foi pro checkout).
 * - A lista inteira ordena pelo evento mais recente de cada item/grupo, do
 *   mais novo pro mais antigo.
 * @param {{id:number, criado_em:string, cart_token:string|null}[]} linhas
 * @returns {(object|{agrupado:true, cart_token:string, criado_em:string, eventos:object[]})[]}
 */
export function agruparPorCarrinho(linhas) {
  const porCarrinho = new Map()
  const itens = []

  for (const linha of linhas || []) {
    if (!linha.cart_token) { itens.push(linha); continue }
    if (!porCarrinho.has(linha.cart_token)) porCarrinho.set(linha.cart_token, [])
    porCarrinho.get(linha.cart_token).push(linha)
  }

  for (const [cart_token, eventos] of porCarrinho) {
    if (eventos.length === 1) { itens.push(eventos[0]); continue }
    const ordenados = [...eventos].sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
    const maisRecente = ordenados.reduce(
      (max, e) => (new Date(e.criado_em) > new Date(max) ? e.criado_em : max), ordenados[0].criado_em,
    )
    itens.push({ agrupado: true, cart_token, criado_em: maisRecente, eventos: ordenados })
  }

  return itens.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
}
