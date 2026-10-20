import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./copiar-storage-para-disco.mjs', import.meta.url));

// Um Supabase Storage de mentira: dois buckets, uma pasta, um caminho malicioso e um objeto que falha ao baixar.
function storageFalso(objetos, falha = new Set()) {
  const pedidos = [];
  const srv = http.createServer(async (req, res) => {
    pedidos.push(`${req.method} ${req.url}`);
    if (req.headers.authorization !== 'Bearer CHAVE-DE-TESTE') { res.writeHead(401).end('{}'); return; }
    const m = req.url.match(/^\/storage\/v1\/object\/list\/([^/]+)$/);
    if (m && req.method === 'POST') {
      const corpo = JSON.parse(await new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => ok(s)); }));
      const prefixo = corpo.prefix ? corpo.prefix + '/' : '';
      const nomes = new Map();
      for (const [caminho, o] of Object.entries(objetos[m[1]] ?? {})) {
        if (!caminho.startsWith(prefixo)) continue;
        const resto = caminho.slice(prefixo.length);
        const [primeiro, ...mais] = resto.split('/');
        nomes.set(primeiro, mais.length ? { name: primeiro, id: null } : { name: primeiro, id: 'x', metadata: { size: o.length } });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([...nomes.values()]));
      return;
    }
    const d = req.url.match(/^\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/);
    if (d) {
      const caminho = d[2].split('/').map(decodeURIComponent).join('/');
      const o = (objetos[d[1]] ?? {})[caminho];
      if (!o || falha.has(caminho)) { res.writeHead(falha.has(caminho) ? 500 : 404).end(); return; }
      res.writeHead(200).end(o);
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, pedidos, url: `http://127.0.0.1:${srv.address().port}` })));
}

function rodar(url, args) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, SUPABASE_URL: url, SUPABASE_SERVICE_KEY: 'CHAVE-DE-TESTE' } });
    let saida = '', erro = '';
    p.stdout.on('data', (c) => (saida += c));
    p.stderr.on('data', (c) => (erro += c));
    p.on('close', (codigo) => ok({ codigo, saida, erro }));
  });
}

test('copia os objetos (com pasta), é idempotente e o ensaio não grava', async () => {
  const objetos = { avatars: { 'a.png': Buffer.from('PNG-A') }, conteudo: { 'pasta/b.jpg': Buffer.from('JPG-B'), 'pasta/sub/c.mp4': Buffer.from('MP4-C') } };
  const { srv, url } = await storageFalso(objetos);
  const dir = await mkdtemp(join(tmpdir(), 'copia-storage-'));
  try {
    let r = await rodar(url, [dir, 'avatars', 'conteudo', '--ensaio']);
    assert.equal(r.codigo, 0, r.erro);
    assert.match(r.saida, /ENSAIO: copiados 3/);
    assert.deepEqual(await readdir(dir), [], 'o ensaio não pode gravar nada');
    r = await rodar(url, [dir, 'avatars', 'conteudo']);
    assert.equal(r.codigo, 0, r.erro);
    assert.match(r.saida, /copiados 3 .*já estavam 0, falhas 0/);
    assert.equal(await readFile(join(dir, 'conteudo', 'pasta', 'sub', 'c.mp4'), 'utf8'), 'MP4-C');
    assert.equal(await readFile(join(dir, 'avatars', 'a.png'), 'utf8'), 'PNG-A');
    r = await rodar(url, [dir, 'avatars', 'conteudo']);
    assert.match(r.saida, /copiados 0 .*já estavam 3/);
    assert.ok(!r.saida.includes('CHAVE-DE-TESTE') && !r.erro.includes('CHAVE-DE-TESTE'), 'a chave de serviço nunca é impressa');
  } finally { srv.close(); await rm(dir, { recursive: true, force: true }); }
});

test('falha em um objeto: o resto vem, o código de saída acusa, nada fica pela metade', async () => {
  const objetos = { publico: { 'ok.png': Buffer.from('OK'), 'ruim.png': Buffer.from('RUIM') } };
  const { srv, url } = await storageFalso(objetos, new Set(['ruim.png']));
  const dir = await mkdtemp(join(tmpdir(), 'copia-storage-'));
  try {
    const r = await rodar(url, [dir, 'publico']);
    assert.equal(r.codigo, 1);
    assert.match(r.erro, /falhou publico\/ruim\.png/);
    assert.equal(await readFile(join(dir, 'publico', 'ok.png'), 'utf8'), 'OK');
    assert.deepEqual((await readdir(join(dir, 'publico'))).sort(), ['ok.png'], 'sem temporário nem arquivo parcial');
  } finally { srv.close(); await rm(dir, { recursive: true, force: true }); }
});

test('recusa bucket fora da lista da API e caminho que sai do destino', async () => {
  const { srv, url } = await storageFalso({ publico: { '../fora.png': Buffer.from('X'), 'ok.png': Buffer.from('OK') } });
  const dir = await mkdtemp(join(tmpdir(), 'copia-storage-'));
  try {
    let r = await rodar(url, [dir, 'fotos-modelo']);
    assert.equal(r.codigo, 1);
    assert.match(r.erro, /fora da lista/);
    r = await rodar(url, [dir, 'publico']);
    assert.equal(r.codigo, 1);
    await assert.rejects(stat(join(dir, '..', 'fora.png')));
    assert.equal(await readFile(join(dir, 'publico', 'ok.png'), 'utf8'), 'OK');
  } finally { srv.close(); await rm(dir, { recursive: true, force: true }); }
});
