// O CUSTO POR SEGUIDOR — sempre DA CONTA, nunca de uma campanha.
//
// A Meta NÃO atribui "novo seguidor" a uma campanha: conferido na Graph API em
// 12/09/2026 (ver db/migrations/2026-09-12-meta-ads-hora-cliques.sql). O que
// existe é o total de seguidores da conta por dia (followers_leituras).
//
// Ratear esse total entre campanhas foi medido e DESCARTADO pelo dono em
// 24/09/2026: o rateio por clique quebra quando uma campanha tem clique perto
// de zero — a AXIOM_05_SEGUID_VESSEL-CAMPINAS gastou R$ 726 com 1 clique em 7
// dias e o rateio cospe "R$ 2.624,88 por seguidor". Um número desses na tela é
// pior que nenhum.
//
// O número inclui SEGUIDOR ORGÂNICO e não há como separar. Quem mostra tem de
// dizer isso. PURO: sem rede, sem tela.

// Abaixo disto o ganho não sustenta uma régua: 3 seguidores num período podem
// ser 3 pessoas quaisquer, orgânico incluso — mesmo espírito do
// MINIMO_DE_RESULTADOS de sugerir-publico.js (10 resultados como piso).
export const AMOSTRA_MINIMA_DE_SEGUIDORES = 10;

// `custoPorSeguidorDaConta({ gastoDeSeguidores, seguidoresGanhos })` →
// `{ valor, confiavel, porque }`.
//
// `gastoDeSeguidores`: soma do gasto das campanhas onde `ehDeSeguidores`
// (baldes.js) é verdadeiro, na MESMA janela de `seguidoresGanhos`.
// `seguidoresGanhos`: delta de `followers_leituras` da conta na janela — pode
// incluir dias sem campanha de seguidor nenhuma, o dado é da conta inteira.
//
// Ganho zero ou negativo (perdeu seguidor no período) NUNCA vira número: seria
// dividir por zero ou inventar um "custo" negativo sem significado nenhum —
// a régua "a tela nunca mente" do padrão do projeto.
export function custoPorSeguidorDaConta({ gastoDeSeguidores, seguidoresGanhos }) {
  const gasto = Number(gastoDeSeguidores) || 0;
  const ganho = Number(seguidoresGanhos);

  if (!Number.isFinite(ganho) || ganho <= 0) {
    return {
      valor: null,
      confiavel: false,
      porque: ganho === 0
        ? 'a conta não ganhou seguidor nenhum no período — dividir por zero não produz custo.'
        : 'a conta perdeu seguidor no período (saldo negativo) — não há ganho para dividir o gasto.',
    };
  }

  const valor = gasto / ganho;
  const amostraPequena = ganho < AMOSTRA_MINIMA_DE_SEGUIDORES;
  return {
    valor,
    confiavel: !amostraPequena,
    porque: amostraPequena
      ? `apenas ${ganho} seguidor(es) ganho(s) no período — amostra pequena demais para sustentar a régua.`
      : 'gasto das campanhas de seguidores dividido pelo ganho de seguidores da conta no período.',
  };
}
