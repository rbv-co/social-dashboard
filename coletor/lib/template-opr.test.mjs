import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarHtmlOpr } from './template-opr.mjs';
import { agruparCampanhasDoDia, montarDadosOpr } from '../../src/ferramentas/meta-ads/relatorio-diario-opr.js';

test('montarHtmlOpr: injeta os valores calculados no HTML, formatados', () => {
  const dados = {
    header: { investimentoTotal: 300, novosSeguidores: 12, engajamentos: 80, leadsGerados: 5 },
    growth: { investimento: 100, seguidores: 12, visitasPerfil: 150, custoPorSeguidor: 8.33, custoPorVisita: 0.67, conversaoVisitaSeguidor: 8 },
    engagement: { investimento: 200, curtidas: 30, comentarios: 5, compartilhamentos: 2, salvamentos: 3, custoPorCurtida: 6.67, custoPorComentario: 40, custoPorCompartilhamento: 100, custoPorSalvamento: 66.67, totalInteracoes: 40, custoMedioPorEngajamento: 5 },
    leads: { leads: 5, investimento: 100, custoPorLead: 20 },
  };
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
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
    leads: { leads: 0, investimento: 0, custoPorLead: null },
  };
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.doesNotMatch(html, /null/);
  assert.match(html, /—/);
});

test('integração: agruparCampanhasDoDia -> montarDadosOpr -> montarHtmlOpr, sem mocks no meio', () => {
  // Fixture pequena, à mão — se algum campo mudar de nome de um lado (ex. em
  // montarDadosOpr) sem o outro lado (template) acompanhar, é este teste que
  // quebra; os outros dois arquivos de teste isolam cada ponta com fixtures
  // próprias e não pegariam essa quebra.
  const linhas = [
    { campaign_id: 'c1', spend: 301, likes: 0, comments: 0, shares: 0, saves: 0, conversas: 4, post_engagement: 0 },
    { campaign_id: 'c2', spend: 100, likes: 0, comments: 0, shares: 0, saves: 0, conversas: 0, post_engagement: 0 },
    { campaign_id: 'c3', spend: 50, likes: 10, comments: 2, shares: 1, saves: 1, conversas: 0, post_engagement: 14 },
  ];
  const nomesPorCampanha = {
    c1: '[CAMPANHA WPP] Promo',
    c2: '[+ SEGUIDORES] Reels',
    c3: '[+ ENGAJAMENTO] Post',
  };

  const campanhasDoDia = agruparCampanhasDoDia(linhas, nomesPorCampanha);
  const dados = montarDadosOpr(campanhasDoDia, /* seguidoresDoDia */ 5, /* visitasPerfilDoDia */ 40);

  // Contas de cabeça, pra conferir que a agregação bateu antes de olhar o HTML:
  // custoPorLead = 301 / 4 conversas = 75.25 -> "R$ 75,25"
  // conversaoVisitaSeguidor = 5 seguidores / 40 visitas * 100 = 12.5 -> "12,5%"
  assert.equal(dados.leads.custoPorLead, 75.25);
  assert.equal(dados.growth.conversaoVisitaSeguidor, 12.5);

  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /R\$\s?75,25/, 'custoPorLead calculado bate no HTML final, formatado em reais');
  assert.match(html, /12,5%/, 'conversão calculada bate no HTML final, com vírgula (pt-BR)');
});
