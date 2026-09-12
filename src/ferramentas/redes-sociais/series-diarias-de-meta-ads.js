// Monta as séries DIÁRIAS dos gráficos da seção "02 · Meta Ads":
//   1) investimento por dia (barras) + linha da meta diária;
//   2) custo por seguidor por dia (barras) + linha da meta máxima;
//   3) custo por RESULTADO por dia — uma função só para os sete indicadores de
//      custo que o balde pode mostrar (conversa, cadastro, visita, venda,
//      interação, curtida e mil impressões).
//
// Módulo PURO de propósito: recebe as linhas já lidas do banco e devolve os pontos.
// Não importa NADA (nem o cliente do Supabase) — assim o teste roda no Node limpo,
// sem esbarrar no `window.supabase` que o conectar-no-banco-de-dados.js exige.
//
// Entradas esperadas:
//   linhasDeGasto      → campaign_insights com period_days = 0 (gasto do dia isolado),
//                        uma linha POR CAMPANHA por dia: { captured_at, spend }.
//   linhasDeSeguidores → um registro por dia: { data, novos, saiu }.
//                        (é o mesmo par novos/saíram que o gráfico de seguidores usa)
//   linhasDeResultado  → as MESMAS linhas de campaign_insights, com a contagem do
//                        indicador já escolhida: { captured_at, quantidade }.

const UM_DIA = 86400000;
const LIMITE_DE_DIAS = 400; // trava de sanidade: janela absurda não vira laço infinito

/** Lista todos os dias (YYYY-MM-DD) de `inicio` até `fim`, inclusive. */
export function listarDias(inicio, fim) {
  if (!inicio || !fim) return [];
  const t0 = Date.parse(inicio + 'T00:00:00Z');
  const t1 = Date.parse(fim + 'T00:00:00Z');
  if (!isFinite(t0) || !isFinite(t1) || t1 < t0) return [];
  const dias = [];
  for (let t = t0; t <= t1 && dias.length < LIMITE_DE_DIAS; t += UM_DIA) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}

/**
 * Soma o gasto de todas as campanhas de cada dia.
 * Devolve { 'YYYY-MM-DD': gastoDoDia }. Dia AUSENTE do mapa = dia sem coleta
 * (buraco de verdade), diferente de dia coletado com gasto zero.
 */
export function somarGastoPorDia(linhasDeGasto) {
  const porDia = {};
  for (const l of linhasDeGasto || []) {
    const dia = l && l.captured_at ? String(l.captured_at).slice(0, 10) : null;
    if (!dia) continue;
    const v = parseFloat(l.spend);
    porDia[dia] = (porDia[dia] || 0) + (isFinite(v) ? v : 0);
  }
  return porDia;
}

/**
 * Novos seguidores LÍQUIDOS por dia (seguiram − deixaram de seguir).
 * Mesma conta do card "CUSTO POR SEGUIDOR" (investimento ÷ novos seguidores).
 * Devolve { 'YYYY-MM-DD': liquido }.
 */
export function somarSeguidoresPorDia(linhasDeSeguidores) {
  const porDia = {};
  for (const l of linhasDeSeguidores || []) {
    const dia = l && l.data ? String(l.data).slice(0, 10) : null;
    if (!dia) continue;
    const novos = Number(l.novos) || 0;
    const saiu = Number(l.saiu) || 0;
    porDia[dia] = (porDia[dia] || 0) + (novos - saiu);
  }
  return porDia;
}

/**
 * Meta DIÁRIA de investimento = budget do período ÷ nº de dias do período.
 * O card "BUDGET" é do PERÍODO inteiro; o gráfico é por dia. Dividir é o único
 * jeito de a linha responder a pergunta "gastei demais NESTE dia?".
 */
export function metaDiariaDeInvestimento(budgetDoPeriodo, totalDeDias) {
  const b = Number(budgetDoPeriodo);
  if (!isFinite(b) || b <= 0 || !totalDeDias || totalDeDias <= 0) return 0;
  return b / totalDeDias;
}

/** Série de barras do investimento por dia + linha da meta diária. */
export function montarSerieDeInvestimento({ inicio, fim, linhasDeGasto, budgetDoPeriodo } = {}) {
  const dias = listarDias(inicio, fim);
  const gasto = somarGastoPorDia(linhasDeGasto);
  const pontos = dias.map((data) => {
    const temColeta = Object.prototype.hasOwnProperty.call(gasto, data);
    return temColeta
      ? { data, valor: gasto[data], semDado: false, motivo: null }
      : { data, valor: null, semDado: true, motivo: 'sem-coleta' };
  });
  return {
    pontos,
    meta: metaDiariaDeInvestimento(budgetDoPeriodo, dias.length),
    temDado: pontos.some((p) => !p.semDado),
    totalDeDias: dias.length,
  };
}

/**
 * Série de barras do custo por seguidor por dia + linha da meta máxima.
 * A meta NÃO é dividida por dia: "META MÁX" já é um valor por seguidor
 * (R$ por seguidor), que vale igual em qualquer recorte de tempo.
 *
 * Por dia:
 *   sem linha de gasto              → sem dado ('sem-coleta')
 *   líquido de seguidores <= 0      → sem dado ('sem-seguidor') — não divide por zero
 *                                     nem inventa custo infinito
 *   gasto 0 e seguidores > 0        → custo 0 (ganhou seguidor sem pagar)
 */
export function montarSerieDeCustoPorSeguidor({ inicio, fim, linhasDeGasto, linhasDeSeguidores, metaDeCustoPorSeguidor } = {}) {
  const dias = listarDias(inicio, fim);
  const gasto = somarGastoPorDia(linhasDeGasto);
  const seguidores = somarSeguidoresPorDia(linhasDeSeguidores);
  const pontos = dias.map((data) => {
    if (!Object.prototype.hasOwnProperty.call(gasto, data)) {
      return { data, valor: null, semDado: true, motivo: 'sem-coleta' };
    }
    const liquido = seguidores[data];
    if (!(liquido > 0)) {
      return { data, valor: null, semDado: true, motivo: 'sem-seguidor', gasto: gasto[data], seguidores: liquido == null ? null : liquido };
    }
    return { data, valor: gasto[data] / liquido, semDado: false, motivo: null, gasto: gasto[data], seguidores: liquido };
  });
  const m = Number(metaDeCustoPorSeguidor);
  return {
    pontos,
    meta: isFinite(m) && m > 0 ? m : 0,
    temDado: pontos.some((p) => !p.semDado),
    totalDeDias: dias.length,
  };
}

/**
 * Soma o RESULTADO de todas as campanhas de cada dia.
 * Linhas esperadas: { captured_at, quantidade }.
 *
 * NULO NÃO É ZERO. As colunas conversas/cadastros/compras/visitas nasceram sem
 * default no banco, então linha antiga chega com null — que quer dizer "ainda não
 * foi coletado", não "não aconteceu". Só entra na soma a linha que tem número; se
 * NENHUMA linha do dia tiver, o dia fica FORA do mapa (é a mesma distinção que o
 * somarGastoPorDia faz entre dia sem coleta e dia coletado com zero).
 */
export function somarResultadoPorDia(linhasDeResultado) {
  const porDia = {};
  for (const l of linhasDeResultado || []) {
    const dia = l && l.captured_at ? String(l.captured_at).slice(0, 10) : null;
    if (!dia) continue;
    if (l.quantidade == null) continue;         // "não sei" nunca vira 0
    const v = Number(l.quantidade);
    if (!isFinite(v)) continue;
    porDia[dia] = (porDia[dia] || 0) + v;
  }
  return porDia;
}

/**
 * UMA função para SETE indicadores: custo por conversa, cadastro, visita, venda,
 * interação, curtida e mil impressões. Todos são a MESMA conta — gasto do dia ÷
 * resultado do dia — mudando só de onde vem o denominador. Sete cópias quase
 * iguais viram sete verdades que divergem no primeiro conserto; foi por isso que
 * esta é uma só, recebendo as linhas do resultado de fora.
 *
 * `divisorDoResultado` existe por um indicador só: o CUSTO POR MIL IMPRESSÕES,
 * cujo denominador é impressões ÷ 1000. Deixar essa divisão do lado de fora
 * obrigaria quem chama a dividir um número que pode ser NULO — e é exatamente aí
 * que "não sei" costuma virar zero.
 *
 * A meta NÃO é dividida pelos dias: "R$ 12 por conversa" é uma taxa, vale igual
 * em 1 ou em 30 dias (mesma regra do custo por seguidor e do METAS_DE_TAXA de
 * cartoes-do-balde.js).
 *
 * Por dia:
 *   sem linha de gasto        → 'sem-coleta'   (buraco de verdade)
 *   resultado nulo ou <= 0    → 'sem-resultado' (não divide por zero nem inventa
 *                               custo infinito)
 *   gasto 0 e resultado > 0   → custo 0 (teve resultado sem pagar: é medida)
 */
export function montarSerieDeCustoPorResultado({ inicio, fim, linhasDeGasto, linhasDeResultado, meta, divisorDoResultado } = {}) {
  const dias = listarDias(inicio, fim);
  const gasto = somarGastoPorDia(linhasDeGasto);
  const resultado = somarResultadoPorDia(linhasDeResultado);
  const divisor = isFinite(Number(divisorDoResultado)) && Number(divisorDoResultado) > 0 ? Number(divisorDoResultado) : 1;
  const pontos = dias.map((data) => {
    if (!Object.prototype.hasOwnProperty.call(gasto, data)) {
      return { data, valor: null, semDado: true, motivo: 'sem-coleta' };
    }
    const temResultado = Object.prototype.hasOwnProperty.call(resultado, data);
    const bruto = temResultado ? resultado[data] : null;
    if (!(bruto > 0)) {
      return { data, valor: null, semDado: true, motivo: 'sem-resultado', gasto: gasto[data], resultado: bruto };
    }
    return { data, valor: gasto[data] / (bruto / divisor), semDado: false, motivo: null, gasto: gasto[data], resultado: bruto };
  });
  const m = Number(meta);
  return {
    pontos,
    meta: isFinite(m) && m > 0 ? m : 0,
    temDado: pontos.some((p) => !p.semDado),
    totalDeDias: dias.length,
  };
}

/** Quantos dias da janela realmente têm um custo calculado (nem buraco, nem "não sei"). */
export function diasComCusto(serie) {
  const pontos = (serie && serie.pontos) || [];
  return pontos.filter((p) => p && !p.semDado).length;
}

/**
 * Dias que AUTORIZAM um gráfico de custo: têm custo calculado E dinheiro gasto.
 *
 * Dia com resultado e ZERO investimento é medida de verdade e continua virando
 * ponto no desenho — mas não pode ser um dos dias que liberam o gráfico. Senão o
 * gráfico inteiro pode ser feito de barras de R$ 0,00, que não dizem nada sobre
 * custo nenhum. Acontece pouco e acontece: 2 dias assim na Vessel e 1 na
 * Motoeasy nos últimos 30 dias.
 */
export function diasComInvestimentoEResultado(serie) {
  const pontos = (serie && serie.pontos) || [];
  return pontos.filter((p) => p && !p.semDado && p.gasto > 0).length;
}

/**
 * VALE A PENA DESENHAR ESTE GRÁFICO?
 *
 * Só com DOIS dias ou mais. Um ponto não é uma linha: não mostra tendência
 * nenhuma, não dá para comparar com nada, e ainda ocupa a altura inteira de um
 * gráfico fingindo que mostra. Num celular de 375px, sete cartões com um pontinho
 * cada empurram a seção inteira para baixo sem entregar uma informação sequer.
 *
 * Abaixo do mínimo, quem chama escreve a frase do porquê — "—" com motivo, nunca
 * um quadro vazio que parece defeito.
 *
 * `exigirInvestimento` liga a regra do dia pago (ver diasComInvestimentoEResultado).
 * Nasce DESLIGADA: o gráfico de investimento e o de custo por seguidor entram por
 * esta mesma porta, com mínimo 1, e mexer no que eles desenham não estava em jogo
 * — os pontos do investimento nem carregam `gasto` separado, porque o gasto É o
 * valor deles.
 */
export function valeDesenharOGrafico(serie, minimoDeDias = 2, { exigirInvestimento = false } = {}) {
  const dias = exigirInvestimento ? diasComInvestimentoEResultado(serie) : diasComCusto(serie);
  return dias >= minimoDeDias;
}
