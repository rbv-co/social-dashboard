import { test } from 'node:test';
import assert from 'node:assert/strict';
import { custoEngajamentoPraticado } from './custo-praticado.js';

// Insight mínimo de engajamento: gasto + post_engagement.
function insightEngajamento({ campaign_id = 'c1', campaign_name = 'Campanha', spend = '100', engajamentos = 500, objective = 'OUTCOME_ENGAGEMENT' } = {}) {
  return {
    campaign_id, campaign_name, objective, spend,
    actions: [{ action_type: 'post_engagement', value: String(engajamentos) }],
  };
}

test('soma gasto e engajamento de todas as campanhas de engajamento e divide no fim', () => {
  const insights = [
    insightEngajamento({ campaign_id: 'c1', spend: '100', engajamentos: 500 }),   // R$ 0,20/engaj isolado
    insightEngajamento({ campaign_id: 'c2', spend: '10000', engajamentos: 1000 }), // R$ 10/engaj isolado
  ];
  // Média das médias daria (0,20 + 10) / 2 = 5,10 — errado: pesaria igual uma
  // campanha de R$ 100 e uma de R$ 10.000. A conta certa é (100+10000)/(500+1000).
  const esperado = (100 + 10000) / (500 + 1000);
  assert.equal(custoEngajamentoPraticado(insights, []), esperado);
});

test('exclui campanha de MENSAGEM (WhatsApp) mesmo caindo no balde engajamento', () => {
  const insights = [
    insightEngajamento({ campaign_id: 'c1', spend: '100', engajamentos: 500 }),
    insightEngajamento({ campaign_id: 'c2', spend: '9999', engajamentos: 1 }), // seria um outlier gigante
  ];
  const adsets = [{ campaign_id: 'c2', destination_type: 'WHATSAPP' }];
  assert.equal(custoEngajamentoPraticado(insights, adsets), 100 / 500,
    'a campanha de WhatsApp (c2) não pode entrar na soma — ela vende conversa, não engajamento');
});

// Defeito real da rodada 1 de revisão (24/09/2026, conta Mantova Móveis):
// campanha "[+ SEGUIDORES]" caindo no balde engajamento entrava na soma, e a
// ferramenta já declara "medida indisponível" pra esse tipo — o número de
// referência da régua não pode ser puxado pela campanha que a régua não julga.
test('exclui campanha DE SEGUIDORES mesmo caindo no balde engajamento', () => {
  const insights = [
    insightEngajamento({ campaign_id: 'c1', campaign_name: '[LOJA] REELS', spend: '100', engajamentos: 500 }),
    insightEngajamento({ campaign_id: 'c2', campaign_name: '[+ SEGUIDORES] DETALHES | P3', spend: '9999', engajamentos: 1 }),
  ];
  assert.equal(custoEngajamentoPraticado(insights, []), 100 / 500,
    'a campanha de seguidores (c2) não pode entrar na soma — a Meta não atribui seguidor a campanha nenhuma');
});

test('campanha que não é de engajamento não entra na soma', () => {
  const insights = [
    insightEngajamento({ campaign_id: 'c1', spend: '100', engajamentos: 500 }),
    { campaign_id: 'c2', campaign_name: 'Tráfego', objective: 'OUTCOME_TRAFFIC', spend: '9999', actions: [] },
  ];
  assert.equal(custoEngajamentoPraticado(insights, []), 100 / 500);
});

test('sem nenhuma campanha de engajamento com dado, devolve null (nunca zero)', () => {
  assert.equal(custoEngajamentoPraticado([], []), null);
  assert.equal(custoEngajamentoPraticado(
    [{ campaign_id: 'c1', campaign_name: 'X', objective: 'OUTCOME_TRAFFIC', spend: '100', actions: [] }], []
  ), null);
});

test('engajamento sem gasto registrado (spend zero) não gera divisão por lixo', () => {
  const insights = [insightEngajamento({ spend: '0', engajamentos: 500 })];
  assert.equal(custoEngajamentoPraticado(insights, []), null);
});

test('gasto sem nenhum engajamento contado também devolve null, não custo infinito', () => {
  const insights = [insightEngajamento({ spend: '100', engajamentos: 0 })];
  assert.equal(custoEngajamentoPraticado(insights, []), null);
});

test('insights/adsets ausentes não derrubam a função', () => {
  assert.equal(custoEngajamentoPraticado(undefined, undefined), null);
});
