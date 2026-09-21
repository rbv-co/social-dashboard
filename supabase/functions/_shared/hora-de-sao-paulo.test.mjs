import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paredeEmSaoPaulo, instanteLegivel, diaEmSaoPaulo } from './hora-de-sao-paulo.js';

// ⚠️ AS LINHAS DESTE TESTE SÃO CADASTROS REAIS, medidos no banco em 21/09/2026,
// e o defeito que elas provam é o que motivou o conserto: a planilha imprimia
// o instante como o banco o guarda (UTC) e adiantava tudo em 3 horas.

test('a Marisa entrou dia 20 às 23h11, e não dia 21 às 02h11', () => {
  // `criado_em` dela no banco: 2026-09-21 02:11:23.050085+00
  assert.equal(instanteLegivel('2026-09-21T02:11:23.050085+00:00'),
    '2026-09-20 23:11:23');
  // O DIA muda, e é isso que fazia 24 dos 150 cadastros cairem no dia errado.
  assert.equal(diaEmSaoPaulo('2026-09-21T02:11:23.050085+00:00'), '2026-09-20');
});

test('cadastro do meio da tarde perde 3 horas e mantém o dia', () => {
  assert.equal(instanteLegivel('2026-09-21T17:37:08.239706+00:00'),
    '2026-09-21 14:37:08');
});

test('meia-noite em São Paulo sai como 00, nunca como 24', () => {
  // 03:00 em UTC é exatamente meia-noite no Brasil.
  const h = paredeEmSaoPaulo('2026-09-21T03:00:00+00:00');
  assert.equal(h.hora, 0);
  assert.equal(instanteLegivel('2026-09-21T03:00:00+00:00'), '2026-09-21 00:00:00');
});

test('o horário de verão antigo é respeitado, e não descontado na mão', () => {
  // 15/01/2018: o Brasil estava em horário de verão, UTC-2 e não UTC-3.
  // Menos-três-horas na mão erraria esta linha em uma hora.
  assert.equal(instanteLegivel('2018-01-15T12:00:00+00:00'), '2018-01-15 10:00:00');
  // Em julho do mesmo ano, sem horário de verão, são três horas.
  assert.equal(instanteLegivel('2018-07-15T12:00:00+00:00'), '2018-07-15 09:00:00');
});

test('vazio e lixo devolvem vazio, e não "Invalid Date" na célula', () => {
  for (const v of [null, undefined, '', 'nao e data']) {
    assert.equal(instanteLegivel(v), '', `falhou em ${JSON.stringify(v)}`);
    assert.equal(diaEmSaoPaulo(v), '');
    assert.equal(paredeEmSaoPaulo(v), null);
  }
});

test('aceita objeto Date, não só texto', () => {
  assert.equal(instanteLegivel(new Date('2026-09-21T02:11:23Z')), '2026-09-20 23:11:23');
});
