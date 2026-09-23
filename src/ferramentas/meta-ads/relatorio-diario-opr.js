// src/ferramentas/meta-ads/relatorio-diario-opr.js
// Agregação diária pro relatório OPR (Paid Media Performance) — ver spec em
// docs/superpowers/specs/2026-09-17-relatorio-opr-diario-design.md.
//
// Nunca a mensagem/HTML pronta (isso é responsabilidade do template em
// coletor/lib/template-opr.mjs) — só os NÚMEROS, testáveis por igualdade.
import { custoPorLead } from './relatorio-por-hora.js';

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

// Campanha de seguidor não tem objective próprio na Meta — ela cresce
// audiência usando Tráfego ou Engajamento como qualquer outra, só dá pra
// separar pelo NOME. Mas só entra aqui quem JÁ passou pelo objective:
// revisando as 75 campanhas históricas com "SEGUID" no nome (22/09/2026),
// achamos campanha de Vendas/Leads que usa "SEGUIDORES" como rótulo de
// PÚBLICO-ALVO ("[VENDA][ECOMMERCE][SEGUIDORES][COM INTERESSE]"), não como
// objetivo — essas nunca chegam a ser testadas aqui, porque o objective
// delas já não é Tráfego nem Engajamento.
export function ehCampanhaDeSeguidores(nome) {
  return nome.toUpperCase().includes('SEGUID');
}

// Tipo final da campanha: objective primeiro, "seguidores" só como recorte
// de Tráfego/Engajamento por nome — nunca de Vendas/Leads.
export function classificarCampanha(nome, objective) {
  const tipo = tipoPorObjective(objective);
  if ((tipo === 'trafego' || tipo === 'engajamento') && ehCampanhaDeSeguidores(nome)) return 'seguidores';
  return tipo;
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
        tipo: classificarCampanha(nome, objectivesPorCampanha[l.campaign_id]),
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

function porTipo(campanhas, tipo) {
  return campanhas.filter((c) => c.tipo === tipo);
}
function somar(campanhas, campo) {
  return campanhas.reduce((s, c) => s + c[campo], 0);
}

// Números prontos do relatório OPR — imagem do WhatsApp (coletor/gerar-opr-diario.mjs)
// e tela (tela-de-relatorio-opr.vue) leem exatamente o mesmo formato, layout
// 2×2 aprovado pelo dono em 21/09/2026 e ajustado em 22/09/2026: Seguidores
// sai de dentro de Tráfego (tinha sumido o custo por seguidor), e Leads
// junta com Vendas no mesmo painel (igual o antigo "Leads & Sales").
//
// Regra de custo (mesma do resto do projeto): nunca divide por contagem <= 0
// nem por investimento <= 0 — cai pra `null`, nunca "R$ 0,00" inventado.
// `seguidoresDoDia` pode ser `null` (nenhuma leitura de seguidor nesse dia
// ainda) — é dado de CONTA, nunca dependeu de campanha nem de classificação.
export function calcularDadosOpr(campanhasDoDia, seguidoresDoDia) {
  // "outro" continua fora de QUALQUER soma — `agruparCampanhasDoDia` só tira
  // o ruído (vaga/atacado/rh/dre), "outro" (objective não mapeado) ainda
  // aparece na lista pra quem quiser auditar, mas nunca entra em número
  // nenhum do relatório, nem nas somas "de qualquer campanha" abaixo.
  const campanhasValidas = campanhasDoDia.filter((c) => c.tipo !== 'outro');
  const seguidoresCampanhas = porTipo(campanhasValidas, 'seguidores');
  const trafegoCampanhas = porTipo(campanhasDoDia, 'trafego');
  const engajamentoCampanhas = porTipo(campanhasDoDia, 'engajamento');
  const vendasCampanhas = porTipo(campanhasDoDia, 'vendas');
  const leadsCampanhas = porTipo(campanhasDoDia, 'leads');

  const investimentoSeguidores = somar(seguidoresCampanhas, 'gasto');
  const investimentoTrafego = somar(trafegoCampanhas, 'gasto');
  const investimentoEngajamento = somar(engajamentoCampanhas, 'gasto');
  const investimentoVendas = somar(vendasCampanhas, 'gasto');
  const investimentoLeads = somar(leadsCampanhas, 'gasto');

  // `novos`/`seguidoresDoDia` é dado de CONTA (delta do Instagram), nunca de
  // campanha — por isso o custo por seguidor pode dar `null` mesmo com
  // investimento > 0 (seguidor pode ter vindo de orgânico no dia).
  //
  // Curtidas/comentários/compart./salvamentos entraram em 23/09/2026: campanha
  // de seguidor roda em objective Tráfego/Engajamento, então gera engajamento
  // de verdade também (o post do anúncio recebe curtida igual qualquer outro)
  // — antes esse número ficava escondido, só aparecia se a campanha caísse no
  // balde genérico de Tráfego/Engajamento.
  const seguidores = {
    investimento: investimentoSeguidores,
    novos: seguidoresDoDia,
    curtidas: somar(seguidoresCampanhas, 'likes'),
    comentarios: somar(seguidoresCampanhas, 'comments'),
    compartilhamentos: somar(seguidoresCampanhas, 'shares'),
    salvamentos: somar(seguidoresCampanhas, 'saves'),
    custoPorSeguidor: investimentoSeguidores > 0 && seguidoresDoDia > 0
      ? custoPorLead(investimentoSeguidores, seguidoresDoDia) : null,
  };

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
  // `post_engagement` é a métrica da própria Meta pra "toda interação com o
  // anúncio" (curtida+comentário+compart.+salvamento e mais: clique no post,
  // visualização de foto/vídeo...) — sempre MAIOR que a soma dos 4 tipos que
  // a gente abre em campo próprio. Pedido do dono, 23/09/2026: usar a métrica
  // da Meta aqui, não a nossa soma parcial — mesma fonte que já usa pro KPI
  // "Engajamentos" do topo (a diferença lá era outra: aquele soma TODAS as
  // campanhas, este continua só as de objective Engajamento).
  const totalInteracoes = somar(engajamentoCampanhas, 'postEngagement');
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

  // Leads & Vendas no mesmo painel (22/09/2026, igual o antigo "Leads &
  // Sales"). `resultado` soma `conversas` de QUALQUER campanha, não só as de
  // objective Leads — achado revisando 22/09: a maior campanha de WhatsApp
  // do dia ("[LEADS LOJA][mixconversão]", 35 conversas reais) tem objective
  // Tráfego, e o relatório mostrava Leads Gerados = 0 por só olhar o balde
  // Leads. `cadastros` (formulário) continua só de campanha objective Leads,
  // que é o único jeito de gerar esse tipo de ação. Custo de cada resultado
  // continua sobre o investimento do PRÓPRIO balde (Leads/Vendas) — nunca o
  // investimento combinado, que inventaria um custo sem lastro quando o
  // resultado veio de uma campanha de outro objective (ex.: Tráfego).
  const resultadoLeads = somar(leadsCampanhas, 'cadastros') + somar(campanhasValidas, 'conversas');
  const investimentoLeadsEVendas = investimentoLeads + investimentoVendas;
  const leadsEVendas = {
    investimento: investimentoLeadsEVendas,
    leads: resultadoLeads,
    // Chatwoot só rastreia a lista de espera hoje, não qualificação de lead
    // — sem fonte, `null` de propósito (mesmo espírito do "compras" acima).
    leadsQuentes: null,
    vendas: compras,
    custoPorLead: investimentoLeads > 0 && resultadoLeads > 0
      ? custoPorLead(investimentoLeads, resultadoLeads) : null,
    custoPorVenda: investimentoVendas > 0 && compras > 0
      ? custoPorLead(investimentoVendas, compras) : null,
  };

  const header = {
    investimentoTotal: investimentoSeguidores + investimentoTrafego + investimentoEngajamento
      + investimentoVendas + investimentoLeads,
    novosSeguidores: seguidoresDoDia,
    // Soma de TODAS as campanhas, não só as de objective Engajamento (achado
    // 22/09/2026: a legenda é "Interações totais", mas só contava a fatia de
    // Engajamento — 3.173 de um real de 31.132 no dia validado).
    engajamentos: somar(campanhasValidas, 'postEngagement'),
    leadsGerados: resultadoLeads,
  };

  // Media Mix: % do investimento total em cada fatia. `null` quando não
  // houve investimento nenhum no dia (0/0 não é 0%, é "sem dado"). 4 fatias,
  // batendo 1-pra-1 com os 4 painéis — sem eixo somado por cima (removido o
  // salesLink/leadsLink de 18/09: existia pra pegar campanha AXIOM que a
  // classificação por NOME não reconhecia; a classificação por OBJECTIVE já
  // pega essas campanhas certo, então aquele eixo só duplicava o
  // investimento — R$325 a mais no dia 22/09, por exemplo).
  const investimentoTotal = header.investimentoTotal;
  const pctDoTotal = (valor) => (investimentoTotal > 0 ? (valor / investimentoTotal) * 100 : null);
  const mix = {
    seguidores: pctDoTotal(investimentoSeguidores),
    trafego: pctDoTotal(investimentoTrafego),
    engajamento: pctDoTotal(investimentoEngajamento),
    leadsEVendas: pctDoTotal(investimentoLeadsEVendas),
  };

  return {
    header, seguidores, trafego, engajamento, leadsEVendas, mix,
  };
}
