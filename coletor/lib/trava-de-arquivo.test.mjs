import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { comTrava } from './trava-de-arquivo.mjs';

const nova = () => join(mkdtempSync(join(tmpdir(), 'trava-')), 'trava');

test('duas seções críticas nunca se sobrepõem', async () => {
  const t = nova(); let dentro = 0, maximo = 0;
  const secao = () => comTrava(t, async () => { dentro++; maximo = Math.max(maximo, dentro); await new Promise((r) => setTimeout(r, 30)); dentro--; });
  await Promise.all([secao(), secao(), secao(), secao()]);
  assert.equal(maximo, 1);
  assert.ok(!existsSync(t), 'a trava some no fim');
});

test('devolve o valor e solta a trava mesmo quando a função falha', async () => {
  const t = nova();
  assert.equal(await comTrava(t, async () => 42), 42);
  await assert.rejects(comTrava(t, async () => { throw new Error('x'); }), /x/);
  assert.ok(!existsSync(t));
});

test('trava de processo que morreu é tomada; a de processo vivo espera e estoura o prazo', async () => {
  const morta = nova(); mkdirSync(morta); writeFileSync(join(morta, 'pid'), '2147483646'); // pid que não existe
  assert.equal(await comTrava(morta, async () => 'tomei'), 'tomei');
  const viva = nova(); mkdirSync(viva); writeFileSync(join(viva, 'pid'), String(process.pid));
  await assert.rejects(comTrava(viva, async () => 'não', { esperaMaxMs: 300 }), /trava ocupada/);
});
