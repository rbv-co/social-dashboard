// supabase/functions/_shared/senha-gerada.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { gerarSenha, ALFABETO_DA_SENHA } from './senha-gerada.js';

test('a senha tem 12 caracteres', () => {
  assert.equal(gerarSenha().length, 12);
});

test('⚠️ o alfabeto não tem caractere que se confunde ao ler', () => {
  // A cliente vai COPIAR do e-mail e DIGITAR. 0/O e 1/l/I viram chamado de
  // suporte, não senha errada dela.
  for (const proibido of ['0', 'O', '1', 'l', 'I']) {
    assert.ok(!ALFABETO_DA_SENHA.includes(proibido), `alfabeto contém ${proibido}`);
  }
});

test('duas senhas seguidas não são iguais', () => {
  assert.notEqual(gerarSenha(), gerarSenha());
});

test('o sorteio pode ser injetado, para o teste ser determinístico', () => {
  assert.equal(gerarSenha(() => 0), ALFABETO_DA_SENHA[0].repeat(12));
});
