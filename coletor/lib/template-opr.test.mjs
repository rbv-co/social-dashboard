import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarHtmlOpr } from './template-opr.mjs';

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
