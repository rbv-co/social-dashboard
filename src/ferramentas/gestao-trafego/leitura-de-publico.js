// A LEITURA DE PÚBLICO DA CONTA — o farol da Fila.
//
// PEDIDO DO DONO (12/08/2026): "otimização de público na Fila da IA também é
// interessante... que ele possa sugerir a otimização de público já trazendo os
// resultados sejam positivos ou negativos (manter), e também ser um farol para
// criarmos públicos através dessa análise".
//
// DUAS COISAS QUE ESTE ARQUIVO FAZ DIFERENTE DO RESTO DA FILA, e as duas são
// pedido explícito dele:
//
// 1. APARECE MESMO QUANDO O VEREDITO É "MANTER". Em toda a fila, 'manter' não
//    entra — não há o que aprovar. Aqui entra: ele quer ver o resultado positivo
//    ou negativo. Por isso NÃO é um item da fila (não conta no número da aba,
//    que existe pra dizer quantas DECISÕES esperam por ele) e sim um bloco de
//    leitura ao lado dela. Inflar aquele contador com coisa que não pede decisão
//    seria a tela mentindo sobre quanto trabalho há.
//
// 2. NÃO ESCREVE NA META. A recomendação é da CONTA inteira; aplicá-la de uma
//    vez reiniciaria o aprendizado de todas as campanhas juntas. Mesma política
//    do alerta de saúde, que também informa sem botão de aprovar. O que ela
//    oferece é a RECEITA pronta pra virar público novo.
//
// POR QUE POR CONTA E NÃO POR CAMPANHA — MEDIDO NO GRAPH em 12/08/2026, e foi
// esta medida que decidiu o desenho:
//   por campanha: 11 campanhas ativas, UMA com recomendação, valendo R$ 23,72.
//                 A maioria não tem NENHUMA faixa etária com 10+ resultados.
//   por conta:    4 das 7 contas com recomendação, R$ 66.554,95 em faixas caras
//                 em 90 dias.
// Construir por campanha teria entregado uma tela vazia.
//
// PURO: sem rede, sem tela.

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Quantas faixas etárias a conta tem no total. A Meta devolve seis (18-24 até
// 65+); serve pra dizer "1 de 6", que é o que mostra o tamanho do corte.
const FAIXAS_DA_META = 6;

// A leitura completa. `faixas` e `recomendacao` vêm de sugerir-publico.js —
// este arquivo não recalcula nada, só decide O QUE DIZER.
export function montarLeituraDePublico({ faixas, recomendacao, doConjunto, contando } = {}) {
  const todas = Array.isArray(faixas) ? faixas : [];
  const confiaveis = todas.filter((f) => f.confiavel && f.custo != null);

  // SEM DADO é um veredito, não um vazio. A conta pode simplesmente não ter
  // rodado o bastante — e dizer isso é diferente de não dizer nada.
  if (confiaveis.length < 2) {
    return {
      veredito: 'sem-dados',
      titulo: 'Ainda não dá para ler o público desta conta',
      frase: todas.length
        ? `Das ${todas.length} faixas de idade, ${confiaveis.length === 1 ? 'só uma tem' : 'nenhuma tem'} resultado suficiente nos últimos 90 dias. Com menos de duas faixas comparáveis, qualquer recomendação seria chute.`
        : 'Não há resultado por faixa de idade nos últimos 90 dias nesta conta.',
      contando: contando || '',
      faixas: todas,
      receita: null,
      dinheiroEmFaixasCaras: 0,
      alerta: '',
    };
  }

  if (!recomendacao) {
    // MANTER. O dono pediu para ver isto — é resultado, não ausência de
    // resultado: as faixas estão equilibradas e apertar o público não pagaria.
    const barato = confiaveis.reduce((a, b) => (a.custo <= b.custo ? a : b));
    const caro = confiaveis.reduce((a, b) => (a.custo >= b.custo ? a : b));
    return {
      veredito: 'manter',
      titulo: 'O público desta conta está equilibrado',
      frase: `Entre as ${confiaveis.length} faixas com dado suficiente, a mais barata (${barato.faixa}, ${reais(barato.custo)}) e a mais cara (${caro.faixa}, ${reais(caro.custo)}) estão perto demais para justificar cortar alguém. Apertar o público aqui seria trocar alcance por ruído.`,
      contando: contando || '',
      faixas: todas,
      receita: null,
      dinheiroEmFaixasCaras: 0,
      alerta: '',
    };
  }

  const r = recomendacao;
  const dentro = confiaveis.filter((f) => f.custo <= Math.min(...confiaveis.map((x) => x.custo)) * 1.5);

  return {
    veredito: 'ajustar',
    titulo: `Vale olhar a idade: ${r.idadeMin} a ${r.idadeMax} anos custa mais barato`,
    frase: r.porque,
    contando: contando || '',
    faixas: todas,
    dinheiroEmFaixasCaras: r.desperdicio || 0,
    fraseDoDinheiro: r.fraseDoDesperdicio || '',
    // A RECEITA pronta pra virar público novo — o "farol" que ele pediu.
    receita: {
      idadeMin: r.idadeMin,
      idadeMax: r.idadeMax,
      cidades: (doConjunto && doConjunto.cidades) || [],
      interesses: (doConjunto && doConjunto.interesses) || [],
      porqueDosConjuntos: (doConjunto && doConjunto.porque) || '',
    },
    // O CORTE DRÁSTICO PRECISA SER DITO. Medido em 12/08/2026: a conta da Vessel
    // recomenda SÓ 18-24 (a mais barata em conversa) e a Breno Vale SÓ 65+. São
    // recomendações corretas em aritmética e péssimas em negócio: conversa
    // barata não é venda, e sobrou uma faixa de seis. É exatamente o "sugere
    // idades que não casam com a marca" que o dono relatou.
    alerta: dentro.length <= 1
      ? `Atenção: isto deixaria de fora ${FAIXAS_DA_META - 1} das ${FAIXAS_DA_META} faixas de idade. O número diz quem sai mais barato, não quem compra — confira contra a persona da marca antes de estreitar tanto.`
      : '',
  };
}

// O PÚBLICO pronto pro editor, a partir da receita. `vazio` é o PUBLICO_VAZIO do
// publico-alvo.js — recebido de fora para este arquivo não depender daquele.
export function publicoDaReceita(receita, vazio) {
  if (!receita) return null;
  return {
    ...(vazio || {}),
    idadeMin: receita.idadeMin,
    idadeMax: receita.idadeMax,
    cidades: Array.isArray(receita.cidades) ? receita.cidades : [],
    interesses: Array.isArray(receita.interesses) ? receita.interesses : [],
  };
}
