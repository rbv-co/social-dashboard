import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-17-vessel-registro-com-conta.sql'), 'utf8').toLowerCase();

test('⚠️ registrar exige sessão', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_registrar_como_cliente'));
  assert.match(f, /vessel_conta_da_sessao/);
  assert.match(f, /sem_sessao/);
});

test('⚠️ as funções novas não são concedidas a anon', () => {
  assert.ok(!/grant execute on function public\.vessel_(registrar_como_cliente|candidatos_de_presente)[^;]*to (anon|authenticated)/.test(SQL));
});

test('a marca PRESENTE é lida sem acento e sem maiúscula', () => {
  assert.match(SQL, /translate\(lower\(p_texto\)/);
});

test('⚠️ vessel_aprovar_presente NÃO existe — a aprovação usa vessel_decidir_pedido_de_registro', () => {
  assert.ok(!SQL.includes('vessel_aprovar_presente'));
});
