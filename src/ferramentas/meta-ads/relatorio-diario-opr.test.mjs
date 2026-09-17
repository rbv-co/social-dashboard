import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparCampanhasDoDia, montarDadosOpr } from './relatorio-diario-opr.js';

test('agruparCampanhasDoDia: classifica pelo nome e converte os números (string->number, ausente->0)', () => {
  const linhas = [
    { campaign_id: 'c1', spend: '100.50', likes: '10', comments: '2', shares: '1', saves: '3', conversas: '4', post_engagement: '20' },
    { campaign_id: 'c2', spend: '50', likes: null, comments: null, shares: null, saves: null, conversas: null, post_engagement: null },
  ];
  const nomes = { c1: '[+ SEGUIDORES] Reels', c2: '[VAGA] Emprego' };
  const out = agruparCampanhasDoDia(linhas, nomes);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    campaignId: 'c1', nome: '[+ SEGUIDORES] Reels', tipo: 'seguidores',
    gasto: 100.5, likes: 10, comments: 2, shares: 1, saves: 3, conversas: 4, postEngagement: 20,
  });
  assert.equal(out[1].tipo, 'outro');
  assert.equal(out[1].gasto, 50);
  assert.equal(out[1].likes, 0, 'campo ausente vira 0, nunca null/NaN');
});

test('montarDadosOpr: soma cada categoria certa e ignora "outro"', () => {
  const campanhas = agruparCampanhasDoDia([
    { campaign_id: 'c1', spend: 100, conversas: 5 },
    { campaign_id: 'c2', spend: 200, likes: 30, comments: 5, shares: 2, saves: 3, post_engagement: 80 },
    { campaign_id: 'c3', spend: 999, conversas: 999 },
  ], { c1: '[CAMPANHA WPP] X', c2: '[+ ENGAJAMENTO] Y', c3: '[VAGA] Z' });

  const dados = montarDadosOpr(campanhas, 12, 150);

  assert.equal(dados.leads.leads, 5);
  assert.equal(dados.leads.investimento, 100);
  assert.equal(dados.engagement.investimento, 200);
  assert.equal(dados.engagement.curtidas, 30);
  assert.equal(dados.engagement.totalInteracoes, 40);
  assert.equal(dados.header.investimentoTotal, 300, 'soma wpp+engajamento+seguidores, nunca a campanha "outro"');
  assert.equal(dados.header.engajamentos, 80);
  assert.equal(dados.header.leadsGerados, 5);
});

test('montarDadosOpr: custo nunca nasce de contagem ou investimento <= 0', () => {
  const semNada = montarDadosOpr([], 0, 0);
  assert.equal(semNada.growth.custoPorSeguidor, null);
  assert.equal(semNada.growth.custoPorVisita, null);
  assert.equal(semNada.growth.conversaoVisitaSeguidor, null, 'visita 0 é denominador inválido, não 0%');
  assert.equal(semNada.engagement.custoPorCurtida, null);
  assert.equal(semNada.engagement.custoMedioPorEngajamento, null);
  assert.equal(semNada.leads.custoPorLead, null);
});

test('montarDadosOpr: conversão visita->seguidor pode ser 0% de verdade (não é custo)', () => {
  const campanhas = agruparCampanhasDoDia(
    [{ campaign_id: 'c1', spend: 50 }],
    { c1: '[+ SEGUIDORES] X' },
  );
  const dados = montarDadosOpr(campanhas, 0, 100);
  assert.equal(dados.growth.conversaoVisitaSeguidor, 0, '0 seguidor de 100 visitas é 0% real, não null');
  assert.equal(dados.growth.custoPorSeguidor, null, 'mas custo por seguidor não existe com 0 seguidor (denominador inválido pra custo)');
});

test('montarDadosOpr: seguidoresDoDia null (sem leitura nenhuma) propaga null, não 0', () => {
  const dados = montarDadosOpr([], null, 50);
  assert.equal(dados.header.novosSeguidores, null);
  assert.equal(dados.growth.seguidores, null);
  assert.equal(dados.growth.conversaoVisitaSeguidor, null);
});
