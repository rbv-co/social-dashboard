import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GT_METRIC_CATALOG, GT_BALDE_PADRAO } from './metricas.js';

// Um insight com número redondo em cada métrica, pra conta errada aparecer.
const INS = {
  spend: '1000', impressions: '50000', clicks: '800', ctr: '1.6', cpc: '1.25',
  reach: '25000', frequency: '2',
  actions: [
    { action_type: 'lead', value: '40' },
    { action_type: 'landing_page_view', value: '500' },
    { action_type: 'link_click', value: '800' },
    { action_type: 'post_engagement', value: '2000' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '100' },
    { action_type: 'purchase', value: '20' },
  ],
  action_values: [{ action_type: 'purchase', value: '5000' }],
};

const calc = (k) => GT_METRIC_CATALOG[k].compute(INS);

test('o catálogo calcula o que a tela sempre calculou', () => {
  assert.equal(calc('leads'), 40);
  assert.equal(calc('custo_lead'), 25);          // 1000 / 40
  assert.equal(calc('visitas'), 500);            // landing_page_view ganha de link_click
  assert.equal(calc('custo_visita'), 2);         // 1000 / 500
  assert.equal(calc('cpm'), 20);                 // 1000 / 50000 * 1000
  assert.equal(calc('conversas'), 100);
  assert.equal(calc('custo_conversa'), 10);      // 1000 / 100
  assert.equal(calc('compras'), 20);
  assert.equal(calc('cac'), 50);                 // 1000 / 20
  assert.equal(calc('valor_conversao'), 5000);
  assert.equal(calc('roas'), 5);                 // 5000 / 1000, sem purchase_roas
  assert.equal(calc('engaj_pub'), 2000);
  assert.equal(calc('alcance'), 25000);
  assert.equal(calc('frequencia'), 2);
  assert.equal(calc('gasto'), 1000);
});

test('ação que a Meta omitiu vira null, nunca zero', () => {
  // A Meta OMITE o action_type inteiro quando a contagem é zero.
  const vazio = { spend: '500', actions: [] };
  assert.equal(GT_METRIC_CATALOG.leads.compute(vazio), null);
  assert.equal(GT_METRIC_CATALOG.custo_lead.compute(vazio), null,
    'custo com zero lead precisa ser null: R$ 0,00 seria lido como "de graça"');
  assert.equal(GT_METRIC_CATALOG.custo_conversa.compute(vazio), null);
});

test('insight sem o array actions não derruba o cálculo', () => {
  assert.equal(GT_METRIC_CATALOG.leads.compute({ spend: '10' }), null);
  assert.equal(GT_METRIC_CATALOG.roas.compute({ spend: '10' }), null);
});

test('todo balde aponta só para métricas que existem no catálogo', () => {
  for (const [balde, chaves] of Object.entries(GT_BALDE_PADRAO)) {
    for (const k of chaves) {
      assert.ok(GT_METRIC_CATALOG[k], `${balde} aponta para "${k}", que não existe no catálogo`);
    }
  }
});

test('a tela não tem mais a sua própria cópia do catálogo', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const vue = readFileSync(join(aqui, 'tela-de-gestao-trafego.vue'), 'utf8');
  assert.ok(!/const\s+GT_METRIC_CATALOG\s*=/.test(vue),
    'a tela redefine GT_METRIC_CATALOG: duas fontes acabam discordando');
  assert.ok(!/function\s+_gtActionVal\s*\(/.test(vue),
    'a tela redefine _gtActionVal: duas fontes acabam discordando');
  assert.ok(/from '\.\/metricas\.js'/.test(vue), 'a tela precisa importar de metricas.js');
});
