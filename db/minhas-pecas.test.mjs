// db/minhas-pecas.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-17-vessel-minhas-pecas.sql'), 'utf8').toLowerCase();

test('⚠️ a lista sai da SESSÃO, nunca de um id vindo da página', () => {
  assert.match(SQL, /vessel_conta_da_sessao/);
  assert.ok(!/p_cliente_id/.test(SQL), 'aceitar o id do cliente por parâmetro deixaria qualquer um listar as peças de qualquer um');
});

test('a peça em conferência aparece com esse estado', () => {
  assert.match(SQL, /em conferência/);
});
