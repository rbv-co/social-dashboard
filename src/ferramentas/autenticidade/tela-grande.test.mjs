/* A TELA GRANDE — as travas do desenho de computador.
 *
 * Até 01/09/2026 esta tela não tinha UMA regra `@media (min-width)`: tudo era
 * travado em 520–720px, e num monitor de 1440px a lista usava 720 de 1440 (50%)
 * e a bancada de gravação 620 de 1440 (43%). O dono viu: "no computador está
 * horrível, mal distribuído". É também o item 7 do PADRAO-DA-CENTRAL — "Tela é
 * full-bleed: nada de coluna estreita centralizada".
 *
 * O que este arquivo guarda são as três coisas que quebram EM SILÊNCIO:
 *   1. a ordem dos `@media` — regra-base escrita depois do bloco de celular o
 *      apaga sem erro nenhum, e só se vê no aparelho;
 *   2. o cabeçalho de tabela vazando para o celular — lá ele seria uma fileira
 *      de palavras soltas em cima de nada;
 *   3. cabeçalho e linha saírem com número DIFERENTE de colunas — as colunas
 *      deixam de se alinhar e ninguém recebe erro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8');
const template = fonte.slice(0, fonte.indexOf('<script setup>'));
const estilo = fonte.slice(fonte.indexOf('<style scoped>'));

const painel = readFileSync(new URL('./painel-de-busca.vue', import.meta.url), 'utf8');
const painelEstilo = painel.slice(painel.indexOf('<style scoped>'));

/* OS COMENTÁRIOS SAEM ANTES DE PROCURAR REGRA. Este arquivo de estilo explica
 * o que faz — os comentários citam `@media (min-width:900px)` e `max-width` por
 * escrito, e sem tirá-los o teste acharia regra onde só há explicação. Já
 * aconteceu na primeira rodada deste próprio teste. */
const semComentarios = (css) => css.replace(/\/\*[^]*?\*\//g, '');
const cssTela = semComentarios(estilo);
const cssPainel = semComentarios(painelEstilo);

/* ── 1. A ORDEM DOS `@media` ──────────────────────────────────────────────── */

test('a tela tem regra de tela grande — sem ela o conteúdo volta para a faixa da esquerda', () => {
  assert.ok(cssTela.includes('@media (min-width:900px){'),
    'sumiu o bloco da tela grande: a 1440px o conteúdo volta a usar metade da tela');
  assert.ok(cssPainel.includes('@media (min-width:900px){'),
    'sumiu o bloco da tela grande do painel de busca');
});

test('o bloco da tela grande vem DEPOIS das regras-base e ANTES do `@media` do celular', () => {
  for (const [onde, css] of [['a tela', cssTela], ['o painel de busca', cssPainel]]) {
    const grande = css.indexOf('@media (min-width:900px){');
    const celular = css.lastIndexOf('@media (max-width:520px){');
    assert.notEqual(grande, -1, `${onde}: sumiu o bloco da tela grande`);
    assert.notEqual(celular, -1, `${onde}: sumiu o ajuste de celular`);
    assert.ok(grande < celular,
      `${onde}: o bloco da tela grande foi escrito DEPOIS do \`@media\` do celular. `
      + 'Há teste que exige o de celular por último, e as duas consultas não se cruzam — '
      + 'a ordem certa é regras-base, tela grande, celular.');
  }
});

/* ── 2. O CABEÇALHO DE TABELA NÃO EXISTE NO CELULAR ───────────────────────── */

test('o cabeçalho de tabela nasce escondido e só a tela grande o acende', () => {
  assert.match(estilo, /\n\.au-tabela-cab\{display:none\}/,
    'a regra-base do cabeçalho tem de ser `display:none`: no celular a forma certa é o '
    + 'cartão, e um cabeçalho ali é uma fileira de palavras em cima de nada');
  const grande = cssTela.slice(cssTela.indexOf('@media (min-width:900px){'));
  assert.match(grande, /\.au-tabela \.au-tabela-cab\{[^}]*display:grid/);
  assert.match(grande, /\.au-tabela-pecas \.au-tabela-cab\{[^}]*display:grid/);
});

test('o cabeçalho sai da árvore de acessibilidade', () => {
  // ele não acrescenta informação: cada linha já diz "nº 3", "Gravada em 12/08"
  // por escrito. Ouvir os rótulos duas vezes é ruído, não ajuda.
  const cabecalhos = [...template.matchAll(/class="au-tabela-cab"([^>]*)>/g)].map((m) => m[1]);
  assert.ok(cabecalhos.length >= 6, `esperava um cabeçalho por tabela, achei ${cabecalhos.length}`);
  for (const atributos of cabecalhos) {
    assert.match(atributos, /aria-hidden="true"/, 'cabeçalho de tabela sem `aria-hidden`');
  }
});

/* ── 3. CABEÇALHO E LINHA COM O MESMO NÚMERO DE COLUNAS ───────────────────── */

test('cada tabela tem tantas colunas no CSS quantas palavras no cabeçalho', () => {
  // O erro que este teste pega: alguém acrescenta uma coluna no cabeçalho e
  // esquece do `grid-template-columns` (ou o contrário). As colunas deixam de
  // se alinhar de linha para linha, e não sai erro nenhum — só fica torto.
  const grande = cssTela.slice(cssTela.indexOf('@media (min-width:900px){'));
  const colunasNoCss = new Map();
  for (const m of grande.matchAll(/\.au-tabela-(\w+)[^{]*\{\s*grid-template-columns:([^;]+);/g)) {
    colunasNoCss.set(m[1], (m[2].match(/minmax\(/g) || []).length);
  }
  assert.ok(colunasNoCss.size >= 6, `esperava as seis tabelas no CSS, achei ${colunasNoCss.size}`);

  for (const [nome, quantas] of colunasNoCss) {
    const daClasse = template.indexOf(`au-tabela-${nome}`);
    assert.notEqual(daClasse, -1, `o CSS tem \`.au-tabela-${nome}\` e o template não usa a classe`);
    const doCab = template.indexOf('class="au-tabela-cab"', daClasse);
    assert.notEqual(doCab, -1, `a tabela \`${nome}\` não tem cabeçalho`);
    // o cabeçalho vai até o fecho do próprio elemento — `</div>` nas listas,
    // `</li>` na lista das peças
    const fim = Math.min(
      ...[template.indexOf('</div>', doCab), template.indexOf('</li>', doCab)].filter((i) => i > 0),
    );
    const rotulos = (template.slice(doCab, fim).match(/<span>/g) || []).length;
    assert.equal(rotulos, quantas,
      `a tabela \`${nome}\` tem ${quantas} coluna(s) no CSS e ${rotulos} rótulo(s) no cabeçalho — `
      + 'com números diferentes as colunas param de se alinhar, sem erro nenhum');
  }
});

/* ── 4. O PERÍODO EXATO FICA FECHADO EM TODA LARGURA ──────────────────────── */

/* ⚠️ ESTE TESTE MUDOU DE LADO EM 02/09/2026, e o motivo é uma decisão de
 * desenho, não um detalhe de implementação.
 *
 * O QUE ELE EXIGIA ANTES: que a gaveta do período exato NASCESSE ABERTA no
 * computador — por `matchMedia('(min-width: 900px)')` no script, casado com o
 * `@media` do estilo. O argumento era que numa tela larga esconder duas datas
 * atrás de um clique é só um clique a mais.
 *
 * POR QUE ACABOU: aberta de graça, ela era um dos QUATRO andares que deixavam a
 * busca com 235px de altura a 1440px — mais alta que o cartão de um lote, que
 * tem 202px. O dono olhou a tela e disse "o card de pesquisa está feio em todas
 * as abas que existem o mesmo", e pediu que o que é raro ficasse "fora do
 * caminho até ser pedido". Escrever duas datas à mão é o caso raro: quem quer
 * "esta semana" aperta o atalho.
 *
 * O QUE ESTE TESTE GUARDA AGORA: que a gaveta NÃO abre por largura de tela, e
 * que ela CONTINUA abrindo sozinha quando o recorte é de datas escritas à mão —
 * filtro ligado escondido é filtro que a pessoa não entende por que corta a
 * lista. Sem esta segunda metade, o conserto de um vira o defeito do outro. */
test('a gaveta do período não abre por largura de tela — só pelo recorte à mão', () => {
  // a CHAMADA, não a palavra: o comentário do painel conta por que ela saiu, e
  // procurar só por "matchMedia" acusaria a própria explicação
  assert.doesNotMatch(painel, /window\.matchMedia\(|\bmatchMedia\(/,
    'o painel voltou a ler a largura da tela para abrir a gaveta: o período exato é o caso '
    + 'RARO e fica fechado em qualquer largura');
  assert.match(painel, /:open="gavetaAberta"/,
    'a gaveta tem de continuar abrindo sozinha quando o recorte é de datas escritas à mão');
  const i = painel.indexOf('const gavetaAberta = computed(');
  assert.notEqual(i, -1, 'sumiu a conta que abre a gaveta sozinha');
  assert.match(painel.slice(i, painel.indexOf('\n', i)),
    /\(props\.filtro\.de \|\| props\.filtro\.ate\) && !props\.filtro\.atalho/,
    'a gaveta abre quando há data à mão e NENHUM atalho aceso');
});

test('a busca não tem mais caixa: nem fundo, nem moldura', () => {
  // A caixa era o que fazia a ferramenta de apoio pesar mais que o conteúdo que
  // ela filtra. O recuo de 24px continua, para os controles nascerem na mesma
  // linha vertical da lista.
  const raiz = cssPainel.match(/\.pb-barra\{([^}]*)\}/);
  assert.ok(raiz, 'sumiu a regra-base da barra de busca');
  assert.doesNotMatch(raiz[1], /background|border\s*:/,
    'a busca ganhou fundo ou moldura de novo — era exatamente isso que o dono chamou de feio');
  assert.match(raiz[1], /margin:var\(--sp-3\) 24px 0/,
    'o recuo tem de ser o mesmo 24px do resto da tela');
});

/* ── 5. O CELULAR NÃO PODE SER TOCADO POR ESTAS REGRAS ────────────────────── */

test('nenhuma regra da tela grande vale abaixo de 900px', () => {
  // O desenho de celular está medido e fica como está. Se alguém escrever aqui
  // um `max-width` ou um ponto de quebra menor, o celular muda junto.
  const grande = cssTela.slice(
    cssTela.indexOf('@media (min-width:900px){'),
    cssTela.lastIndexOf('@media (max-width:520px){'),
  );
  assert.doesNotMatch(grande, /@media[^{]*max-width/,
    'o bloco da tela grande ganhou um `max-width` dentro: isso alcança o celular');
  const painelGrande = cssPainel.slice(
    cssPainel.indexOf('@media (min-width:900px){'),
    cssPainel.lastIndexOf('@media (max-width:520px){'),
  );
  assert.doesNotMatch(painelGrande, /@media[^{]*max-width/,
    'o bloco da tela grande do painel ganhou um `max-width` dentro');
});

/* ── FILHO DIRETO DO CARD VIRA UMA CÉLULA ────────────────────────────────────
 * No computador `.au-tabela .au-card` é `display:grid`, e TODO filho direto cai
 * numa coluna. A caixa dos botões caía numa coluna de ~1fr, onde os dois botões
 * não cabiam lado a lado: o `flex-wrap:wrap` da regra-base os empilhava e a
 * linha inteira crescia. Medido em 05/09/2026 a 1440px: 195px empilhados contra
 * 143px lado a lado — 52px a mais em CADA linha da aba Garantias.
 *
 * Quem tem de ocupar a linha toda são os blocos que NÃO são célula: a conversa
 * de confirmação e a caixa de botões. */
test('caixa de botoes dentro de card-tabela ocupa a LINHA INTEIRA', () => {
  assert.match(estilo, /\.au-tabela \.au-card > \.au-acoes\{[^}]*grid-column:1 \/ -1/,
    'sem isto os botoes empilham numa coluna e esticam a altura da linha');
});

test('os DOIS blocos que nao sao celula ocupam a linha inteira', () => {
  // Se alguem adicionar um terceiro bloco de largura cheia e esquecer a regra,
  // o defeito volta calado. Aqui ficam os dois que existem hoje.
  for (const bloco of ['au-confirma', 'au-acoes']) {
    const re = new RegExp('\\.au-tabela \\.au-card > \\.' + bloco + '\\{[^}]*grid-column:1 \\/ -1');
    assert.match(estilo, re, `${bloco} tem de ocupar a linha inteira dentro da tabela`);
  }
});

test('a regra dos botoes vive no bloco de COMPUTADOR, e nao na regra-base', () => {
  /* A grade so existe a partir de 900px. A mesma regra na base tiraria o
   * `padding` da caixa de botoes no celular, onde nao ha grade nenhuma. */
  const abre = estilo.indexOf('@media (min-width:900px)');
  assert.ok(abre > -1, 'nao achei o bloco de computador');
  const daRegra = estilo.indexOf('.au-tabela .au-card > .au-acoes');
  assert.ok(daRegra > abre,
    'a regra dos botoes tem de estar DEPOIS da abertura do @media de computador');
});
