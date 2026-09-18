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
 * Agrupa os registros crus por session_id, pra tela de Registros mostrar
 * "sessão iniciada" como uma linha só, expansível, com o que aconteceu
 * dentro dela por baixo — em vez de uma lista solta sem narrativa.
 *
 * Regras:
 * - Sem session_id (ex.: checkout_iniciado vindo do webhook, que não sabe o
 *   cookie do navegador) nunca agrupa — vira linha solta, como hoje.
 * - Sessão com um evento só (ex.: entrou e não fez mais nada) também não
 *   vira grupo — não tem o que expandir.
 * - Dentro do grupo, do mais antigo pro mais novo (é a ordem que a pessoa
 *   viveu: entrou, colocou, tirou, foi pro checkout).
 * - A lista inteira ordena pelo evento mais recente de cada item/grupo, do
 *   mais novo pro mais antigo — mesmo critério que a tela já usava.
 * @param {{id:number, criado_em:string, session_id:string|null}[]} linhas
 * @returns {(object|{agrupado:true, session_id:string, criado_em:string, eventos:object[]})[]}
 */
export function agruparPorSessao(linhas) {
  const porSessao = new Map()
  const itens = []

  for (const linha of linhas || []) {
    if (!linha.session_id) { itens.push(linha); continue }
    if (!porSessao.has(linha.session_id)) porSessao.set(linha.session_id, [])
    porSessao.get(linha.session_id).push(linha)
  }

  for (const [session_id, eventos] of porSessao) {
    if (eventos.length === 1) { itens.push(eventos[0]); continue }
    const ordenados = [...eventos].sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
    const maisRecente = ordenados.reduce(
      (max, e) => (new Date(e.criado_em) > new Date(max) ? e.criado_em : max), ordenados[0].criado_em,
    )
    itens.push({ agrupado: true, session_id, criado_em: maisRecente, eventos: ordenados })
  }

  return itens.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
}
