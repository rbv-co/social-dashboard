// src/ferramentas/gestao-a-vista/estoque-gv.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPOSITOS_SEMENTE, normalizarDepositos, ehDepositoDeLoja, canalCasaComDeposito,
         statusSaldo, depositosVisiveis, prepararEstoque, filtrarPedidosPorCanal,
         ehMateriaPrima, categoriasDisponiveis } from './estoque-gv.js';

test('statusSaldo: limiares default (crit<=3, low<=8)', () => {
  assert.equal(statusSaldo(0), 'crit'); assert.equal(statusSaldo(3), 'crit');
  assert.equal(statusSaldo(4), 'low'); assert.equal(statusSaldo(8), 'low');
  assert.equal(statusSaldo(9), 'ok');
});

// ── OS SETE DEPOSITOS DE VERDADE, como o Bling os devolve (medido 05/09/2026).
// O codigo antigo conhecia TRES. Os outros quatro nao existiam para a tela.
const DO_BLING = [
  { deposito_id: 14889124779, nome: 'Estoque Almoxarifado',      ativo: true, padrao: false },
  { deposito_id: 14888617206, nome: 'Estoque Loja Dom Pedro',    ativo: true, padrao: false },
  { deposito_id: 14888726277, nome: 'Estoque Loja Hortolândia',  ativo: true, padrao: false },
  { deposito_id: 14888726315, nome: 'Estoque Loja Sbo. Tivoli',  ativo: true, padrao: false },
  { deposito_id: 14888830073, nome: 'Estoque M.P Pulmão',        ativo: true, padrao: false },
  { deposito_id: 14888248253, nome: 'Estoque P.A Pulmão',        ativo: true, padrao: true  },
  { deposito_id: 14888898221, nome: 'Estoque Sede B. Prado',     ativo: true, padrao: false },
];
// O vinculo explicito que ja existe em `fabrica_lojas`.
const VINCULOS = new Map([
  ['205834140', 14888726315],   // Loja Santa Barbara d'Oeste -> Tivoli
  ['205657609', 14888617206],   // Loja Dom Pedro             -> Dom Pedro
]);

test('normalizarDepositos: le o que o Bling mandou, e o `padrao` vira o pulmao', () => {
  const d = normalizarDepositos(DO_BLING);
  assert.equal(d.length, 7, 'os sete depositos tem de chegar');
  assert.deepEqual(d.filter((x) => x.pulmao).map((x) => x.nome), ['Estoque P.A Pulmão'],
    'o pulmao e o marcado como `padrao` no Bling, e nao um palpite escrito aqui');
});

test('⚠️ normalizarDepositos: banco vazio cai na semente, e nao em NADA', () => {
  // Devolver [] deixaria a secao de estoque em branco sem dizer por que.
  assert.equal(normalizarDepositos([]).length, 3);
  assert.equal(normalizarDepositos(null).length, 3);
  assert.deepEqual(normalizarDepositos([]).map((d) => d.id), DEPOSITOS_SEMENTE.map((d) => d.id));
});

test('normalizarDepositos: deposito inativo fica de fora', () => {
  const d = normalizarDepositos([...DO_BLING, { deposito_id: 1, nome: 'Fechado', ativo: false }]);
  assert.ok(!d.some((x) => x.id === 1));
});

test('ehDepositoDeLoja: so os "Estoque Loja X" — retaguarda nao e loja', () => {
  const d = normalizarDepositos(DO_BLING);
  assert.deepEqual(d.filter(ehDepositoDeLoja).map((x) => x.nome), [
    'Estoque Loja Dom Pedro', 'Estoque Loja Hortolândia', 'Estoque Loja Sbo. Tivoli',
  ]);
});

test('⚠️ canalCasaComDeposito: "loja" e "shopping" NAO casam nada sozinhas', () => {
  /* Sem tirar essas palavras, o canal "Loja Shopify" casaria com TODOS os
   * depositos de loja, e a tela mostraria estoque de tres lojas para um canal
   * de internet. */
  const tivoli = { nome: 'Estoque Loja Sbo. Tivoli' };
  assert.equal(canalCasaComDeposito('Loja Shopify', tivoli), false);
  assert.equal(canalCasaComDeposito('Shopping Qualquer', tivoli), false);
  assert.equal(canalCasaComDeposito('Loja Dom Pedro', { nome: 'Estoque Loja Dom Pedro' }), true);
});

test('a ordem e LOJA primeiro, RETAGUARDA depois — nao a ordem do Bling', () => {
  /* O pulmao no meio das colunas embaralha a leitura: quem abre a secao esta
   * olhando a loja, e o pulmao responde a pergunta seguinte. */
  const foraDeOrdem = [
    { deposito_id: 14888248253, nome: 'Estoque P.A Pulmão',      ativo: true, padrao: true  },
    { deposito_id: 14888617206, nome: 'Estoque Loja Dom Pedro',  ativo: true, padrao: false },
  ];
  const vis = depositosVisiveis(['Loja Dom Pedro'], foraDeOrdem, new Map());
  assert.deepEqual(vis.map((d) => d.nome), ['Estoque Loja Dom Pedro', 'Estoque P.A Pulmão']);
});

test('depositosVisiveis: sem filtro mostra TODOS os depositos', () => {
  assert.equal(depositosVisiveis([], DO_BLING, VINCULOS).length, 7);
  assert.equal(depositosVisiveis(null, DO_BLING, VINCULOS).length, 7);
  assert.equal(depositosVisiveis(new Set(), DO_BLING, VINCULOS).length, 7);
});

test('⚠️ depositosVisiveis: o VINCULO explicito resolve o que o nome nao resolve', () => {
  /* O canal chama-se "Loja Santa Barbara d'Oeste" e o deposito "Estoque Loja
   * Sbo. Tivoli". Nao ha uma palavra em comum entre os dois — sem o vinculo de
   * `fabrica_lojas`, esta loja nunca casaria. */
  const vis = depositosVisiveis([{ loja_id: '205834140', nome: "Loja Santa Bárbara d'Oeste" }],
                                DO_BLING, VINCULOS);
  assert.deepEqual(vis.map((d) => d.nome), ['Estoque Loja Sbo. Tivoli', 'Estoque P.A Pulmão']);
});

test('depositosVisiveis: LOJA NOVA casa sozinha pelo nome, sem ninguem cadastrar', () => {
  // É o caso do Iguatemi: canal e depósito criados no Bling, nada tocado aqui.
  const comIguatemi = [...DO_BLING,
    { deposito_id: 999, nome: 'Estoque Loja Iguatemi', ativo: true, padrao: false }];
  const vis = depositosVisiveis(['Loja Iguatemi'], comIguatemi, VINCULOS);
  assert.deepEqual(vis.map((d) => d.nome), ['Estoque Loja Iguatemi', 'Estoque P.A Pulmão']);
});

test('depositosVisiveis: o pulmao entra SEMPRE, mesmo sem loja casada', () => {
  /* Sem ele a pessoa ve a loja com 2 pecas e conclui que acabou — quando ha 600
   * na retaguarda. */
  const vis = depositosVisiveis(['Canal Direto'], DO_BLING, VINCULOS);
  assert.deepEqual(vis.map((d) => d.nome), ['Estoque P.A Pulmão']);
});

test('depositosVisiveis: dois canais somam as duas lojas, sem repetir o pulmao', () => {
  const vis = depositosVisiveis(['Loja Dom Pedro', 'Loja Hortolândia'], DO_BLING, VINCULOS);
  assert.deepEqual(vis.map((d) => d.nome), [
    'Estoque Loja Dom Pedro', 'Estoque Loja Hortolândia', 'Estoque P.A Pulmão',
  ]);
  assert.equal(vis.filter((d) => d.pulmao).length, 1);
});

test('depositosVisiveis: aceita o vinculo como objeto simples tambem', () => {
  const vis = depositosVisiveis([{ loja_id: '205657609', nome: 'Loja Dom Pedro' }],
                                DO_BLING, { '205657609': 14888617206 });
  assert.deepEqual(vis.map((d) => d.nome), ['Estoque Loja Dom Pedro', 'Estoque P.A Pulmão']);
});

test('prepararEstoque: busca + status + ordena + limita', () => {
  const itens = [
    {sku:'LV1',produto:'Bolsa Foggia',saldo:2,categoria:'Bolsa (outros)'},{sku:'LV2',produto:'Bolsa Porto',saldo:15,categoria:'Bolsa (outros)'},
    {sku:'LV3',produto:'Bolsa Pisa',saldo:6,categoria:'Bolsa (outros)'},{sku:'LV4',produto:'Bolsa Siena',saldo:20,categoria:'Bolsa (outros)'},
  ];
  // status crítico + ordena estoque asc
  let r = prepararEstoque(itens, {busca:'', status:'crit', sort:'qasc', limit:'all'});
  assert.deepEqual(r.rows.map(x=>x.sku), ['LV1']); assert.equal(r.full, 1);
  // busca por nome
  r = prepararEstoque(itens, {busca:'porto', status:'todos', sort:'qasc', limit:'all'});
  assert.deepEqual(r.rows.map(x=>x.sku), ['LV2']);
  // limite corta e full guarda o total
  r = prepararEstoque(itens, {busca:'', status:'todos', sort:'qasc', limit:2});
  assert.deepEqual(r.rows.map(x=>x.saldo), [2,6]); assert.equal(r.full, 4);
});

test('ehMateriaPrima: categoria vazia/nula/whitespace = insumo; categoria real = produto', () => {
  assert.equal(ehMateriaPrima({sku:'X',categoria:null}), true);
  assert.equal(ehMateriaPrima({sku:'X'}), true);              // sem a chave
  assert.equal(ehMateriaPrima({sku:'X',categoria:''}), true);
  assert.equal(ehMateriaPrima({sku:'X',categoria:'   '}), true);
  assert.equal(ehMateriaPrima(null), true);
  assert.equal(ehMateriaPrima({sku:'X',categoria:'Cinto'}), false);
});

test('prepararEstoque: oculta matéria-prima (categoria vazia) por regra fixa', () => {
  const itens = [
    {sku:'LV1',produto:'Cinto Astana',saldo:5,categoria:'Cinto'},
    {sku:'EMB1',produto:'Bobina Papel Embalagem',saldo:99,categoria:null}, // insumo
    {sku:'AV1',produto:'Fivela a granel',saldo:99,categoria:''},           // insumo
  ];
  const r = prepararEstoque(itens, {status:'todos', limit:'all'});
  assert.deepEqual(r.rows.map(x=>x.sku), ['LV1']); assert.equal(r.full, 1);
});

test('prepararEstoque: filtro por categoria (multi-seleção)', () => {
  const itens = [
    {sku:'A',produto:'Cinto A',saldo:5,categoria:'Cinto'},
    {sku:'B',produto:'Bolsa B',saldo:5,categoria:'Tote'},
    {sku:'C',produto:'Cinto C',saldo:5,categoria:'Cinto'},
    {sku:'D',produto:'Óculos D',saldo:5,categoria:'Óculos'},
  ];
  // uma categoria
  let r = prepararEstoque(itens, {categorias:['Cinto'], limit:'all'});
  assert.deepEqual(r.rows.map(x=>x.sku).sort(), ['A','C']);
  // várias categorias (união)
  r = prepararEstoque(itens, {categorias:['Cinto','Óculos'], limit:'all'});
  assert.deepEqual(r.rows.map(x=>x.sku).sort(), ['A','C','D']);
  // aceita Set
  r = prepararEstoque(itens, {categorias:new Set(['Tote']), limit:'all'});
  assert.deepEqual(r.rows.map(x=>x.sku), ['B']);
  // vazio/null = todas
  assert.equal(prepararEstoque(itens, {categorias:[], limit:'all'}).full, 4);
  assert.equal(prepararEstoque(itens, {limit:'all'}).full, 4);
});

test('categoriasDisponiveis: únicas, sem matéria-prima, ordenadas pt-BR', () => {
  const itens = [
    {sku:'A',categoria:'Óculos'},{sku:'B',categoria:'Cinto'},{sku:'C',categoria:'Cinto'},
    {sku:'D',categoria:null},{sku:'E',categoria:'Bolsa de ombro'},
  ];
  assert.deepEqual(categoriasDisponiveis(itens), ['Bolsa de ombro','Cinto','Óculos']);
});

test('filtrarPedidosPorCanal', () => {
  const peds=[{loja:{id:1}},{loja:{id:2}},{loja:{id:1}}];
  assert.equal(filtrarPedidosPorCanal(peds, null).length, 3);
  assert.equal(filtrarPedidosPorCanal(peds, []).length, 3);
  assert.equal(filtrarPedidosPorCanal(peds, [1]).length, 2);
  // multi-select: união de dois canais
  assert.equal(filtrarPedidosPorCanal(peds, [1,2]).length, 3);
  assert.deepEqual(filtrarPedidosPorCanal(peds, [2]).map(p=>p.loja.id), [2]);
  // aceita Set também
  assert.equal(filtrarPedidosPorCanal(peds, new Set([1,2])).length, 3);
});

// ── QUANTOS FICARAM DE FORA (20/08/2026) ─────────────────────────────────────
// A tela esconde matéria-prima e, desde o conserto do coletor, esconde também o
// que a lista de classificação não reconheceu. Esconder calado é o defeito
// gêmeo de mostrar o que não devia: quem olha o telão não tem como saber que
// falta coisa. Por isso o número sai junto da contagem.
test('prepararEstoque conta quantos ficaram de fora por não ter categoria', () => {
  const itens = [
    { sku: 'A1', produto: 'Bolsa Tote', categoria: 'Tote', saldo: 5 },
    { sku: 'A2', produto: 'Cinto Couro', categoria: 'Cinto', saldo: 9 },
    { sku: 'B1', produto: 'Argola - 1.6cm', categoria: null, saldo: 764 },
    { sku: 'B2', produto: 'Sacola TNT', categoria: '', saldo: 30 },
    { sku: 'B3', produto: 'Couro Bristol', categoria: '   ', saldo: 2 },
  ];
  const r = prepararEstoque(itens, {});
  assert.equal(r.rows.length, 2);
  assert.equal(r.full, 2);
  assert.equal(r.semClassificacao, 3);
});

test('semClassificacao não muda com busca, status nem limite', () => {
  const itens = [
    { sku: 'A1', produto: 'Bolsa Tote', categoria: 'Tote', saldo: 5 },
    { sku: 'A2', produto: 'Cinto Couro', categoria: 'Cinto', saldo: 900 },
    { sku: 'B1', produto: 'Argola', categoria: null, saldo: 1 },
  ];
  // O número é sobre o que a TELA esconde por não ser produto, e isso não
  // depende do que a pessoa digitou no filtro.
  assert.equal(prepararEstoque(itens, { busca: 'bolsa' }).semClassificacao, 1);
  assert.equal(prepararEstoque(itens, { status: 'crit' }).semClassificacao, 1);
  assert.equal(prepararEstoque(itens, { limit: 1 }).semClassificacao, 1);
  assert.equal(prepararEstoque(itens, { categorias: ['Tote'] }).semClassificacao, 1);
});

test('sem nada escondido, o número é 0 e não some', () => {
  const r = prepararEstoque([{ sku: 'A1', produto: 'Bolsa', categoria: 'Tote', saldo: 1 }], {});
  assert.equal(r.semClassificacao, 0);
});
