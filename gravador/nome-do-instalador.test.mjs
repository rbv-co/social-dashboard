import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('./electron-builder.config.cjs');

/* ⚠️ O NOME DO INSTALADOR E O `latest.yml` TÊM DE NASCER IGUAIS.
 *
 * O `latest.yml` é o arquivo que o programa instalado lê para saber que existe
 * versão nova e onde baixá-la. O electron-builder escreve nele o nome com
 * HÍFENS, mas monta o arquivo com o `productName` — que tem ESPAÇOS. Os dois
 * não batem: o programa pediria um arquivo inexistente e a atualização ficaria
 * MUDA, sem erro em tela nenhuma.
 *
 * Aconteceu na 1.0.0 e de novo na 1.0.1, as duas pegas na conferência manual
 * antes de subir. Este teste tira isso do "alguém lembrar". */

test('⚠️ o nome do instalador NAO tem espaco', () => {
  const nome = config.win?.artifactName;
  assert.ok(nome, 'sem `artifactName` o nome volta a sair do productName, com espacos');
  assert.ok(!/ /.test(nome), `o nome tem espaco: "${nome}"`);
});

test('o nome carrega a VERSAO — senao um instalador sobrescreve o outro', () => {
  assert.match(config.win.artifactName, /\$\{version\}/);
  assert.match(config.win.artifactName, /\$\{ext\}/);
});

test('o nome e exatamente o que o electron-builder escreve no latest.yml', () => {
  /* A regra dele: trocar espaco por hifen no productName. Entao o nome fixo tem
   * de ser o productName hifenizado — se alguem renomear o produto e esquecer
   * daqui, isto falha. */
  const esperado = `${config.productName.replace(/ /g, '-')}-Setup-\${version}.\${ext}`;
  assert.equal(config.win.artifactName, esperado);
});

test('o resto da configuracao do Windows continua de pe', () => {
  assert.equal(config.win.target, 'nsis');
  assert.equal(config.nsis.shortcutName, 'Gravador de Etiquetas');
  assert.equal(config.nsis.oneClick, false);
});
