import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhasDeFormaPagamento } from './forma-pagamento.mjs';

// Parcelas reais do pedido #2708 (Kariny, 01/10/2026), lidas no Bling em
// 03/10/2026: detalhe.parcelas = [
//   { id: 19590588502, valor: 300,  dataVencimento: '2026-10-01', formaPagamento: { id: 7621351 } },  // Cartão 1x
//   { id: 19590588503, valor: 1600, dataVencimento: '2026-10-01', formaPagamento: { id: 7467470 } },  // Devolução de mercadorias
// ]
const parcelasReais = [
  { id: 19590588502, valor: 300, dataVencimento: '2026-10-01', formaPagamento: { id: 7621351 } },
  { id: 19590588503, valor: 1600, dataVencimento: '2026-10-01', formaPagamento: { id: 7467470 } },
];
const catalogo = new Map([['7621351', 3], ['7467470', 5]]); // 3 = Cartão, 5 = Devolução

test('o caso real: pedido #2708 vira duas linhas, só a de 1600 marcada como devolução', () => {
  const linhas = linhasDeFormaPagamento(27018529287, 205834116, parcelasReais, catalogo);
  assert.equal(linhas.length, 2);
  const cartao = linhas.find((l) => l.parcela_id === 19590588502);
  const devolucao = linhas.find((l) => l.parcela_id === 19590588503);
  assert.equal(cartao.eh_devolucao, false);
  assert.equal(cartao.valor, 300);
  assert.equal(cartao.pedido_id, 27018529287);
  assert.equal(cartao.loja_id, 205834116);
  assert.equal(cartao.forma_pagamento_id, 7621351);
  assert.equal(cartao.data_vencimento, '2026-10-01');
  assert.equal(devolucao.eh_devolucao, true);
  assert.equal(devolucao.valor, 1600);
});

test('forma de pagamento fora do catálogo: grava a parcela com eh_devolucao=false, não some com ela', () => {
  const parcela = [{ id: 1, valor: 50, dataVencimento: '2026-10-01', formaPagamento: { id: 999999 } }];
  const linhas = linhasDeFormaPagamento(1, 1, parcela, new Map());
  assert.equal(linhas.length, 1, 'a parcela tem que ser gravada mesmo sem achar o tipoPagamento');
  assert.equal(linhas[0].eh_devolucao, false);
  assert.equal(linhas[0].forma_pagamento_id, 999999);
});

test('parcela sem id ou sem formaPagamento é descartada — não dá para gravar sem chave', () => {
  const parcelas = [
    { valor: 50, formaPagamento: { id: 1 } },           // sem id da parcela
    { id: 2, valor: 50 },                                // sem formaPagamento
    { id: 3, valor: 50, formaPagamento: {} },            // formaPagamento sem id
  ];
  const linhas = linhasDeFormaPagamento(1, 1, parcelas, catalogo);
  assert.equal(linhas.length, 0);
});

test('sem parcela nenhuma, devolve lista vazia', () => {
  for (const vazio of [[], null, undefined]) {
    assert.deepEqual(linhasDeFormaPagamento(1, 1, vazio, catalogo), []);
  }
});

test('loja_id nulo é aceito (detalhe do Bling sem loja)', () => {
  const linhas = linhasDeFormaPagamento(1, null, [parcelasReais[0]], catalogo);
  assert.equal(linhas[0].loja_id, null);
});

test('data_vencimento "0000-00-00" do Bling vira null, não a string zerada', () => {
  const parcela = [{ id: 1, valor: 50, dataVencimento: '0000-00-00', formaPagamento: { id: 7621351 } }];
  const linhas = linhasDeFormaPagamento(1, 1, parcela, catalogo);
  assert.equal(linhas[0].data_vencimento, null);
});
