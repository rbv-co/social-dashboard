/* A GAVETA DO "PERÍODO EXATO" NÃO VAZA — as travas do conserto de 19/09/2026.
 *
 * O DEFEITO, MEDIDO no navegador (não deduzido):
 *
 *   · a 375px, com a gaveta FECHADA e o rótulo curto — "Período exato", sem
 *     data escrita à mão, que é o caso comum — a `.pb-mais` é `flex:0 1 auto` e
 *     fica do tamanho do PRÓPRIO RÓTULO: **115px**. O `.pb-linha` lá dentro
 *     herda essa caixa, e o conteúdo dele precisa de **189px**: estoura 74px;
 *   · a 320px e a 360px com o zoom de leitura do app em 2×, e a gaveta ABERTA,
 *     esse mesmo estouro é PINTADO: o bloco das datas vaza 42px (a 320px) e 2px
 *     (a 360px) para fora da barra de busca.
 *
 * A CAUSA, medida: `input type="date"` é controle nativo e tem uma largura
 * mínima que nenhum CSS reduz — 189px num navegador de celular (177px no
 * desktop), e ela cresce junto com a letra: 232px a 1,3×, 260px a 1,5×, 330px a
 * 2×. O `.pb-campo` já tem `min-width:0` e mesmo assim não encolhe abaixo
 * disso, porque quem manda é o mínimo do próprio controle. Ou seja: o
 * `.pb-linha` tem um PISO de largura, e a caixa em volta é que precisa saber
 * lidar com ele.
 *
 * POR QUE O CONSERTO É ROLAGEM SÓ DAQUELE BLOCO, e não espremer o campo:
 * espremer um `input type="date"` corta a data escrita dentro dele, e texto que
 * corta é defeito (PADRÃO item 5) — o próprio CSS deste painel já dizia isso
 * por escrito. Como o piso de 189px não se reduz, sobra fazer o bloco rolar em
 * si mesmo: `overflow-x:auto` só age QUANDO não cabe, então em largura
 * confortável nada muda, e quando não cabe o bloco ganha rolagem própria em vez
 * de vazar por cima do resto da tela. É a mesma saída que o PADRÃO item 6 já
 * admite para régua de controles ("se for uma régua de botões, `overflow-x:auto`")
 * e a que a barra de abas desta mesma tela usa. Nada é escondido: a data
 * continua inteira e legível.
 *
 * ⚠️ Teste que lê TEXTO de CSS não prova layout — prova que a regra não sumiu.
 * Quem provou o conserto foi a medida no navegador, a 320/360/375px, com a
 * gaveta aberta e fechada e o zoom de leitura em 1×, 1,5× e 2×.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./painel-de-busca.vue', import.meta.url), 'utf8');
/* ⚠️ `lastIndexOf`, e não `indexOf`: a palavra `<style scoped>` aparece DUAS
 * vezes neste arquivo — a de cima está dentro de um comentário do `<script
 * setup>`, explicando que o estilo é `scoped`. Recortando pela primeira, o
 * teste lê o script inteiro como se fosse CSS: na primeira rodada deste próprio
 * arquivo isso acusou um comentário quebrado que não existe. */
const estilo = fonte.slice(fonte.lastIndexOf('<style scoped>'));
/* Os comentários saem antes de procurar regra: este arquivo explica o que faz e
 * cita `@media` e medidas por escrito. Sem tirá-los, o teste acharia regra onde
 * só há explicação — já aconteceu na tela grande desta mesma ferramenta. */
const css = estilo.replace(/\/\*[^]*?\*\//g, '');

const CELULAR = '@media (max-width:520px){';

function regra(pedaco, seletor) {
  const m = pedaco.match(
    new RegExp(`(^|[};{])\\s*${seletor.replace(/[.[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(m, `sumiu a regra \`${seletor}\``);
  return m[2];
}

/* ── 1. O BLOCO ROLA EM SI MESMO ──────────────────────────────────────────── */

test('o bloco das datas rola em si mesmo em vez de vazar', () => {
  // Medido antes: 42px vazando para fora da barra a 320px com a letra em 2×.
  const linha = regra(css, '.pb-linha');
  assert.match(linha, /overflow-x:\s*auto/,
    'o `.pb-linha` perdeu a rolagem própria: o campo de data tem piso de 189px (330px com a '
    + 'letra em 2×) e, sem ela, o bloco volta a vazar para fora da barra de busca');
});

test('a rolagem é da regra-BASE, e não de um `@media`', () => {
  // O vazamento não é exclusivo do celular: ele depende da razão entre a
  // largura da caixa e o tamanho da letra, e o zoom de leitura mexe nos dois.
  // Preso a um `@media` de celular, o conserto some justamente para quem
  // aumentou a letra numa tela média.
  const base = css.slice(0, css.indexOf('@media'));
  assert.match(base, /\.pb-linha\{[^}]*overflow-x:\s*auto/,
    'a rolagem do bloco das datas saiu da regra-base: ela precisa valer em toda largura, '
    + 'porque o piso do campo de data cresce com o zoom de leitura');
});

/* ── 2. NADA DE CORTAR A DATA PARA CABER ──────────────────────────────────── */

test('⚠️ nenhuma peça da gaveta esconde texto para caber', () => {
  // A linha que separa o conserto do estrago. Espremer o `input type="date"`
  // corta a data escrita dentro dele, e o PADRÃO item 5 proíbe. Se alguém
  // "melhorar" o conserto assim, o defeito volta disfarçado de tela arrumada.
  for (const seletor of ['.pb-linha', '.pb-linha .pb-campo']) {
    const corpo = regra(css, seletor);
    assert.doesNotMatch(corpo, /text-overflow\s*:\s*ellipsis/,
      `\`${seletor}\` ganhou reticências: a data ficaria cortada dentro do próprio campo`);
    assert.doesNotMatch(corpo, /overflow\s*:\s*hidden|overflow-x\s*:\s*hidden/,
      `\`${seletor}\` ganhou \`overflow:hidden\`: isso não faz caber, faz sumir`);
  }
});

test('⚠️ a gaveta pode encolher até a caixa do pai (`min-width:0`)', () => {
  /* ESTA É A PEÇA QUE FAZ A ROLAGEM DE CIMA EXISTIR, e ela quebra em silêncio:
   * a primeira versão deste conserto tinha o `overflow-x:auto` e NÃO tinha o
   * `min-width:0`, o teste passou verde e a tela saiu IDÊNTICA à de antes —
   * fotografada e comparada, pixel por pixel.
   *
   * O motivo: item de flex tem largura mínima automática igual ao mínimo de
   * conteúdo, e o conteúdo aqui são dois `input type="date"`, que têm piso
   * próprio. Sem `min-width:0` a gaveta não encolhe até o pai: ela cresce até o
   * piso do conteúdo e empurra tudo para fora da barra — e aí não sobra nada
   * para o `overflow-x` rolar. */
  assert.match(css, /\.pb-mais\{[^}]*min-width:\s*0/,
    'a gaveta perdeu o `min-width:0`: ela volta a crescer até o piso do campo de data '
    + '(330px com a letra em 2×) e a empurrar o conteúdo para fora da barra de busca, '
    + 'e a rolagem do bloco deixa de ter o que rolar');
  assert.match(css, /\.pb-mais\[open\]\{[^}]*min-width:\s*0/,
    'a gaveta ABERTA perdeu o `min-width:0` — é justamente aberta que o conteúdo é pintado');
});

test('a gaveta aberta continua tomando a linha inteira', () => {
  // É o que dá 343px de caixa a 375px. Sem isto a gaveta aberta volta ao
  // tamanho do rótulo — os 115px medidos — e o conteúdo estoura 74px.
  assert.match(css, /\.pb-mais\[open\]\{[^}]*flex:1 1 100%/,
    'a gaveta aberta deixou de ocupar a linha inteira: ela volta ao tamanho do rótulo '
    + '(115px medidos a 375px) e as duas datas, que precisam de 189px, não cabem');
});

/* ── 3. AS DUAS ARMADILHAS DE CSS DESTA CASA ──────────────────────────────── */

test('o `@media` do celular continua sendo o ÚLTIMO bloco do arquivo', () => {
  // Duas regras de mesma especificidade: ganha a última. O próprio arquivo
  // avisa disto por escrito, e esta casa já perdeu um `@media` inteiro assim.
  const celular = css.lastIndexOf(CELULAR);
  assert.notEqual(celular, -1, 'sumiu o `@media (max-width:520px)` do painel de busca');
  const grande = css.lastIndexOf('@media (min-width:1240px){');
  assert.notEqual(grande, -1, 'sumiu o bloco de 1240px do painel de busca');
  assert.ok(grande < celular,
    'o bloco de celular deixou de ser o último: a regra escrita depois dele o apaga');
  const depois = css.slice(celular + CELULAR.length);
  const solto = depois.slice(depois.lastIndexOf('}') + 1).trim().replace(/<\/style>/, '').trim();
  assert.equal(solto, '',
    `alguém escreveu CSS depois do \`@media\` do celular: ${solto.slice(0, 80)}`);
});

test('o CSS do painel não tem comentário quebrado', () => {
  /* Um fecho de comentário sem abertura já matou um `@media` inteiro nesta
   * casa, em silêncio: deploy verde e tela quebrada só no aparelho. */
  const abre = (estilo.match(/\/\*/g) || []).length;
  const fecha = (estilo.match(/\*\//g) || []).length;
  assert.equal(abre, fecha,
    `comentário de CSS desbalanceado no painel de busca: ${abre} aberturas e ${fecha} fechos`);
});
