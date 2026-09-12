import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ⚠️ A MARCA QUE SEPARA UMA LP DA OUTRA, no Bling.
 *
 * O contato do Bling não tem campo de texto livre — `observacoes` não existe
 * (são 24 campos e ele não está entre eles; o Bling aceita no envio e descarta
 * calado). O único campo livre é `codigo`, e é ali que a origem viaja.
 *
 * O código começava SEMPRE com "LP-", porque quando ele foi escrito só existia
 * uma landing page. A coluna `origem` nasceu depois, para a pré-venda, e esta
 * parte não acompanhou: no Bling um cadastro de pré-venda ficava IDÊNTICO a um
 * da LP comum. A planilha sempre soube separar (tem coluna `origem`); o Bling
 * não. Corrigido em 06/09/2026, antes de existir o primeiro cadastro de
 * pré-venda — a pré-venda abre dia 08. */

const FONTE = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

// A função é curta e pura; leio o mapa da fonte e reproduzo a conta para
// exercitá-la de verdade, em vez de só conferir se o texto existe.
function prefixos() {
  const bloco = FONTE.slice(FONTE.indexOf('PREFIXO_POR_ORIGEM: Record<string, string> = {'));
  const corpo = bloco.slice(bloco.indexOf('{') + 1, bloco.indexOf('}'));
  return Object.fromEntries([...corpo.matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
}

test('cada LP tem a SUA marca — pre-venda nao se confunde com a LP comum', () => {
  const p = prefixos();
  assert.equal(p['pre-venda'], 'PV');
  assert.equal(p['lp-vesselbrasil'], 'LP');
  assert.notEqual(p['pre-venda'], p['lp-vesselbrasil'],
    'se as duas tiverem a mesma marca, nao da para separar no Bling');
});

test('a marca sai da ORIGEM da linha, e nao esta cravada', () => {
  assert.match(FONTE, /PREFIXO_POR_ORIGEM\[String\(linha\.origem \|\| ''\)\.trim\(\)\]/,
    'o prefixo tem de ser escolhido pela origem da linha');
  assert.ok(!/return `LP-\$\{dia\}/.test(FONTE),
    'voltou o "LP-" cravado: toda LP nova ficaria indistinguivel no Bling');
});

test('⚠️ origem desconhecida cai em "LP", e nao em algo inventado', () => {
  /* LP nova que alguem crie sem passar por aqui grava com a etiqueta antiga —
   * que e legivel — em vez de um codigo que ninguem sabe ler. */
  assert.match(FONTE, /const PREFIXO_PADRAO = 'LP';/);
  assert.match(FONTE, /\|\| PREFIXO_PADRAO;/);
});

test('o codigo continua unico por pessoa', () => {
  // Dois contatos disputando o mesmo `codigo` fariam o Bling recusar o segundo.
  assert.match(FONTE, /String\(linha\.id\)\.replace\(\/\[\^A-Za-z0-9\]\/g, ''\)\.slice\(-6\)/,
    'o pedaco do id tem de continuar no codigo');
});

test('a planilha continua carregando a origem na propria coluna', () => {
  // Ela sempre soube separar; o teste existe para nao se perder numa faxina.
  assert.match(FONTE, /const cab = \['nome', 'email', 'whatsapp', 'origem',/,
    'a coluna `origem` saiu do CSV');
});
