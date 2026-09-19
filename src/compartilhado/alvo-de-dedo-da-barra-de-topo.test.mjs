/* O ALVO DE DEDO DO "VOLTAR" — as travas do conserto de 19/09/2026.
 *
 * O DEFEITO, MEDIDO: o `.bt-voltar` tinha **26px de altura** a 375px, nas seis
 * telas conferidas (Patrimônio, Autenticidade, Gestão à Vista, Frota, Acessos e
 * Gestão de Tráfego) e nas duas larguras. O PADRÃO-DA-CENTRAL item 6 exige
 * **40px de alvo de toque**, e não é estética: dedo não acerta menos que isso,
 * e este é o botão que sai de toda tela da Central — ele está em 35 arquivos.
 *
 * ⚠️ O QUE ESTE ARQUIVO GUARDA SÃO AS QUATRO COISAS QUE QUEBRAM EM SILÊNCIO.
 *
 * 1. O ALVO CRESCE, O DESENHO NÃO. O pedido foi explícito: área clicável maior,
 *    mesmo peso visual. Quem "consertar" isto com `min-height:40px` no botão
 *    engorda o desenho, empurra o título e cresce a barra de TODAS as telas —
 *    que é exatamente o estrago que a primeira versão desta barra causou e que
 *    o dono mandou reverter. A receita certa está no PADRÃO item 6, na seção
 *    "40px de alvo sem engordar o botão": um `::after` absoluto de 40px.
 *
 * 2. O `::after` PRECISA RECEBER O TOQUE. `pointer-events:none` nele anula o
 *    conserto inteiro sem mudar nada na aparência: a medida de altura continua
 *    passando e o dedo continua sem acertar. O PADRÃO avisa disto por escrito.
 *
 * 3. SEM `position:relative` NO BOTÃO o `::after` absoluto se ancora no
 *    ancestral posicionado mais próximo — a `.bt-barra`, que é `sticky` — e a
 *    faixa de 40px nasce em cima da barra inteira, cobrindo o logo e o título.
 *
 * 4. O `@media` DO CELULAR TEM DE CONTINUAR SENDO O ÚLTIMO BLOCO DO ARQUIVO.
 *    Duas regras de mesma especificidade: ganha a última. Uma regra-base
 *    escrita depois daqui apaga o ajuste de celular sem erro nenhum, e só se vê
 *    no aparelho. Esta casa já perdeu um `@media` inteiro assim.
 *
 * ⚠️ E A RESSALVA QUE VALE PARA O ARQUIVO TODO: teste que lê TEXTO de CSS não
 * prova layout. Ele prova que a regra não sumiu. Quem prova que o dedo acerta é
 * a medida no navegador — `elementFromPoint` varrido pixel a pixel a partir do
 * centro do botão, a 375px e a 1440px, que é como o conserto foi conferido.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./barra-de-topo.vue', import.meta.url), 'utf8');
const estilo = fonte.slice(fonte.indexOf('<style scoped>'));
/* OS COMENTÁRIOS SAEM ANTES DE PROCURAR REGRA: este arquivo de estilo explica o
 * que faz, e cita `@media` e medidas por escrito. Sem tirá-los, o teste acharia
 * regra onde só há explicação — já aconteceu na tela grande da Autenticidade. */
const css = estilo.replace(/\/\*[^]*?\*\//g, '');

const CELULAR = '@media(max-width:640px){';

/** O corpo de uma regra, pelo seletor exato, dentro de um pedaço de CSS. */
function regra(pedaco, seletor) {
  const m = pedaco.match(
    new RegExp(`(^|[};{])\\s*${seletor.replace(/[.[\]()::]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(m, `sumiu a regra \`${seletor}\``);
  return m[2];
}

/** O bloco do celular, que é o último do arquivo. */
function blocoDoCelular() {
  const i = css.lastIndexOf(CELULAR);
  assert.notEqual(i, -1, 'sumiu o `@media(max-width:640px)` da barra de topo');
  return css.slice(i);
}

/* ── 1. O ALVO DE 40px EXISTE, E É ÁREA, NÃO DESENHO ──────────────────────── */

test('o "Voltar" tem 40px de ALVO no celular', () => {
  // Medido antes do conserto: 26px de altura nas seis telas, nas duas larguras.
  // O PADRÃO item 6 exige 40.
  const celular = blocoDoCelular();
  const depois = regra(celular, '.bt-voltar::after');
  assert.match(depois, /height:40px/,
    'o alvo de dedo do "Voltar" não tem mais 40px — ele voltou aos 26px do desenho, '
    + 'e este botão está em TODA tela da Central');
  assert.match(depois, /position:absolute/,
    'o alvo tem de ser uma faixa ABSOLUTA por cima do botão: é assim que ele cresce '
    + 'sem empurrar o título nem engordar a barra');
  assert.match(depois, /content:\s*''/, 'pseudo-elemento sem `content` não existe');
});

test('⚠️ o alvo NÃO engorda o desenho do botão', () => {
  // A linha que separa o conserto do estrago. O pedido foi "área clicável maior,
  // mesmo peso visual": `min-height` no próprio botão cresceria a barra das 35
  // telas que usam esta peça.
  const base = regra(css, '.bt-voltar');
  const celular = blocoDoCelular();
  assert.doesNotMatch(base, /(^|;)\s*(min-)?height:/,
    'o `.bt-voltar` ganhou altura própria: isso engorda o desenho e empurra o título');
  const noCelular = celular.match(/(^|[};{])\s*\.bt-voltar\s*\{([^}]*)\}/);
  if (noCelular) {
    assert.doesNotMatch(noCelular[2], /(^|;)\s*(min-)?height:/,
      'o `.bt-voltar` ganhou altura no celular: o alvo é o `::after`, não o botão');
  }
  assert.doesNotMatch(celular, /\.bt-barra\{[^}]*(min-)?height:/,
    'a barra ganhou altura fixa — ela é medida em seis telas e não pode mudar');
});

/* ── 2. O PSEUDO PRECISA RECEBER O TOQUE ──────────────────────────────────── */

test('⚠️ o alvo não é anulado por `pointer-events:none`', () => {
  // O defeito mais silencioso possível: a altura continua 40px, a aparência
  // continua igual, e o dedo continua sem acertar. O PADRÃO avisa por escrito.
  const depois = regra(blocoDoCelular(), '.bt-voltar::after');
  assert.doesNotMatch(depois, /pointer-events\s*:\s*none/,
    'o alvo do "Voltar" ganhou `pointer-events:none` — ele PRECISA receber o toque, '
    + 'é para isso que existe. Com isto o conserto some sem mudar nenhuma medida');
});

/* ── 3. A ÂNCORA DO PSEUDO ────────────────────────────────────────────────── */

test('⚠️ o botão é a âncora do próprio alvo', () => {
  // Sem `position:relative` no botão, o `::after` absoluto se pendura na
  // `.bt-barra` (que é `sticky`, logo posicionada) e a faixa de 40px nasce em
  // cima da barra inteira — cobrindo logo e título, que ficam inalcançáveis.
  const celular = blocoDoCelular();
  const noCelular = celular.match(/(^|[};{])\s*\.bt-voltar\s*\{([^}]*)\}/);
  const base = regra(css, '.bt-voltar');
  const temRelativo = /position\s*:\s*relative/.test(base)
    || (noCelular && /position\s*:\s*relative/.test(noCelular[2]));
  assert.ok(temRelativo,
    'o `.bt-voltar` precisa de `position:relative`, senão o alvo de 40px se ancora na '
    + 'barra `sticky` e cobre o logo e o título');
});

/* ── 4. A ORDEM DOS BLOCOS ────────────────────────────────────────────────── */

test('o `@media` do celular é o ÚLTIMO bloco do arquivo', () => {
  // Duas regras de mesma especificidade: ganha a última. Uma regra-base escrita
  // depois daqui apaga o ajuste de celular em silêncio.
  const celular = css.lastIndexOf(CELULAR);
  const grande = css.lastIndexOf('@media(min-width:768px){');
  assert.notEqual(grande, -1, 'sumiu o bloco da tela grande da barra de topo');
  assert.ok(grande < celular,
    'o bloco de celular deixou de ser o último: a regra escrita depois dele o apaga');
  const depoisDoCelular = css.slice(celular + CELULAR.length);
  const fechaMedia = depoisDoCelular.lastIndexOf('}');
  const soltoDepois = depoisDoCelular.slice(fechaMedia + 1).trim().replace(/<\/style>/, '').trim();
  assert.equal(soltoDepois, '',
    `alguém escreveu CSS depois do \`@media\` do celular: ${soltoDepois.slice(0, 80)}`);
});

test('o CSS da barra não tem comentário quebrado', () => {
  /* Um `*/ /* sem abertura já matou um `@media` inteiro nesta casa, em silêncio:
   * deploy verde, tela quebrada só no aparelho. Aberturas e fechos têm de bater. */
  const abre = (estilo.match(/\/\*/g) || []).length;
  const fecha = (estilo.match(/\*\//g) || []).length;
  assert.equal(abre, fecha,
    `comentário de CSS desbalanceado na barra de topo: ${abre} aberturas e ${fecha} fechos — `
    + 'um fecho sem abertura engole a regra seguinte sem erro nenhum');
});
