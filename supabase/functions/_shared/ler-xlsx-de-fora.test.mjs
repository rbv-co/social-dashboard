// O LEITOR DE XLSX DIANTE DE ARQUIVO QUE NÃO FOI O NOSSO GERADOR QUE ESCREVEU.
//
// ⚠️ POR QUE ESTE TESTE EXISTE (25/09/2026): a planilha da triagem do Tivoli
// tem duas colunas que o RH preenche. O robô relê o arquivo do Zoho para não
// apagá-las — e o leitor só entendia o formato exato do nosso gerador. Um
// arquivo salvo pelo openpyxl (e, do mesmo jeito, pelo Excel e pelo Zoho) voltava
// ZERO abas: o robô leu "0 anotações" e reescreveria a planilha por cima, com a
// anotação do RH sumindo sem erro nenhum. Os testes de antes passavam porque
// liam arquivos que o próprio gerador tinha escrito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { abasDoXlsx } from './ler-xlsx.mjs';

const fixture = (n) => readFileSync(new URL(`./xlsx-de-fora/${n}`, import.meta.url));

test('arquivo salvo pelo openpyxl: acha as abas e a anotação do RH', () => {
  const abas = abasDoXlsx(fixture('salvo-pelo-openpyxl.xlsx'));
  assert.deepEqual(abas.map((a) => a.nome), ['Candidatos', 'Como usar']);
  const c = abas[0];
  const l = c.linhas[0];
  assert.equal(l[c.colunas.indexOf('Status (RH)')], 'Entrevista 30/09');
  assert.equal(l[c.colunas.indexOf('Observações (RH)')], 'Anotação do RH');
  assert.equal(l[c.colunas.indexOf('ID do cadastro')], 'b358e94e-2b86-440b-9321-6868d1d64c38');
});

test('jeito do Excel/Zoho: textos compartilhados, atributos fora de ordem, aba em outro arquivo', () => {
  const abas = abasDoXlsx(fixture('jeito-do-excel.xlsx'));
  assert.deepEqual(abas.map((a) => a.nome), ['Candidatos', 'Como usar']);
  const [c, uso] = abas;
  assert.deepEqual(c.colunas, ['Nome', 'Status (RH)', 'ID do cadastro']);
  // o texto em dois pedaços (um deles em negrito) volta inteiro, e o &amp; desfeito
  assert.deepEqual(c.linhas[0], ['Ana', 'Entrevista 30/09 & ok', 'abc-123']);
  // a aba "Como usar" mora no sheet1.xml, a "Candidatos" no sheet2.xml
  assert.deepEqual(uso.colunas, ['COMO USAR']);
});
