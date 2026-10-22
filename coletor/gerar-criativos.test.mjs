import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

// A API da Central é FALSA (servidor local): o teste nunca fala com o Supabase (desligado em 22/10/2026) nem
// com a API de verdade. Registra cada pedido para provar que NADA saiu para *.supabase.co.
const pedidos = [];
const api = http.createServer((req, res) => {
  pedidos.push(`${req.method} ${req.url.split('?')[0]}`);
  res.setHeader('Content-Type', 'application/json'); res.setHeader('X-Total-Count', '0');
  res.end('[]');   // fabrica_looks/objetivos/marcas/lojas vazios: a rota de "tabela não povoada"
}).listen(0, '127.0.0.1');
await new Promise((r) => api.once('listening', r));
process.env.CENTRAL_API_URL = `http://127.0.0.1:${api.address().port}`;
process.env.CENTRAL_API_TOKEN = 'srv_teste';
const { run, objetivoPermitePromo } = await import('./gerar-criativos.mjs');
test.after(() => api.close());

test('sem CENTRAL_API_*: run() falha alto antes de qualquer requisição (não cai no Supabase)', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    "const { run } = await import(process.argv[1]); await run({ dry: true }).catch((e) => console.log(e.message))",
    new URL('./gerar-criativos.mjs', import.meta.url).href], { env: { PATH: process.env.PATH, COLETOR_ENV: '/nao-existe' }, encoding: 'utf8' });
  assert.match(r.stdout, /CENTRAL_API_URL \+ CENTRAL_API_TOKEN.*Supabase foi desligado/);
});

test('run() é exportada e aceita opts', () => {
  assert.equal(typeof run, 'function');
});

test('run({dry:true, limite:0}) sem itens/--estrela falha rápido (fabrica_rodadas/candidatos foram dropadas na migration 019)', async () => {
  await assert.rejects(
    () => run({ dry: true, limite: 0 }),
    /forneça itens \(modo Estúdio\) ou --estrela/
  );
});

test('run() aceita objetivo no destructuring (não quebra a assinatura) — mesmo guard de itens/--estrela, agora com objetivo', async () => {
  // itens:[] cai no mesmo guard "forneça itens ou --estrela" de antes (candsDeItens
  // trata array vazio como ausente); o que este teste garante é que adicionar
  // `objetivo` ao destructuring/filtro não muda esse comportamento nem lança um
  // erro diferente (ex.: ReferenceError por causa do novo bloco de filtro).
  await assert.rejects(
    () => run({ dry: true, objetivo: 'branding', itens: [] }),
    /forneça itens \(modo Estúdio\) ou --estrela/
  );
});

test('contrato: o que run() pediu saiu SÓ para a API da Central, 0 requisição ao Supabase', () => {
  assert.ok(pedidos.length > 0, 'run() deveria ter lido a curadoria pela API');
  assert.ok(pedidos.every((p) => p.startsWith('GET /fabrica/')), pedidos.join(', '));
});

test('objetivoPermitePromo: branding não permite promo; engajamento sim; null sim', () => {
  assert.equal(objetivoPermitePromo('branding'), false);
  assert.equal(objetivoPermitePromo('engajamento'), true);
  assert.equal(objetivoPermitePromo('conversao'), true);
  assert.equal(objetivoPermitePromo('trafego'), true);
  assert.equal(objetivoPermitePromo(null), true);
});

test('gerar importa looksAtivosOrdenados (integra fabrica_looks)', async () => {
  const looks = await import('./lib/looks.mjs');
  assert.equal(typeof looks.looksAtivosOrdenados, 'function');
});
