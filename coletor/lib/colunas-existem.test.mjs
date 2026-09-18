// coletor/lib/colunas-existem.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { colunasExistem } from './colunas-existem.mjs';

test('colunasExistem: true quando o banco devolve todas as colunas pedidas', async () => {
  const falso = async () => ({
    rows: [{ column_name: 'observacoes' }, { column_name: 'observacoes_internas' }],
  });
  assert.equal(
    await colunasExistem(falso, 'vessel_pedidos', ['observacoes', 'observacoes_internas']),
    true);
});

test('⚠️ colunasExistem: false quando falta QUALQUER uma das colunas — é o caso do robô rodando antes da migration', async () => {
  const falso = async () => ({ rows: [{ column_name: 'observacoes' }] });
  assert.equal(
    await colunasExistem(falso, 'vessel_pedidos', ['observacoes', 'observacoes_internas']),
    false);
});

test('colunasExistem: nenhuma coluna existente devolve false', async () => {
  const falso = async () => ({ rows: [] });
  assert.equal(
    await colunasExistem(falso, 'vessel_pedidos', ['observacoes', 'observacoes_internas']),
    false);
});

test('colunasExistem: pergunta pela tabela e pelas colunas certas', async () => {
  let tabelaPedida, colunasPedidas;
  await colunasExistem(async (sql, params) => {
    tabelaPedida = params[0];
    colunasPedidas = params[1];
    return { rows: [] };
  }, 'vessel_pedidos', ['a', 'b']);
  assert.equal(tabelaPedida, 'vessel_pedidos');
  assert.deepEqual(colunasPedidas, ['a', 'b']);
});
