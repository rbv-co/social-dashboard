import { test } from 'node:test';
import assert from 'node:assert/strict';
import { janelaDeAds, janelaDeAdsAntiga } from './janela-de-ads.js';

// O `time_range` da Meta é INCLUSIVO nas duas pontas — é daí que sai a conta de
// quantos dias uma janela cobre de verdade.
const quantosDias = (j) =>
  Math.round((new Date(j.until + 'T12:00:00') - new Date(j.since + 'T12:00:00')) / 86400000) + 1;

test('7 dias são SETE dias, e nenhum deles é hoje', () => {
  const j = janelaDeAds('2026-08-20', 7);
  assert.deepEqual(j, { since: '2026-08-13', until: '2026-08-19' });
  assert.equal(quantosDias(j), 7);
  assert.notEqual(j.until, '2026-08-20', 'o dia de hoje ainda está correndo');
});

test('o defeito que isto conserta: a janela velha cobria OITO dias e incluía hoje', () => {
  const velha = janelaDeAdsAntiga('2026-08-20', 7);
  assert.deepEqual(velha, { since: '2026-08-13', until: '2026-08-20' });
  assert.equal(quantosDias(velha), 8);
  assert.equal(quantosDias(janelaDeAds('2026-08-20', 7)) + 1, quantosDias(velha), 'exatamente um dia a mais');
});

test('1, 14 e 30 seguem a mesma régua', () => {
  for (const n of [1, 14, 30]) {
    const j = janelaDeAds('2026-08-20', n);
    assert.equal(quantosDias(j), n, `${n} dias`);
    assert.equal(j.until, '2026-08-19', 'toda janela de N dias termina ontem');
  }
});

// A REGRA DE HOJE (period_days = 0) NÃO PODE MUDAR: é ela que alimenta os
// gráficos diários da seção 02 e a conta de qual tipo de campanha ficou sem
// dinheiro no período. Mexer nela quebraria os dois de uma vez.
test('period_days = 0 continua sendo o próprio dia, ponta a ponta', () => {
  assert.deepEqual(janelaDeAds('2026-08-20', 0), { since: '2026-08-20', until: '2026-08-20' });
  assert.deepEqual(janelaDeAds('2026-08-20', 0), janelaDeAdsAntiga('2026-08-20', 0), 'aqui as duas sempre concordaram');
});

test('vira o mês e vira o ano sem sair do calendário', () => {
  assert.deepEqual(janelaDeAds('2026-03-01', 7), { since: '2026-02-22', until: '2026-02-28' });
  assert.deepEqual(janelaDeAds('2026-01-01', 30), { since: '2025-12-02', until: '2025-12-31' });
  assert.deepEqual(janelaDeAds('2026-03-01', 1), { since: '2026-02-28', until: '2026-02-28' });
});

test('entrada inválida devolve null — nunca uma janela chutada', () => {
  for (const ruim of [null, undefined, '', 123]) assert.equal(janelaDeAds(ruim, 7), null, String(ruim));
  for (const ruim of [null, undefined, -1, 1.5, 'sete', NaN]) assert.equal(janelaDeAds('2026-08-20', ruim), null, String(ruim));
});
