// O cálculo do ranking por vendedora, extraído de dentro de duas funções da
// tela (_gvUpdateVendRanking e renderGestaoVista) que faziam a MESMA conta
// com nomes de variável diferentes. Até 03/10/2026 eram dois lugares — e
// uma correção (ex: valor líquido de troca) que entrasse só num deles faria
// os dois discordarem, o mesmo tipo de bug que data-da-venda e
// valor-corrigido já existem para evitar em outro canto da tela.
export function calcularRankingPorVendedor(pedidos, pedidosPrev, pedidoVendorMap, vendedoresCache, canaisMap) {
  const vm = vendedoresCache || {};
  const pm = pedidoVendorMap || {};
  const cm = canaisMap || {};

  const porVendObj = {};
  (pedidos || []).forEach((p) => {
    const vId = pm[p.id] || p.vendedor?.id;
    const vNome = (vm[vId]?.nome || 'Sem vendedor').split(' ').slice(0, 2).join(' ');
    const canal = cm[p.loja?.id] || '';
    const key = vId || vNome;
    if (!porVendObj[key]) porVendObj[key] = { nm: vNome, total: 0, cnt: 0, canalCnt: {} };
    porVendObj[key].total += parseFloat(p.total || 0);
    porVendObj[key].cnt++;
    if (canal) porVendObj[key].canalCnt[canal] = (porVendObj[key].canalCnt[canal] || 0) + 1;
  });
  Object.values(porVendObj).forEach((vd) => {
    const e = Object.entries(vd.canalCnt);
    vd.canal = e.sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  });
  const vendsArr = Object.values(porVendObj).sort((a, b) => b.total - a.total);

  const porVendPrev = {};
  (pedidosPrev || []).forEach((p) => {
    const vId = pm[p.id] || p.vendedor?.id;
    const vNome = (vm[vId]?.nome || 'Sem vendedor').split(' ').slice(0, 2).join(' ');
    const key = vId || vNome;
    porVendPrev[key] = (porVendPrev[key] || 0) + parseFloat(p.total || 0);
  });

  return { porVendObj, vendsArr, porVendPrev };
}
