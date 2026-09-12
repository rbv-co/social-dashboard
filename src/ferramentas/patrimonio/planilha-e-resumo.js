// A visão "Planilha" (tudo detalhado, como o xlsx do dono) e a visão "Resumo"
// (o que a aba Dinâmica da planilha fazia, só que viva). Lógica pura: não toca
// banco nem DOM.

import { matrizParaExcel } from '../../compartilhado/relatorios/exportar.js'

// As colunas da planilha, na ordem em que o dono já lia o arquivo dele. Cada uma
// sabe extrair o próprio valor de um bem "achatado" (com os nomes já resolvidos)
// — assim a mesma definição serve pra tabela na tela E pra exportação, sem duas
// listas que discordam.
export const COLUNAS_PLANILHA = [
  { chave: 'numero', titulo: 'Nº', tipo: 'numero' },
  { chave: 'numero_serie', titulo: 'IMEI / Nº de série', tipo: 'texto' },
  { chave: 'nome', titulo: 'Item', tipo: 'texto' },
  { chave: 'categoria', titulo: 'Categoria', tipo: 'texto' },
  { chave: 'tipo', titulo: 'Tipo', tipo: 'texto' },
  { chave: 'marca', titulo: 'Marca / modelo', tipo: 'texto' },
  { chave: 'empresa', titulo: 'Marca (empresa)', tipo: 'texto' },
  { chave: 'local', titulo: 'Local', tipo: 'texto' },
  { chave: 'comodo', titulo: 'Ambiente', tipo: 'texto' },
  { chave: 'dono', titulo: 'Com quem', tipo: 'texto' },
  { chave: 'situacao', titulo: 'Situação', tipo: 'texto' },
  { chave: 'etiquetado', titulo: 'Etiquetado', tipo: 'texto' },
  { chave: 'data_compra', titulo: 'Compra', tipo: 'texto' },
  { chave: 'valor_centavos', titulo: 'Valor', tipo: 'dinheiro' },
  { chave: 'observacao', titulo: 'Observação', tipo: 'texto' },
]

// Ordena sem mutar. Vazio vai SEMPRE pro fim, cresça ou decresça: item sem valor
// não é o mais barato, é "não informado" — deixá-lo liderar o ranking do mais
// barato seria mentira.
export function ordenarPlanilha(linhas, chave, crescente = true) {
  const lista = [...(linhas || [])]
  const vazio = (v) => v === null || v === undefined || v === ''
  const col = COLUNAS_PLANILHA.find((c) => c.chave === chave)
  const numerico = col && (col.tipo === 'numero' || col.tipo === 'dinheiro')
  lista.sort((a, b) => {
    const x = a?.[chave], y = b?.[chave]
    if (vazio(x) && vazio(y)) return 0
    if (vazio(x)) return 1
    if (vazio(y)) return -1
    let r
    if (numerico) r = Number(x) - Number(y)
    else r = String(x).localeCompare(String(y), 'pt-BR', { sensitivity: 'base', numeric: true })
    return crescente ? r : -r
  })
  return lista
}

// Agrupa por um eixo e devolve o ranking: quem tem mais valor primeiro, que é a
// pergunta que se faz olhando patrimônio ("onde está o dinheiro?").
// `pegarChave` recebe o bem e devolve o rótulo do grupo.
export function resumirPor(bens, pegarChave, rotuloVazio = 'Não informado') {
  const lista = (bens || []).filter(Boolean)
  const mapa = new Map()
  for (const b of lista) {
    const k = (pegarChave(b) || '').trim() || rotuloVazio
    if (!mapa.has(k)) mapa.set(k, { chave: k, quantidade: 0, totalCentavos: 0 })
    const g = mapa.get(k)
    g.quantidade++
    const v = b.valor_centavos
    if (typeof v === 'number' && Number.isFinite(v)) g.totalCentavos += Math.trunc(v)
  }
  const total = [...mapa.values()].reduce((a, g) => a + g.totalCentavos, 0)
  return [...mapa.values()]
    .sort((a, b) => b.totalCentavos - a.totalCentavos || b.quantidade - a.quantidade)
    .map((g) => ({ ...g, fatia: total > 0 ? g.totalCentavos / total : 0 }))
}

// Os números do topo da tela de Resumo.
export function totaisGerais(bens) {
  const lista = (bens || []).filter(Boolean)
  const soma = (f) => lista.filter(f).reduce((a, b) =>
    a + (typeof b.valor_centavos === 'number' ? Math.trunc(b.valor_centavos) : 0), 0)
  return {
    itens: lista.length,
    totalCentavos: soma(() => true),
    emUso: lista.filter((b) => b.situacao === 'em_uso').length,
    emUsoCentavos: soma((b) => b.situacao === 'em_uso'),
    emEstoque: lista.filter((b) => b.situacao === 'em_estoque').length,
    emEstoqueCentavos: soma((b) => b.situacao === 'em_estoque'),
    semValor: lista.filter((b) => typeof b.valor_centavos !== 'number').length,
  }
}

// Monta a matriz do arquivo .xlsx das COLUNAS_PLANILHA. A regra de como cada
// tipo de coluna vira célula mora em compartilhado/relatorios/exportar.js, e é
// a MESMA dos outros relatórios — duas cópias divergiriam na primeira mudança.
export function montarLinhasParaExcel(linhas) {
  return matrizParaExcel(COLUNAS_PLANILHA, linhas)
}
