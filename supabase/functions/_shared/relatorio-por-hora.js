// CÓPIA de src/ferramentas/meta-ads/relatorio-por-hora.js.
//
// POR QUE DUPLICADO E NÃO IMPORTADO: a Edge `enviar-relatorio-hora` roda no
// Deno e não alcança `src/` (mesmo motivo de `_shared/valor-corrigido.js` —
// ver o comentário lá). É a MESMA regra que o Relatório por Hora usa pra
// montar as mensagens; mudou uma, muda a outra à mão.
//
// Agrupa campaign_insights_hora em dias > horas > campanhas, para o
// acordeão do Relatório por Hora. Pura, sem I/O — recebe os dados já
// buscados do Supabase (ver tela-de-relatorio-por-hora.vue).

// null (não 0) quando não há conversa: custar em cima de zero lead seria
// inventar um número — regra "a tela nunca mente" do padrão do projeto.
export function custoPorLead(gastoHora, conversasHora) {
  if (!conversasHora) return null;
  return gastoHora / conversasHora;
}

export function formatarReais(v) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Classifica a campanha pelo NOME (prefixo combinado na Meta) — é o único
// sinal que temos hoje pra saber o que ela é. `[CAMPANHA WPP]` vira mensagem
// de leads; `[+ SEGUIDORES]` reserva a aba própria (indicadores dela ainda
// não existem, pedido do dono em 12/09/2026); o resto cai em "outro".
export function tipoDaCampanha(nome) {
  if (nome.startsWith('[CAMPANHA WPP]')) return 'wpp';
  if (nome.startsWith('[+ SEGUIDORES]')) return 'seguidores';
  return 'outro';
}

export function agruparPorDiaEHora(linhas, nomesPorCampanha = {}) {
  const porDia = new Map();
  for (const l of linhas) {
    if (!porDia.has(l.dia)) porDia.set(l.dia, new Map());
    const porHora = porDia.get(l.dia);
    if (!porHora.has(l.hora)) porHora.set(l.hora, []);
    const gastoHora = Number(l.gasto_hora) || 0;
    const conversasHora = Number(l.conversas_hora) || 0;
    // Acumulado do DIA até essa hora, já vem pronto do robô (mesma coluna que
    // ele usa pra calcular o próprio gastoHora) — pedido do dono (12/09/2026):
    // "gasto total da campanha junto ao gasto do período" na Mensagem WPP.
    const gastoAcumulado = Number(l.gasto_acumulado) || 0;
    const nome = nomesPorCampanha[l.campaign_id] || l.campaign_id;
    porHora.get(l.hora).push({
      campaignId: l.campaign_id,
      nome,
      tipo: tipoDaCampanha(nome),
      gastoHora,
      gastoAcumulado,
      conversasHora,
      custoPorLead: custoPorLead(gastoHora, conversasHora),
    });
  }

  return [...porDia.keys()].sort().reverse().map((dia) => {
    const porHora = porDia.get(dia);
    const horas = [...porHora.keys()].sort((a, b) => a - b).map((hora) => {
      // Todas as campanhas ficam aqui, com ou sem conversão — quem decide o
      // que mostrar (aba Resultados/Outras/Mensagem WPP) é a tela, não esta
      // função. O total da hora sempre soma todas, nunca só as exibidas.
      const campanhas = [...porHora.get(hora)].sort((a, b) => b.gastoHora - a.gastoHora);
      return {
        hora,
        gastoTotal: campanhas.reduce((s, c) => s + c.gastoHora, 0),
        conversasTotal: campanhas.reduce((s, c) => s + c.conversasHora, 0),
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

// Texto pronto pra mandar no grupo de WhatsApp via Z-API, de hora em hora.
// Só entram campanhas [CAMPANHA WPP]; `null` quando não há nenhuma nessa
// hora (não força mensagem vazia).
//
// MESMO ESQUEMA da Mensagem Seguidores (pedido de um colega no grupo,
// repassado pelo dono em 12/09/2026: "tem que ter o msm esquema de: Leads no
// intervalo: +xx / Total de leads diário: xx" — e o dono: "coloca a palavra
// gasto antes do valor, pra saber também, se não fica confuso"). Cada número
// com o RÓTULO na frente, nunca só o valor solto — foi isso que confundiu
// antes ("parece que não teve nenhum lead no dia" quando só a hora tinha 0).
// `leadsHoje`/`gastoHoje` são os totais WPP do dia inteiro (vêm de
// `leadsWppNoDia`/`gastoWppNoDia`); `null`/`undefined` não mostra a linha
// (chamador ainda não tem o dado).
// Reformulada pra bater com o mock que um colega mandou no grupo (repassado
// pelo dono, 12/09/2026): cabeçalhos "INTERVALO"/"TOTAL DESDOBRADO" (mesmo
// espírito do INTERVALO/TOTAL da Mensagem Seguidores), custo por lead antes
// do valor bruto de gasto (mesma regra: indicador por unidade primeiro, valor
// investido por último). O rótulo "Gasto Dia" por campanha é o que veio no
// mock — o valor é o gasto do PERÍODO desta campanha (`gastoHora`), não o
// acumulado do dia; "Gasto total das campanhas" saiu de cena, redundante com
// "Total de gasto no dia" no rodapé.
export function montarMensagemWpp(dia, hora, campanhas, leadsHoje, gastoHoje) {
  const wpp = campanhas.filter((c) => c.tipo === 'wpp');
  if (!wpp.length) return null;

  const [ano, mes, d] = dia.split('-');
  const horaStr = String(hora).padStart(2, '0');
  const cabecalho = `📊 Leads recebidos — ${horaStr}h, ${d}/${mes}`;

  const totalLeads = wpp.reduce((s, c) => s + c.conversasHora, 0);
  const totalGasto = wpp.reduce((s, c) => s + c.gastoHora, 0);
  const custoMedio = custoPorLead(totalGasto, totalLeads);

  const linhaNoPeriodo = `Leads no período: ${totalLeads}`;
  const linhaCustoPorLead = custoMedio !== null ? `Custo por lead: ${formatarReais(custoMedio)}` : null;
  const linhaGasto = `Gasto no período: ${formatarReais(totalGasto)}`;
  const doPeriodo = [linhaNoPeriodo, linhaCustoPorLead, linhaGasto].filter((l) => l !== null);

  const linhasCampanhas = wpp.map((c) => `${c.nome} — ${c.conversasHora} lead${c.conversasHora === 1 ? '' : 's'}`
    + ` · Gasto Dia: ${formatarReais(c.gastoHora)}`);

  const linhaLeadsDoDia = leadsHoje != null ? `Total de leads no dia: ${leadsHoje}` : null;
  const linhaGastoDoDia = gastoHoje != null ? `Total de gasto no dia: ${formatarReais(gastoHoje)}` : null;
  const doDia = [linhaLeadsDoDia, linhaGastoDoDia].filter((l) => l !== null);

  const corpo = [cabecalho, '', 'INTERVALO', ...doPeriodo, '', 'TOTAL DESDOBRADO', ...linhasCampanhas];
  if (doDia.length) corpo.push('', ...doDia);
  return corpo.join('\n');
}

// Soma os leads (ou o gasto) das campanhas [CAMPANHA WPP] em TODAS as horas
// do dia — o "Total de leads/gasto diário" pedido acima. `horas` é o array
// que `agruparPorDiaEHora` já devolve para um dia (cada uma com
// `.campanhas`) — não precisa de leitura nova.
export function leadsWppNoDia(horas) {
  return horas.reduce((soma, h) => soma + h.campanhas.filter((c) => c.tipo === 'wpp').reduce((s, c) => s + c.conversasHora, 0), 0);
}
export function gastoWppNoDia(horas) {
  return horas.reduce((soma, h) => soma + h.campanhas.filter((c) => c.tipo === 'wpp').reduce((s, c) => s + c.gastoHora, 0), 0);
}

// Mesma soma de gastoWppNoDia, mas pro tipo 'seguidores' — usado pra "Custo de
// seguidores dia" e "Custo visitantes dia" (pedido do dono, 12/09/2026:
// mostrar o custo do DIA inteiro, não só do período).
export function gastoSeguidoresNoDia(horas) {
  return horas.reduce((soma, h) => soma + h.campanhas.filter((c) => c.tipo === 'seguidores').reduce((s, c) => s + c.gastoHora, 0), 0);
}

// Soma visitas ao perfil de TODAS as horas do dia — "Total visitantes dia"
// (pedido do dono, 12/09/2026). `linhas` é o que a Edge já busca de
// perfil_visitas_hora (cada uma com `dia`/`hora`/`visitas_hora`) — sem
// leitura nova, só soma o que já veio.
export function visitasPerfilNoDia(linhas, dia) {
  return linhas.filter((l) => l.dia === dia).reduce((soma, l) => soma + (l.visitas_hora ?? 0), 0);
}

// Texto pronto pra mandar no grupo de WhatsApp via Z-API, mesmo espírito de
// montarMensagemWpp — com os números DA CONTA: seguidores (do período, do
// dia, e total) e visita ao perfil. Não existe por campanha pra nenhum dos
// dois (Meta não atribui nem seguidor nem visita a uma campanha específica).
//
// DUAS PARTES, separadas por linha em branco (pedido do dono, 12/09/2026:
// "separa entre total e resultado do horário, tipo novos seguidores, visitas
// ao perfil ---- total do dia, total da conta"): o RESULTADO DO PERÍODO
// (novos seguidores + visita ao perfil + investimento e custos) primeiro, os
// TOTAIS (do dia e da conta) depois. Cada linha só entra se o próprio valor
// não for `null`; cada PARTE só entra se tiver ao menos uma linha; a linha em
// branco entre as partes só aparece se as duas tiverem conteúdo. `null`
// geral = nada em nenhuma das duas partes.
//
// `gastoSeguidores` é a soma do gasto das campanhas [+ SEGUIDORES] nessa
// hora (pedido do dono, 12/09/2026: "faz uma linha de investimento também
// ... investimento, custo por visita, custo por seguidor" — o mesmo dado que
// existia antes de "tira o link_click", agora do lado de visita/seguidor em
// vez de clique). Só aparece o bloco de investimento quando teve gasto de
// verdade — sem isso, três linhas de "—" seriam paisagem. Custo por
// seguidor null quando o delta é <= 0 (perdeu seguidor, ou zero): dividir
// gasto por um delta negativo daria um "custo" sem sentido.
//
// `gastoSeguidoresHoje`/`visitasPerfilHoje` são os mesmos dois números, só
// que do DIA inteiro (pedido do dono, 12/09/2026, "MELHORIA": renomeia
// "Total do dia"/"Total da conta" pra "Total seguidores do dia"/"Total
// seguidores da conta" — porque agora tem MAIS de um "total do dia" na
// mensagem — e acrescenta "Custo de seguidores dia", "Total visitantes dia"
// e "Custo visitantes dia", na ORDEM exata que ele desenhou). Mesma regra de
// custo do período: null sem gasto do dia, ou sem o denominador (nunca
// divide por zero nem por delta negativo). Cada parte ganha um cabeçalho
// próprio ("INTERVALO"/"TOTAL", mesmo pedido) — só aparece se a parte tiver
// alguma linha.
export function montarMensagemSeguidores(
  dia, hora, seguidoresDelta, visitasPerfilDelta, seguidoresTotal, seguidoresHoje, gastoSeguidores,
  gastoSeguidoresHoje, visitasPerfilHoje,
) {
  if (seguidoresTotal === null && seguidoresHoje === null && visitasPerfilDelta === null) return null;

  const [ano, mes, d] = dia.split('-');
  const horaStr = String(hora).padStart(2, '0');
  const cabecalho = `📊 Seguidores e visitas ao perfil — ${horaStr}h, ${d}/${mes}`;
  const comSinal = (n) => `${n > 0 ? '+' : ''}${n}`;

  const linhaNoPeriodo = seguidoresDelta !== null
    ? `Novos seguidores no período: ${comSinal(seguidoresDelta)}`
    : null;
  // Visita é atividade (nunca negativa), não estoque como seguidor — sem
  // sinal de "+" na frente.
  const linhaVisitasPerfil = visitasPerfilDelta !== null
    ? `Visitas ao perfil da conta: ${visitasPerfilDelta}`
    : null;

  const teveGasto = gastoSeguidores > 0;
  const linhaInvestimento = teveGasto ? `Investimento: ${formatarReais(gastoSeguidores)}` : null;
  const custoPorVisita = teveGasto ? custoPorLead(gastoSeguidores, visitasPerfilDelta) : null;
  const linhaCustoPorVisita = custoPorVisita !== null ? `Custo por visita ao perfil: ${formatarReais(custoPorVisita)}` : null;
  const custoPorSeguidor = teveGasto && seguidoresDelta > 0 ? custoPorLead(gastoSeguidores, seguidoresDelta) : null;
  const linhaCustoPorSeguidor = custoPorSeguidor !== null ? `Custo por seguidor: ${formatarReais(custoPorSeguidor)}` : null;

  const linhaSeguidoresDoDia = seguidoresHoje !== null
    ? `Total seguidores do dia: ${comSinal(seguidoresHoje)}`
    : null;
  const teveGastoHoje = gastoSeguidoresHoje > 0;
  const linhaInvestimentoDia = teveGastoHoje ? `Investimento no dia: ${formatarReais(gastoSeguidoresHoje)}` : null;
  const custoSeguidorDia = teveGastoHoje && seguidoresHoje > 0 ? custoPorLead(gastoSeguidoresHoje, seguidoresHoje) : null;
  const linhaCustoSeguidoresDia = custoSeguidorDia !== null ? `Custo de seguidores dia: ${formatarReais(custoSeguidorDia)}` : null;
  const linhaTotalConta = seguidoresTotal !== null
    ? `Total seguidores da conta: ${seguidoresTotal.toLocaleString('pt-BR')}`
    : null;
  const linhaVisitantesDia = visitasPerfilHoje != null ? `Total visitantes dia: ${visitasPerfilHoje}` : null;
  const custoVisitaDia = teveGastoHoje && visitasPerfilHoje > 0 ? custoPorLead(gastoSeguidoresHoje, visitasPerfilHoje) : null;
  const linhaCustoVisitantesDia = custoVisitaDia !== null ? `Custo visitantes dia: ${formatarReais(custoVisitaDia)}` : null;

  // Investimento por último (pedido do dono, 12/09/2026): primeiro os
  // indicadores por unidade (custo por X), o valor bruto vem depois.
  const doPeriodo = [linhaNoPeriodo, linhaVisitasPerfil, linhaCustoPorVisita, linhaCustoPorSeguidor, linhaInvestimento]
    .filter((l) => l !== null);
  const totais = [
    linhaTotalConta, linhaSeguidoresDoDia, linhaVisitantesDia,
    linhaCustoSeguidoresDia, linhaCustoVisitantesDia, linhaInvestimentoDia,
  ].filter((l) => l !== null);

  const corpo = [cabecalho, ''];
  if (doPeriodo.length) corpo.push('INTERVALO', ...doPeriodo);
  if (doPeriodo.length && totais.length) corpo.push('');
  if (totais.length) corpo.push('TOTAL', ...totais);

  return corpo.join('\n');
}

function diaEHoraSP(isoTimestamp) {
  const d = new Date(isoTimestamp);
  const dia = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const hora = Number(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
  return { dia, hora };
}

// Seguidores são da CONTA, nunca da campanha — a Meta não atribui "novo
// seguidor" a uma campanha específica pra esse tipo de anúncio (conferido
// direto na Graph API em 12/09/2026: nenhuma campanha [+ SEGUIDORES] tinha
// ação de "follow"). Por isso este número vem de `followers_leituras`
// (leitura da conta inteira, já existia, agora alimentada de hora em hora),
// não de `campaign_insights_hora`.
//
// Delta sempre contra a ÚLTIMA leitura anterior, atravessando a virada do
// dia — seguidor não reseta à meia-noite como o gasto reseta. A primeira
// leitura da série INTEIRA não tem "anterior": vem com delta `null` (não
// `0` — `0` diria "não mudou", e a verdade é "ainda não sei").
//
// Duas leituras no mesmo bucket dia+hora (o coletor de 4x/dia e o de hora
// em hora podem cair na mesma hora) — fica só a MAIS RECENTE das duas.
export function deltaDeSeguidoresPorHora(leituras) {
  const porBucket = new Map();
  for (const l of leituras) {
    const { dia, hora } = diaEHoraSP(l.lido_em);
    const chave = `${dia}|${hora}`;
    const atual = porBucket.get(chave);
    if (!atual || new Date(l.lido_em) > new Date(atual.lidoEm)) {
      porBucket.set(chave, { dia, hora, followersCount: l.followers_count, lidoEm: l.lido_em });
    }
  }
  const ordenado = [...porBucket.values()].sort((a, b) => new Date(a.lidoEm) - new Date(b.lidoEm));
  let anterior = null;
  return ordenado.map((b) => {
    const seguidoresDelta = anterior === null ? null : b.followersCount - anterior.followersCount;
    anterior = b;
    // O TOTAL vem sempre que existe leitura nesse bucket — inclusive na
    // primeira da série, que não tem delta mas tem o número absoluto (pedido
    // do dono, 12/09/2026: "coloca o total de seguidores também").
    return { dia: b.dia, hora: b.hora, seguidoresDelta, seguidoresTotal: b.followersCount };
  });
}

// Acha o delta de uma hora específica dentro do que `deltaDeSeguidoresPorHora`
// devolveu. `null` tanto quando não há leitura pra essa hora quanto quando é
// a primeira leitura da série — a tela mostra os dois casos como "sem dado".
export function seguidoresNaHora(deltas, dia, hora) {
  const achado = deltas.find((d) => d.dia === dia && d.hora === hora);
  return achado ? achado.seguidoresDelta : null;
}

// O TOTAL absoluto (não o delta) de uma hora específica. `null` só quando não
// há leitura pra essa hora — ao contrário do delta, a primeira leitura da
// série TEM total (é o próprio número lido), só não tem "quanto mudou".
export function seguidoresTotalNaHora(deltas, dia, hora) {
  const achado = deltas.find((d) => d.dia === dia && d.hora === hora);
  return achado ? achado.seguidoresTotal : null;
}

// Soma os deltas de TODAS as horas do dia até agora — "quanto ganhou (ou
// perdeu) hoje", não só nessa hora isolada (pedido do dono, 12/09/2026).
// Bucket sem delta (a primeiríssima leitura da série inteira, se calhar de
// cair nesse dia) entra como 0 na soma — é a única leitura sem "anterior"
// pra comparar, tratar como null quebraria a soma do dia inteiro por causa
// de uma leitura só. `null` quando o dia não tem NENHUMA leitura ainda.
export function seguidoresNoDia(deltas, dia) {
  const doDia = deltas.filter((d) => d.dia === dia);
  if (!doDia.length) return null;
  return doDia.reduce((soma, d) => soma + (d.seguidoresDelta ?? 0), 0);
}
