import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparCampanhasDoDia, calcularDadosOpr, montarDadosOpr } from './relatorio-diario-opr.js';

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

test('calcularDadosOpr: soma cada categoria certa e ignora "outro"', () => {
  const campanhas = agruparCampanhasDoDia([
    { campaign_id: 'c1', spend: 100, conversas: 5 },
    { campaign_id: 'c2', spend: 200, likes: 30, comments: 5, shares: 2, saves: 3, post_engagement: 80 },
    { campaign_id: 'c3', spend: 999, conversas: 999 },
  ], { c1: '[CAMPANHA WPP] X', c2: '[+ ENGAJAMENTO] Y', c3: '[VAGA] Z' });

  const dados = calcularDadosOpr(campanhas, 12, 150);

  assert.equal(dados.sales.leads, 5);
  assert.equal(dados.sales.investimento, 100);
  assert.equal(dados.engagement.investimento, 200);
  assert.equal(dados.engagement.curtidas, 30);
  assert.equal(dados.engagement.totalInteracoes, 40);
  assert.equal(dados.header.investimentoTotal, 300, 'soma wpp+engajamento+seguidores, nunca a campanha "outro"');
  assert.equal(dados.header.engajamentos, 80);
  assert.equal(dados.header.leadsGerados, 5);

  // Media Mix: % do investimento total (300) em cada categoria.
  assert.equal(dados.mix.leads, 100 / 300 * 100);
  assert.equal(dados.mix.engagement, 200 / 300 * 100);
  assert.equal(dados.mix.growth, 0, 'sem campanha [+ SEGUIDORES] nesse dia, 0% de verdade (não null — o total é positivo)');
});

test('calcularDadosOpr: Leads Quentes/Vendas e tudo que depende deles é null (sem fonte ainda — Chatwoot)', () => {
  const campanhas = agruparCampanhasDoDia(
    [{ campaign_id: 'c1', spend: 100, conversas: 5 }],
    { c1: '[CAMPANHA WPP] X' },
  );
  const dados = calcularDadosOpr(campanhas, null, 0);
  assert.equal(dados.sales.leadsQuentes, null);
  assert.equal(dados.sales.vendas, null);
  assert.equal(dados.sales.custoPorLeadQuente, null);
  assert.equal(dados.sales.custoPorVenda, null);
  assert.equal(dados.sales.conversaoLeadQuente, null);
  assert.equal(dados.sales.conversaoQuenteVenda, null);
  assert.equal(dados.sales.leads, 5, 'leads (WPP) já tem fonte real, continua saindo');
});

test('calcularDadosOpr: custo nunca nasce de contagem ou investimento <= 0', () => {
  const semNada = calcularDadosOpr([], 0, 0);
  assert.equal(semNada.growth.custoPorSeguidor, null);
  assert.equal(semNada.growth.custoPorVisita, null);
  assert.equal(semNada.growth.conversaoVisitaSeguidor, null, 'visita 0 é denominador inválido, não 0%');
  assert.equal(semNada.engagement.custoPorCurtida, null);
  assert.equal(semNada.engagement.custoMedioPorEngajamento, null);
  assert.equal(semNada.sales.custoPorLead, null);
  assert.equal(semNada.mix.growth, null, 'sem investimento nenhum, 0/0 não é 0% — é null');
  assert.equal(semNada.mix.engagement, null);
  assert.equal(semNada.mix.leads, null);
});

test('calcularDadosOpr: conversão visita->seguidor pode ser 0% de verdade (não é custo)', () => {
  const campanhas = agruparCampanhasDoDia(
    [{ campaign_id: 'c1', spend: 50 }],
    { c1: '[+ SEGUIDORES] X' },
  );
  const dados = calcularDadosOpr(campanhas, 0, 100);
  assert.equal(dados.growth.conversaoVisitaSeguidor, 0, '0 seguidor de 100 visitas é 0% real, não null');
  assert.equal(dados.growth.custoPorSeguidor, null, 'mas custo por seguidor não existe com 0 seguidor (denominador inválido pra custo)');
});

test('calcularDadosOpr: seguidoresDoDia null (sem leitura nenhuma) propaga null, não 0', () => {
  const dados = calcularDadosOpr([], null, 50);
  assert.equal(dados.header.novosSeguidores, null);
  assert.equal(dados.growth.seguidores, null);
  assert.equal(dados.growth.conversaoVisitaSeguidor, null);
});

// Rollout do OPR (pedido do dono, 17/09/2026: "esvazia esse relatório por
// completo, deixa tudo —, vamos ir batendo um por um e preenchendo") — a
// conta em si é `calcularDadosOpr` (testada acima); `montarDadosOpr` é o que
// o dashboard e o robô do WhatsApp realmente usam, e aplica esse rollout.
test('⚠️ montarDadosOpr: só os campos confirmados saem com valor, o resto continua null ("—")', () => {
  const campanhas = agruparCampanhasDoDia([
    { campaign_id: 'c1', spend: 100, conversas: 5 },
    { campaign_id: 'c2', spend: 200, likes: 30, comments: 5, shares: 2, saves: 3, post_engagement: 80 },
  ], { c1: '[CAMPANHA WPP] X', c2: '[+ ENGAJAMENTO] Y' });

  const esperado = calcularDadosOpr(campanhas, 12, 150);
  const dados = montarDadosOpr(campanhas, 12, 150);
  // Mantido em sincronia à mão com o `CAMPOS_CONFIRMADOS` real do arquivo —
  // se um lado mudar sem o outro, este teste é quem acusa a divergência.
  const CONFIRMADOS = new Set([
    'header.novosSeguidores', 'growth.seguidores',
    'header.investimentoTotal', 'header.engajamentos', 'header.leadsGerados',
    'growth.investimento', 'growth.custoPorSeguidor',
    'growth.visitasPerfil', 'growth.custoPorVisita', 'growth.conversaoVisitaSeguidor',
    'engagement.investimento', 'engagement.curtidas', 'engagement.comentarios',
    'engagement.compartilhamentos', 'engagement.salvamentos', 'engagement.custoPorCurtida',
    'engagement.custoPorComentario', 'engagement.custoPorCompartilhamento',
    'engagement.custoPorSalvamento', 'engagement.totalInteracoes', 'engagement.custoMedioPorEngajamento',
    'mix.growth', 'mix.engagement', 'mix.leads',
  ]);

  for (const secao of ['header', 'growth', 'engagement', 'sales', 'mix']) {
    for (const campo of Object.keys(dados[secao])) {
      const chave = `${secao}.${campo}`;
      if (CONFIRMADOS.has(chave)) {
        assert.equal(dados[secao][campo], esperado[secao][campo], `${chave} é confirmado — deveria sair com o valor calculado`);
      } else {
        assert.equal(dados[secao][campo], null, `${chave} deveria ser null (ainda não confirmado)`);
      }
    }
  }
});
