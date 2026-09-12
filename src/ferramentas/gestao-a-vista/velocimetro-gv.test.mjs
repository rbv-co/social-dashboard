import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALTURA_SO_ARCO,
  Y_PRIMEIRA_LINHA,
  montarLinhas,
  posicionarLinhas,
  alturaComum,
} from './velocimetro-gv.js';

// Um canal completo: tem meta batida e tem período anterior para comparar.
const COMPLETO = {
  vendidoStr: 'R$ 12.400',
  metaStr: 'meta R$ 10.000',
  desvioStr: '↑ R$2,4k da meta',
  desvioCol: 'var(--green)',
  deltaStr: '↑ 18% vs ontem',
  deltaCol: 'var(--green)',
};

test('canal completo: as quatro linhas, na ordem de sempre', () => {
  const linhas = montarLinhas(COMPLETO);
  assert.deepEqual(
    linhas.map((l) => l.t),
    ['R$ 12.400', 'meta R$ 10.000', '↑ R$2,4k da meta', '↑ 18% vs ontem'],
  );
});

test('linha ausente não ocupa lugar: sem meta sobra só o comparativo', () => {
  const linhas = montarLinhas({ deltaStr: '↓ 5% vs ontem', deltaCol: 'var(--red)' });
  assert.deepEqual(linhas.map((l) => l.t), ['↓ 5% vs ontem']);
});

test('canal sem meta e sem histórico não tem linha nenhuma', () => {
  assert.deepEqual(montarLinhas({}), []);
});

test('o nome do canal entra quando vem, entre o desvio e o comparativo', () => {
  const linhas = montarLinhas({ ...COMPLETO, canalNm: 'Mercado Livre' });
  assert.deepEqual(
    linhas.map((l) => l.t),
    ['R$ 12.400', 'meta R$ 10.000', '↑ R$2,4k da meta', 'Mercado Livre', '↑ 18% vs ontem'],
  );
});

test('a cor do desvio e a do comparativo são as que chegaram; sem cor, o tom apagado', () => {
  const comCor = montarLinhas(COMPLETO);
  assert.equal(comCor[2].cor, 'var(--green)');
  assert.equal(comCor[3].cor, 'var(--green)');
  const semCor = montarLinhas({ ...COMPLETO, desvioCol: null, deltaCol: null });
  assert.equal(semCor[2].cor, 'var(--muted)');
  assert.equal(semCor[3].cor, 'var(--muted)');
});

test('as linhas empilham de cima para baixo, começando logo abaixo do arco', () => {
  const { linhas } = posicionarLinhas(montarLinhas(COMPLETO));
  assert.equal(linhas[0].y, Y_PRIMEIRA_LINHA);
  for (let i = 1; i < linhas.length; i++) {
    assert.ok(linhas[i].y > linhas[i - 1].y, 'cada linha vem abaixo da anterior');
  }
});

test('faltando as do meio, o comparativo SOBE — não fica cravado lá embaixo', () => {
  const soDelta = posicionarLinhas(montarLinhas({ deltaStr: '↓ 5% vs ontem' }));
  assert.equal(soDelta.linhas[0].y, Y_PRIMEIRA_LINHA);
});

test('sem linha nenhuma, a altura é a do arco sozinho', () => {
  assert.equal(posicionarLinhas([]).altura, ALTURA_SO_ARCO);
});

test('a altura natural cresce com a quantidade de linhas', () => {
  const cheio = posicionarLinhas(montarLinhas(COMPLETO)).altura;
  const magro = posicionarLinhas(montarLinhas({ deltaStr: '↓ 5%' })).altura;
  assert.ok(cheio > magro, 'é justamente essa diferença que desalinhava os cards');
  assert.ok(magro > ALTURA_SO_ARCO);
});

// ── O CONSERTO ──────────────────────────────────────────────────────────────
// Todo card da rodada desenha com a MESMA altura de viewBox. Como o SVG é
// width:100% + height:auto, viewBox igual = card renderizado igual.

test('alturaComum devolve a maior altura da rodada', () => {
  const rodada = [
    montarLinhas(COMPLETO),
    montarLinhas({ deltaStr: '↓ 5%' }),
    montarLinhas({}),
  ];
  const comum = alturaComum(rodada);
  const maior = Math.max(...rodada.map((l) => posicionarLinhas(l).altura));
  assert.equal(comum, maior);
});

test('com a altura comum, o card mais pobre fica do tamanho do mais rico', () => {
  const rodada = [montarLinhas(COMPLETO), montarLinhas({}), montarLinhas({ deltaStr: '↓ 5%' })];
  const comum = alturaComum(rodada);
  const alturas = rodada.map((l) => posicionarLinhas(l, comum).altura);
  assert.deepEqual(alturas, [comum, comum, comum]);
});

test('a sobra vai para o RODAPÉ: a primeira linha não desce', () => {
  const rodada = [montarLinhas(COMPLETO), montarLinhas({ deltaStr: '↓ 5%' })];
  const comum = alturaComum(rodada);
  const pobre = posicionarLinhas(montarLinhas({ deltaStr: '↓ 5%' }), comum);
  assert.equal(pobre.linhas[0].y, Y_PRIMEIRA_LINHA, 'começa colada no arco, sobra fica embaixo');
});

test('altura comum nunca encolhe um card: forçar menos que o natural é ignorado', () => {
  const linhas = montarLinhas(COMPLETO);
  const natural = posicionarLinhas(linhas).altura;
  assert.equal(posicionarLinhas(linhas, natural - 40).altura, natural);
});

test('rodada vazia ou sem linha nenhuma: a altura é a do arco, nunca 0 nem NaN', () => {
  assert.equal(alturaComum([]), ALTURA_SO_ARCO);
  assert.equal(alturaComum([[], []]), ALTURA_SO_ARCO);
});

test('posicionarLinhas não mexe na lista que recebeu', () => {
  const linhas = montarLinhas(COMPLETO);
  const antes = JSON.stringify(linhas);
  posicionarLinhas(linhas, 200);
  assert.equal(JSON.stringify(linhas), antes);
});
