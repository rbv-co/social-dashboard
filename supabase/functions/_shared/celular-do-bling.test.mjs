import test from 'node:test';
import assert from 'node:assert/strict';
import { celularParaOBling } from './celular-do-bling.js';

test('⚠️ tira o +55, que era o que derrubava os quatro', () => {
  // Os quatro números reais que ficaram presos, medidos em 11/09/2026.
  assert.equal(celularParaOBling('+5519992415806'), '19992415806');
  assert.equal(celularParaOBling('+5537998263076'), '37998263076');
  assert.equal(celularParaOBling('+5538999992323'), '38999992323');
  assert.equal(celularParaOBling('+5519996314610'), '19996314610');
});

test('os formatos que o Bling JÁ aceitava continuam passando', () => {
  assert.equal(celularParaOBling('19999071702'), '19999071702');
  assert.equal(celularParaOBling('(19) 99999-0000'), '19999990000');
  assert.equal(celularParaOBling('(19)99999-0000'), '19999990000');
  assert.equal(celularParaOBling('19 9 99999-00'), '1999999900');
});

test('fixo de 10 dígitos passa inteiro', () => {
  assert.equal(celularParaOBling('1938761234'), '1938761234');
  assert.equal(celularParaOBling('+551938761234'), '1938761234');
});

test('⚠️ o que não dá para confiar vira NULO, não palpite', () => {
  // Contato sem celular se conserta; contato com o número de outra pessoa, não.
  assert.equal(celularParaOBling(''), null);
  assert.equal(celularParaOBling(null), null);
  assert.equal(celularParaOBling('123'), null);
  assert.equal(celularParaOBling('+1 415 555 0100'), null);   // não é Brasil
  assert.equal(celularParaOBling('5511'), null);
});

test('⚠️ não come o 55 de quem tem DDD 55', () => {
  // Rio Grande do Sul usa o DDD 55. Um celular de lá é 55 9 9999-9999, onze
  // dígitos — cortar os dois primeiros o transformaria no telefone de outra
  // pessoa. Só se corta quando há 12 ou 13 dígitos.
  assert.equal(celularParaOBling('55999998888'), '55999998888');
  assert.equal(celularParaOBling('5599999888'), '5599999888');
});
