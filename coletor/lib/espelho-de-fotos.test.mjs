import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sincronizarPasta, podarPastas, versaoDoTratamento } from './espelho-de-fotos.mjs';

const roda = (dir, remotos, manifesto, extra = []) => {
  let chamadas = 0;
  const baixar = async (f) => { chamadas++; return Buffer.from('conteudo-' + f.versao); };
  return sincronizarPasta({ dir, remotos, todosNomes: new Set([...remotos.map((r) => r.nome), ...extra]), manifesto, baixar })
    .then((r) => ({ ...r, chamadas }));
};

test('primeira vez baixa tudo; segunda vez não baixa nada', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'esp-')), 'Produto - SS0001');
  const m = {};
  const remotos = [{ nome: 'a.png', versao: '1:10' }, { nome: 'b.jpeg', versao: '1:20' }];
  assert.deepEqual(await roda(dir, remotos, m), { baixados: 2, apagados: 0, trocados: 0, chamadas: 2 });
  assert.deepEqual(await roda(dir, remotos, m), { baixados: 0, apagados: 0, trocados: 0, chamadas: 0 });
});

test('foto trocada no Zoho (versão nova) é baixada de novo e conta como trocada', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'esp-')), 'P');
  const m = {};
  await roda(dir, [{ nome: 'a.png', versao: '1:10' }], m);
  const r = await roda(dir, [{ nome: 'a.png', versao: '2:10' }], m);
  assert.equal(r.trocados, 1);
  assert.equal(readFileSync(join(dir, 'a.png'), 'utf8'), 'conteudo-2:10');
});

test('arquivo que sumiu do Zoho some do disco e conta como trocado; o filtrado de fora fica', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'esp-')), 'P');
  const m = {};
  await roda(dir, [{ nome: 'a.png', versao: '1:1' }, { nome: 'b.jpeg', versao: '1:2' }], m);
  const r = await roda(dir, [{ nome: 'a.png', versao: '1:1' }], m, ['b.jpeg']); // b.jpeg existe no Zoho, só não é desejado aqui
  assert.equal(r.apagados, 0);
  const r2 = await roda(dir, [{ nome: 'a.png', versao: '1:1' }], m); // agora b.jpeg sumiu de vez
  assert.deepEqual([r2.apagados, r2.trocados], [1, 1]);
  assert.deepEqual(readdirSync(dir), ['a.png']);
});

test('sem versão não dá para provar que não mudou: baixa sempre', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'esp-')), 'P');
  const m = {};
  await roda(dir, [{ nome: 'a.png' }], m);
  assert.equal((await roda(dir, [{ nome: 'a.png' }], m)).chamadas, 1);
});

test('podarPastas tira a pasta que não existe mais e as entradas dela', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'esp-'));
  mkdirSync(join(raiz, 'Velha')); mkdirSync(join(raiz, 'Nova'));
  writeFileSync(join(raiz, '.manifesto.json'), '{}');
  const m = { 'Velha/a.png': '1', 'Nova/b.png': '2' };
  assert.equal(podarPastas(raiz, new Set(['Nova']), m), 1);
  assert.deepEqual(m, { 'Nova/b.png': '2' });
  assert.ok(!existsSync(join(raiz, 'Velha')) && existsSync(join(raiz, 'Nova')));
});

test('versaoDoTratamento muda com o conteúdo de arquivo e de pasta, e não com o mesmo conteúdo', () => {
  const d = mkdtempSync(join(tmpdir(), 'esp-'));
  writeFileSync(join(d, 'tratar.py'), 'v1'); mkdirSync(join(d, 'a-mao'));
  const v1 = versaoDoTratamento([join(d, 'tratar.py'), join(d, 'a-mao')]);
  assert.equal(versaoDoTratamento([join(d, 'tratar.py'), join(d, 'a-mao')]), v1);
  writeFileSync(join(d, 'a-mao', 'Linear.png'), 'x');
  const v2 = versaoDoTratamento([join(d, 'tratar.py'), join(d, 'a-mao')]);
  assert.notEqual(v2, v1);
  writeFileSync(join(d, 'tratar.py'), 'v2');
  assert.notEqual(versaoDoTratamento([join(d, 'tratar.py'), join(d, 'a-mao')]), v2);
});
