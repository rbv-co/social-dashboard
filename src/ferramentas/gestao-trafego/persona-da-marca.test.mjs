import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limparPersona, resumoPersona, fraseDaPersona, MAXIMO } from './persona-da-marca.js';

// POR QUE ESTE ARQUIVO EXISTE: o dono relatou "vc sugere idades que não casam com
// a marca". A causa medida no prompt de sugerir-publico-ia era a tela mandar só o
// NOME da conta. A persona é o que faltava chegar lá.

test('limpa o \\r\\n que vem de colar do Word/Zoho, sem destruir os topicos', () => {
  const colado = 'Mulher 30-55\r\n\r\n- procura bolsa de couro\r\n- nao e publico teen\r\n';
  const r = limparPersona(colado);
  assert.ok(!r.includes('\r'), 'o \\r some');
  assert.equal(r.split('\n').filter((l) => l.startsWith('- ')).length, 2, 'os dois topicos continuam em linhas separadas');
});

test('mais de uma linha em branco vira uma so, e sobra de espaco no fim da linha some', () => {
  assert.equal(limparPersona('a   \n\n\n\nb'), 'a\n\nb');
});

test('corta no teto em vez de deixar a persona crescer sem limite', () => {
  // Ela viaja em TODO pedido de sugestao de publico: tamanho aqui e custo recorrente.
  const gigante = 'x'.repeat(MAXIMO + 500);
  assert.equal(limparPersona(gigante).length, MAXIMO);
});

test('entrada que nao e texto nao quebra nem vira "undefined"', () => {
  assert.equal(limparPersona(null), '');
  assert.equal(limparPersona(undefined), '');
  assert.equal(limparPersona(42), '');
  assert.equal(limparPersona({}), '');
});

test('resumoPersona conta o que a tela precisa mostrar', () => {
  assert.deepEqual(resumoPersona('  '), { vazia: true, caracteres: 0, restantes: MAXIMO, excedeu: false });
  const r = resumoPersona('Mulher 30-55');
  assert.equal(r.vazia, false);
  assert.equal(r.caracteres, 12);
  assert.equal(r.restantes, MAXIMO - 12);
});

test('resumoPersona acusa quando passou do teto (a tela avisa, nao corta calada)', () => {
  const r = resumoPersona('x'.repeat(MAXIMO + 10));
  assert.equal(r.excedeu, true);
  assert.equal(r.restantes, -10);
});

test('persona VAZIA nao e erro: a frase diz o que muda por estar vazia', () => {
  const f = fraseDaPersona('', 'Vessel');
  assert.match(f, /Sem persona de Vessel/);
  assert.match(f, /para quem j[áa] clicou/, 'diz POR QUE isso e um problema');
});

test('persona preenchida: a frase diz que ela tem precedencia sobre os numeros', () => {
  const f = fraseDaPersona('Mulher 30-55', 'Vessel');
  assert.match(f, /preced[êe]ncia/);
});

test('sem nome de conta a frase nao vira "de undefined"', () => {
  assert.doesNotMatch(fraseDaPersona('', null), /undefined/);
  assert.doesNotMatch(fraseDaPersona('texto', ''), /undefined/);
});
