import { test } from 'node:test';
import assert from 'node:assert/strict';
import { custoPorSeguidorDaConta, AMOSTRA_MINIMA_DE_SEGUIDORES } from './seguidores.js';

test('custo por seguidor da conta é o gasto das campanhas de seguidores dividido pelo ganho', () => {
  const r = custoPorSeguidorDaConta({ gastoDeSeguidores: 3344, seguidoresGanhos: 2089 });
  assert.ok(Math.abs(r.valor - 1.60) < 0.01, 'medido na Vessel em 24/09: R$ 1,60');
  assert.equal(r.confiavel, true);
});

test('ganho zero ou negativo não vira número, vira explicação', () => {
  for (const ganho of [0, -12]) {
    const r = custoPorSeguidorDaConta({ gastoDeSeguidores: 500, seguidoresGanhos: ganho });
    assert.equal(r.valor, null, 'dividir por zero ou por perda de seguidor não produz custo');
    assert.equal(r.confiavel, false);
    assert.ok(r.porque && r.porque.length > 10, 'precisa dizer ao dono POR QUE não há número');
  }
});

test('amostra pequena devolve o número marcado como pouco confiável', () => {
  const r = custoPorSeguidorDaConta({ gastoDeSeguidores: 500, seguidoresGanhos: 3 });
  assert.ok(r.valor > 0);
  assert.equal(r.confiavel, false, 'três seguidores no período não sustentam uma régua');
});

// O brief cita R$ 7,21 (Mantova) e R$ 10,05 (Raíssa) medidos em 7 dias
// (24/09/2026), sem o par gasto/ganho por trás — aqui só confere que a DIVISÃO
// bate com essas duas razões (100 é um ganho arbitrário, só pra montar a
// fração; o que se confere é o resultado, não os valores reais da conta).
test('a divisão bate com as razões medidas: Mantova R$ 7,21 e Raíssa R$ 10,05', () => {
  const mantova = custoPorSeguidorDaConta({ gastoDeSeguidores: 721, seguidoresGanhos: 100 });
  assert.ok(Math.abs(mantova.valor - 7.21) < 0.01);
  const raissa = custoPorSeguidorDaConta({ gastoDeSeguidores: 1005, seguidoresGanhos: 100 });
  assert.ok(Math.abs(raissa.valor - 10.05) < 0.01);
});

test('amostra no limiar exato ainda não é confiável (limiar é exclusivo por baixo)', () => {
  const limite = custoPorSeguidorDaConta({ gastoDeSeguidores: 100, seguidoresGanhos: AMOSTRA_MINIMA_DE_SEGUIDORES - 1 });
  assert.equal(limite.confiavel, false);
  const acima = custoPorSeguidorDaConta({ gastoDeSeguidores: 100, seguidoresGanhos: AMOSTRA_MINIMA_DE_SEGUIDORES });
  assert.equal(acima.confiavel, true);
});

test('sem gasto de seguidores mas com ganho positivo dá custo zero, não null', () => {
  const r = custoPorSeguidorDaConta({ gastoDeSeguidores: 0, seguidoresGanhos: 50 });
  assert.equal(r.valor, 0);
});
