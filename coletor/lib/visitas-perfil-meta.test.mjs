import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epochDoDiaSP } from './visitas-perfil-meta.mjs';

test('epochDoDiaSP: 24h exatas, começando meia-noite em SP (-03:00 = 03:00 UTC)', () => {
  const { since, until } = epochDoDiaSP('2026-09-16');
  assert.equal(until - since, 24 * 3600, 'exatamente um dia inteiro');
  assert.equal(new Date(since * 1000).toISOString(), '2026-09-16T03:00:00.000Z');
  assert.equal(new Date(until * 1000).toISOString(), '2026-09-17T03:00:00.000Z');
});

test('epochDoDiaSP: atravessa mês/ano sem quebrar', () => {
  const { since, until } = epochDoDiaSP('2026-12-31');
  assert.equal(new Date(since * 1000).toISOString(), '2026-12-31T03:00:00.000Z');
  assert.equal(new Date(until * 1000).toISOString(), '2027-01-01T03:00:00.000Z');
});
