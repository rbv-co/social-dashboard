import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirAutorizacao, igualTempoConstante } from './autorizacao-de-cron.js';

const CERTO = 'abc123';
const AUTH = `Bearer ${CERTO}`;

test('sem Bearer nao entra, e nem chega a olhar segredo', () => {
  for (const auth of ['', 'abc123', 'Basic abc123', 'bearer abc123']) {
    const d = decidirAutorizacao({ auth, segredoNaMemoria: CERTO });
    assert.equal(d.acao, 'negar', `deixou passar: ${JSON.stringify(auth)}`);
  }
});

test('bateu com a memoria: entra SEM tocar o banco', () => {
  const d = decidirAutorizacao({ auth: AUTH, segredoNaMemoria: CERTO });
  assert.equal(d.acao, 'autorizar');
});

test('memoria vazia: vai ao banco (e nao tem nada para descartar)', () => {
  const d = decidirAutorizacao({ auth: AUTH, segredoNaMemoria: null });
  assert.equal(d.acao, 'ler-o-banco');
  assert.equal(d.descartarMemoria, false);
});

test('⚠️ O DIA DA ROTACAO: nao bateu com a memoria, LE O BANCO antes de negar', () => {
  /* O defeito que esta regra impede so apareceria no dia em que alguem trocasse
   * o segredo — e ai TODOS os robos cairiam por ate o tempo da memoria, sem
   * ninguem entender por que. Negar direto seria "mais seguro" e estaria errado:
   * o chamador pode estar certo e a memoria velha. */
  const d = decidirAutorizacao({ auth: AUTH, segredoNaMemoria: 'segredo-velho' });
  assert.equal(d.acao, 'ler-o-banco');
  assert.equal(d.descartarMemoria, true, 'guardar o velho faria o erro se repetir na proxima');
});

test('⚠️ FAIL-CLOSED intacto: leu o banco e nao ha segredo -> nega', () => {
  const d = decidirAutorizacao({ auth: AUTH, segredoDoBanco: null });
  assert.equal(d.acao, 'negar');
});

test('⚠️ FAIL-CLOSED intacto: leu o banco e o segredo e OUTRO -> nega', () => {
  const d = decidirAutorizacao({ auth: AUTH, segredoDoBanco: 'outro-segredo' });
  assert.equal(d.acao, 'negar');
});

test('leu o banco e bateu: entra', () => {
  assert.equal(decidirAutorizacao({ auth: AUTH, segredoDoBanco: CERTO }).acao, 'autorizar');
});

test('⚠️ a leitura que FALHOU nao pode virar "autorizado" por descuido', () => {
  // `null` é "li e não tem"; `undefined` é "ainda não li". Confundir os dois é o
  // jeito clássico de um fail-closed virar fail-open numa refatoração futura.
  assert.equal(decidirAutorizacao({ auth: AUTH, segredoDoBanco: null }).acao, 'negar');
  assert.equal(decidirAutorizacao({ auth: AUTH, segredoDoBanco: '' }).acao, 'negar');
  assert.equal(decidirAutorizacao({ auth: AUTH, segredoDoBanco: undefined }).acao, 'ler-o-banco');
});

test('a comparacao nao entrega o segredo pelo tamanho', () => {
  assert.equal(igualTempoConstante('abc', 'abc'), true);
  assert.equal(igualTempoConstante('abc', 'abd'), false);
  assert.equal(igualTempoConstante('abc', 'abcd'), false);
  assert.equal(igualTempoConstante('', ''), true);
  assert.equal(igualTempoConstante(null, undefined), true, 'os dois viram string vazia');
});
