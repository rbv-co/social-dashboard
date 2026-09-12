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
    const nome = nomesPorCampanha[l.campaign_id] || l.campaign_id;
    porHora.get(l.hora).push({
      campaignId: l.campaign_id,
      nome,
      tipo: tipoDaCampanha(nome),
      gastoHora,
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

// As quatro seções da tela (Resultados / Seguidores / Outras / Mensagem WPP)
// recortam a MESMA lista de campanhas de `agruparPorDiaEHora` — nunca listas
// discordando. `[+ SEGUIDORES]` sai de Resultados/Outras e ganha seção
// própria (pedido do dono, 12/09/2026): não é campanha de lead, misturar as
// duas só confundia quem lia.
export function comResultado(campanhas) {
  return campanhas.filter((c) => c.tipo !== 'seguidores' && c.conversasHora > 0);
}
export function semResultado(campanhas) {
  return campanhas.filter((c) => c.tipo !== 'seguidores' && c.conversasHora === 0);
}

// Texto pronto pra copiar (a tela ainda tem o botão) — e é a MESMA regra que
// `enviar-relatorio-hora` usa pra mandar automático no grupo de WhatsApp via
// Z-API, de hora em hora (ligado em 12/09/2026; ver cópia comentada em
// supabase/functions/_shared/relatorio-por-hora.js). Só entram campanhas
// [CAMPANHA WPP]; `null` quando não há nenhuma nessa hora (não força
// mensagem vazia).
export function montarMensagemWpp(dia, hora, campanhas) {
  const wpp = campanhas.filter((c) => c.tipo === 'wpp');
  if (!wpp.length) return null;

  const [ano, mes, d] = dia.split('-');
  const horaStr = String(hora).padStart(2, '0');
  const linhas = wpp.map((c) => `${c.nome} — ${c.conversasHora} lead${c.conversasHora === 1 ? '' : 's'} · ${formatarReais(c.gastoHora)}`);

  const totalLeads = wpp.reduce((s, c) => s + c.conversasHora, 0);
  const totalGasto = wpp.reduce((s, c) => s + c.gastoHora, 0);
  const custoMedio = custoPorLead(totalGasto, totalLeads);

  const cabecalho = `📊 Leads recebidos — ${horaStr}h, ${d}/${mes}`;
  const consolidado = `Total: ${totalLeads} lead${totalLeads === 1 ? '' : 's'} · ${formatarReais(totalGasto)} investidos`
    + (custoMedio !== null ? ` · ${formatarReais(custoMedio)}/lead` : '');

  return [cabecalho, '', ...linhas, '', consolidado].join('\n');
}

// Texto pronto pra copiar (mesmo espírito de montarMensagemWpp), mas só com
// os números DA CONTA — total de seguidores, delta de seguidores, e visita
// ao perfil. Nunca teve (cliques, 12/09/2026) e depois teve e foi tirado de
// novo no mesmo dia (pedido do dono: "tira o link_click, apenas visitas no
// perfil e seguidores") — não existe por campanha pra nenhum dos dois (Meta
// não atribui nem seguidor nem visita a uma campanha específica), então não
// tem por que fingir granularidade que não existe.
//
// `seguidoresTotal` decide se a linha de seguidor aparece (vem de
// `seguidoresTotalNaHora`) — é o mais permissivo dos dois: a primeira
// leitura da série tem total mas não tem delta (pedido do dono, 12/09/2026:
// "coloca o total de seguidores também, fica mais completo"). `null` em cada
// valor = sem leitura pra essa hora, não entra na mensagem. `null` geral =
// nem seguidor (total) nem visita ao perfil tinham o que dizer.
export function montarMensagemSeguidores(dia, hora, seguidoresDelta, visitasPerfilDelta, seguidoresTotal) {
  if (seguidoresTotal === null && visitasPerfilDelta === null) return null;

  const [ano, mes, d] = dia.split('-');
  const horaStr = String(hora).padStart(2, '0');
  const cabecalho = `📊 Seguidores e visitas ao perfil — ${horaStr}h, ${d}/${mes}`;
  const linhaSeguidores = seguidoresTotal !== null
    ? `Seguidores da conta: ${seguidoresTotal.toLocaleString('pt-BR')}`
      + (seguidoresDelta !== null ? ` (${seguidoresDelta > 0 ? '+' : ''}${seguidoresDelta} nessa hora)` : '')
    : null;
  // Visita é atividade (nunca negativa), não estoque como seguidor — sem
  // sinal de "+" na frente.
  const linhaVisitasPerfil = visitasPerfilDelta !== null
    ? `Visitas ao perfil da conta: ${visitasPerfilDelta}`
    : null;

  return [cabecalho, '', linhaSeguidores, linhaVisitasPerfil].filter((l) => l !== null).join('\n');
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

// Visitas ao perfil da CONTA (12/09/2026, "vai atras desse dado") — mesma
// limitação de seguidores: a Meta não atribui por campanha, só dá o total da
// conta. Diferente de seguidor (estoque, delta calculado aqui contra a
// última leitura), visita é atividade — o robô já grava o delta calculado
// (perfil_visitas_hora.visitas_hora, reseta por dia, mesma regra de
// gasto_hora), então aqui é só achar a linha certa. `null` = sem leitura
// pra essa hora (nunca mostra 0 como se fosse "não teve visita").
export function visitasPerfilNaHora(linhas, dia, hora) {
  const achada = linhas.find((l) => l.dia === dia && l.hora === hora);
  return achada ? achada.visitas_hora : null;
}
