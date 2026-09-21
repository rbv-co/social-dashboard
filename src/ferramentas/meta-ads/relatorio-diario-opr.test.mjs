import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ehRuidoDeCampanha, tipoPorObjective, agruparCampanhasDoDia, calcularDadosOpr, agruparAnunciosDoDia,
} from './relatorio-diario-opr.js';

test('tipoPorObjective: mapeia os 4 objectives conhecidos; qualquer outro (ou ausente) vira "outro"', () => {
  assert.equal(tipoPorObjective('OUTCOME_TRAFFIC'), 'trafego');
  assert.equal(tipoPorObjective('OUTCOME_ENGAGEMENT'), 'engajamento');
  assert.equal(tipoPorObjective('OUTCOME_SALES'), 'vendas');
  assert.equal(tipoPorObjective('OUTCOME_LEADS'), 'leads');
  assert.equal(tipoPorObjective('OUTCOME_AWARENESS'), 'outro');
  assert.equal(tipoPorObjective('LINK_CLICKS'), 'outro');
  assert.equal(tipoPorObjective(undefined), 'outro');
});

test('ehRuidoDeCampanha: pega VAGA/ATACADO/RH/DRE em qualquer posição do nome, sem diferenciar maiúscula', () => {
  assert.equal(ehRuidoDeCampanha('[VAGA] Vendedora | Campinas'), true);
  assert.equal(ehRuidoDeCampanha('[DOM PEDRO] VAGA GERENTE | WPP RH'), true);
  assert.equal(ehRuidoDeCampanha('[atacado] venda fernanda'), true);
  assert.equal(ehRuidoDeCampanha('[DRE] fechamento mensal'), true);
  assert.equal(ehRuidoDeCampanha('[+ SEGUIDORES] Reels'), false);
  assert.equal(ehRuidoDeCampanha('[LEADS LOJA][mixconversão]'), false);
});

test('agruparCampanhasDoDia: classifica pelo objective (não mais pelo nome) e converte números', () => {
  const linhas = [
    {
      campaign_id: 'c1', spend: '100.50', likes: '10', comments: '2', shares: '1', saves: '3',
      conversas: '4', cadastros: '1', compras: '0', visitas: '9', post_engagement: '20',
    },
    { campaign_id: 'c2', spend: '50', likes: null, comments: null, shares: null, saves: null, conversas: null, cadastros: null, compras: null, visitas: null, post_engagement: null },
  ];
  const nomes = { c1: '[+ SEGUIDORES] Reels', c2: 'Campanha sem prefixo' };
  const objectives = { c1: 'OUTCOME_ENGAGEMENT', c2: 'OUTCOME_TRAFFIC' };
  const out = agruparCampanhasDoDia(linhas, nomes, objectives);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    campaignId: 'c1', nome: '[+ SEGUIDORES] Reels', tipo: 'engajamento',
    gasto: 100.5, likes: 10, comments: 2, shares: 1, saves: 3, conversas: 4, cadastros: 1, compras: 0, visitas: 9, postEngagement: 20,
  });
  assert.equal(out[1].tipo, 'trafego', 'nome não tem mais peso nenhum na classificação — só o objective');
  assert.equal(out[1].likes, 0, 'campo ausente vira 0, nunca null/NaN');
});

test('agruparCampanhasDoDia: campanha de ruído (vaga/atacado/rh/dre) é excluída inteiramente, nem aparece como "outro"', () => {
  const linhas = [
    { campaign_id: 'c1', spend: 500, conversas: 99 },
    { campaign_id: 'c2', spend: 10 },
  ];
  const nomes = { c1: '[VAGA] Vendedora | Campinas', c2: '[+ SEGUIDORES] Reels' };
  const objectives = { c1: 'OUTCOME_LEADS', c2: 'OUTCOME_TRAFFIC' };
  const out = agruparCampanhasDoDia(linhas, nomes, objectives);
  assert.equal(out.length, 1, 'a campanha de vaga nem entra na lista');
  assert.equal(out[0].campaignId, 'c2');
});

test('agruparCampanhasDoDia: objective desconhecido/ausente vira "outro" (fora do relatório, mesmo espírito de antes)', () => {
  const out = agruparCampanhasDoDia([{ campaign_id: 'c1', spend: 10 }], { c1: 'Campanha institucional' }, { c1: 'OUTCOME_AWARENESS' });
  assert.equal(out[0].tipo, 'outro');
});

test('calcularDadosOpr: soma cada categoria certa por objective e ignora "outro"', () => {
  const campanhas = agruparCampanhasDoDia([
    { campaign_id: 'c1', spend: 100, cadastros: 3, conversas: 2 },
    { campaign_id: 'c2', spend: 200, likes: 30, comments: 5, shares: 2, saves: 3, post_engagement: 80 },
    { campaign_id: 'c3', spend: 50, visitas: 40 },
    { campaign_id: 'c4', spend: 30, compras: 1 },
    { campaign_id: 'c5', spend: 999, conversas: 999 },
  ], { c1: 'Leads X', c2: 'Engaj Y', c3: 'Trafego Z', c4: 'Vendas W', c5: 'Outro (awareness)' },
  { c1: 'OUTCOME_LEADS', c2: 'OUTCOME_ENGAGEMENT', c3: 'OUTCOME_TRAFFIC', c4: 'OUTCOME_SALES', c5: 'OUTCOME_AWARENESS' });

  const dados = calcularDadosOpr(campanhas, 12);

  assert.equal(dados.leads.resultado, 5, 'cadastros + conversas somados');
  assert.equal(dados.leads.investimento, 100);
  assert.equal(dados.engajamento.investimento, 200);
  assert.equal(dados.engajamento.curtidas, 30);
  assert.equal(dados.engajamento.totalInteracoes, 40);
  assert.equal(dados.trafego.investimento, 50);
  assert.equal(dados.trafego.visitas, 40);
  assert.equal(dados.vendas.investimento, 30);
  assert.equal(dados.vendas.compras, 1);
  assert.equal(dados.header.investimentoTotal, 380, 'soma leads+engajamento+trafego+vendas, nunca a campanha "outro"');
  assert.equal(dados.header.engajamentos, 80);
  assert.equal(dados.header.leadsGerados, 5);

  assert.equal(dados.mix.leads, 100 / 380 * 100);
  assert.equal(dados.mix.trafego, 50 / 380 * 100);
});

test('calcularDadosOpr: custo nunca nasce de contagem ou investimento <= 0', () => {
  const semNada = calcularDadosOpr([], 0);
  assert.equal(semNada.trafego.custoPorVisita, null);
  assert.equal(semNada.engajamento.custoPorCurtida, null);
  assert.equal(semNada.engajamento.custoMedioPorEngajamento, null);
  assert.equal(semNada.vendas.custoPorCompra, null);
  assert.equal(semNada.leads.custoPorLead, null);
  assert.equal(semNada.mix.trafego, null, 'sem investimento nenhum, 0/0 não é 0% — é null');
  assert.equal(semNada.mix.leads, null);
});

test('calcularDadosOpr: seguidoresDoDia null (sem leitura nenhuma) propaga null no header, não 0', () => {
  const dados = calcularDadosOpr([], null);
  assert.equal(dados.header.novosSeguidores, null);
});

test('agruparAnunciosDoDia: soma gasto/clique por anúncio ao longo das horas do dia, classifica pelo link (sem mudança)', () => {
  const linhas = [
    { ad_id: 'a1', gasto_hora: 10, cliques_hora: 2 },
    { ad_id: 'a1', gasto_hora: 5, cliques_hora: 1 },
    { ad_id: 'a2', gasto_hora: 8, cliques_hora: 3 },
  ];
  const links = { a1: 'https://vesselbrasil.com.br/', a2: 'https://vesselbrasil.com.br/universovessel#narrativa' };
  const out = agruparAnunciosDoDia(linhas, links);
  assert.equal(out.length, 2);
  const a1 = out.find((a) => a.adId === 'a1');
  assert.equal(a1.gasto, 15);
  assert.equal(a1.categoria, 'sales');
  assert.equal(out.find((a) => a.adId === 'a2').categoria, 'leads');
});

test('calcularDadosOpr: salesLink/leadsLink somam certo e entram no investimentoTotal (eixo por link do anúncio, intocado pela troca de classificação)', () => {
  const campanhas = agruparCampanhasDoDia(
    [{ campaign_id: 'c1', spend: 100, cadastros: 5 }], { c1: 'Leads X' }, { c1: 'OUTCOME_LEADS' },
  );
  const anunciosDoDia = [
    { adId: 'a1', gasto: 50, cliques: 10, categoria: 'sales' },
    { adId: 'a2', gasto: 20, cliques: 4, categoria: 'leads' },
    { adId: 'a3', gasto: 999, cliques: 999, categoria: null },
  ];
  const dados = calcularDadosOpr(campanhas, 0, anunciosDoDia);
  assert.equal(dados.salesLink.investimento, 50);
  assert.equal(dados.salesLink.custoPorClique, 5);
  assert.equal(dados.leadsLink.investimento, 20);
  assert.equal(dados.header.investimentoTotal, 100 + 50 + 20, 'leads + salesLink + leadsLink, campanha categoria=null fora');
});

test('calcularDadosOpr: sem anúncio nenhum, salesLink/leadsLink saem zerados com custo null (nunca undefined)', () => {
  const dados = calcularDadosOpr([], null);
  assert.deepEqual(dados.salesLink, { investimento: 0, cliques: 0, custoPorClique: null });
  assert.deepEqual(dados.leadsLink, { investimento: 0, cliques: 0, custoPorClique: null });
});
