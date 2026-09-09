import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ⚠️ A RODADA TEM DE CHEGAR VIVA ATE A PUBLICACAO.
 *
 * Medido em 08/09/2026, rodando de verdade: um `fetch` cru estourou
 * `ECONNRESET` baixando uma foto e DERRUBOU O PROCESSO no lote 76 de 104.
 *
 * O estrago nao foi perder 28 lotes. Foi que a publicacao do site vem DEPOIS do
 * laco: 71 lotes ja tinham o endereco da foto nova gravado no banco, e nenhuma
 * dessas fotos estava no ar. O certificado da cliente aponta para o banco — ele
 * passou a pedir imagem que respondia 404.
 *
 * Por isso as duas travas testadas aqui: uma falha custa a FOTO, ou no maximo o
 * LOTE — nunca a rodada. */

const ROBO = readFileSync(new URL('../fotos-do-selo-do-bling.mjs', import.meta.url), 'utf8');

test('a foto e baixada por `baixarFoto`, nunca por `fetch` cru no laco', () => {
  assert.match(ROBO, /const baixada = await baixarFoto\(urls\[i\], cabecalhoExtra\)/);
  const laco = ROBO.slice(ROBO.indexOf('for (let i = 0; i < urls.length; i++)'));
  assert.ok(!/await fetch\(urls\[i\]/.test(laco.slice(0, 800)),
    'voltou o fetch cru — uma conexao caida derruba a rodada de novo');
});

test('`baixarFoto` aguenta a conexao cair, e tenta de novo', () => {
  const f = ROBO.slice(ROBO.indexOf('async function baixarFoto'));
  const corpo = f.slice(0, f.indexOf('\n}\n') + 3);
  assert.match(corpo, /try \{/, 'sem try/catch o ECONNRESET sobe e mata o processo');
  assert.match(corpo, /catch \(e\)/);
  assert.match(corpo, /tentativa/, 'uma queda de conexao merece nova tentativa');
});

test('um lote com problema NAO leva os outros junto', () => {
  const laco = ROBO.slice(ROBO.indexOf('for (const lote of alvos) {'));
  assert.match(laco.slice(0, 600), /try \{/,
    'o corpo do laco precisa estar dentro de try/catch');
  assert.match(laco, /sigo para o próximo/);
});

test('a publicacao vem DEPOIS do laco — e por isso o laco nao pode morrer', () => {
  /* Se um dia a publicacao passar para dentro do laco, este teste cai e a
   * pessoa que mexeu tem de pensar de novo no assunto. */
  const laco = ROBO.indexOf('for (const lote of alvos) {');
  const publica = ROBO.indexOf('// ── PUBLICAR O SITE ──');
  assert.ok(laco > -1 && publica > laco);
});

test('⚠️ a rodada de verdade REGISTRA de onde veio a foto', () => {
  /* Ate 08/09/2026 so o `--dry` dizia a fonte. Sem isto, responder "de onde veio
   * a foto desta bolsa?" vira deducao em cima da regra, e nao o registro do que
   * o robo fez naquele dia — que e o que vale quando a regra muda no meio. */
  assert.match(ROBO, /console\.log\(`   fonte: \$\{deOnde\} · \$\{urls\.length\} foto\(s\)`\)/);
})

test('⚠️ foto repetida NA FONTE nao entra duas vezes na galeria', () => {
  /* O dono viu a mesma foto marrom duas vezes no certificado 5YUNAVAAG8. Nao foi
   * o robo que duplicou: a pasta do Zoho da LUNEA PINHAO tem `Lado` e `Costas`
   * byte a byte iguais, e o cadastro do Bling repete a 2a na 3a. Comparar pelos
   * BYTES BAIXADOS, e nao pelo arquivo ja reduzido. */
  assert.match(ROBO, /const jaVistas = new Set\(\)/);
  assert.match(ROBO, /createHash\('md5'\)\.update\(baixada\)/,
    'a impressao tem de ser dos bytes baixados');
  assert.match(ROBO, /if \(jaVistas\.has\(impressao\)\) \{/);
})

test('⚠️ a sobra da rodada anterior e apagada', () => {
  /* Sair de 8 fotos para 7 deixa a `8.jpg` velha publicada no endereco antigo.
   * O certificado nao a lista, mas ela continua no ar. */
  assert.match(ROBO, /tirei a sobra/);
  assert.match(ROBO, /for \(let sobra = guardadas\.length \+ 1; sobra <= 20; sobra\+\+\)/);
})

test('⚠️ `--sku=` mexe em UMA bolsa so', () => {
  /* Regra do dono, 08/09/2026, depois de eu refazer as 104 para consertar duas:
   * "as vezes a maior parte ja ta ok, uma ou outra que aconteceu isso de mostrar
   * uma foto errada ou duplicada". O preco do excesso foi medido — 20 enderecos
   * do banco apontando para foto que nao estava publicada.
   *
   * ⚠️ E ELE PRECISA REFAZER SOZINHO: a bolsa que se quer consertar JA TEM foto
   * (errada), entao sem isso ela e ignorada e o comando nao faz nada, calado. */
  assert.match(ROBO, /const SO_ESTE_SKU = /);
  assert.match(ROBO, /const REBAIXAR = REFAZER \|\| Boolean\(SO_ESTE_SKU\)/,
    'sem isto, a bolsa com foto errada e ignorada por "ja ter foto"');
  const usos = ROBO.match(/REBAIXAR/g) || [];
  assert.equal(usos.length, 3,
    'sao DOIS filtros: escolher o lote e baixar a foto. Um so deixa o robo mudo');
  assert.match(ROBO, /alvos\.filter\(\(l\) => achatar\(l\.sku\) === achatar\(SO_ESTE_SKU\)\)/);
})
