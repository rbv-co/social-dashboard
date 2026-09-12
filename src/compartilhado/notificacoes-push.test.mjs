// src/compartilhado/notificacoes-push.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Este módulo puxa, na cadeia de imports, o conectar-no-banco-de-dados.js, que
// chama window.supabase.createClient() assim que carrega. No navegador o window
// existe; aqui no node, não. Então fingimos um window mínimo ANTES de importar —
// por isso o import é dinâmico e não estático, senão ele rodaria primeiro.
globalThis.window = { supabase: { createClient: () => ({}) } };
const { urlBase64ToUint8Array, devePedirPush, deveInscreverEmSilencio } = await import('./notificacoes-push.js');

test('urlBase64ToUint8Array: decodifica VAPID base64url para bytes', () => {
  // "BLc" base64url -> 2 bytes conhecidos
  const out = urlBase64ToUint8Array('BLc');
  assert.ok(out instanceof Uint8Array);
  assert.equal(out.length, 2);       // "BLc" (3 chars b64) = 2 bytes
  assert.equal(out[0], 0x04);
  assert.equal(out[1], 0xb7);
});

// ── devePedirPush ─────────────────────────────────────────────────────────
// O dono reclamou em 13/08/2026: "para todos da Central, sempre está pedindo
// para ativar notificações; se o usuário ou o dispositivo já aceitou não precisa
// mostrar novamente". A regra antiga só calava com 'denied' ou com inscrição
// feita — quem fechava o convite era perguntado em TODA abertura.
const base = { suportado: true, permissao: 'default', inscrito: false, dispensou: false };

test('pergunta uma vez para quem nunca decidiu', () => {
  assert.equal(devePedirPush(base), true);
});

test('NÃO pergunta se a permissão já foi concedida (o aparelho já aceitou)', () => {
  assert.equal(devePedirPush({ ...base, permissao: 'granted' }), false);
  // inclusive quando a inscrição sumiu do aparelho: aí se inscreve em silêncio,
  // porque com permissão dada o navegador não mostra prompt nenhum.
  assert.equal(devePedirPush({ ...base, permissao: 'granted', inscrito: false }), false);
});

test('NÃO pergunta se o navegador negou', () => {
  assert.equal(devePedirPush({ ...base, permissao: 'denied' }), false);
});

test('NÃO pergunta para quem já está inscrito', () => {
  assert.equal(devePedirPush({ ...base, inscrito: true }), false);
});

test('NÃO pergunta de novo para quem já dispensou o convite neste aparelho', () => {
  assert.equal(devePedirPush({ ...base, dispensou: true }), false);
});

test('NÃO pergunta onde push não é suportado', () => {
  assert.equal(devePedirPush({ ...base, suportado: false }), false);
  assert.equal(devePedirPush({ ...base, suportado: false, permissao: 'nao-suportado' }), false);
});

test('chamada sem argumento não explode nem pergunta', () => {
  assert.equal(devePedirPush(), false);
});

// ── deveInscreverEmSilencio ───────────────────────────────────────────────
test('permissão concedida e sem inscrição neste aparelho: inscreve calado', () => {
  assert.equal(deveInscreverEmSilencio({ ...base, permissao: 'granted', inscrito: false }), true);
});

test('já inscrito, ou sem permissão, não inscreve nada', () => {
  assert.equal(deveInscreverEmSilencio({ ...base, permissao: 'granted', inscrito: true }), false);
  assert.equal(deveInscreverEmSilencio({ ...base, permissao: 'default' }), false);
  assert.equal(deveInscreverEmSilencio({ ...base, permissao: 'denied' }), false);
  assert.equal(deveInscreverEmSilencio({ ...base, suportado: false, permissao: 'granted' }), false);
});
