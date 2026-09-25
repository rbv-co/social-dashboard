import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mercadoDoConjunto, mercadoDaCampanha, MERCADOS } from './mercados.js';

// As combinações REAIS, medidas em 25/09/2026 nas 6 contas de produção — não
// inventadas (ver docs/superpowers/plans/2026-09-25-gt-onda-c.md, seção "As
// combinações reais"). Uma linha da tabela por teste.

test('WhatsApp: conversa, em qualquer objetivo declarado', () => {
  assert.equal(mercadoDoConjunto({ destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' }), 'conversa');
  // O objetivo NÃO entra na conta — mercadoDoConjunto nem recebe objetivo.
  // OUTCOME_ENGAGEMENT, OUTCOME_LEADS e OUTCOME_SALES com este mesmo conjunto
  // são, todos, 'conversa'.
});

test('perfil do Instagram: três otimizações diferentes, um só mercado', () => {
  assert.equal(mercadoDoConjunto({ destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_AND_PAGE_ENGAGEMENT' }), 'perfil');
  assert.equal(mercadoDoConjunto({ destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_VISIT' }), 'perfil');
  assert.equal(mercadoDoConjunto({ destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'VISIT_INSTAGRAM_PROFILE' }), 'perfil');
});

test('perfil também quando o destino é perfil + página', () => {
  assert.equal(mercadoDoConjunto({ destination_type: 'INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE', optimization_goal: 'PROFILE_VISIT' }), 'perfil');
});

test('vídeo: ON_VIDEO com THRUPLAY', () => {
  assert.equal(mercadoDoConjunto({ destination_type: 'ON_VIDEO', optimization_goal: 'THRUPLAY' }), 'video');
});

test('post: ON_POST com POST_ENGAGEMENT', () => {
  assert.equal(mercadoDoConjunto({ destination_type: 'ON_POST', optimization_goal: 'POST_ENGAGEMENT' }), 'post');
});

test('site com venda: WEBSITE com OFFSITE_CONVERSIONS', () => {
  assert.equal(mercadoDoConjunto({ destination_type: 'WEBSITE', optimization_goal: 'OFFSITE_CONVERSIONS' }), 'site_venda');
});

test('site sem pixel de conversão: UNDEFINED com LANDING_PAGE_VIEWS — a otimização desempata', () => {
  // Aqui o destino (UNDEFINED) não decide nada sozinho — é o caso que existe
  // a otimização como desempate.
  assert.equal(mercadoDoConjunto({ destination_type: 'UNDEFINED', optimization_goal: 'LANDING_PAGE_VIEWS' }), 'site_trafego');
});

test('o OBJETIVO declarado não decide o mercado', () => {
  // A mesma campanha de OUTCOME_ENGAGEMENT vira mercados diferentes conforme o
  // destino. É a razão de existir deste módulo: na Motoeasy "engajamento" é
  // conversa de WhatsApp; na Mantova é visita ao perfil.
  assert.equal(mercadoDaCampanha([{ destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' }]), 'conversa');
  assert.equal(mercadoDaCampanha([{ destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_AND_PAGE_ENGAGEMENT' }]), 'perfil');
  assert.equal(mercadoDaCampanha([{ destination_type: 'ON_VIDEO', optimization_goal: 'THRUPLAY' }]), 'video');
});

test('sem conjunto, ou sinal irreconhecível, devolve desconhecido — nunca chuta', () => {
  assert.equal(mercadoDaCampanha([]), 'desconhecido');
  assert.equal(mercadoDaCampanha(undefined), 'desconhecido');
  assert.equal(mercadoDaCampanha([{ destination_type: 'XPTO', optimization_goal: 'XPTO' }]), 'desconhecido');
  assert.equal(mercadoDoConjunto({ destination_type: 'XPTO', optimization_goal: 'XPTO' }), 'desconhecido');
  assert.equal(mercadoDoConjunto({}), 'desconhecido');
});

test('campanha MISTA se declara mista, não escolhe um lado', () => {
  const mistos = [
    { destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' },
    { destination_type: 'UNDEFINED', optimization_goal: 'LANDING_PAGE_VIEWS' },
  ];
  assert.equal(mercadoDaCampanha(mistos), 'misto',
    'somar mercados diferentes não produz número com significado — ver a [LEADS LOJA][mixconversão]');
});

test('conjunto irreconhecível dentro de uma campanha reconhecida não vira misto sozinho', () => {
  // Um conjunto sem sinal identificável não é um SEGUNDO mercado — é ausência
  // de sinal. Só vira 'misto' quando há DOIS mercados reconhecidos e
  // diferentes ao mesmo tempo.
  const conjuntos = [
    { destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' },
    { destination_type: 'XPTO', optimization_goal: 'XPTO' },
  ];
  assert.equal(mercadoDaCampanha(conjuntos), 'conversa');
});

test('MERCADOS lista os mercados válidos — sem misto e sem desconhecido', () => {
  assert.ok(MERCADOS.includes('conversa'));
  assert.ok(MERCADOS.includes('perfil'));
  assert.ok(MERCADOS.includes('video'));
  assert.ok(MERCADOS.includes('post'));
  assert.ok(MERCADOS.includes('site_venda'));
  assert.ok(MERCADOS.includes('site_trafego'));
  assert.ok(!MERCADOS.includes('misto'));
  assert.ok(!MERCADOS.includes('desconhecido'));
});
