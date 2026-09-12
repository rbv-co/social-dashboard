import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listaDaResposta, detalheDaResposta } from './resposta-do-bling.js';

test('resposta boa devolve a lista', () => {
  assert.deepEqual(listaDaResposta({ data: { data: [{ id: 1 }] } }), [{ id: 1 }]);
});

test('lista vazia continua sendo lista vazia — o item pode não existir mesmo', () => {
  assert.deepEqual(listaDaResposta({ data: { data: [] } }), []);
  assert.deepEqual(listaDaResposta({ data: {} }), []);
});

// O DEFEITO QUE ISTO EXISTE PARA IMPEDIR: `functions.invoke` NÃO joga erro
// quando a chamada falha — devolve { data: null, error }. O código antigo fazia
// `(r && r.data && r.data.data) || []`, então o Bling fora do ar virava lista
// vazia, e a tela dizia "Item não encontrado no Bling" em vez de "não consegui
// consultar". Medido em 18/08: o bling-proxy falha em 2,2% das chamadas.
test('falha do proxy SOBE, não vira lista vazia', () => {
  assert.throws(() => listaDaResposta({ data: null, error: { message: 'FunctionsHttpError' } }), /bling/i);
  assert.throws(() => listaDaResposta({ error: new Error('504') }), /bling/i);
});

test('detalhe: resposta boa devolve o produto', () => {
  assert.deepEqual(detalheDaResposta({ data: { data: { id: 7 } } }), { id: 7 });
});

test('detalhe: sem produto devolve null (legítimo), mas falha SOBE', () => {
  assert.equal(detalheDaResposta({ data: {} }), null);
  assert.throws(() => detalheDaResposta({ data: null, error: { message: 'timeout' } }), /bling/i);
});

test('a mensagem do erro diz de onde veio, para o console não virar adivinhação', () => {
  assert.throws(() => listaDaResposta({ error: { message: 'Edge Function returned 504' } }), /504/);
});

test('resposta que não é objeto não derruba nem inventa', () => {
  assert.deepEqual(listaDaResposta(null), []);
  assert.equal(detalheDaResposta(undefined), null);
});
