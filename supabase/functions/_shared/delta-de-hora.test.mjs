import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conversasIniciadas, calcularDeltaHora, visitasNoPerfil, deltaSimples,
  linkDoCriativo, linkClicks,
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

test('linkDoCriativo: object_story_spec.link_data.link é o formato mais comum', () => {
  const creative = { object_story_spec: { link_data: { link: 'https://vesselbrasil.com.br/?utm=x' } } };
  assert.equal(linkDoCriativo(creative), 'https://vesselbrasil.com.br/?utm=x');
});

test('linkDoCriativo: video_data com call_to_action.value.link', () => {
  const creative = { object_story_spec: { video_data: { call_to_action: { value: { link: 'https://vesselbrasil.com.br/universovessel#narrativa' } } } } };
  assert.equal(linkDoCriativo(creative), 'https://vesselbrasil.com.br/universovessel#narrativa');
});

test('linkDoCriativo: asset_feed_spec.link_urls (criativo dinâmico), junta se tiver mais de um', () => {
  const creative = { asset_feed_spec: { link_urls: [{ website_url: 'https://vesselbrasil.com.br/a' }, { website_url: 'https://vesselbrasil.com.br/b' }] } };
  assert.equal(linkDoCriativo(creative), 'https://vesselbrasil.com.br/a | https://vesselbrasil.com.br/b');
});

test('linkDoCriativo: object_url como último recurso', () => {
  assert.equal(linkDoCriativo({ object_url: 'https://vesselbrasil.com.br/x' }), 'https://vesselbrasil.com.br/x');
});

test('linkDoCriativo: sem creative ou sem nenhum campo conhecido vira null (ex.: anúncio clique-pro-WhatsApp)', () => {
  assert.equal(linkDoCriativo(null), null);
  assert.equal(linkDoCriativo(undefined), null);
  assert.equal(linkDoCriativo({ object_story_spec: {} }), null);
  assert.equal(linkDoCriativo({ asset_feed_spec: { message_extensions: [{ type: 'whatsapp' }] } }), null);
});

test('linkClicks: acha link_click, e 0 sem actions ou sem o tipo', () => {
  assert.equal(linkClicks([{ action_type: 'link_click', value: '42' }]), 42);
  assert.equal(linkClicks(null), 0);
  assert.equal(linkClicks([]), 0);
  assert.equal(linkClicks([{ action_type: 'post_reaction', value: '9' }]), 0);
});
