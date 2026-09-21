/* A RÉGUA DE PERÍODO PARA EM BOTÃO INTEIRO — a trava do conserto de 19/09/2026.
 *
 * O QUE FOI RELATADO: "a 375px, dois botões `gv-pbtn` não respondem ao toque no
 * próprio centro; quem recebe é a barra de topo, por cima".
 *
 * O QUE A MEDIDA MOSTROU (Chrome de verdade, sessão e rede fingidas, 375px):
 * **ninguém está por cima.** Varrida ponto a ponto, de 3 em 3px, a área VISÍVEL
 * de cada um dos 11 clicáveis da barra responde por ele mesmo — 0% de pontos
 * tapados. O que acontece é outra coisa:
 *
 *   · a régua `.gv-period-btns` rola na horizontal: 868px de botões dentro de
 *     uma janela de 323px;
 *   · cada botão tem `min-width:12ch` = 89,16px, e nenhuma posição de rolagem
 *     deixa um número inteiro deles na janela;
 *   · então sempre sobra um TOQUINHO de botão na borda. MEDIDO: 29,5px em
 *     repouso, 16,5px na posição do meio, **7,8px** no pior caso;
 *   · o CENTRO geométrico desse botão cai FORA do recorte da régua. O
 *     `elementFromPoint` no centro responde `.bt-barra` — que é o ANCESTRAL,
 *     não alguém por cima. Daí a leitura de "a barra roubou o toque".
 *
 * ⚠️ A FAIXA DE 40px DO "VOLTAR" (commit 0832184) NÃO TEM PARTE NISTO. Medido
 * dos dois jeitos, no mesmo carregamento, a 375px/1× e a 320px/2×: com a faixa
 * e com ela desligada, a lista de alvos sem centro é IDÊNTICA. A faixa vai de
 * y=5,1 a y=45,1 e a régua começa em y=58,3 — elas nem se encostam.
 *
 * O CONSERTO: `scroll-snap`, para a régua descansar em botão inteiro. MEDIDO
 * depois: o menor pedaço à vista sobe de 7,8px para 43,5px em toda a régua, e
 * some o toco anônimo da esquerda. O desenho do botão não mudou.
 *
 * ⚠️ RESSALVA QUE VALE PARA O ARQUIVO TODO: teste que lê TEXTO de CSS não prova
 * layout. Ele prova que a regra não sumiu. Quem prova que o dedo acerta é a
 * medida no navegador, que está no relatório desta entrega.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./tela-de-gestao-a-vista.vue', import.meta.url), 'utf8');
/* OS COMENTÁRIOS SAEM ANTES DE PROCURAR REGRA: este arquivo de estilo explica o
 * que faz e cita medidas e propriedades por escrito. Sem tirá-los, o teste
 * acharia regra onde só há explicação. */
const css = fonte.slice(fonte.indexOf('<style scoped>')).replace(/\/\*[^]*?\*\//g, '');

const CELULAR = '@media(max-width:480px){';

/** O bloco de celular onde a régua vira um rolo horizontal. */
function blocoDoCelular() {
  const i = css.lastIndexOf(CELULAR);
  assert.notEqual(i, -1, 'sumiu o `@media(max-width:480px)` da Gestão à Vista');
  return css.slice(i);
}

/** O corpo da regra da régua dentro de um pedaço de CSS. */
function regraDaRegua(pedaco) {
  const m = pedaco.match(/:deep\(\.gv-period-btns\)\s*\{([^}]*)\}/);
  assert.ok(m, 'sumiu a regra da régua de período no celular');
  return m[1];
}

test('a régua de período PARA EM BOTÃO INTEIRO no celular', () => {
  // Sem isto ela para em qualquer lugar e sobra um toco de 7,8px na borda —
  // que não dá para ler nem para acertar com o dedo.
  const regra = regraDaRegua(blocoDoCelular());
  assert.match(regra, /scroll-snap-type\s*:\s*x\s+mandatory/,
    'a régua de período perdeu o `scroll-snap-type:x mandatory` — ela volta a parar '
    + 'no meio de um botão, e sobra um toquinho ilegível na borda');
  assert.match(blocoDoCelular(), /:deep\(\.gv-period-btns\)\s*>\s*\*\s*\{[^}]*scroll-snap-align\s*:\s*start/,
    'os botões da régua perderam o `scroll-snap-align:start` — sem ponto de encaixe '
    + 'o `scroll-snap-type` do pai não faz nada');
});

test('⚠️ a régua NÃO ganha `scroll-padding-left`', () => {
  // Parece asseio, porque a régua tem 14px de margem interna — e é o contrário.
  // Com ele o encaixe alinha o botão à MARGEM em vez da BORDA, e passa a sobrar
  // o RABO do botão anterior do lado esquerdo. MEDIDO: o menor pedaço à vista
  // cai para 10,5px, pior do que sem conserto nenhum.
  const regra = regraDaRegua(blocoDoCelular());
  assert.doesNotMatch(regra, /scroll-padding(-left|-inline-start)?\s*:/,
    'a régua ganhou `scroll-padding`: o encaixe passa a deixar o rabo do botão '
    + 'anterior à mostra, e o toco fica MENOR do que antes do conserto (10,5px medidos)');
});

test('o rolo horizontal da régua continua existindo', () => {
  // O encaixe só faz sentido sobre um rolo. Se alguém trocar por `flex-wrap`,
  // o `scroll-snap` vira enfeite e o teste acima passaria mentindo.
  const regra = regraDaRegua(blocoDoCelular());
  assert.match(regra, /overflow-x\s*:\s*auto/, 'a régua deixou de rolar na horizontal');
  assert.match(regra, /flex-wrap\s*:\s*nowrap/, 'a régua passou a quebrar linha: o encaixe não vale mais');
});

test('o CSS da Gestão à Vista não tem comentário quebrado', () => {
  /* Um `*/ /* sem abertura já matou um `@media` inteiro nesta casa, em silêncio:
   * deploy verde, tela quebrada só no aparelho. Aberturas e fechos têm de bater. */
  const estilo = fonte.slice(fonte.indexOf('<style scoped>'));
  const abre = (estilo.match(/\/\*/g) || []).length;
  const fecha = (estilo.match(/\*\//g) || []).length;
  assert.equal(abre, fecha,
    `comentário de CSS desbalanceado na Gestão à Vista: ${abre} aberturas e ${fecha} fechos — `
    + 'um fecho sem abertura engole a regra seguinte sem erro nenhum');
});
