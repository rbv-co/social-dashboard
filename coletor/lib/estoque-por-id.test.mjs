import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indiceDeProdutos, idDoProdutoPelaChave } from './estoque-por-id.mjs';

const idx = indiceDeProdutos([
  { id_bling: 1, codigo: 'LV1059', id_situacaocadastro: 1 },
  { id_bling: 2, codigo: '', id_situacaocadastro: 1 },            // insumo sem SKU: a Central usa o id
  { id_bling: 3, codigo: 'ESC-1', id_situacaocadastro: 0 },       // versão velha, inativa
  { id_bling: 4, codigo: 'ESC-1', id_situacaocadastro: 1 },       // versão nova, ativa
  { id_bling: 5, codigo: 'DUP', id_situacaocadastro: 1 },
  { id_bling: 6, codigo: 'DUP', id_situacaocadastro: 1 },         // dois ativos: ambíguo
  { id_bling: 7, codigo: null, id_situacaocadastro: 0 },
]);

test('chave com código casa pelo código', () => assert.equal(idDoProdutoPelaChave('LV1059', idx), '1'));
test('chave numérica de produto sem código casa pelo id', () => assert.equal(idDoProdutoPelaChave('2', idx), '2'));
test('chave numérica aceita número', () => assert.equal(idDoProdutoPelaChave(7, idx), '7'));
test('código repetido: vale o único ativo', () => assert.equal(idDoProdutoPelaChave('ESC-1', idx), '4'));
test('código repetido com dois ativos: não casa', () => assert.equal(idDoProdutoPelaChave('DUP', idx), null));
test('código que não existe mais no catálogo: não casa', () => assert.equal(idDoProdutoPelaChave('lona Cafe', idx), null));
