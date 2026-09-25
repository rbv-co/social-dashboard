// O QUE A CONTA PAGA por engajamento, medido pelos dados que a tela JÁ tem em
// memória (insights + conjuntos da conta aberta) — nunca uma chamada nova à
// Meta. Alimenta o painel da régua (opcoes.custoEngajamentoPraticado em
// painel-regua.js), pro dono definir a meta nova de custo por engajamento
// contra o real, e não no escuro — que é justamente o que esse campo existe
// pra evitar (acréscimo ao brief da Tarefa 4 da Onda B, 24/09/2026).
//
// PURO por decisão de projeto, não só por convenção da pasta: a rodada 1 de
// revisão pegou dois defeitos reais aqui (a soma incluindo campanha de
// SEGUIDORES, e o texto chamando de "hoje" um número que soma o filtro de
// período inteiro) — os dois são exatamente o tipo de erro que um teste de
// unidade, com insights forjados, prova sem precisar abrir a tela. Antes esta
// função morava dentro do .vue, sem teste possível.
//
// Soma gasto e engajamento de TODA campanha de engajamento da conta (mesmo
// recorte usado no cartão e em `_gtExemplosParaRegua`, no .vue: exclui
// campanha de MENSAGEM — vende conversa, não curtida/comentário/salvamento —
// e campanha DE SEGUIDORES, `ehDeSeguidores`: a mesma decisão de 24/09/2026
// que deu a elas "medida indisponível" no robô, porque a Meta não atribui
// seguidor a campanha nenhuma. Incluí-las aqui puxaria o número de referência
// da régua pela campanha que a própria régua declara não saber julgar —
// defeito real visto na conta Mantova Móveis, com 5-6 campanhas
// "[+ SEGUIDORES]" caindo no balde engajamento) — e só então divide o total:
// nunca a média das médias por campanha, que pesaria igual uma campanha de
// R$ 10 e uma de R$ 10.000.
//
// NÃO é "de hoje": a soma é sobre QUALQUER janela que `insights` representar —
// isto aqui não sabe (nem precisa saber) qual filtro de período está ativo.
// Quem chama (o .vue) é responsável por rotular a janela de verdade ao montar
// o texto — ver `custoEngajamentoPraticadoPeriodo` em painel-regua.js.
//
// Sem gasto ou sem engajamento no total: devolve null. Item 9 do padrão ("a
// tela nunca mente") proíbe zero inventado ou traço solto — e quem usa este
// valor já trata a ausência não mostrando nada.
import { baldeDoObjetivo, ehDeWhatsapp, ehDeSeguidores } from './baldes.js';
import { GT_METRIC_CATALOG } from './metricas.js';

export function custoEngajamentoPraticado(insights, adsets) {
  // Conjuntos agrupados por campanha UMA vez (Map), em vez de filtrar todos
  // os conjuntos da conta a cada campanha do laço — mesmo motivo de
  // `_gtGastosPorCampanha`, no .vue: o custo de montar o mapa é O(m), contra
  // O(n×m) de refiltrar por campanha a cada linha de insight.
  const conjuntosPorCampanha = new Map();
  for (const s of adsets || []) {
    const cid = String((s && s.campaign_id) || '');
    if (!conjuntosPorCampanha.has(cid)) conjuntosPorCampanha.set(cid, []);
    conjuntosPorCampanha.get(cid).push(s);
  }
  let gastoTotal = 0, engajTotal = 0;
  for (const linha of insights || []) {
    if (baldeDoObjetivo(linha && linha.objective) !== 'engajamento') continue;
    if (ehDeSeguidores(linha && linha.campaign_name)) continue;
    const conjuntosDaLinha = conjuntosPorCampanha.get(String((linha && linha.campaign_id) || '')) || [];
    if (ehDeWhatsapp(conjuntosDaLinha)) continue;
    gastoTotal += Number(GT_METRIC_CATALOG.gasto.compute(linha)) || 0;
    engajTotal += Number(GT_METRIC_CATALOG.engaj_pub.compute(linha)) || 0;
  }
  return (gastoTotal > 0 && engajTotal > 0) ? gastoTotal / engajTotal : null;
}
