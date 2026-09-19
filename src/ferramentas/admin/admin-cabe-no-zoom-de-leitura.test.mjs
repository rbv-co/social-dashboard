/* A CONFIGURAÇÃO DE ADMIN CABE NA TELA COM O ZOOM DE LEITURA 2× —
 * as travas do conserto de 19/09/2026.
 *
 * O DEFEITO, MEDIDO no navegador a 375px com o zoom de leitura do app em 2×: o
 * `.admin-content` ficava com **590,8px dentro de uma tela de 375** — passava
 * 215,8px da borda. E `html,body` têm `overflow-x:clip` (estilos-globais.css):
 * **a página não rola para o lado.** O que passa da borda não fica escondido
 * atrás de uma barra de rolagem — ele deixa de existir para quem está no
 * aparelho. Ficavam fora da tela o campo "Email", o seletor "Perfil de acesso"
 * e o botão "Criar com senha": não dava para convidar ninguém pelo celular,
 * que é para isso que esta tela serve. Por isso o conserto veio em commit
 * próprio, e não na lista da varredura.
 *
 * A CAUSA: item de grade nasce com `min-width:auto`, e isso o proíbe de
 * encolher abaixo da largura MÍNIMA do conteúdo. Com a letra em dobro essa
 * mínima passou dos 375px e a coluna `1fr` inchou junto.
 *
 * MEDIDO DEPOIS, nas 5 seções (Usuários, Contas, Solicitações, Metas, Dados) ×
 * 3 larguras (320/360/375) × 2 zooms = 30 combinações: **nada passa da borda**,
 * em nenhuma. A 1440px a tela não mudou em nada.
 *
 * ⚠️ TESTE QUE LÊ TEXTO DE CSS NÃO PROVA LAYOUT. Ele prova que a regra não
 * sumiu. Quem prova que cabe é a medida no navegador, que está no relatório.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./tela-de-admin.vue', import.meta.url), 'utf8');
const estilo = fonte.slice(fonte.indexOf('<style scoped>'));
/* Os comentários saem antes de procurar regra: este CSS explica o que faz e
 * cita propriedades por escrito. Sem tirá-los, o teste acharia regra onde só há
 * explicação — já aconteceu na tela grande da Autenticidade. */
const css = estilo.replace(/\/\*[^]*?\*\//g, '');

const CELULAR = '@media(max-width:768px){';

function blocoDoCelular() {
  const i = css.lastIndexOf(CELULAR);
  assert.notEqual(i, -1, 'sumiu o `@media(max-width:768px)` da Configuração de Admin');
  // até o fecho do @media: conta as chaves
  let nivel = 0; let fim = i + CELULAR.length;
  for (let k = i + CELULAR.length; k < css.length; k++) {
    if (css[k] === '{') nivel++;
    else if (css[k] === '}') { if (nivel === 0) { fim = k; break; } nivel--; }
  }
  return css.slice(i, fim);
}

test('a coluna do conteúdo PODE ENCOLHER no celular', () => {
  // `1fr` sozinho não deixa: item de grade nasce com `min-width:auto` e trava na
  // largura mínima do conteúdo. Com a letra em dobro isso passou dos 375px.
  const celular = blocoDoCelular();
  const m = celular.match(/:deep\(\.admin-layout\)\s*\{([^}]*)\}/);
  assert.ok(m, 'sumiu a regra do `.admin-layout` no celular');
  assert.match(m[1], /grid-template-columns\s*:\s*minmax\(\s*0\s*,\s*1fr\s*\)/,
    'o `.admin-layout` do celular voltou para `1fr`: a coluna deixa de encolher e a tela '
    + 'de Admin volta a vazar para fora da borda no zoom de leitura 2×');
  assert.match(celular, /:deep\(\.admin-content\)\s*\{[^}]*min-width\s*:\s*0/,
    'o `.admin-content` perdeu o `min-width:0` — sem ele a coluna continua travada '
    + 'na largura mínima do conteúdo');
});

test('a fileira de botões do convite QUEBRA no celular', () => {
  // Os dois botões somam 507px no zoom 2×. Sem quebrar, "Criar com senha" fica
  // fora da tela — e a página não rola para o lado.
  const celular = blocoDoCelular();
  assert.match(celular, /:deep\(\.adm-convite-rodape\)\s*\{[^}]*flex-wrap\s*:\s*wrap/,
    'a fileira do convite perdeu o `flex-wrap:wrap`');
  const m = celular.match(/:deep\(\.adm-convite-botoes\)\s*\{([^}]*)\}/);
  assert.ok(m, 'sumiu a regra dos botões do convite no celular');
  assert.match(m[1], /flex-wrap\s*:\s*wrap/, 'os botões do convite não quebram mais em duas linhas');
  assert.match(m[1], /flex-shrink\s*:\s*1/,
    'os botões do convite voltaram a não ceder — com `flex-shrink:0` a fileira mede '
    + '507px e não quebra, por mais `flex-wrap` que tenha');
});

test('⚠️ o `flex-shrink:0` dos botões NÃO volta para o `style=` do template', () => {
  // Estilo inline ganha da folha. Enquanto ele estiver no `style=`, a regra do
  // celular não consegue fazer a fileira ceder — e o conserto some em silêncio,
  // sem mudar uma vírgula do CSS.
  const template = fonte.slice(0, fonte.indexOf('<style scoped>'));
  const linha = template.match(/class="adm-convite-botoes"[^>]*/);
  assert.ok(linha, 'sumiu a classe `adm-convite-botoes` da fileira de botões do convite');
  assert.doesNotMatch(linha[0], /flex-shrink/,
    'o `flex-shrink` voltou para o `style=` inline dos botões do convite: estilo inline '
    + 'ganha da folha, e o `@media` de celular deixa de conseguir quebrar a fileira');
});

test('o CSS da Configuração de Admin não tem comentário quebrado', () => {
  /* Um `*/ /* sem abertura já matou um `@media` inteiro nesta casa, em silêncio:
   * deploy verde, tela quebrada só no aparelho. */
  const abre = (estilo.match(/\/\*/g) || []).length;
  const fecha = (estilo.match(/\*\//g) || []).length;
  assert.equal(abre, fecha,
    `comentário de CSS desbalanceado na Configuração de Admin: ${abre} aberturas e ${fecha} fechos`);
});
