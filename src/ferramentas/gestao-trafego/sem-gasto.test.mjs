import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campanhasAguardandoEntrega } from './sem-gasto.js';

const AGORA = Date.parse('2026-09-25T03:47:00Z');
const dias = (n) => new Date(AGORA + n * 86400000).toISOString();

test('campanha ativa sem gasto entra na lista, zerada e marcada', () => {
  // O caso real: CAUÇÃO GRÁTIS ligada à meia-noite, 0 impressões, e sumida da tela.
  const campanhas = [{ id: '120250086602750410', name: '[LEADS] CAUÇÃO GRÁTIS | PIRACICABA [25.09.26]', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }];
  const linhas = campanhasAguardandoEntrega(campanhas, [], AGORA);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].campaign_id, '120250086602750410');
  assert.equal(linhas[0].campaign_name, '[LEADS] CAUÇÃO GRÁTIS | PIRACICABA [25.09.26]');
  assert.equal(linhas[0].objective, 'OUTCOME_LEADS');
  assert.equal(linhas[0].spend, '0');
  assert.deepEqual(linhas[0].actions, []);
  assert.equal(linhas[0].aguardandoEntrega, true);
});

test('campanha que já tem número não é duplicada — nem com id em número', () => {
  const campanhas = [{ id: 111, name: 'A', effective_status: 'ACTIVE' }];
  assert.deepEqual(campanhasAguardandoEntrega(campanhas, [{ campaign_id: '111', spend: '10' }], AGORA), []);
});

test('pausada, arquivada e encerrada sem gasto continuam fora', () => {
  const campanhas = [
    { id: '1', effective_status: 'PAUSED' },
    { id: '2', effective_status: 'ARCHIVED' },
    { id: '3', effective_status: 'ACTIVE', stop_time: dias(-3) },
  ];
  assert.deepEqual(campanhasAguardandoEntrega(campanhas, [], AGORA), []);
});

test('período que não chega a hoje não inventa campanha aguardando', () => {
  const campanhas = [{ id: '1', name: 'nova', effective_status: 'ACTIVE' }];
  assert.deepEqual(campanhasAguardandoEntrega(campanhas, [], AGORA, false), []);
});

test('lista vazia ou ausente não quebra', () => {
  assert.deepEqual(campanhasAguardandoEntrega(undefined, undefined, AGORA), []);
});
