import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarItem, classificarItemDetalhado, categoriaDeEstoque } from './bling-comercial.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// O DEFEITO QUE ESTE ARQUIVO TRANCA (medido em 20/08/2026)
//
// `classificarItem` termina num PEGA-TUDO: o nome que ela não reconhece vira
// 'Outros acessórios', ou seja, produto vendável. Como a seção de estoque da
// Gestão à Vista esconde só quem tem categoria vazia, todo insumo fora da lista
// de 15 palavras aparecia no telão: 213 das 1.386 linhas visíveis eram argola,
// botão, corrente, couro, camurça, espuma, retalho, bobina, caixa, aplicador,
// fivela injetada e alça. Conferidas uma a uma nos três depósitos — nenhuma era
// produto de venda.
//
// A causa por trás: a MESMA função responde a duas perguntas diferentes.
//   · "que categoria é este produto?"   — VENDAS, onde o pega-tudo faz sentido
//                                          (se foi vendido, é produto).
//   · "isto é um produto vendável?"     — ESTOQUE, onde o pega-tudo É o defeito.
// Por isso vendas continua igual e só o estoque passa a exigir reconhecimento.
//
// Os nomes abaixo são REAIS, tirados do banco.
// ─────────────────────────────────────────────────────────────────────────────

const INSUMOS_QUE_VAZAVAM = [
  'Argola - 1.6cm',
  'Argola Grossa - 1.1cm',
  'Botão Imã - 10280-G - Altero',
  'Botão de Pressão BT7 - BT7.130.80.6.CM.F  - Eberle',
  'Botão Colchete - CC7.115.12.7.L - Eberle',
  'Corrente Ouro Claro - Torcida 3mm',
  'Corda Para Alça - 4mm',
  'Couro - MundoCamurca - Bristol nozes',
  'CAMURCA CAFE (DUPLA)',
  'Espuma Grossa - D28 5mm - 1.9x5.2 - Pj Espumas',
  'Espaguete Plastico - Lema Plast',
  'Retalho - York - Diversos',
  'Bobina Plastico PCR - 25kg -EmbalaTec',
  'CX 04 GAB',
  'APLICADOR',
  'Cursor Ouro Velho Sino Grande - Okero',
  '6AI5-25 FIVELA INJ OURO C/VZ C/PINO',
  'Alça Gergelim - 3CM',
  'Alça De Fita Liso - Caramelo',
  'Certificado Garantia - La Vessel',
  'Cadeado - 1-2/7605 - Altero',
  'Artedur - Sh 7007/2 - Magma',
  '10,00MM- C. NITRILICO PRETO TOL. +- 0,8',
  'Placa Retangular Pequena C/Borda - 12820 - Fatobene',
  'BM18-1 # DOURADO 9K BOTAO MAGNETICO MAIOR C/IMA O18,7MM',
];

const PRODUTOS_DE_VERDADE = [
  ['Cinto Couro Astana Café Tamanho:G', 'Cinto'],
  ['Bolsa Transversal Manu Preta', 'Transversal'],
  ['Carteira Feminina Nina Caramelo', 'Carteira'],
  ['Mochila Vessel Preta', 'Mochila'],
  ['Óculos de Sol Vessel', 'Óculos'],
  ['Bolsa Tote Grande Havana', 'Tote'],
  ['Clutch de Festa Dourada', 'Festa/Clutch'],
  ['Bolsa de Ombro Valentina', 'Bolsa de ombro'],
  ['Necessaire Média Preta', 'Necessaire'],
  ['Porta-cartão Slim Marrom', 'Porta-cartão'],
  ['Chaveiro Couro Vessel', 'Chaveiro'],
];

const INSUMOS_JA_RECONHECIDOS = [
  'Sacola TNT Vessel',
  'Embalagem Caixa Presente',
  'Tinta Preta Acabamento',
  'Zíper Metal 20cm',
  'Forro Poliester Bege',
  'Cola de Contato',
  'Fivela a granel dourada',
];

// ── ESTOQUE: só entra o que foi RECONHECIDO como produto ─────────────────────

test('estoque: os 25 insumos que vazavam para o telão ficam sem categoria', () => {
  const vazando = INSUMOS_QUE_VAZAVAM.filter((n) => categoriaDeEstoque(n) !== null);
  assert.deepEqual(vazando, [], 'estes aparecem na seção de estoque e não deveriam');
});

test('estoque: produto de verdade continua com a categoria dele', () => {
  for (const [nome, esperada] of PRODUTOS_DE_VERDADE) {
    assert.equal(categoriaDeEstoque(nome), esperada, `"${nome}" sumiu do estoque`);
  }
});

test('estoque: insumo que a lista já reconhecia continua fora', () => {
  for (const nome of INSUMOS_JA_RECONHECIDOS) {
    assert.equal(categoriaDeEstoque(nome), null, `"${nome}" voltou a aparecer`);
  }
});

test('estoque: "INSUMOS DE PRODUCAO - BOLSAS" não entra por conter "bolsa"', () => {
  // Escapava por match POSITIVO, não pelo pega-tudo: /bolsa|bag/ o classificava
  // como 'Bolsa (outros)'. São 3 linhas no banco.
  assert.equal(categoriaDeEstoque('INSUMOS DE PRODUCAO - BOLSAS'), null);
  assert.equal(classificarItem('INSUMOS DE PRODUCAO - BOLSAS'), null, 'em vendas também não é bolsa');
});

test('estoque: nome vazio ou nulo não vira produto', () => {
  for (const nome of [null, undefined, '', '   ']) {
    assert.equal(categoriaDeEstoque(nome), null);
  }
});

// ── VENDAS: nada muda ────────────────────────────────────────────────────────

test('vendas: o pega-tudo CONTINUA valendo — se foi vendido, é produto', () => {
  // Aqui o pega-tudo está certo: um item vendido que a lista não reconhece é um
  // produto, e perder a categoria dele estragaria o relatório de vendas.
  assert.equal(classificarItem('Produto Novo Que A Lista Nao Conhece'), 'Outros acessórios');
  assert.equal(classificarItem('Argola - 1.6cm'), 'Outros acessórios');
});

test('vendas: produto reconhecido e insumo reconhecido não mudam', () => {
  for (const [nome, esperada] of PRODUTOS_DE_VERDADE) {
    assert.equal(classificarItem(nome), esperada);
  }
  for (const nome of INSUMOS_JA_RECONHECIDOS) {
    assert.equal(classificarItem(nome), null);
  }
});

// ── O SINAL QUE A VIGIA USA ──────────────────────────────────────────────────

test('detalhado separa "reconheci" de "chutei no pega-tudo"', () => {
  assert.deepEqual(classificarItemDetalhado('Cinto Couro Astana Café Tamanho:G'),
    { categoria: 'Cinto', reconhecido: true });
  assert.deepEqual(classificarItemDetalhado('Sacola TNT Vessel'),
    { categoria: null, reconhecido: true }, 'insumo reconhecido é reconhecimento, não chute');
  assert.deepEqual(classificarItemDetalhado('Argola - 1.6cm'),
    { categoria: 'Outros acessórios', reconhecido: false });
});

test('o que a vigia conta é o NÃO reconhecido, não o insumo conhecido', () => {
  const nomes = [...INSUMOS_QUE_VAZAVAM, ...INSUMOS_JA_RECONHECIDOS, ...PRODUTOS_DE_VERDADE.map((p) => p[0])];
  const naoReconhecidos = nomes.filter((n) => !classificarItemDetalhado(n).reconhecido);
  assert.equal(naoReconhecidos.length, INSUMOS_QUE_VAZAVAM.length);
});
