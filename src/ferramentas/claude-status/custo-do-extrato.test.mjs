import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fraseDoCusto, ehZeroDeVerdade, somarCustos, porFornecedor } from './custo-do-extrato.js';

test('custo zero de verdade é dito como zero', () => {
  assert.match(fraseDoCusto(0), /R\$ 0/);
  assert.equal(ehZeroDeVerdade(0), true);
});

// O DEFEITO QUE ISTO CONSERTA: `Number(null) === 0` é TRUE em JavaScript. Sem
// esta distinção, "não sei" apareceria na tela como "R$ 0 · sem API paga" — que
// é exatamente a mentira que 473 criativos pagos contaram durante um mês.
test('custo desconhecido NÃO é zero, e a tela precisa dizer isso', () => {
  assert.equal(ehZeroDeVerdade(null), false);
  assert.equal(ehZeroDeVerdade(undefined), false);
  assert.doesNotMatch(fraseDoCusto(null), /R\$ 0/);
  assert.match(fraseDoCusto(null), /não|ainda/i);
});

test('custo com valor sai em reais', () => {
  assert.match(fraseDoCusto(2), /R\$/);
  assert.doesNotMatch(fraseDoCusto(2), /não sei/i);
});

test('a soma separa o que se sabe do que não se sabe', () => {
  const r = somarCustos([
    { usd: 1, itens: 2 }, { usd: 2, itens: 3 },
    { usd: null, itens: 10 }, { usd: null, itens: 5 },
  ]);
  assert.equal(r.usd, 3);
  assert.equal(r.execucoesSemCusto, 2);
  assert.equal(r.itensSemCusto, 15);
});

test('soma sem nada desconhecido não inventa aviso', () => {
  const r = somarCustos([{ usd: 1 }, { usd: 0 }]);
  assert.equal(r.usd, 1);
  assert.equal(r.execucoesSemCusto, 0);
});

test('lista vazia ou torta não derruba', () => {
  assert.deepEqual(somarCustos(null), { usd: 0, execucoesSemCusto: 0, itensSemCusto: 0 });
  assert.equal(somarCustos([null, undefined]).usd, 0);
});

// "Segmentado e organizado", pedido do dono em 18/08.
test('separa por fornecedor: Anthropic, OpenAI e o que não usa IA', () => {
  const g = porFornecedor([
    { modelo: 'claude-opus-4-8', usd: 3 },
    { modelo: 'claude-sonnet-4-6', usd: 1 },
    { modelo: 'gpt-image-2', usd: null, itens: 20 },
    { modelo: null, usd: 0 },
  ]);
  assert.equal(g.anthropic.usd, 4);
  assert.equal(g.openai.execucoesSemCusto, 1);
  assert.equal(g.openai.itensSemCusto, 20);
  assert.equal(g.semIa.usd, 0);
});

test('modelo desconhecido não some: entra como "outros"', () => {
  const g = porFornecedor([{ modelo: 'motor-novo', usd: null, itens: 4 }]);
  assert.equal(g.outros.itensSemCusto, 4);
});

// ── O total dos dois fornecedores ────────────────────────────────────────────
import { somarFornecedores } from './custo-do-extrato.js';

test('os dois fornecedores conhecidos somam, e o total é completo', () => {
  const r = somarFornecedores({ Anthropic: 10, OpenAI: 45.4 });
  assert.equal(r.total, 55.4);
  assert.equal(r.completo, true);
  assert.deepEqual(r.faltando, []);
});

// O DEFEITO QUE ISTO IMPEDE: se a busca da OpenAI falhar e virar zero, a tela
// mostra um total menor que o real — com cara de número exato.
test('fornecedor que falhou NÃO entra como zero: o total fica marcado incompleto', () => {
  const r = somarFornecedores({ Anthropic: 10, OpenAI: null });
  assert.equal(r.total, 10);
  assert.equal(r.completo, false);
  assert.deepEqual(r.faltando, ['OpenAI']);
});

test('nenhum fornecedor conhecido não é R$ 0 — é "não sei"', () => {
  const r = somarFornecedores({ Anthropic: null, OpenAI: undefined });
  assert.equal(r.total, null);
  assert.equal(r.completo, false);
  assert.equal(r.faltando.length, 2);
});

test('zero de verdade continua sendo um valor conhecido', () => {
  const r = somarFornecedores({ Anthropic: 0, OpenAI: 45.4 });
  assert.equal(r.total, 45.4);
  assert.equal(r.completo, true);
});
