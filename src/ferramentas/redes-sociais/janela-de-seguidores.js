// QUEM É "ROLANTE" NO GRÁFICO DE NOVOS SEGUIDORES.
//
// ⚠️ ISTO É O QUE SOBROU DE UMA TENTATIVA MAIOR, e o resto foi apagado de
// propósito (09/09/2026). Passou-se a tarde tentando fazer o card bater com o
// painel profissional do Instagram — deslocando janela, rotulando barras um dia à
// frente, explicando a diferença numa nota. Tudo desfeito.
//
// O DONO ACHOU A RAIZ: o painel filtra OUTRO período. Medido por ele no painel
// dele — "últimos 7 dias" vai de 2 a 7, e "5 a 8" mostra de 4 a 7. Não existe
// arranjo que faça a nossa janela e a dele darem o mesmo número, porque não são a
// mesma janela. A regra virou outra: o card é a soma do gráfico, e a validação
// contra o painel se faz pela conta, com a janela que o painel mostrar.

/**
 * O gráfico deve tratar este recorte como ROLANTE (Hoje/1D/3D/7D/14D/30D)?
 *
 * ⚠️ O RECORTE PERSONALIZADO NUNCA É ROLANTE, mesmo com `period` numérico. Ao
 * escolher datas na tela, `period` CONTINUA com o valor antigo (7, 30…) — e o
 * gráfico decidia o ramo só por ele. O ramo rolante cola "ontem" e "hoje" no fim
 * da série, então um período de 5 a 8 de setembro ganhava barras dos dias 8 e 9.
 *
 * Defeito visto pelo dono em 09/09/2026: filtrando 5 a 8, a barra do dia 8
 * apareceu DUAS VEZES — uma como dia da série, outra como "ontem". Antes disso o
 * mesmo defeito já mostrava um dia 9 que ninguém tinha pedido, e passou batido.
 */
export function ehRecorteRolante(period, inicio, fim) {
  if (inicio && fim) return false
  return [0, 1, 3, 7, 14, 30].includes(period)
}

/**
 * Neste período o gráfico mostra CONTEXTO em vez do próprio período?
 *
 * ⚠️ "HOJE" E "ONTEM" DESENHAM OS ÚLTIMOS 7 DIAS DE PROPÓSITO — uma barra só
 * seria um retângulo sem leitura nenhuma. O card, porém, é do DIA.
 *
 * Defeito real (09/09/2026), logo depois de o card virar "a soma do gráfico":
 * "ontem" mostrava 1,7 mil — a semana inteira somada — quando o dia tinha sido
 * 443, e "hoje" mostrava o mesmo 1,7 mil no lugar de 336.
 *
 * Ou seja: "o card é a soma do gráfico" vale onde o gráfico É o período. Nestes
 * dois, o card é a ÚLTIMA barra.
 */
export function ehGraficoDeContexto(period) {
  return period === 0 || period === 1
}
