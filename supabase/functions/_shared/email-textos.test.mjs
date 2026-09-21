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

test('⚠️ o e-mail não crava prazo de garantia — o prazo depende do material da peça', () => {
  // Regra de 18/09/2026: canvas 2 anos, couro 6 meses. `vessel-conta` não sabe
  // o material, então nenhum prazo fixo pode entrar no texto.
  for (const m of [textoDoPrimeiroAcesso('Tereza', 'x'), textoDaSenhaNova('Tereza', 'x')]) {
    const tudo = (m.assunto + m.html + m.texto).toLowerCase();
    assert.doesNotMatch(tudo, /\b2 anos\b|24 meses|dois anos|6 meses|seis meses/);
  }
});

// ── o lembrete de "registrar depois" (19/09/2026) ────────────────────────────
// Desenho: docs/superpowers/specs/2026-09-19-register-later-design.md
import { textoDoLembrete } from './email-textos.js';

const LEMBRETE = () => textoDoLembrete(
  'TBNWXAS28A',
  'https://vesselbrasil.com.br/verify/TBNWXAS28A',
  'https://vesselbrasil.com.br/verify/parar-lembrete?t=abc123',
);

test('o lembrete traz o link do certificado e o de parar de receber, nos DOIS formatos', () => {
  const m = LEMBRETE();
  for (const parte of [m.html, m.texto]) {
    assert.ok(parte.includes('https://vesselbrasil.com.br/verify/TBNWXAS28A'),
      'sem o link do certificado o e-mail não serve para nada');
    assert.ok(parte.includes('https://vesselbrasil.com.br/verify/parar-lembrete?t=abc123'),
      '"não quero mais receber" em um toque, sem login — em todo e-mail');
  }
  assert.match(m.assunto, /VESSEL/);
});

test('⚠️ o lembrete NUNCA crava prazo de garantia — canvas 2 anos, couro 6 meses', () => {
  // O robô do lembrete não recebe o material da peça. Um prazo fixo aqui seria
  // mentira para toda cliente de bolsa de couro — e ficaria gravado na caixa
  // de entrada dela.
  const m = LEMBRETE();
  const tudo = (m.assunto + m.html + m.texto).toLowerCase();
  assert.doesNotMatch(tudo, /\b2 anos\b|24 meses|dois anos|6 meses|seis meses|garantia de/);
});

test('⚠️ o lembrete não diz que registrar é obrigatório nem que dá garantia', () => {
  const m = LEMBRETE();
  const tudo = (m.assunto + m.html + m.texto).toLowerCase();
  for (const proibido of ['obrigat', 'cpf', 'pedido', 'nota fiscal', 'comprou']) {
    assert.ok(!tudo.includes(proibido), `o texto não pode conter "${proibido}"`);
  }
});

test('⚠️ o lembrete não leva senha nenhuma — não é e-mail de conta', () => {
  const m = LEMBRETE();
  assert.ok(!(m.html + m.texto).toLowerCase().includes('senha'));
});

test('⚠️ código e links saem escapados no html', () => {
  const m = textoDoLembrete('A<b>', 'https://x/"onload=1', 'https://y/&z');
  assert.ok(!m.html.includes('<b>'), 'o código cru não pode virar tag');
  assert.ok(!m.html.includes('"onload=1'), 'o link cru não pode escapar do atributo');
  assert.match(m.html, /&lt;b&gt;/);
});
