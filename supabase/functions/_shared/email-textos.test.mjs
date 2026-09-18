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

test('⚠️ nome com HTML sai ESCAPADO no html (nunca cru) e literal no texto', () => {
  // Sem espaço logo após o nome: `textoDoPrimeiroAcesso` usa só a 1ª "palavra"
  // do nome (split por espaço) — um ataque de verdade não avisa com espaço
  // antes da tag, então o teste tem de refletir isso.
  const m = textoDoPrimeiroAcesso('José<img/src=x/onerror=alert(1)>', 'ABCdef234567');
  assert.ok(!m.html.includes('<img'), 'o html não pode conter a tag crua do nome');
  assert.match(m.html, /&lt;img/);
  assert.match(m.texto, /<img\/src=x\/onerror=alert\(1\)>/, 'texto puro não precisa de escape');
});

test('⚠️ senha com < e & sai escapada no html', () => {
  const m = textoDaSenhaNova('Tereza', 'AB<cd&ef>23');
  assert.ok(!m.html.includes('<cd&ef>'), 'a senha crua não pode aparecer no html');
  assert.match(m.html, /AB&lt;cd&amp;ef&gt;23/);
});

test('escapar não estraga o caso normal — nome simples continua legível', () => {
  const m = textoDoPrimeiroAcesso('Tereza Aparecida', 'ABCdef234567');
  assert.match(m.html, /Bem-vinda, Tereza/);
  assert.ok(!m.html.includes('&amp;'), 'nome sem caractere especial não deve ganhar &amp; nenhum');
});
