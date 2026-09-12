import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ⚠️ A LISTA QUE SEGURA O ERP INTEIRO — e que ate 05/09/2026 nao tinha teste.
 *
 * O token do Bling que esta edge usa abre o ERP TODO: pedidos, clientes,
 * produtos, estoque, financeiro. O que separa a Central do resto e esta lista de
 * caminhos. Uma linha escrita larga demais (um `.*` no lugar errado, uma barra a
 * mais) abre porta sem ninguem perceber — nao ha erro, ha acesso.
 *
 * Este arquivo le a lista do proprio index.ts e a exercita. */

const FONTE = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

function caminhosPermitidos() {
  const bloco = FONTE.slice(
    FONTE.indexOf('const CAMINHOS_PERMITIDOS'),
    FONTE.indexOf('];', FONTE.indexOf('const CAMINHOS_PERMITIDOS')),
  );
  // pega os literais de regex das linhas que nao sao comentario
  return bloco.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('/^'))
    .map((l) => l.replace(/,$/, ''))
    .map((lit) => new RegExp(lit.slice(1, lit.lastIndexOf('/'))));
}

const permite = (caminho) => caminhosPermitidos().some((re) => re.test(caminho));

test('a lista foi encontrada e nao esta vazia', () => {
  assert.ok(caminhosPermitidos().length >= 10,
    'nao consegui ler os caminhos do index.ts — o teste estaria passando a toa');
});

test('os caminhos que as telas usam CONTINUAM abertos', () => {
  for (const bom of [
    'pedidos/vendas', 'pedidos/vendas/123', 'vendedores/45',
    'produtos', 'produtos/999', 'estoques/saldos',
    'nfe', 'nfe/7', 'nfce', 'nfce/7',
    'depositos',
  ]) {
    assert.ok(permite(bom), `caminho que uma tela usa foi fechado: ${bom}`);
  }
});

test('⚠️ o que NAO e da Central continua fechado', () => {
  for (const mau of [
    'contatos', 'contatos/1', 'financeiro', 'contas/pagar', 'contas/receber',
    'oauth/token', 'usuarios', 'notas', 'estoques', 'estoques/saldos/1',
    'pedidos', 'pedidos/compras', 'depositos/1', 'depositos/1/saldos',
  ]) {
    assert.ok(!permite(mau), `caminho perigoso ficou ABERTO: ${mau}`);
  }
});

test('⚠️ nao da para escapar do caminho', () => {
  // Barra e ponto sao o material de toda fuga de caminho.
  for (const fuga of [
    'produtos/../oauth/token', 'produtos/..%2Foauth', '../financeiro',
    'depositos/../contatos', 'depositos ', ' depositos', 'depositos/',
  ]) {
    assert.ok(!permite(fuga), `fuga de caminho aceita: ${fuga}`);
  }
});

test('toda regra e ancorada nas DUAS pontas', () => {
  /* Regra sem `^` casa no meio do texto; sem `$` casa qualquer sufixo. Uma
   * `/^produtos/` sem `$` abriria `produtos-e-mais-o-que-vier`. */
  for (const re of caminhosPermitidos()) {
    const s = re.source;
    assert.ok(s.startsWith('^'), `regra sem ancora no comeco: ${s}`);
    assert.ok(s.endsWith('$'), `regra sem ancora no fim: ${s}`);
  }
});
