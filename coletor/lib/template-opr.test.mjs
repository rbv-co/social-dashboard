import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarHtmlOpr } from './template-opr.mjs';
import { agruparCampanhasDoDia, calcularDadosOpr } from '../../src/ferramentas/meta-ads/relatorio-diario-opr.js';

function dadosBase() {
  return {
    header: {
      investimentoTotal: 480, novosSeguidores: 12, engajamentos: 80, leadsGerados: 5, ctr: 2.1, cpm: 15.5, frequencia: 1.8,
    },
    seguidores: {
      investimento: 50, novos: 12, curtidas: 20, comentarios: 1, compartilhamentos: 4, salvamentos: 2, custoPorSeguidor: 4.17,
    },
    trafego: { investimento: 50, visitas: 40, custoPorVisita: 1.25 },
    engajamento: { investimento: 200, curtidas: 30, comentarios: 5, compartilhamentos: 2, salvamentos: 3, custoPorCurtida: 6.67, custoPorComentario: 40, custoPorCompartilhamento: 100, custoPorSalvamento: 66.67, totalInteracoes: 40, custoMedioPorEngajamento: 5 },
    leadsEVendas: {
      investimento: 180, leads: 5, leadsQuentes: null, vendas: 1, custoPorLead: 20, custoPorVenda: 30,
    },
    mix: {
      seguidores: 10.4, trafego: 10.4, engajamento: 41.7, leadsEVendas: 37.5,
    },
  };
}

test('montarHtmlOpr: injeta os valores calculados no HTML, formatados', () => {
  const html = montarHtmlOpr(dadosBase(), { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /Vessel Brasil/);
  assert.match(html, /16\/09\/2026/);
  assert.match(html, /R\$\s?480,00/);
  assert.match(html, /Custo por Lead/);
  assert.match(html, /R\$\s?20,00/);
});

test('montarHtmlOpr: os 4 painéis (Seguidores/Tráfego/Engajamento/Leads & Vendas) aparecem', () => {
  const html = montarHtmlOpr(dadosBase(), { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, />Seguidores</);
  assert.match(html, />Tráfego</);
  assert.match(html, />Engajamento</);
  assert.match(html, /Leads &amp; Vendas|Leads & Vendas/);
});

test('⚠️ montarHtmlOpr: CTR/CPM/Frequência aparecem como KPI único do dia (não por categoria)', () => {
  const html = montarHtmlOpr(dadosBase(), { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, />CTR</);
  assert.match(html, /2,1%/);
  assert.match(html, />CPM</);
  assert.match(html, /R\$\s?15,50/);
  assert.match(html, />Frequência</);
  assert.match(html, /1,8/);
});

test('montarHtmlOpr: valor null aparece como travessão, nunca "null" ou número inventado', () => {
  const dados = {
    header: {
      investimentoTotal: 0, novosSeguidores: null, engajamentos: 0, leadsGerados: 0, ctr: null, cpm: null, frequencia: null,
    },
    seguidores: {
      investimento: 0, novos: null, curtidas: 0, comentarios: 0, compartilhamentos: 0, salvamentos: 0, custoPorSeguidor: null,
    },
    trafego: { investimento: 0, visitas: 0, custoPorVisita: null },
    engajamento: { investimento: 0, curtidas: 0, comentarios: 0, compartilhamentos: 0, salvamentos: 0, custoPorCurtida: null, custoPorComentario: null, custoPorCompartilhamento: null, custoPorSalvamento: null, totalInteracoes: 0, custoMedioPorEngajamento: null },
    leadsEVendas: {
      investimento: 0, leads: 0, leadsQuentes: null, vendas: 0, custoPorLead: null, custoPorVenda: null,
    },
    mix: {
      seguidores: null, trafego: null, engajamento: null, leadsEVendas: null,
    },
  };
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.doesNotMatch(html, /null/);
  assert.match(html, /—/);
});

test('⚠️ montarHtmlOpr: Leads Quentes aparece como travessão (sem fonte — Chatwoot), Leads/Vendas aparecem com o valor real', () => {
  const dados = dadosBase();
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /Leads Quentes[\s\S]*?—/, 'sem número inventado pra Leads Quentes');
  assert.match(html, /metric-value">5</, 'Leads já tem fonte real — leadsEVendas.leads=5 aparece de verdade, não travessão');
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
  dados.mix = {
    seguidores: 250, trafego: null, engajamento: 40, leadsEVendas: 10,
  };
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /width:100%/, 'seguidores=250% nunca estica a barra além do card');
  assert.match(html, /width:0%/, 'trafego null não tem barra (nem null% nem negativo)');
});

test('integração: agruparCampanhasDoDia -> calcularDadosOpr -> montarHtmlOpr, sem mocks no meio', () => {
  // Fixture pequena, à mão — se algum campo mudar de nome de um lado (ex. em
  // calcularDadosOpr) sem o outro lado (template) acompanhar, é este teste
  // que quebra.
  const linhas = [
    { campaign_id: 'c1', spend: 301, likes: 0, comments: 0, shares: 0, saves: 0, cadastros: 4, conversas: 0, post_engagement: 0 },
    { campaign_id: 'c2', spend: 100, likes: 0, comments: 0, shares: 0, saves: 0, visitas: 40, post_engagement: 0 },
    { campaign_id: 'c3', spend: 50, likes: 10, comments: 2, shares: 1, saves: 1, conversas: 0, post_engagement: 14 },
  ];
  const nomesPorCampanha = { c1: 'Campanha de Leads', c2: 'Campanha de Tráfego', c3: 'Campanha de Engajamento' };
  const objectivesPorCampanha = { c1: 'OUTCOME_LEADS', c2: 'OUTCOME_TRAFFIC', c3: 'OUTCOME_ENGAGEMENT' };

  const campanhasDoDia = agruparCampanhasDoDia(linhas, nomesPorCampanha, objectivesPorCampanha);
  const dados = calcularDadosOpr(campanhasDoDia, /* seguidoresDoDia */ 5);

  // Contas de cabeça, pra conferir que a agregação bateu antes de olhar o HTML:
  // custoPorLead = 301 / 4 cadastros = 75.25 -> "R$ 75,25"
  assert.equal(dados.leadsEVendas.custoPorLead, 75.25);

  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /R\$\s?75,25/, 'custoPorLead calculado bate no HTML final, formatado em reais');
});
