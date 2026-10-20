import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compararEstoque, linhaDeLog } from './leitura-dupla-estoque.mjs';

const produtos = [
  { id_bling: 1, codigo: 'LV1', id_situacaocadastro: 1 },
  { id_bling: 2, codigo: '', id_situacaocadastro: 1 },            // insumo: a Central usa o id como chave
  { id_bling: 3, codigo: 'LV3', id_situacaocadastro: 1 },
  { id_bling: 4, codigo: 'LV4', id_situacaocadastro: 1 },
];
const D = 14888617206;
const saldosCore = [
  { id_bling: '1', deposito_id: D, saldo: 5 },
  { id_bling: '2', deposito_id: D, saldo: 7 },
  { id_bling: '3', deposito_id: D, saldo: 0 },
  { id_bling: '4', deposito_id: D, saldo: 9 },                    // a Central não tem
];

test('casa por código e por id, trata ausente como zero e separa o que não é comparável', () => {
  const central = [
    { deposito_id: D, sku: 'LV1', saldo: 5 },                      // igual
    { deposito_id: D, sku: '2', saldo: 6 },                        // chave = id, saldo diferente
    { deposito_id: D, sku: 'LV3', saldo: 4 },                      // Core zerou, Central nunca zera
    { deposito_id: D, sku: 'MORTO', saldo: 3 },                    // código que sumiu do catálogo
    { deposito_id: D, sku: 'MORTO2', saldo: 0 },                   // sem par mas zerado: ignora
    { deposito_id: 14888248253, sku: 'LV1', saldo: 99 },           // depósito que o Core não espelha
    { deposito_id: 14888248253, sku: 'LV1B', saldo: 0 },
  ];
  const r = compararEstoque({ central, produtos, saldosCore });
  assert.equal(r.iguais, 1);
  assert.deepEqual(r.diferentes.map((d) => [d.sku, d.central, d.core]), [['2', 6, 7]]);
  assert.deepEqual(r.centralNaoZerou.map((d) => [d.sku, d.central]), [['LV3', 4]]);
  assert.deepEqual(r.semPar, [{ sku: 'MORTO', deposito: String(D), central: 3 }]);
  assert.deepEqual(r.soCore, [{ id: '4', deposito: String(D), core: 9 }]);
  assert.equal(r.soCentral.length, 0);
  assert.equal(r.foraDoCore, 1);
});

test('linha só na Central com saldo vira so_central; zerada conta como igual', () => {
  const r = compararEstoque({
    central: [{ deposito_id: D, sku: 'LV1', saldo: 2 }, { deposito_id: D, sku: 'LV3', saldo: 0 }],
    produtos, saldosCore: [{ id_bling: '9', deposito_id: D, saldo: 0 }],
  });
  assert.deepEqual(r.soCentral, [{ sku: 'LV1', id: '1', deposito: String(D), central: 2 }]);
  assert.equal(r.iguais, 1);
});

test('resposta torta do Core e depósito sumido LANÇAM', () => {
  const central = [{ deposito_id: D, sku: 'LV1', saldo: 0 }];
  assert.throws(() => compararEstoque({ central, produtos, saldosCore: [{ id_bling: '1', deposito_id: D, saldo: 'abc' }] }), /inesperada/);
  assert.throws(() => compararEstoque({ central, produtos, saldosCore: [{ id_bling: '1', deposito_id: D, saldo: null }] }), /inesperada/);
  assert.throws(() => compararEstoque({ central, produtos, saldosCore: [{ id_bling: '1', saldo: 1 }] }), /inesperada/);
  assert.throws(() => compararEstoque({ central, produtos, saldosCore: [{ id_bling: '1', deposito_id: D, saldo: 1 }], depositosEsperados: [D, 14888726277] }), /14888726277/);
});

test('log: resíduo conhecido da Central (linha parada, código morto) não impede "limpa"', () => {
  const r = compararEstoque({
    central: [{ deposito_id: D, sku: 'LV1', saldo: 5 }, { deposito_id: D, sku: 'LV3', saldo: 4 }, { deposito_id: D, sku: 'MORTO', saldo: 2 }],
    produtos, saldosCore: [{ id_bling: '1', deposito_id: D, saldo: 5 }, { id_bling: '3', deposito_id: D, saldo: 0 }],
  });
  const l = linhaDeLog(r, { depositos: 1, centralAtualizadoAte: 'x', sincroniaInformada: true });
  assert.match(l, /central_nao_zerou=1.*sem_par=1.*resultado=limpa/);
});

test('log: limpa só sem nenhuma divergência', () => {
  const info = { depositos: 4, centralAtualizadoAte: 'x', sincroniaInformada: true };
  const limpa = compararEstoque({ central: [{ deposito_id: D, sku: 'LV1', saldo: 5 }], produtos, saldosCore: [{ id_bling: '1', deposito_id: D, saldo: 5 }] });
  assert.match(linhaDeLog(limpa, info), /resultado=limpa/);
  const suja = compararEstoque({ central: [{ deposito_id: D, sku: 'LV1', saldo: 4 }], produtos, saldosCore: [{ id_bling: '1', deposito_id: D, saldo: 5 }] });
  assert.match(linhaDeLog(suja, info), /diferentes=1.*resultado=divergente/);
});

test('o Core guarda decimal e a Central arredonda: 5.3 e 4.53 casam com 5', () => {
  const r = compararEstoque({
    central: [{ deposito_id: D, sku: 'LV1', saldo: 5 }, { deposito_id: D, sku: 'LV3', saldo: 5 }],
    produtos, saldosCore: [{ id_bling: '1', deposito_id: D, saldo: 5.3 }, { id_bling: '3', deposito_id: D, saldo: 4.53 }],
  });
  assert.equal(r.iguais, 2);
  assert.equal(r.diferentes.length, 0);
});
