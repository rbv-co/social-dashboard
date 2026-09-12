import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conversasIniciadas, calcularDeltaHora, visitasNoPerfil, deltaSimples,
} from './delta-de-hora.js';

test('conversasIniciadas acha messaging_conversation_started_7d', () => {
  const actions = [
    { action_type: 'link_click', value: '10' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' },
  ];
  assert.equal(conversasIniciadas(actions), 4);
});

test('conversasIniciadas aceita a variante sem _7d quando é a que existe', () => {
  const actions = [{ action_type: 'onsite_conversion.messaging_conversation_started', value: '2' }];
  assert.equal(conversasIniciadas(actions), 2);
});

test('conversasIniciadas devolve 0 sem actions ou sem o tipo certo', () => {
  assert.equal(conversasIniciadas(null), 0);
  assert.equal(conversasIniciadas([]), 0);
  assert.equal(conversasIniciadas([{ action_type: 'lead', value: '9' }]), 0);
});

test('calcularDeltaHora: primeira leitura do dia (sem anterior) = o próprio acumulado', () => {
  assert.deepEqual(calcularDeltaHora(120.5, 6, null), { gasto_hora: 120.5, conversas_hora: 6 });
});

test('calcularDeltaHora: subtrai contra a última linha gravada', () => {
  const anterior = { gasto_acumulado: 100, conversas_acumuladas: 4 };
  assert.deepEqual(calcularDeltaHora(135, 7, anterior), { gasto_hora: 35, conversas_hora: 3 });
});

test('calcularDeltaHora: nunca devolve negativo (Meta pode corrigir pra baixo)', () => {
  const anterior = { gasto_acumulado: 100, conversas_acumuladas: 10 };
  assert.deepEqual(calcularDeltaHora(90, 8, anterior), { gasto_hora: 0, conversas_hora: 0 });
});

test('visitasNoPerfil acha profile_visits, e 0 sem actions ou sem nenhum tipo conhecido', () => {
  assert.equal(visitasNoPerfil([{ action_type: 'profile_visits', value: '88' }]), 88);
  assert.equal(visitasNoPerfil(null), 0);
  assert.equal(visitasNoPerfil([]), 0);
  assert.equal(visitasNoPerfil([{ action_type: 'post_reaction', value: '9' }]), 0);
});

test('visitasNoPerfil cai para profile_views quando profile_visits não vier', () => {
  assert.equal(visitasNoPerfil([{ action_type: 'profile_views', value: '42' }]), 42);
});

// Fallback pra link_click: conferido ao vivo em 12/09/2026 que NENHUM anúncio
// [+ SEGUIDORES] desta conta gera profile_visits/profile_views (destino é
// link, não "Instagram Profile") — sem o fallback a métrica ficaria sempre
// zerada. Ver comentário em delta-de-hora.js.
test('visitasNoPerfil cai para link_click quando nem profile_visits nem profile_views vierem', () => {
  assert.equal(visitasNoPerfil([{ action_type: 'link_click', value: '999' }]), 999);
});

test('visitasNoPerfil: profile_visits ganha de link_click quando os dois vêm juntos', () => {
  const actions = [
    { action_type: 'link_click', value: '10' },
    { action_type: 'profile_visits', value: '3' },
  ];
  assert.equal(visitasNoPerfil(actions), 3);
});

test('deltaSimples: primeira leitura (sem anterior) = o próprio valor, nunca negativo', () => {
  assert.equal(deltaSimples(50, null), 50);
  assert.equal(deltaSimples(50, undefined), 50);
  assert.equal(deltaSimples(30, 40), 0, 'Meta corrigiu pra baixo — nunca negativo');
  assert.equal(deltaSimples(88, 20), 68);
});
