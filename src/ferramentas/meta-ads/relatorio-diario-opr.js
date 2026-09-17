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

// Números prontos do relatório OPR diário. `seguidoresDoDia` pode ser `null`
// (nenhuma leitura de seguidor nesse dia ainda); `visitasPerfilDoDia` nunca é
// null (a soma do dia é 0 quando não há leitura).
//
// Regra de custo (mesma do resto do projeto): nunca divide por contagem <= 0
// nem por investimento <= 0 — cai pra `null`, nunca "R$ 0,00" inventado.
// Diferente disso, TAXA/PERCENTUAL (conversão) pode ser 0% de verdade — não é
// mentira, é fato quando a base é positiva e o resultado é zero.
export function montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia) {
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

  const leadsCount = somar(wpp, 'conversas');
  const leads = {
    leads: leadsCount,
    investimento: investimentoWpp,
    custoPorLead: investimentoWpp > 0 && leadsCount > 0
      ? custoPorLead(investimentoWpp, leadsCount) : null,
  };

  const header = {
    investimentoTotal: investimentoSeguidores + investimentoEngajamento + investimentoWpp,
    novosSeguidores: seguidoresDoDia,
    engajamentos: somar(engajamento, 'postEngagement'),
    leadsGerados: leadsCount,
  };

  return { header, growth, engagement, leads };
}
