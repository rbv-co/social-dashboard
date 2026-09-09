import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ⚠️⚠️ QUEM MANDA NA FOTO DO CERTIFICADO — E A TRAVA QUE DECIDE.
 *
 * Regra do dono, 08/09/2026: "Zoho quando houver pasta tratada e a cor e o SKU
 * bater". A pasta do Zoho ja vem tratada, entao ela tem preferencia — mas so
 * com o SKU exato E a cor conferindo. Nao conferindo, o Bling assume.
 *
 * ⚠️ POR QUE A COR ENTROU NA CONTA: em 07/09 o Zoho passou a vir primeiro sem
 * conferencia nenhuma alem do SKU. A LUNEA PINHAO (SS0008HB.M4) tem pasta com o
 * SKU exato — `Lunea_Pinhão - SS0008HB.M4` — e arquivos `Lunea_Marrom_*` dentro.
 * O certificado da cliente ficou com aquele conjunto em vez do cadastro do
 * Bling, e o dono viu. Conferido em 08/09 pelos md5 do que estava publicado.
 *
 * O Bling e a queda de todo caso duvidoso porque e o cadastro que aparece na
 * loja, no Mercado Livre e na Shopify — onde a cliente decide comprar. */

const ROBO = readFileSync(new URL('../fotos-do-selo-do-bling.mjs', import.meta.url), 'utf8');

test('o Zoho e consultado antes, e o Bling e a queda', () => {
  const zoho = ROBO.indexOf('fotosDoZohoParaSku(lote.sku');
  const bling = ROBO.indexOf('imagensGrandesDoProduto(produto)');
  assert.ok(zoho > -1 && bling > -1, 'nao achei as duas fontes');
  assert.ok(zoho < bling, 'a ordem mudou sem passar por aqui');
  assert.match(ROBO, /if \(!urls\.length\) \{\s*\n\s*urls = imagensGrandesDoProduto/,
    'sem a queda, lote reprovado na cor ficaria sem foto tendo foto no Bling');
});

test('⚠️ a COR vai junto na pergunta ao Zoho — e nao pode ser esquecida', () => {
  /* Sem passar a cor, `pastaServeParaACor` reprova tudo e o Zoho nunca e usado;
   * pior, se um dia o parametro virar opcional com padrao permissivo, a Pinhao
   * volta calada. */
  assert.match(ROBO, /fotosDoZohoParaSku\(lote\.sku, \{ cor: corDoLote \}\)/);
  assert.match(ROBO, /const corDoLote = mudou\.cor \?\? lote\.cor/,
    'a cor lida do Bling nesta mesma rodada tem de contar');
});

test('⚠️ o PORQUE da trava esta escrito junto do codigo', () => {
  assert.match(ROBO, /A TRAVA DE COR NASCEU DE UM DEFEITO DE VERDADE/);
  assert.match(ROBO, /LUNEA PINHAO/, 'sumiu o caso que originou a trava');
  assert.match(ROBO, /DECIDE COMPRAR/, 'sumiu o motivo de o Bling ser a queda');
});

test('o robo DIZ quando reprovou a pasta do Zoho', () => {
  // Reprovacao silenciosa vira "por que essa bolsa mudou de foto?" tres meses
  // depois, sem nenhum rastro.
  assert.match(ROBO, /else if \(doZoho\.porque\) \{/);
});

test('falha do Zoho NAO derruba a rodada — cai no Bling', () => {
  const trecho = ROBO.slice(ROBO.indexOf('fotosDoZohoParaSku(lote.sku'));
  assert.match(trecho.slice(0, 900), /catch \(e\)/);
  assert.match(trecho.slice(0, 900), /tentando o Bling/);
});

test('⚠️ `--refazer` existe, e o robo o usa nos DOIS lugares', () => {
  /* Quando a regra das fontes muda, quem ja tem foto continua com a da regra
   * antiga PARA SEMPRE — porque "ja tem foto" e a condicao de ser ignorado.
   * Sao dois filtros: o que escolhe os lotes e o que decide baixar a foto. */
  assert.match(ROBO, /const REFAZER = process\.argv\.includes\('--refazer'\)/);
  assert.match(ROBO, /lotesParaOlhar\(lotes, \{ refazer: REBAIXAR \}\)/);
  assert.match(ROBO, /if \(falta\.faltaFoto \|\| REBAIXAR\)/);
});

test('refazer NAO e o padrao — rebaixar tudo todo dia gasta cota a toa', () => {
  assert.ok(!/const REFAZER = true/.test(ROBO));
});
