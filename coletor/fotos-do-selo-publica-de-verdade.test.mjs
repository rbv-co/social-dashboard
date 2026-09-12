import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ⚠️ `git push` GUARDA, MAS NAO PUBLICA ESTE SITE.
 *
 * O plano Hobby da Vercel BLOQUEIA o deploy quando os metadados de git dizem
 * que o repositorio e privado e de organizacao. Por isso existe
 * `ferramentas/publicar.sh`, que publica de uma copia SEM o `.git`.
 *
 * Ate 07/09/2026 este robo fazia `git push` e escrevia "Site publicado". O
 * estrago era invisivel: o lote ficava com o endereco da foto gravado no banco
 * e a pagina da cliente pedia uma imagem que respondia 404. Descoberto
 * conferindo o endereco de verdade depois de rodar — 46 lotes com foto no banco
 * e NENHUMA no ar. As antigas so funcionavam porque alguem tinha publicado o
 * site a mao por outro motivo, carregando a pasta junto. */

const ROBO = readFileSync(new URL('./fotos-do-selo-do-bling.mjs', import.meta.url), 'utf8');

test('⚠️ o robo CHAMA o script que publica de verdade', () => {
  assert.match(ROBO, /publicar\.sh/,
    'sem isto a foto fica no repositorio e a pagina da cliente responde 404');
});

test('⚠️ ele nao anuncia "publicado" logo depois do push', () => {
  /* O push vem antes, e tudo bem que venha — ele guarda a foto no historico. O
   * que nao pode e a frase de sucesso vir sem a publicacao no meio. */
  const doPush = ROBO.slice(ROBO.indexOf("git('push'"));
  const ateOFim = doPush.slice(0, doPush.indexOf('} else if'));
  const ondePublica = ateOFim.indexOf('publicar.sh');
  const ondeAnuncia = ateOFim.indexOf('Site publicado.');
  assert.ok(ondePublica > -1, 'nao publica');
  assert.ok(ondeAnuncia > -1, 'nao anuncia');
  assert.ok(ondePublica < ondeAnuncia,
    'a frase "Site publicado" vem ANTES de publicar — foi assim que mentiu por dias');
});

test('o script e chamado da pasta do site, e nao da pasta do coletor', () => {
  // Rodado do lugar errado, ele publicaria a pasta errada — ou nada.
  assert.match(ROBO, /execFileSync\('\.\/ferramentas\/publicar\.sh', \[\], \{ cwd: SITE/);
});

test('o push continua acontecendo — ele guarda a foto no historico', () => {
  assert.match(ROBO, /git\('push', 'origin', 'main'\)/,
    'sem o push a foto existiria so no ar, e sumiria na proxima publicacao');
});
