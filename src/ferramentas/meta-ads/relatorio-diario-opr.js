// src/ferramentas/meta-ads/relatorio-diario-opr.js
// Agregação diária pro relatório OPR (Paid Media Performance) — ver spec em
// docs/superpowers/specs/2026-09-17-relatorio-opr-diario-design.md.
//
// Nunca a mensagem/HTML pronta (isso é responsabilidade do template em
// coletor/lib/template-opr.mjs) — só os NÚMEROS, testáveis por igualdade.
import { custoPorLead, classificarLinkAnuncio } from './relatorio-por-hora.js';

// Palavras que tiram uma campanha do relatório INTEIRO, antes de qualquer
// classificação — pedido do dono (21/09/2026): vaga de emprego, RH e atacado
// usam os MESMOS objectives (Leads/Vendas/Engajamento) que campanha de
// produto de verdade, e inflariam os números se entrassem. Substring,
// case-insensitive — `startsWith` não serve aqui porque a palavra aparece em
// qualquer posição do nome ("[DOM PEDRO] VAGA GERENTE | WPP RH").
const PALAVRAS_RUIDO = ['VAGA', 'ATACADO', 'RH', 'DRE'];
export function ehRuidoDeCampanha(nome) {
  const maiusculo = nome.toUpperCase();
  return PALAVRAS_RUIDO.some((p) => maiusculo.includes(p));
}

// Classifica a campanha pelo OBJECTIVE da Meta (não mais pelo nome — pedido
// do dono, 21/09/2026: o nome é escolhido por quem cria a campanha, o
// objective é o que a própria Meta usa pra otimizar entrega, e é a fonte que
// já vem com a campanha em `campaigns.objective`, sem depender de convenção
// de prefixo). Qualquer objective fora dos 4 mapeados (ex. OUTCOME_AWARENESS,
// LINK_CLICKS legado) cai em "outro" — mesmo espírito do "outro" de antes:
// fica fora do relatório, sem inventar categoria pra ele.
const OBJECTIVE_PARA_TIPO = {
  OUTCOME_TRAFFIC: 'trafego',
  OUTCOME_ENGAGEMENT: 'engajamento',
  OUTCOME_SALES: 'vendas',
  OUTCOME_LEADS: 'leads',
};
export function tipoPorObjective(objective) {
  return OBJECTIVE_PARA_TIPO[objective] ?? 'outro';
}

// Agrupa linhas de campaign_insights (period_days=1, já filtradas pro dia e
// conta certos) em campanhas classificadas por objective — mesmo espírito de
// agruparPorDiaEHora, mas pro insight DIÁRIO (spend/likes/comments/shares/
// saves/conversas/cadastros/compras/visitas/post_engagement), não por hora.
// Campanha de ruído (vaga/atacado/rh/dre) é excluída aqui, antes de virar
// dado pra qualquer seção — nunca aparece nem como "outro".
export function agruparCampanhasDoDia(linhas, nomesPorCampanha = {}, objectivesPorCampanha = {}) {
  return linhas
    .map((l) => {
      const nome = nomesPorCampanha[l.campaign_id] || l.campaign_id;
      return {
        campaignId: l.campaign_id,
        nome,
        tipo: tipoPorObjective(objectivesPorCampanha[l.campaign_id]),
        gasto: Number(l.spend) || 0,
        likes: Number(l.likes) || 0,
        comments: Number(l.comments) || 0,
        shares: Number(l.shares) || 0,
        saves: Number(l.saves) || 0,
        conversas: Number(l.conversas) || 0,
        cadastros: Number(l.cadastros) || 0,
        compras: Number(l.compras) || 0,
        visitas: Number(l.visitas) || 0,
        postEngagement: Number(l.post_engagement) || 0,
      };
    })
    .filter((c) => !ehRuidoDeCampanha(c.nome));
}

// Soma gasto/clique de um anúncio ao longo de TODAS as horas do dia
// (linhas = ad_insights_hora do dia inteiro, uma por hora) e classifica
// pelo link — pedido do dono (18/09/2026). Eixo TOTALMENTE separado da
// classificação por objective acima (nunca mudou, nunca precisou mudar: já
// era por destino de anúncio, não por nome/objective de campanha).
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

// Números prontos do relatório OPR — imagem do WhatsApp (coletor/gerar-opr-diario.mjs)
// e tela (tela-de-relatorio-opr.vue) leem exatamente o mesmo formato, layout
// 2×2 aprovado pelo dono em 21/09/2026 (Tráfego/Engajamento/Vendas/Leads).
//
// Regra de custo (mesma do resto do projeto): nunca divide por contagem <= 0
// nem por investimento <= 0 — cai pra `null`, nunca "R$ 0,00" inventado.
// `seguidoresDoDia` pode ser `null` (nenhuma leitura de seguidor nesse dia
// ainda) — é dado de CONTA, nunca dependeu de campanha nem de classificação.
export function calcularDadosOpr(campanhasDoDia, seguidoresDoDia, anunciosDoDia = []) {
  const trafegoCampanhas = porTipo(campanhasDoDia, 'trafego');
  const engajamentoCampanhas = porTipo(campanhasDoDia, 'engajamento');
  const vendasCampanhas = porTipo(campanhasDoDia, 'vendas');
  const leadsCampanhas = porTipo(campanhasDoDia, 'leads');

  const investimentoTrafego = somar(trafegoCampanhas, 'gasto');
  const investimentoEngajamento = somar(engajamentoCampanhas, 'gasto');
  const investimentoVendas = somar(vendasCampanhas, 'gasto');
  const investimentoLeads = somar(leadsCampanhas, 'gasto');

  const visitas = somar(trafegoCampanhas, 'visitas');
  const trafego = {
    investimento: investimentoTrafego,
    visitas,
    custoPorVisita: investimentoTrafego > 0 && visitas > 0 ? custoPorLead(investimentoTrafego, visitas) : null,
  };

  const curtidas = somar(engajamentoCampanhas, 'likes');
  const comentarios = somar(engajamentoCampanhas, 'comments');
  const compartilhamentos = somar(engajamentoCampanhas, 'shares');
  const salvamentos = somar(engajamentoCampanhas, 'saves');
  const totalInteracoes = curtidas + comentarios + compartilhamentos + salvamentos;
  const engajamento = {
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

  // Compras vem do pixel/tracking de conversão da Meta — pode sair "—" com
  // frequência até esse tracking estar disparando de verdade pra Vessel
  // (confirmado com o dono, 21/09/2026, olhando dado real: veio zero em toda
  // campanha ativa até aqui). Não é bug deste relatório, é ausência de fonte.
  const compras = somar(vendasCampanhas, 'compras');
  const vendas = {
    investimento: investimentoVendas,
    compras,
    custoPorCompra: investimentoVendas > 0 && compras > 0 ? custoPorLead(investimentoVendas, compras) : null,
  };

  // Leads soma dois canais que a Meta reporta separado (cadastros de
  // formulário + conversas de WhatsApp) — não se sobrepõem: uma campanha
  // otimiza pra um tipo de ação por vez.
  const resultadoLeads = somar(leadsCampanhas, 'cadastros') + somar(leadsCampanhas, 'conversas');
  const leads = {
    investimento: investimentoLeads,
    resultado: resultadoLeads,
    custoPorLead: investimentoLeads > 0 && resultadoLeads > 0
      ? custoPorLead(investimentoLeads, resultadoLeads) : null,
  };

  // Sales/Leads por LINK do anúncio (18/09/2026) — eixo totalmente separado
  // da classificação por objective acima: aqui é o destino do CRIATIVO do
  // anúncio, não o objective da campanha. Intocado por esta reforma.
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

  const header = {
    investimentoTotal: investimentoTrafego + investimentoEngajamento + investimentoVendas + investimentoLeads
      + investimentoSalesLink + investimentoLeadsLink,
    novosSeguidores: seguidoresDoDia,
    engajamentos: somar(engajamentoCampanhas, 'postEngagement'),
    leadsGerados: resultadoLeads,
  };

  // Media Mix: % do investimento total em cada fatia. `null` quando não
  // houve investimento nenhum no dia (0/0 não é 0%, é "sem dado").
  const investimentoTotal = header.investimentoTotal;
  const pctDoTotal = (valor) => (investimentoTotal > 0 ? (valor / investimentoTotal) * 100 : null);
  const mix = {
    trafego: pctDoTotal(investimentoTrafego),
    engajamento: pctDoTotal(investimentoEngajamento),
    vendas: pctDoTotal(investimentoVendas),
    leads: pctDoTotal(investimentoLeads),
    salesLink: pctDoTotal(investimentoSalesLink),
    leadsLink: pctDoTotal(investimentoLeadsLink),
  };

  return { header, trafego, engajamento, vendas, leads, salesLink, leadsLink, mix };
}
