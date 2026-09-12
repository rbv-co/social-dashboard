// Soma do gasto de uma resposta act_X/insights com level=campaign.
//
// Existe porque o cartão de investimento do painel passou a obedecer ao balde: ele
// vinha de level=account (a conta inteira, sem filtro nenhum) enquanto os cartões
// de custo já usavam o coletado COM filtro. Na Vessel isso divergia de verdade —
// o painel mostrava R$ 7.802 e dividia R$ 461,52.
// PURO: sem rede.

// A META RESPONDEU, OU SÓ DEVOLVEU ALGUMA COISA?
//
// `apiGet` da edge nunca lança: qualquer erro da Graph chega como um objeto com
// `error` e SEM `data`. Sem esta distinção, um erro virava soma zero, o zero
// passava pelo teste `investimento != null` da tela e o cartão imprimia
// R$ 0,00 de investimento no período — com todos os custos dividindo esse zero.
// O desenho promete o contrário: "se a Meta engasgar, a tela cai no coletado".
//
// Resposta COM `data` vazia NÃO é engasgo: é a Meta dizendo "não houve gasto
// nessa janela", e aí zero é a resposta certa e tem de passar.
export function semRespostaDaMeta(resposta) {
  return !resposta || !!resposta.error || !Array.isArray(resposta.data);
}

// VALE A PENA PEDIR A PRÓXIMA PÁGINA?
//
// Três motivos para parar, e os três já custaram caro em algum lugar deste
// projeto:
//  • não há próxima página — o caso normal;
//  • a página que acabou de chegar veio VAZIA e mesmo assim traz `paging.next`.
//    A Graph faz isso, e o laço gira para sempre queimando limite de taxa (é o
//    mesmo cuidado que coletor/preencher-numeros-de-campanha.mjs documenta);
//  • o teto de páginas. 126 campanhas com `limit=500` cabem numa página só, então
//    qualquer número de duas casas já é folga — o teto está aqui para o dia em
//    que a Graph mentir, não para o caminho normal.
export function podeBuscarProximaPagina(pagina, paginasJaLidas, maxPaginas) {
  if (!pagina || !pagina.paging || !pagina.paging.next) return false;
  if (!Array.isArray(pagina.data) || pagina.data.length === 0) return false;
  return paginasJaLidas < maxPaginas;
}

export function somarGasto(resposta, ids) {
  const linhas = (resposta && Array.isArray(resposta.data)) ? resposta.data : [];
  const querTodas = !ids || ids.length === 0;
  const alvo = querTodas ? null : new Set((ids || []).map(String));
  let total = 0;
  for (const l of linhas) {
    if (alvo && !alvo.has(String(l && l.campaign_id))) continue;
    const v = parseFloat((l && l.spend) ?? '0');
    if (isFinite(v)) total += v;
  }
  return total;
}
