// src/ferramentas/meta-ads/relatorio-diario-opr.js
// Agregação diária pro relatório OPR (Paid Media Performance) — ver spec em
// docs/superpowers/specs/2026-09-17-relatorio-opr-diario-design.md.
//
// Nunca a mensagem/HTML pronta (isso é responsabilidade do template em
// coletor/lib/template-opr.mjs) — só os NÚMEROS, testáveis por igualdade.
import { tipoDaCampanha, custoPorLead, classificarLinkAnuncio } from './relatorio-por-hora.js';

// Agrupa linhas de campaign_insights (period_days=1, já filtradas pro dia e
// conta certos) em campanhas classificadas — mesmo espírito de
// agruparPorDiaEHora, mas pro insight DIÁRIO (spend/likes/comments/shares/
// saves/conversas/post_engagement), não por hora.
export function agruparCampanhasDoDia(linhas, nomesPorCampanha = {}) {
  return linhas.map((l) => {
    const nome = nomesPorCampanha[l.campaign_id] || l.campaign_id;
    return {
      campaignId: l.campaign_id,
      nome,
      tipo: tipoDaCampanha(nome),
      gasto: Number(l.spend) || 0,
      likes: Number(l.likes) || 0,
      comments: Number(l.comments) || 0,
      shares: Number(l.shares) || 0,
      saves: Number(l.saves) || 0,
      conversas: Number(l.conversas) || 0,
      postEngagement: Number(l.post_engagement) || 0,
    };
  });
}

// Soma gasto/clique de um anúncio ao longo de TODAS as horas do dia
// (linhas = ad_insights_hora do dia inteiro, uma por hora) e classifica
// pelo link — pedido do dono (18/09/2026). Mesmo espírito de
// agruparCampanhasDoDia, um nível abaixo (anúncio, não campanha).
export function agruparAnunciosDoDia(linhas, linksPorAnuncio = {}) {
  const porAnuncio = new Map();
  for (const l of linhas) {
    const destinoLink = linksPorAnuncio[l.ad_id] ?? null;
    const atual = porAnuncio.get(l.ad_id) ?? {
      adId: l.ad_id, gasto: 0, cliques: 0, categoria: classificarLinkAnuncio(destinoLink),
    };
    atual.gasto += Number(l.gasto_hora) || 0;
    atual.cliques += Number(l.cliques_hora) || 0;
    porAnuncio.set(l.ad_id, atual);
  }
  return [...porAnuncio.values()];
}

function porTipo(campanhas, tipo) {
  return campanhas.filter((c) => c.tipo === tipo);
}
function somar(campanhas, campo) {
  return campanhas.reduce((s, c) => s + c[campo], 0);
}

// Rollout controlado do OPR (pedido do dono, 17/09/2026: "esvazia esse
// relatório por completo, deixa tudo —, vamos ir batendo um por um e
// preenchendo"). Só o que está neste Set sai com o valor calculado; todo o
// resto sai `null` ("—"), mesmo já calculado corretamente logo abaixo — a
// conta fica pronta, só falta o dono confirmar o campo pra "ligar" ele aqui.
// Chave = "secao.campo" (ex.: "header.investimentoTotal").
//
// Confirmados até agora:
// - header.novosSeguidores / growth.seguidores (17/09/2026) — batido contra
//   a Graph API (GET /{ig-id}?fields=followers_count) e as leituras em
//   followers_leituras: ontem (16/09) foi de 18622 (última leitura de
//   15/09, 02:59 UTC) pra 18792 (última leitura de 16/09, 02:59 UTC) = 170,
//   igual ao que a tela já mostrava.
// - header.investimentoTotal / header.engajamentos / header.leadsGerados
//   (17/09/2026) — batido contra a Graph API (act_.../insights,
//   level=campaign, classificado com o mesmo tipoDaCampanha do projeto) E
//   contra campaign_insights do banco, ambos rodando o pipeline real
//   (agruparCampanhasDoDia + calcularDadosOpr): ontem (16/09) fechou em
//   R$857,09 de investimento (seguidores+engajamento+wpp, nunca a
//   campanha "outro"), 1008 engajamentos, 1 lead — igual ao que a tela já
//   mostrava.
// - growth.investimento / growth.custoPorSeguidor (17/09/2026) — mesma
//   fonte já validada acima (spend das campanhas seguidores, R$494,11) —
//   não dependem de Visitas ao Perfil, então confirmados já.
// - growth.visitasPerfil / growth.custoPorVisita / growth.conversaoVisitaSeguidor
//   (17/09/2026) — achado um buraco real primeiro: a soma por hora
//   (perfil_visitas_hora) sempre perde os últimos ~55min do dia (~280-290
//   visitas/dia, batido em 15 e 16/09 contra o profile_views oficial da
//   Meta). Corrigido com cache: o fechamento grava o dia certo em
//   visitas_perfil_dia (Meta, dia fechado, sem esse buraco) e a tela
//   passou a ler esse cache pra qualquer período
//   (visitasPerfilNoPeriodoComCache), só caindo pra soma-por-hora nos
//   dias ainda não fechados. Backfill de 30 dias rodado. 16/09 bateu:
//   1642 visitas, custo por visita R$0,30, conversão 10,4%.
// - Painel Engagement inteiro (17/09/2026) — batido contra a Graph API
//   (act_.../insights, classificado com tipoDaCampanha) E contra
//   campaign_insights do banco: ontem (16/09) foram 289 curtidas, 1
//   comentário, 2 compartilhamentos, 1 salvamento, 293 interações no
//   total, R$362,98 de investimento — custos batendo nas duas fontes.
// - Media Mix (17/09/2026, pedido do dono: "preenche o media mix, tá
//   fácil") — não é dado novo, é aritmética em cima de investimento já
//   confirmado (growth/engagement/wpp, todos batidos acima). Campanhas
//   WPP estão desativadas hoje (gasto R$0,00, confirmado ao listar as 33
//   campanhas do dia), então mix.leads = 0% de verdade, não null.
// - sales.leads / sales.investimento / sales.custoPorLead (18/09/2026,
//   achado ao revisar a imagem: a seção "03 · Leads & Sales" nunca tinha
//   sido ligada, mesmo o dado já estando validado — `sales.leads` é o
//   MESMO `leadsCount` de `header.leadsGerados` (confirmado em 17/09) e
//   `sales.investimento` é a mesma fatia wpp que já compõe
//   `header.investimentoTotal` (também confirmado). Não é dado novo, só
//   nunca tinha sido propagado pra esta seção. `leadsQuentes`/`vendas`/
//   conversões continuam `null` de propósito — dependem do Chatwoot,
//   integração futura, fora de escopo.
// - salesLink / leadsLink (18/09/2026) — confirmado com backfill real: as
//   campanhas AXIOM de 17/09 (sem dado ainda em ad_insights_hora, robô
//   novo) foram buscadas direto na Meta (act_.../insights, level=ad,
//   time_range do dia) e gravadas; header.investimentoTotal foi de
//   R$928,51 pra R$1.363,38 — bateu exatamente com os R$434,76 das duas
//   campanhas AXIOM já confirmadas na lista de campanhas de 17/09 (spend
//   R$325,98 + R$108,78). mix.salesLink/mix.leadsLink também confirmados,
//   mesma aritmética já validada do resto do mix.
const CAMPOS_CONFIRMADOS = new Set([
  'header.novosSeguidores',
  'growth.seguidores',
  'header.investimentoTotal',
  'header.engajamentos',
  'growth.visitasPerfil',
  'growth.custoPorVisita',
  'growth.conversaoVisitaSeguidor',
  'header.leadsGerados',
  'growth.investimento',
  'growth.custoPorSeguidor',
  'engagement.investimento',
  'engagement.curtidas',
  'engagement.comentarios',
  'engagement.compartilhamentos',
  'engagement.salvamentos',
  'engagement.custoPorCurtida',
  'engagement.custoPorComentario',
  'engagement.custoPorCompartilhamento',
  'engagement.custoPorSalvamento',
  'engagement.totalInteracoes',
  'engagement.custoMedioPorEngajamento',
  'mix.growth',
  'mix.engagement',
  'mix.leads',
  'mix.salesLink',
  'mix.leadsLink',
  'sales.leads',
  'sales.investimento',
  'sales.custoPorLead',
  'salesLink.investimento',
  'salesLink.cliques',
  'salesLink.custoPorClique',
  'leadsLink.investimento',
  'leadsLink.cliques',
  'leadsLink.custoPorClique',
]);

function ligado(secao, campo, valor) {
  return CAMPOS_CONFIRMADOS.has(`${secao}.${campo}`) ? valor : null;
}
function aplicarRollout(secao, objeto) {
  return Object.fromEntries(Object.entries(objeto).map(([campo, valor]) => [campo, ligado(secao, campo, valor)]));
}

// Números prontos do relatório OPR diário — o CÁLCULO de verdade, sem
// rollout (exportada à parte pra testar a conta em si, independente de quais
// campos já estão liberados pro dono ver). `seguidoresDoDia` pode ser `null`
// (nenhuma leitura de seguidor nesse dia ainda); `visitasPerfilDoDia` nunca é
// null (a soma do dia é 0 quando não há leitura).
//
// Regra de custo (mesma do resto do projeto): nunca divide por contagem <= 0
// nem por investimento <= 0 — cai pra `null`, nunca "R$ 0,00" inventado.
// Diferente disso, TAXA/PERCENTUAL (conversão) pode ser 0% de verdade — não é
// mentira, é fato quando a base é positiva e o resultado é zero.
export function calcularDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia, anunciosDoDia = []) {
  const seguidores = porTipo(campanhasDoDia, 'seguidores');
  const engajamento = porTipo(campanhasDoDia, 'engajamento');
  const wpp = porTipo(campanhasDoDia, 'wpp');

  const investimentoSeguidores = somar(seguidores, 'gasto');
  const investimentoEngajamento = somar(engajamento, 'gasto');
  const investimentoWpp = somar(wpp, 'gasto');

  const growth = {
    investimento: investimentoSeguidores,
    seguidores: seguidoresDoDia,
    visitasPerfil: visitasPerfilDoDia,
    custoPorSeguidor: investimentoSeguidores > 0 && seguidoresDoDia > 0
      ? custoPorLead(investimentoSeguidores, seguidoresDoDia) : null,
    custoPorVisita: investimentoSeguidores > 0 && visitasPerfilDoDia > 0
      ? custoPorLead(investimentoSeguidores, visitasPerfilDoDia) : null,
    conversaoVisitaSeguidor: visitasPerfilDoDia > 0 && seguidoresDoDia !== null
      ? (seguidoresDoDia / visitasPerfilDoDia) * 100 : null,
  };

  const curtidas = somar(engajamento, 'likes');
  const comentarios = somar(engajamento, 'comments');
  const compartilhamentos = somar(engajamento, 'shares');
  const salvamentos = somar(engajamento, 'saves');
  const totalInteracoes = curtidas + comentarios + compartilhamentos + salvamentos;
  const engagement = {
    investimento: investimentoEngajamento,
    curtidas, comentarios, compartilhamentos, salvamentos,
    custoPorCurtida: investimentoEngajamento > 0 && curtidas > 0
      ? custoPorLead(investimentoEngajamento, curtidas) : null,
    custoPorComentario: investimentoEngajamento > 0 && comentarios > 0
      ? custoPorLead(investimentoEngajamento, comentarios) : null,
    custoPorCompartilhamento: investimentoEngajamento > 0 && compartilhamentos > 0
      ? custoPorLead(investimentoEngajamento, compartilhamentos) : null,
    custoPorSalvamento: investimentoEngajamento > 0 && salvamentos > 0
      ? custoPorLead(investimentoEngajamento, salvamentos) : null,
    totalInteracoes,
    custoMedioPorEngajamento: investimentoEngajamento > 0 && totalInteracoes > 0
      ? custoPorLead(investimentoEngajamento, totalInteracoes) : null,
  };

  // Leads Quentes/Vendas (e tudo que depende deles) ainda não têm fonte —
  // vêm do Chatwoot, integração futura (pedido do dono, 17/09/2026: "mostra
  // só Leads, resto com —"). `null` explícito, nunca 0 nem inventado.
  const leadsCount = somar(wpp, 'conversas');
  const sales = {
    leads: leadsCount,
    leadsQuentes: null,
    vendas: null,
    investimento: investimentoWpp,
    custoPorLead: investimentoWpp > 0 && leadsCount > 0
      ? custoPorLead(investimentoWpp, leadsCount) : null,
    custoPorLeadQuente: null,
    custoPorVenda: null,
    conversaoLeadQuente: null,
    conversaoQuenteVenda: null,
  };

  // Sales/Leads por LINK do anúncio (18/09/2026) — eixo totalmente
  // separado de `sales` acima: `sales.leads` é conversa WPP, isto aqui é
  // anúncio "outro" classificado pelo destino do link. NUNCA somar os
  // dois eixos entre si (pedido do dono: "campanhas wpp desconsidera").
  const salesAnuncios = anunciosDoDia.filter((a) => a.categoria === 'sales');
  const leadsLinkAnuncios = anunciosDoDia.filter((a) => a.categoria === 'leads');
  const investimentoSalesLink = somar(salesAnuncios, 'gasto');
  const cliquesSalesLink = somar(salesAnuncios, 'cliques');
  const investimentoLeadsLink = somar(leadsLinkAnuncios, 'gasto');
  const cliquesLeadsLink = somar(leadsLinkAnuncios, 'cliques');

  const salesLink = {
    investimento: investimentoSalesLink,
    cliques: cliquesSalesLink,
    custoPorClique: investimentoSalesLink > 0 && cliquesSalesLink > 0
      ? custoPorLead(investimentoSalesLink, cliquesSalesLink) : null,
  };
  const leadsLink = {
    investimento: investimentoLeadsLink,
    cliques: cliquesLeadsLink,
    custoPorClique: investimentoLeadsLink > 0 && cliquesLeadsLink > 0
      ? custoPorLead(investimentoLeadsLink, cliquesLeadsLink) : null,
  };

  // investimentoTotal ENTRA salesLink+leadsLink (correção do dono,
  // 18/09/2026, revisando a imagem real: "isso deve contar em investimento
  // total também") — ao contrário da campanha "outro" genérica (que
  // continua fora, porque tem vaga/DRE/atacado misturado), salesLink e
  // leadsLink já são uma fatia CLASSIFICADA de mídia paga de verdade (pelo
  // link de destino do anúncio), então contam no total igual
  // growth/engagement/leads contam. Decisão anterior (excluir) revertida.
  const header = {
    investimentoTotal: investimentoSeguidores + investimentoEngajamento + investimentoWpp
      + investimentoSalesLink + investimentoLeadsLink,
    novosSeguidores: seguidoresDoDia,
    engajamentos: somar(engajamento, 'postEngagement'),
    leadsGerados: leadsCount,
  };

  // Media Mix: % do investimento total em cada categoria — definição
  // provisória (pedido do dono, 17/09/2026: "deixa lá, mas vou confirmar
  // ainda" — o gerente de marketing ainda vai validar). `null` quando não
  // houve investimento nenhum no dia (0/0 não é 0%, é "sem dado").
  const investimentoTotal = header.investimentoTotal;
  const pctDoTotal = (valor) => (investimentoTotal > 0 ? (valor / investimentoTotal) * 100 : null);
  const mix = {
    growth: pctDoTotal(investimentoSeguidores),
    engagement: pctDoTotal(investimentoEngajamento),
    leads: pctDoTotal(investimentoWpp),
    salesLink: pctDoTotal(investimentoSalesLink),
    leadsLink: pctDoTotal(investimentoLeadsLink),
  };

  return { header, growth, engagement, sales, salesLink, leadsLink, mix };
}

// Ponto que o dashboard e o robô do WhatsApp realmente chamam — mesmo
// cálculo de `calcularDadosOpr`, com o rollout de campo por campo aplicado
// em cima (ver `CAMPOS_CONFIRMADOS` acima).
export function montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia, anunciosDoDia = []) {
  const dados = calcularDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia, anunciosDoDia);
  return {
    header: aplicarRollout('header', dados.header),
    growth: aplicarRollout('growth', dados.growth),
    engagement: aplicarRollout('engagement', dados.engagement),
    sales: aplicarRollout('sales', dados.sales),
    salesLink: aplicarRollout('salesLink', dados.salesLink),
    leadsLink: aplicarRollout('leadsLink', dados.leadsLink),
    mix: aplicarRollout('mix', dados.mix),
  };
}
