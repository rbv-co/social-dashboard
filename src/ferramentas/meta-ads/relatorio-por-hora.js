// Agrupa campaign_insights_hora em dias > horas > campanhas, para o
// acordeão do Relatório por Hora. Pura, sem I/O — recebe os dados já
// buscados do Supabase (ver tela-de-relatorio-por-hora.vue).

// null (não 0) quando não há conversa: custar em cima de zero lead seria
// inventar um número — regra "a tela nunca mente" do padrão do projeto.
export function custoPorLead(gastoHora, conversasHora) {
  if (!conversasHora) return null;
  return gastoHora / conversasHora;
}

export function agruparPorDiaEHora(linhas, nomesPorCampanha = {}) {
  const porDia = new Map();
  for (const l of linhas) {
    if (!porDia.has(l.dia)) porDia.set(l.dia, new Map());
    const porHora = porDia.get(l.dia);
    if (!porHora.has(l.hora)) porHora.set(l.hora, []);
    const gastoHora = Number(l.gasto_hora) || 0;
    const conversasHora = Number(l.conversas_hora) || 0;
    porHora.get(l.hora).push({
      campaignId: l.campaign_id,
      nome: nomesPorCampanha[l.campaign_id] || l.campaign_id,
      gastoHora,
      conversasHora,
      custoPorLead: custoPorLead(gastoHora, conversasHora),
    });
  }

  return [...porDia.keys()].sort().reverse().map((dia) => {
    const porHora = porDia.get(dia);
    const horas = [...porHora.keys()].sort((a, b) => a - b).map((hora) => {
      const todasCampanhas = [...porHora.get(hora)].sort((a, b) => b.gastoHora - a.gastoHora);
      // Só entra na lista quem converteu nessa hora — a maioria não converte
      // e só faria poluição visual (pedido do dono, 12/09/2026). O total da
      // hora continua somando TODAS as campanhas, inclusive as escondidas:
      // "quanto se gastou nessa hora" é o gasto real, não só o de quem
      // apareceu na lista.
      const campanhas = todasCampanhas.filter((c) => c.conversasHora > 0);
      return {
        hora,
        gastoTotal: todasCampanhas.reduce((s, c) => s + c.gastoHora, 0),
        conversasTotal: todasCampanhas.reduce((s, c) => s + c.conversasHora, 0),
        campanhas,
      };
    });
    return {
      dia,
      gastoTotal: horas.reduce((s, h) => s + h.gastoTotal, 0),
      conversasTotal: horas.reduce((s, h) => s + h.conversasTotal, 0),
      horas,
    };
  });
}
