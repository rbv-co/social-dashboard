import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarHtmlOpr } from './template-opr.mjs';
import { agruparCampanhasDoDia, calcularDadosOpr } from '../../src/ferramentas/meta-ads/relatorio-diario-opr.js';

function dadosBase() {
  return {
    header: { investimentoTotal: 300, novosSeguidores: 12, engajamentos: 80, leadsGerados: 5 },
    growth: { investimento: 100, seguidores: 12, visitasPerfil: 150, custoPorSeguidor: 8.33, custoPorVisita: 0.67, conversaoVisitaSeguidor: 8 },
    engagement: { investimento: 200, curtidas: 30, comentarios: 5, compartilhamentos: 2, salvamentos: 3, custoPorCurtida: 6.67, custoPorComentario: 40, custoPorCompartilhamento: 100, custoPorSalvamento: 66.67, totalInteracoes: 40, custoMedioPorEngajamento: 5 },
    sales: {
      leads: 5, leadsQuentes: null, vendas: null, investimento: 100, custoPorLead: 20,
      custoPorLeadQuente: null, custoPorVenda: null, conversaoLeadQuente: null, conversaoQuenteVenda: null,
    },
    mix: { growth: 33.3, engagement: 66.7, leads: 33.3, salesLink: 0, leadsLink: 0 },
  };
}

test('montarHtmlOpr: injeta os valores calculados no HTML, formatados', () => {
  const html = montarHtmlOpr(dadosBase(), { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /Vessel Brasil/);
  assert.match(html, /16\/09\/2026/);
  assert.match(html, /R\$\s?300,00/);
  assert.match(html, /Custo por Lead/);
  assert.match(html, /R\$\s?20,00/);
});

test('montarHtmlOpr: valor null aparece como travessão, nunca "null" ou número inventado', () => {
  const dados = {
    header: { investimentoTotal: 0, novosSeguidores: null, engajamentos: 0, leadsGerados: 0 },
    growth: { investimento: 0, seguidores: null, visitasPerfil: 0, custoPorSeguidor: null, custoPorVisita: null, conversaoVisitaSeguidor: null },
    engagement: { investimento: 0, curtidas: 0, comentarios: 0, compartilhamentos: 0, salvamentos: 0, custoPorCurtida: null, custoPorComentario: null, custoPorCompartilhamento: null, custoPorSalvamento: null, totalInteracoes: 0, custoMedioPorEngajamento: null },
    sales: {
      leads: 0, leadsQuentes: null, vendas: null, investimento: 0, custoPorLead: null,
      custoPorLeadQuente: null, custoPorVenda: null, conversaoLeadQuente: null, conversaoQuenteVenda: null,
    },
    mix: { growth: null, engagement: null, leads: null, salesLink: null, leadsLink: null },
  };
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.doesNotMatch(html, /null/);
  assert.match(html, /—/);
});

test('⚠️ montarHtmlOpr: Leads Quentes/Vendas aparecem como travessão (sem fonte — Chatwoot), Leads (WPP) aparece com o valor real', () => {
  const dados = dadosBase();
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /Leads Quentes[\s\S]*?—/, 'sem número inventado pra Leads Quentes');
  assert.match(html, /Vendas[\s\S]*?—/);
  assert.match(html, /funnel-value">5</, 'Leads (WPP) já tem fonte real — sales.leads=5 aparece de verdade, não travessão');
});

test('⚠️ montarHtmlOpr: números ≥ mil/milhão abreviam ("mil"/"M"), nunca quebram linha por dígito', () => {
  const dados = dadosBase();
  dados.header.investimentoTotal = 1_250_000;
  dados.header.novosSeguidores = 8420;
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /R\$\s?1,3\sM/, 'milhão abrevia com "M"');
  assert.match(html, /8,4\smil/, 'mil abrevia com "mil"');
});

test('montarHtmlOpr: Media Mix — barra nunca passa de 100% de largura mesmo com % maluco, e null vira travessão sem quebrar a barra', () => {
  const dados = dadosBase();
  dados.mix = { growth: 250, engagement: null, leads: 40, salesLink: 0, leadsLink: 0 };
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /width:100%/, 'growth=250% nunca estica a barra além do card');
  assert.match(html, /width:0%/, 'engagement null não tem barra (nem null% nem negativo)');
});

test('⚠️ montarHtmlOpr: Media Mix mostra Sales (Link) e Leads (Link) — confirmados em 18/09/2026, nunca apareciam na imagem mesmo já calculados', () => {
  const dados = dadosBase();
  dados.mix = { growth: 20, engagement: 30, leads: 10, salesLink: 25, leadsLink: 15 };
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /Sales \(Link\)[\s\S]*?25,0%/);
  assert.match(html, /Leads \(Link\)[\s\S]*?15,0%/);
});

test('integração: agruparCampanhasDoDia -> calcularDadosOpr -> montarHtmlOpr, sem mocks no meio', () => {
  // Fixture pequena, à mão — se algum campo mudar de nome de um lado (ex. em
  // calcularDadosOpr) sem o outro lado (template) acompanhar, é este teste
  // que quebra; os outros dois arquivos de teste isolam cada ponta com
  // fixtures próprias e não pegariam essa quebra. Usa calcularDadosOpr (sem
  // o rollout de montarDadosOpr) porque aqui o que se testa é a formatação
  // no HTML de um valor JÁ calculado, não o rollout em si (esse tem teste
  // próprio em relatorio-diario-opr.test.mjs).
  const linhas = [
    { campaign_id: 'c1', spend: 301, likes: 0, comments: 0, shares: 0, saves: 0, conversas: 4, post_engagement: 0 },
    { campaign_id: 'c2', spend: 100, likes: 0, comments: 0, shares: 0, saves: 0, conversas: 0, post_engagement: 0 },
    { campaign_id: 'c3', spend: 50, likes: 10, comments: 2, shares: 1, saves: 1, conversas: 0, post_engagement: 14 },
  ];
  const nomesPorCampanha = {
    c1: '[CAMPANHA WPP] Promo',
    c2: '[+ SEGUIDORES] Reels',
    c3: '[ENGAJAMENTO] Post',
  };

  const campanhasDoDia = agruparCampanhasDoDia(linhas, nomesPorCampanha);
  const dados = calcularDadosOpr(campanhasDoDia, /* seguidoresDoDia */ 5, /* visitasPerfilDoDia */ 40);

  // Contas de cabeça, pra conferir que a agregação bateu antes de olhar o HTML:
  // custoPorLead = 301 / 4 conversas = 75.25 -> "R$ 75,25"
  // conversaoVisitaSeguidor = 5 seguidores / 40 visitas * 100 = 12.5 -> "12,5%"
  assert.equal(dados.sales.custoPorLead, 75.25);
  assert.equal(dados.growth.conversaoVisitaSeguidor, 12.5);
  assert.equal(dados.sales.leadsQuentes, null, 'sem fonte ainda — Chatwoot');

  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /R\$\s?75,25/, 'custoPorLead calculado bate no HTML final, formatado em reais');
  assert.match(html, /12,5%/, 'conversão calculada bate no HTML final, com vírgula (pt-BR)');
  assert.match(html, /Leads Quentes[\s\S]*?—/, 'sem dado do Chatwoot ainda, aparece travessão');
});
