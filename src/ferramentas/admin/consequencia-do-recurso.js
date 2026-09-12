// QUAIS FERRAMENTAS GASTAM DINHEIRO DE VERDADE (D4 do desenho de 11/08/2026).
//
// O selo existe pra quem concede parar meio segundo antes de marcar. Ele só
// vale enquanto significar UMA coisa: **esta pessoa vai poder gastar verba**.
//
// FICOU DE FORA de propósito, e não por esquecimento:
// - `sales.metas` — meta é alvo de faturamento, não gasto. (Eu havia incluído
//   por engano no desenho; corrigido antes de virar código.)
// - `acessos` com "Tudo" (apaga colaborador) e `frota.aprovar` (libera carro)
//   são "consequência que não se desfaz", que é OUTRO critério. Misturar os
//   dois faz o selo perder força. Se o dono quiser esse segundo aviso, ele
//   ganha selo próprio — não este.
// O símbolo mora aqui, sozinho, porque ele aparece em DOIS lugares com textos
// diferentes: o selo por recurso no modal ("💰 mexe em dinheiro") e a contagem
// na linha da lista ("💰 2"). Escrever o emoji à mão no segundo já deixou a
// lista com o símbolo antigo quando o módulo mudou — e calada.
export const EMOJI_DINHEIRO = '💰'

export const SELO_DINHEIRO = `${EMOJI_DINHEIRO} mexe em dinheiro`

const GASTAM = new Set([
  'meta.gestor',   // muda orçamento de campanha em veiculação
  'meta.fabrica',  // sobe campanha para a conta de anúncios
])

export function mexeEmDinheiro(recursoKey) {
  return GASTAM.has(recursoKey)
}
