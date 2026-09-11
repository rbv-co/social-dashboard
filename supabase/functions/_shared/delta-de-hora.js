// Delta de hora para o Relatório por Hora do Meta Ads: dado o acumulado do
// dia até agora e a última leitura já gravada, devolve o quanto mudou nesta
// hora. Pura, sem I/O — testável sem Deno e sem falar com a Meta.
//
// Ver docs/superpowers/specs/2026-09-11-meta-ads-relatorio-por-hora-design.md.

const TIPOS_CONVERSA = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_conversation_started',
];

// Primeiro tipo encontrado ganha — mesmo critério de `actVal()` em
// coletar-dados/index.ts, pra não inventar uma segunda regra de leitura do
// array `actions` da Meta neste projeto.
export function conversasIniciadas(actions) {
  if (!Array.isArray(actions)) return 0;
  for (const tipo of TIPOS_CONVERSA) {
    const achado = actions.find((a) => a && a.action_type === tipo);
    if (achado) return parseInt(achado.value ?? '0', 10) || 0;
  }
  return 0;
}

// `anterior` é a última linha já gravada HOJE para esta campanha, ou null se
// for a primeira leitura do dia. Sem anterior, o delta é o próprio acumulado.
// Nunca negativo: a Meta pode reclassificar uma ação e corrigir o acumulado
// pra baixo, e um delta negativo não tem leitura sensata numa tela de
// "quanto se gastou nesta hora".
export function calcularDeltaHora(gastoAcumulado, conversasAcumuladas, anterior) {
  const gastoAnterior = anterior ? Number(anterior.gasto_acumulado) : 0;
  const conversasAnterior = anterior ? Number(anterior.conversas_acumuladas) : 0;
  return {
    gasto_hora: Math.max(0, gastoAcumulado - gastoAnterior),
    conversas_hora: Math.max(0, conversasAcumuladas - conversasAnterior),
  };
}
