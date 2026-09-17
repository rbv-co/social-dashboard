// src/ferramentas/meta-ads/relatorio-diario-opr.js
// Agregação diária pro relatório OPR (Paid Media Performance) — ver spec em
// docs/superpowers/specs/2026-09-17-relatorio-opr-diario-design.md.
//
// Nunca a mensagem/HTML pronta (isso é responsabilidade do template em
// coletor/lib/template-opr.mjs) — só os NÚMEROS, testáveis por igualdade.
import { tipoDaCampanha, custoPorLead } from './relatorio-por-hora.js';

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
//   AINDA NÃO — achado um buraco real: a leitura de hora em hora
//   (perfil_visitas_hora, usada pela TELA) sempre perde os últimos ~55min
//   do dia (~280-290 visitas/dia, batido em 15 e 16/09). O robô do
//   fechamento (coletor/gerar-opr-diario.mjs) já foi corrigido — pergunta
//   pro Meta o dia fechado direto, sem esse buraco — mas a TELA (período
//   customizável, roda no navegador) ainda soma a mesma leitura horária:
//   ligar este campo agora faria a tela mostrar um número sistematicamente
//   menor que o do PNG pro mesmo dia. Fica de fora até decidir sobre uma
//   ponte server-side pra tela também.
const CAMPOS_CONFIRMADOS = new Set([
  'header.novosSeguidores',
  'growth.seguidores',
  'header.investimentoTotal',
  'header.engajamentos',
  'header.leadsGerados',
  'growth.investimento',
  'growth.custoPorSeguidor',
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
export function calcularDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia) {
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

  const header = {
    investimentoTotal: investimentoSeguidores + investimentoEngajamento + investimentoWpp,
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
  };

  return { header, growth, engagement, sales, mix };
}

// Ponto que o dashboard e o robô do WhatsApp realmente chamam — mesmo
// cálculo de `calcularDadosOpr`, com o rollout de campo por campo aplicado
// em cima (ver `CAMPOS_CONFIRMADOS` acima).
export function montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia) {
  const dados = calcularDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia);
  return {
    header: aplicarRollout('header', dados.header),
    growth: aplicarRollout('growth', dados.growth),
    engagement: aplicarRollout('engagement', dados.engagement),
    sales: aplicarRollout('sales', dados.sales),
    mix: aplicarRollout('mix', dados.mix),
  };
}
