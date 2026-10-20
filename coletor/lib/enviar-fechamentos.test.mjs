import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enviarFechamentos } from './enviar-fechamentos.mjs';

const mudo = () => {};

test('mensagem que falha vira falha devolvida, e a outra ainda sai', async () => {
  const enviadas = [];
  const enviar = async (m) => { if (m === 'L') throw new Error('Z-API send-text: 400'); enviadas.push(m); };
  const falhas = await enviarFechamentos([['leads', 'L'], ['seguidores', 'S']], enviar, mudo);
  assert.deepEqual(falhas, ['leads']);
  assert.deepEqual(enviadas, ['S']);
});

test('tudo enviado: sem falhas; mensagem vazia é pulada, não conta como falha', async () => {
  const enviadas = [];
  const falhas = await enviarFechamentos([['leads', null], ['seguidores', 'S']], async (m) => { enviadas.push(m); }, mudo);
  assert.deepEqual(falhas, []);
  assert.deepEqual(enviadas, ['S']);
});

// Achado 06-A1 (20/10/2026): com REST_VIA_PG o robô saía logo depois das mensagens; a falha só ia para o log e o
// painel ficava verde com a mensagem perdida. O robô precisa sair com erro quando alguma falha.
test('gerar-opr-diario marca a rodada como falha quando uma mensagem de fechamento falha', () => {
  const fonte = readFileSync(new URL('../gerar-opr-diario.mjs', import.meta.url), 'utf8');
  const i = fonte.indexOf('await enviarFechamentos(');
  assert.ok(i > 0, 'o robô tem de mandar o fechamento por enviarFechamentos');
  const depois = fonte.slice(i, fonte.indexOf("rest.via === 'pg'", i));
  assert.match(depois, /if \(falhas\.length\) process\.exitCode = 1/);
});
