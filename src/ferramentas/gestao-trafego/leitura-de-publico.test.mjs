import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarLeituraDePublico, publicoDaReceita } from './leitura-de-publico.js';
import { lerFaixasDeIdade, recomendarIdade } from './sugerir-publico.js';

// AS FIXTURES SÃO NÚMEROS REAIS, medidos no Graph em 12/08/2026 (só leitura).
// Usar número inventado aqui esconderia justamente o caso que motivou o alerta.

// Vessel: a mais barata é 18-24 e ela sozinha fica dentro do corte de 1,5x.
const VESSEL = [
  { age: '18-24', spend: '430.14', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '109' }] },
  { age: '25-34', spend: '1409.37', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '157' }] },
  { age: '35-44', spend: '1648.19', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '193' }] },
  { age: '45-54', spend: '2548.41', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '235' }] },
  { age: '55-64', spend: '2245.80', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '163' }] },
  { age: '65+', spend: '1832.03', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '137' }] },
];
// Motoeasy: seis faixas, todas com custo parecido -> nao ha o que cortar.
const MOTOEASY = [
  { age: '18-24', spend: '3391.34', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '287' }] },
  { age: '25-34', spend: '9799.27', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '864' }] },
  { age: '35-44', spend: '7643.70', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '615' }] },
  { age: '45-54', spend: '2889.17', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '241' }] },
  { age: '55-64', spend: '220.69', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '26' }] },
];
const contar = (l) => Number((l.actions || []).find((a) => /messaging_conversation_started/.test(a.action_type))?.value || 0);

const leitura = (linhas) => {
  const faixas = lerFaixasDeIdade(linhas, contar);
  return montarLeituraDePublico({ faixas, recomendacao: recomendarIdade(faixas), contando: 'conversas iniciadas' });
};

test('conta com faixa cara: veredito "ajustar" e o dinheiro que foi pra elas', () => {
  const r = leitura(VESSEL);
  assert.equal(r.veredito, 'ajustar');
  assert.ok(r.dinheiroEmFaixasCaras > 9000, `esperava ~R$ 9.683, veio ${r.dinheiroEmFaixasCaras}`);
  assert.equal(r.receita.idadeMin, 18);
});

// O CASO QUE MOTIVOU O ALERTA. A aritmética manda cortar 5 das 6 faixas porque
// 18-24 conversa mais barato -- e conversa barata nao e venda de bolsa de couro.
test('corte drastico (1 faixa de 6) vem com alerta que manda conferir a persona', () => {
  const r = leitura(VESSEL);
  assert.match(r.alerta, /5 das 6/);
  assert.match(r.alerta, /persona/);
  assert.match(r.alerta, /quem sai mais barato, n[ãa]o quem compra/);
});

test('conta equilibrada NAO some da tela: veredito "manter" com o porque', () => {
  // O dono pediu explicitamente pra ver o resultado positivo tambem.
  const r = leitura(MOTOEASY);
  assert.equal(r.veredito, 'manter');
  assert.equal(r.receita, null, 'nao ha receita: nao ha o que mudar');
  assert.match(r.frase, /equilibrad|perto demais/);
  assert.equal(r.alerta, '');
});

test('conta equilibrada nomeia a faixa mais barata E a mais cara', () => {
  const r = leitura(MOTOEASY);
  assert.match(r.frase, /55-64/);   // a mais barata (R$ 8,49)
  assert.match(r.frase, /35-44/);   // a mais cara (R$ 12,43)
});

test('sem dado suficiente e um VEREDITO, nao um vazio', () => {
  const magra = [{ age: '18-24', spend: '100', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' }] }];
  const r = leitura(magra);
  assert.equal(r.veredito, 'sem-dados');
  assert.match(r.frase, /chute/);
  assert.equal(r.receita, null);
});

test('sem linha nenhuma tambem fala, em vez de ficar mudo', () => {
  const r = leitura([]);
  assert.equal(r.veredito, 'sem-dados');
  assert.match(r.frase, /Não há resultado por faixa de idade/);
});

test('entrada torta nao quebra', () => {
  assert.equal(montarLeituraDePublico().veredito, 'sem-dados');
  assert.equal(montarLeituraDePublico({ faixas: null, recomendacao: null }).veredito, 'sem-dados');
});

// O FAROL: a receita vira publico pro editor.
test('publicoDaReceita monta o publico preservando o resto do padrao', () => {
  const vazio = { cidades: [], idadeMin: 18, idadeMax: 65, interesses: [], generos: [], advantagePlus: true };
  const p = publicoDaReceita({ idadeMin: 25, idadeMax: 54, cidades: [{ key: '1', nome: 'Campinas' }], interesses: [{ id: '9', nome: 'Bolsas' }] }, vazio);
  assert.equal(p.idadeMin, 25);
  assert.equal(p.idadeMax, 54);
  assert.equal(p.cidades.length, 1);
  assert.equal(p.interesses.length, 1);
  assert.equal(p.advantagePlus, true, 'o resto do padrão do editor continua de pé');
});

test('sem receita nao se inventa publico', () => {
  assert.equal(publicoDaReceita(null, {}), null);
});
