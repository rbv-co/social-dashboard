// A falha do ZeptoMail tem de deixar o MOTIVO no log (08/10/2026: recusava tudo
// e só saía `false`) — e nunca o destinatário, o texto do e-mail nem o token.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Deno = { env: { get: (k) => (k === 'ZEPTOMAIL_TOKEN' ? 'TOKEN-SECRETO-123' : undefined) } };
const { mandarEmail } = await import('./email-zeptomail.ts');

const msg = { assunto: 'a', html: '<p>SENHA-NO-TEXTO</p>', texto: 'SENHA-NO-TEXTO' };

async function capturando(fetchFalso) {
  const logs = [];
  const { error } = console;
  console.error = (...a) => logs.push(a.join(' '));
  globalThis.fetch = fetchFalso;
  try {
    return { ok: await mandarEmail('cliente@exemplo.com', msg), logs };
  } finally {
    console.error = error;
  }
}

test('recusa do ZeptoMail: devolve false e loga status, código e mensagem — sem segredo', async () => {
  const { ok, logs } = await capturando(async () => new Response(
    JSON.stringify({ error: { code: 'TM_3501', message: 'Sender domain not verified', details: [{ target: 'cliente@exemplo.com' }] } }),
    { status: 400 }));
  assert.equal(ok, false);
  const log = logs.join('\n');
  assert.match(log, /400/);
  assert.match(log, /TM_3501/);
  assert.match(log, /Sender domain not verified/);
  assert.doesNotMatch(log, /cliente@exemplo\.com|SENHA-NO-TEXTO|TOKEN-SECRETO/);
});

test('rede fora: devolve false e loga a causa', async () => {
  const { ok, logs } = await capturando(async () => { throw new Error('fetch failed'); });
  assert.equal(ok, false);
  assert.match(logs.join('\n'), /fetch failed/);
});

test('envio aceito: devolve true e não loga erro', async () => {
  const { ok, logs } = await capturando(async () => new Response('{}', { status: 201 }));
  assert.equal(ok, true);
  assert.deepEqual(logs, []);
});
