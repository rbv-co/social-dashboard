import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeDeQuemAgiu } from './nome-de-quem-agiu.js';

const PESSOAS = [{ id: 'p1', nome: 'Raissa Herculano', profile_id: 'u1' }];
const PERFIS = [
  { id: 'u1', name: 'Raissa H.',  email: 'raissa@rbvcompany.com' },
  { id: 'u2', name: 'Erick Martins', email: 'erick@rbvcompany.com' },
  { id: 'u3', name: '',           email: 'gabriel@rbvcompany.com' },
  { id: 'u4', name: null,         email: null },
];

test('a ficha de colaborador vence — é o nome que o resto da tela usa', () => {
  assert.equal(nomeDeQuemAgiu('u1', PESSOAS, PERFIS), 'Raissa Herculano');
});

// O DEFEITO QUE ISTO CONSERTA: quem tem login e NÃO tem ficha de colaborador
// ligada aparecia só como data, sem nome. Medido em 18/08: 8 das 20 contas não
// têm ficha ligada, e DUAS delas são admin — justamente quem decide reserva.
test('sem ficha ligada, cai no nome do perfil', () => {
  assert.equal(nomeDeQuemAgiu('u2', PESSOAS, PERFIS), 'Erick Martins');
});

test('sem nome no perfil, cai no e-mail — feio, mas identifica', () => {
  assert.equal(nomeDeQuemAgiu('u3', PESSOAS, PERFIS), 'gabriel@rbvcompany.com');
});

// NUNCA o id cru: um UUID na tela não diz nada a ninguém e parece defeito.
test('sem nada, diz que a conta não tem nome — e não mostra o id', () => {
  const saida = nomeDeQuemAgiu('u4', PESSOAS, PERFIS);
  assert.match(saida, /sem nome/i);
  assert.doesNotMatch(saida, /u4/);
});

test('conta que nem existe na lista também não vira id na tela', () => {
  const saida = nomeDeQuemAgiu('desconhecido', PESSOAS, PERFIS);
  assert.match(saida, /sem nome/i);
  assert.doesNotMatch(saida, /desconhecido/);
});

// Isto NÃO é o defeito: quando não houve ator, não há nome a mostrar. A tela
// escreve só a data, e está certo — inventar "alguém" seria pior.
test('sem ator nenhum devolve null, e a tela cala', () => {
  assert.equal(nomeDeQuemAgiu(null, PESSOAS, PERFIS), null);
  assert.equal(nomeDeQuemAgiu('', PESSOAS, PERFIS), null);
  assert.equal(nomeDeQuemAgiu(undefined, PESSOAS, PERFIS), null);
});

test('listas ausentes não derrubam a tela', () => {
  assert.match(nomeDeQuemAgiu('u1', null, null), /sem nome/i);
  assert.equal(nomeDeQuemAgiu('u1', PESSOAS, null), 'Raissa Herculano');
});

test('espaço em branco no nome não conta como nome', () => {
  const perfis = [{ id: 'u9', name: '   ', email: 'z@x.com' }];
  assert.equal(nomeDeQuemAgiu('u9', [], perfis), 'z@x.com');
});
