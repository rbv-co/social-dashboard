import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mercadoDoConjunto, mercadoDaCampanha, MERCADOS,
  MERCADO_POR_DESTINO, DESTINOS_QUE_EXIGEM_DESEMPATE,
} from './mercados.js';

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

test('WEBSITE não decide sozinho — rodada de correção 25/09/2026', () => {
  // O BUG: WEBSITE estava cravado como 'site_venda' no mapa de destino, então
  // uma campanha de TRÁFEGO para site (destino WEBSITE, otimização
  // LANDING_PAGE_VIEWS — caso comuníssimo) virava 'site_venda' e era julgada
  // por CAC. É a mesma classe de defeito que esta onda existe pra matar.
  assert.equal(mercadoDoConjunto({ destination_type: 'WEBSITE', optimization_goal: 'LANDING_PAGE_VIEWS' }), 'site_trafego');
  assert.equal(mercadoDoConjunto({ destination_type: 'WEBSITE', optimization_goal: 'LINK_CLICKS' }), 'site_trafego');
});

test('WEBSITE com otimização que este módulo não reconhece devolve desconhecido — nunca chuta', () => {
  assert.equal(mercadoDoConjunto({ destination_type: 'WEBSITE', optimization_goal: 'ALGO_NOVO_DA_META' }), 'desconhecido');
});

test('site sem pixel de conversão: UNDEFINED com LANDING_PAGE_VIEWS — a otimização desempata', () => {
  // Aqui o destino (UNDEFINED) não decide nada sozinho — é o caso que existe
  // a otimização como desempate.
  assert.equal(mercadoDoConjunto({ destination_type: 'UNDEFINED', optimization_goal: 'LANDING_PAGE_VIEWS' }), 'site_trafego');
});

// A trava de verdade contra "o objetivo volta a decidir": as TRÊS linhas da
// fixture com o MESMO par destino/otimização (WHATSAPP + CONVERSATIONS) e
// OBJETIVO diferente em cada uma. O campo `objective` está DENTRO do objeto de
// teste de propósito — se `mercadoDoConjunto` alguma hora passar a ler
// `conjunto.objective`, estes três casos divergem e um destes testes quebra.
// A versão anterior (rodada de correção 2, 25/09/2026) nunca passava
// `objective` nos dados, então não distinguia "ignora certo" de "nunca
// recebeu essa entrada" — continuaria verde mesmo se alguém reintroduzisse a
// leitura do objetivo.
test('fixture: OUTCOME_ENGAGEMENT + WHATSAPP + CONVERSATIONS → conversa', () => {
  assert.equal(mercadoDaCampanha([{ objective: 'OUTCOME_ENGAGEMENT', destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' }]), 'conversa');
});

test('fixture: OUTCOME_LEADS + WHATSAPP + CONVERSATIONS → conversa — mesmo par, objetivo diferente', () => {
  assert.equal(mercadoDaCampanha([{ objective: 'OUTCOME_LEADS', destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' }]), 'conversa');
});

test('fixture: OUTCOME_SALES + WHATSAPP + CONVERSATIONS → conversa — os três objetivos convergem no mesmo mercado', () => {
  assert.equal(mercadoDaCampanha([{ objective: 'OUTCOME_SALES', destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' }]), 'conversa');
});

test('o mesmo objetivo declarado (OUTCOME_ENGAGEMENT) vira mercados diferentes conforme o destino', () => {
  // É a razão de existir deste módulo: na Motoeasy "engajamento" é conversa de
  // WhatsApp; na Mantova é visita ao perfil; no [FLUXO SHOPPING] da Vessel é
  // vídeo. Ilustrativo (destino já varia entre os três casos) — a trava real
  // contra a leitura do objetivo é o bloco acima, com destino FIXO.
  assert.equal(mercadoDaCampanha([{ objective: 'OUTCOME_ENGAGEMENT', destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' }]), 'conversa');
  assert.equal(mercadoDaCampanha([{ objective: 'OUTCOME_ENGAGEMENT', destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_AND_PAGE_ENGAGEMENT' }]), 'perfil');
  assert.equal(mercadoDaCampanha([{ objective: 'OUTCOME_ENGAGEMENT', destination_type: 'ON_VIDEO', optimization_goal: 'THRUPLAY' }]), 'video');
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

test('trava de consistência: nenhum destino que exige desempate decide sozinho ao mesmo tempo', () => {
  // Antes (rodada de correção 1) isto era um `throw` na carga do módulo — pego
  // por mutação (reintroduzir `WEBSITE: 'site_venda'` derrubava a IMPORTAÇÃO
  // inteira, não só um teste). Movido para cá na rodada de correção 2: mesma
  // cobertura de regressão, sem o risco de uma violação futura derrubar
  // qualquer tela que importe mercados.js transitivamente.
  for (const destino of DESTINOS_QUE_EXIGEM_DESEMPATE) {
    assert.ok(
      !(destino in MERCADO_POR_DESTINO),
      `${destino} não pode estar em MERCADO_POR_DESTINO e em DESTINOS_QUE_EXIGEM_DESEMPATE ao mesmo tempo`,
    );
  }
});
