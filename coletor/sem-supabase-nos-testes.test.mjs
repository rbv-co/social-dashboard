import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Se este arquivo falhar, `npm test` voltou a poder mexer no Supabase desligado
// (o contador de logins do D+14 só pára se isto estiver verde).

test('a guarda está carregada: credenciais do Supabase não existem no teste', () => {
  assert.equal(globalThis.fetch.guardaSemSupabase, true, 'rode pelo npm test (node --test --import coletor/lib/sem-supabase-nos-testes.mjs)');
  const vazadas = Object.keys(process.env).filter((k) => /^(SUPABASE_|GESTOR_USER_)/.test(k));
  assert.deepEqual(vazadas, []);
});

test('fetch para *.supabase.co/.com e para o host-placeholder é recusado', async () => {
  for (const url of ['https://qualquer.supabase.co/rest/v1/x', 'https://aws-0.pooler.supabase.com/', 'https://supabase-desligado.invalid/auth/v1/token']) {
    await assert.rejects(fetch(url), /Supabase desligado/, url);
  }
});

test('http.request (pg, curl-fetch, etc.) para o Supabase também é recusado', async () => {
  const err = await new Promise((resolve) => {
    http.get('http://qualquer.supabase.co/', () => resolve(null)).on('error', resolve);
  });
  assert.match(String(err?.message), /Supabase desligado/);
});

test('rede local continua funcionando (a guarda não é um bloqueio geral)', async () => {
  const srv = http.createServer((_, res) => res.end('ok')).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${srv.address().port}/`)).text(), 'ok');
  } finally { srv.close(); }
});
