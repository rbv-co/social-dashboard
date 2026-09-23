import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ehRuidoDeCampanha, tipoPorObjective, ehCampanhaDeSeguidores, classificarCampanha,
  agruparCampanhasDoDia, calcularDadosOpr,
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

test('ehCampanhaDeSeguidores: pega "SEGUID" em qualquer posição, sem diferenciar maiúscula', () => {
  assert.equal(ehCampanhaDeSeguidores('[+ SEGUIDORES] Reels'), true);
  assert.equal(ehCampanhaDeSeguidores('+Seguidores_PublicoQuente'), true);
  assert.equal(ehCampanhaDeSeguidores('[500]_AXIOM_01_SEGUID_VESSEL-SP_SET2026'), true);
  assert.equal(ehCampanhaDeSeguidores('[LEADS LOJA][mixconversão]'), false);
  assert.equal(ehCampanhaDeSeguidores('[Engajamento]'), false);
});

test('classificarCampanha: Tráfego/Engajamento com nome de seguidor vira "seguidores"', () => {
  assert.equal(classificarCampanha('[+ SEGUIDORES] Reels', 'OUTCOME_TRAFFIC'), 'seguidores');
  assert.equal(classificarCampanha('Engajamento Seguidores', 'OUTCOME_ENGAGEMENT'), 'seguidores');
});

test('classificarCampanha: Tráfego/Engajamento SEM nome de seguidor mantém o objective', () => {
  assert.equal(classificarCampanha('[LEADS LOJA][mixconversão]', 'OUTCOME_TRAFFIC'), 'trafego');
  assert.equal(classificarCampanha('[Engajamento]', 'OUTCOME_ENGAGEMENT'), 'engajamento');
});

test('⚠️ classificarCampanha: Vendas/Leads NUNCA viram "seguidores", mesmo com "SEGUIDORES" no nome — é rótulo de público, não objetivo', () => {
  assert.equal(classificarCampanha('[VENDA][ECOMMERCE][SEGUIDORES][COM INTERESSE][BR]', 'OUTCOME_SALES'), 'vendas');
  assert.equal(classificarCampanha('[LEADS] FIRST ACCESS | SEGUIDORES VESSEL', 'OUTCOME_LEADS'), 'leads');
});

test('agruparCampanhasDoDia: classifica pelo objective + nome (seguidores) e converte números', () => {
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
    campaignId: 'c1', nome: '[+ SEGUIDORES] Reels', tipo: 'seguidores',
    gasto: 100.5, likes: 10, comments: 2, shares: 1, saves: 3, conversas: 4, cadastros: 1, compras: 0, visitas: 9, postEngagement: 20,
  });
  assert.equal(out[1].tipo, 'trafego');
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

test('calcularDadosOpr: soma cada categoria certa (seguidores/trafego/engajamento/vendas/leads) e ignora "outro"', () => {
  const campanhas = agruparCampanhasDoDia([
    {
      campaign_id: 'c0', spend: 40, visitas: 5, likes: 20, comments: 1, shares: 4, saves: 2,
    },
    { campaign_id: 'c1', spend: 100, cadastros: 3, conversas: 2 },
    { campaign_id: 'c2', spend: 200, likes: 30, comments: 5, shares: 2, saves: 3, post_engagement: 80 },
    { campaign_id: 'c3', spend: 50, visitas: 40 },
    { campaign_id: 'c4', spend: 30, compras: 1 },
    { campaign_id: 'c5', spend: 999, conversas: 999 },
  ], {
    c0: '[+ SEGUIDORES] Reels', c1: 'Leads X', c2: 'Engaj Y', c3: 'Trafego Z', c4: 'Vendas W', c5: 'Outro (awareness)',
  }, {
    c0: 'OUTCOME_TRAFFIC', c1: 'OUTCOME_LEADS', c2: 'OUTCOME_ENGAGEMENT', c3: 'OUTCOME_TRAFFIC', c4: 'OUTCOME_SALES', c5: 'OUTCOME_AWARENESS',
  });

  const dados = calcularDadosOpr(campanhas, 12);

  assert.equal(dados.seguidores.investimento, 40);
  assert.equal(dados.seguidores.novos, 12);
  assert.equal(dados.seguidores.curtidas, 20, 'campanha de seguidor também gera engajamento de verdade');
  assert.equal(dados.seguidores.comentarios, 1);
  assert.equal(dados.seguidores.compartilhamentos, 4);
  assert.equal(dados.seguidores.salvamentos, 2);
  assert.equal(dados.seguidores.custoPorSeguidor, 40 / 12);
  assert.equal(dados.trafego.investimento, 50, 'a campanha de seguidor não entra mais em Tráfego');
  assert.equal(dados.trafego.visitas, 40);
  assert.equal(dados.engajamento.investimento, 200);
  assert.equal(dados.engajamento.curtidas, 30);
  assert.equal(dados.engajamento.totalInteracoes, 80, 'usa post_engagement da Meta, não a soma de curtida+coment.+compart.+salv. (que seria 40)');
  assert.equal(dados.leadsEVendas.investimento, 100 + 30, 'leads + vendas somados');
  assert.equal(dados.leadsEVendas.leads, 5, 'cadastros (leads) + conversas de QUALQUER campanha');
  assert.equal(dados.leadsEVendas.leadsQuentes, null, 'sem fonte — Chatwoot só rastreia lista de espera');
  assert.equal(dados.leadsEVendas.vendas, 1);
  assert.equal(dados.leadsEVendas.custoPorLead, 100 / 5, 'custo usa só o investimento de Leads, não o combinado');
  assert.equal(dados.leadsEVendas.custoPorVenda, 30 / 1);

  assert.equal(dados.header.investimentoTotal, 40 + 50 + 200 + 30 + 100, 'soma seguidores+trafego+engajamento+vendas+leads, nunca a campanha "outro"');
  assert.equal(dados.header.engajamentos, 80, 'soma post_engagement de TODAS as campanhas classificadas, não só engajamento');
  assert.equal(dados.header.leadsGerados, 5);

  assert.equal(dados.mix.leadsEVendas, 130 / 420 * 100);
  assert.equal(dados.mix.trafego, 50 / 420 * 100);
});

test('⚠️ calcularDadosOpr: Leads soma conversas de campanha de QUALQUER objective, não só Leads — achado 22/09/2026', () => {
  const campanhas = agruparCampanhasDoDia([
    { campaign_id: 'c1', spend: 500, conversas: 35 },
  ], { c1: '[LEADS LOJA][mixconversão]' }, { c1: 'OUTCOME_TRAFFIC' });

  const dados = calcularDadosOpr(campanhas, 0);
  assert.equal(dados.header.leadsGerados, 35, 'conversa de campanha Tráfego conta como lead');
  assert.equal(dados.leadsEVendas.investimento, 0, 'mas o investimento de Leads/Vendas fica 0 — a campanha é Tráfego');
  assert.equal(dados.leadsEVendas.custoPorLead, null, 'sem investimento no balde Leads, custo não se inventa');
});

test('calcularDadosOpr: custo nunca nasce de contagem ou investimento <= 0', () => {
  const semNada = calcularDadosOpr([], 0);
  assert.equal(semNada.seguidores.custoPorSeguidor, null);
  assert.equal(semNada.trafego.custoPorVisita, null);
  assert.equal(semNada.engajamento.custoPorCurtida, null);
  assert.equal(semNada.engajamento.custoMedioPorEngajamento, null);
  assert.equal(semNada.leadsEVendas.custoPorLead, null);
  assert.equal(semNada.leadsEVendas.custoPorVenda, null);
  assert.equal(semNada.mix.trafego, null, 'sem investimento nenhum, 0/0 não é 0% — é null');
  assert.equal(semNada.mix.leadsEVendas, null);
});

test('calcularDadosOpr: seguidoresDoDia null (sem leitura nenhuma) propaga null no header e no painel de seguidores, não 0', () => {
  const dados = calcularDadosOpr([], null);
  assert.equal(dados.header.novosSeguidores, null);
  assert.equal(dados.seguidores.novos, null);
});
