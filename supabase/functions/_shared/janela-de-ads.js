// A JANELA DE DATAS QUE O COLETOR PEDE À META PARA O RECORTE DE N DIAS.
//
// O DEFEITO QUE ESTE MÓDULO CONSERTA (medido no código em 20/08/2026):
// `coletarAdsPorCampanha` pedia `{ since: hoje − N, until: hoje }`. O
// `time_range` da Meta é INCLUSIVO nas duas pontas, então "7 dias" virava
// 13/08→20/08 = OITO dias, e o oitavo era o dia de HOJE, que ainda não acabou.
//
// Isso vazava para a tela inteira da seção 02 · Meta Ads: o investimento vem ao
// vivo e cobre 7 dias exatos, e todos os denominadores (impressões, alcance,
// cliques, interações, curtidas, conversas, cadastros, visitas, vendas) vinham
// desses 8. Todo custo por resultado saía mais barato do que é — uns 10 a 14%
// em 7D — e o ALCANCE nunca fechava com o "Últimos 7 dias" da Meta.
//
// O engajamento da conta, no MESMO coletor, sempre esteve certo (últimos N dias
// COMPLETOS, fechando à meia-noite BRT, conferido contra o Business Suite). Só o
// pedaço de anúncios tinha ficado fora da régua. Agora os dois usam a mesma.
//
// N = 0 É OUTRA COISA, e continua como sempre: é o gasto do PRÓPRIO dia
// (`{ since: dia, until: dia }`), que alimenta os gráficos diários e a conta de
// qual tipo de campanha ficou sem dinheiro. Mexer nele quebraria os dois.
// PURO: sem rede.

// Âncora ao MEIO-DIA de propósito: assim nem fuso nem horário de verão empurram
// a data para o dia vizinho na hora de formatar.
function menosDias(dia, n) {
  const d = new Date(dia + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

/**
 * @param {string} hoje  'AAAA-MM-DD' — o dia da coleta (BRT).
 * @param {number} dias  0 = o próprio dia; N > 0 = os últimos N dias COMPLETOS.
 * @returns {{since:string, until:string}|null}  null para entrada inválida —
 *          nunca uma janela chutada, que preencheria o período errado.
 */
export function janelaDeAds(hoje, dias) {
  if (!hoje || typeof hoje !== 'string') return null;
  // `null` e `''` saem ANTES do Number(): `Number(null)` é 0, e 0 aqui quer
  // dizer "o gasto do próprio dia" — devolver isso para quem não passou recorte
  // nenhum seria responder outra pergunta com confiança.
  if (dias == null || dias === '') return null;
  const n = Number(dias);
  if (!Number.isInteger(n) || n < 0) return null;
  if (n === 0) return { since: hoje, until: hoje };
  // `until` é ONTEM: o dia de hoje ainda está correndo, e meio dia contado como
  // dia inteiro é exatamente o que fazia o custo sair barato.
  return { since: menosDias(hoje, n), until: menosDias(hoje, 1) };
}

// A JANELA VELHA, a que vigorou até esta correção subir.
//
// Ela não existe por nostalgia: as linhas de `campaign_insights` já gravadas
// foram medidas assim, e o backfill das quatro contagens (conversa, cadastro,
// venda, visita) tem de fazer à Meta a MESMA pergunta que fez quem gravou a
// linha — senão duas colunas vizinhas da mesma linha passam a falar de períodos
// diferentes, que é pior do que a linha estar errada por inteiro.
export function janelaDeAdsAntiga(hoje, dias) {
  if (!hoje || typeof hoje !== 'string') return null;
  if (dias == null || dias === '') return null;
  const n = Number(dias);
  if (!Number.isInteger(n) || n < 0) return null;
  return { since: menosDias(hoje, n), until: hoje };
}
