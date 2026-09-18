// supabase/functions/_shared/nome-de-quem-deu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNome, nomesBatem, nomesChegamPerto } from './nome-de-quem-deu.js';

test('normalizar tira acento, maiúscula e espaço sobrando', () => {
  assert.equal(normalizarNome('  Ana  MARIA de Souza '), 'ana maria de souza');
});

test('bate ignorando partícula e nome do meio', () => {
  assert.ok(nomesBatem('Ana Souza', 'ANA MARIA DE SOUZA'));
  assert.ok(nomesBatem('ana maria de souza', 'Ana Souza'));
});

test('⚠️ NÃO bate quando só o primeiro nome coincide', () => {
  // "Ana" existe às dezenas na base. Aprovar por primeiro nome entregaria a
  // garantia de uma peça para a pessoa errada, calado.
  assert.ok(!nomesBatem('Ana Ferreira', 'Ana Souza'));
  assert.ok(!nomesBatem('Ana', 'Ana Souza'));
});

test('chega perto aceita sobrenome escrito errado, mas exige primeiro nome', () => {
  assert.ok(nomesChegamPerto('Ana Sousa', 'Ana Souza'));   // z/s, sobrenome de 5 letras
  assert.ok(!nomesChegamPerto('Ana Soza', 'Ana Souza'));   // sobrenome curto (4): exige igualdade exata
  assert.ok(nomesChegamPerto('Ana Rodriges', 'Ana Rodrigues'));  // sobrenome longo (8+): 1 letra faltando é erro de digitação
  assert.ok(!nomesChegamPerto('Bia Souza', 'Ana Souza'));  // outro primeiro nome
  assert.ok(!nomesChegamPerto('Ana', 'Ana Souza'));        // sem sobrenome
});

test('⚠️ sobrenome curto e DIFERENTE não é erro de digitação — é outra pessoa', () => {
  // Achado da revisão: distância fixa ≤2 aprovava sobrenomes curtos e
  // diferentes (pessoas diferentes) como se fossem erro de digitação. O
  // limite agora escala com o tamanho do menor sobrenome.
  assert.ok(!nomesChegamPerto('Ana Pina', 'Ana Lima'));
  assert.ok(!nomesChegamPerto('Ana Neis', 'Ana Reis'));
  assert.ok(!nomesChegamPerto('Ana Nelo', 'Ana Melo'));
  assert.ok(!nomesChegamPerto('Ana Dip', 'Ana Dias'));
});

test('vazio nunca bate com nada', () => {
  assert.ok(!nomesBatem('', 'Ana Souza'));
  assert.ok(!nomesChegamPerto('  ', 'Ana Souza'));
  assert.ok(!nomesBatem('Ana Souza', ''));
});
