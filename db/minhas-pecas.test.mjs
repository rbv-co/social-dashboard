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

test('⚠️ Correção 1: uma peça já registrada não aparece de novo como "em conferência"', () => {
  // Sem esta trava, a própria dona reabrindo um pedido de registro para um
  // código que já é dela faria a peça sair DUAS VEZES na lista: uma como
  // "registrada", outra como "em conferência" do mesmo código.
  const ramoPendente = SQL.slice(SQL.indexOf('em conferência'));
  assert.match(ramoPendente, /not exists\s*\(\s*select 1 from public\.vessel_registros r2 where r2\.codigo = pr\.codigo\s*\)/,
    'o ramo "em conferência" precisa excluir códigos que já estão em vessel_registros');
});
