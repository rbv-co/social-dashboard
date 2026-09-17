// supabase/functions/_shared/email-textos.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { textoDoPrimeiroAcesso, textoDaSenhaNova, mascararEmail } from './email-textos.js';

test('o e-mail do primeiro acesso traz a senha e o endereço da página', () => {
  const m = textoDoPrimeiroAcesso('Tereza Aparecida', 'ABCdef234567');
  assert.match(m.html, /ABCdef234567/);
  assert.match(m.texto, /ABCdef234567/);
  assert.match(m.assunto, /VESSEL/);
});

test('⚠️ o e-mail NUNCA repete CPF nem diz o que a pessoa comprou', () => {
  const m = textoDaSenhaNova('Tereza', 'ABCdef234567');
  const tudo = (m.assunto + m.html + m.texto).toLowerCase();
  for (const proibido of ['cpf', 'pedido', 'nota fiscal', 'comprou']) {
    assert.ok(!tudo.includes(proibido), `o texto não pode conter "${proibido}"`);
  }
});

test('⚠️ o e-mail não promete que registrar dá direito legal', () => {
  const tudo = (textoDoPrimeiroAcesso('T', 'x').html).toLowerCase();
  assert.ok(!tudo.includes('obrigat'), 'registro é opcional; o texto não pode dizer o contrário');
});

test('mascarar mostra a primeira letra e o domínio', () => {
  assert.equal(mascararEmail('tereza@exemplo.com.br'), 't•••@exemplo.com.br');
  assert.equal(mascararEmail(''), '');
});
