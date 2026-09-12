/* A BARRA DE ABAS EM UMA LINHA — as travas do conserto de 02/09/2026.
 *
 * O PEDIDO DO DONO, com estas palavras: "quero o menu de abas em uma linha no
 * celular, não em duas". `.abas` é classe GLOBAL, e o conserto vale para as
 * QUATRO telas que a usam — Frota, Patrimônio, Acessos e Autenticidade.
 * Medido a 375px, nas quatro, antes de mexer: 83px de altura e duas fileiras.
 * Depois: 42px e uma fileira, nas quatro. No computador nada mudou (42px,
 * primeira aba em x=24, barra sem rolagem).
 *
 * ⚠️ O QUE ESTE ARQUIVO GUARDA É UMA ARMADILHA QUE JÁ PEGOU ESTE PROJETO.
 * Uma entrega anterior tentou o conserto do jeito óbvio — só trocar `wrap` por
 * `nowrap` — e o resultado medido foi pior que o defeito: com `justify-content:
 * center` e o conteúdo mais largo que a caixa, a faixa transborda pelos DOIS
 * lados, e a PRIMEIRA aba nasceu em −67px. O que sai pela esquerda é
 * inalcançável, porque rolagem só alcança o que sai pela direita: duas abas
 * ficaram sem como serem apertadas. Aquilo virou três remendos em cima de um
 * defeito inventado, e foi desfeito.
 *
 * Por isso o teste de `flex-start` abaixo não é asseio: é a linha que separa o
 * conserto do estrago, e ela quebra EM SILÊNCIO — a barra continua bonita numa
 * tela larga, e só some pela esquerda no aparelho de quem estiver usando.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../estilos/estilos-globais.css', import.meta.url), 'utf8');
const semComentarios = css.replace(/\/\*[^]*?\*\//g, '');

/** O corpo de uma regra, pelo seletor exato. */
function regra(seletor) {
  const m = semComentarios.match(
    new RegExp(`(^|[};])\\s*${seletor.replace(/[.[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(m, `sumiu a regra \`${seletor}\``);
  return m[2];
}

test('a faixa não quebra mais em duas linhas', () => {
  const barra = regra('.abas');
  assert.match(barra, /flex-wrap:nowrap/,
    'a barra voltou a quebrar em duas fileiras no celular — 83px de altura em quatro telas');
});

test('⚠️ a faixa encosta à ESQUERDA, e nunca centrada', () => {
  // A linha que separa o conserto do estrago. Centrada e mais larga que a
  // caixa, ela transborda pelos dois lados e o começo fica INALCANÇÁVEL:
  // medido, a primeira aba nasceu em −67px. Encostada, ela nasce em x ≥ 0.
  const barra = regra('.abas');
  assert.match(barra, /justify-content:flex-start/,
    'a barra voltou a ser centrada. Com `nowrap`, centrada = a primeira aba fora da tela e '
    + 'sem como voltar, porque rolagem só alcança o que sai pela direita');
  // e nenhum `@media` pode reintroduzir o `center` numa largura qualquer
  assert.doesNotMatch(semComentarios, /\.abas\{[^}]*justify-content:center/,
    'alguma regra de `.abas` voltou a centrar a faixa');
});

test('a rolagem é da BARRA, nunca da página', () => {
  // PADRÃO item 6: rolagem horizontal na página é ZERO. Medido depois do
  // conserto, nas quatro telas a 375px: rolagem da página 0, rolagem da barra
  // 31px (Frota), 47px (Patrimônio), 65px (Autenticidade) e 136px (Acessos).
  const barra = regra('.abas');
  assert.match(barra, /overflow-x:auto/, 'sem isto o transbordo vira rolagem da PÁGINA');
  assert.match(barra, /overscroll-behavior-x:contain/,
    'sem isto, arrastar até o fim da barra vira gesto de "voltar" do navegador');
});

test('a barra de rolagem não aparece por cima do rótulo', () => {
  // a barra tem 42px de altura: não há onde pôr uma barra de rolagem desenhada.
  // O que se esconde é o DESENHO dela — o gesto do dedo continua igual.
  const barra = regra('.abas');
  assert.match(barra, /scrollbar-width:none/);
  assert.match(semComentarios, /\.abas::-webkit-scrollbar\{display:none;?\}/,
    'sem a regra do WebKit, a barra de rolagem aparece por cima das abas no Safari e no Chrome');
});

test('a aba não encolhe nem tem o rótulo partido', () => {
  // "CONFIGU / RAÇÕES / S" foi uma queixa real do dono, de quando as abas
  // tinham largura mínima igual. Com `nowrap` na faixa, quem espreme agora
  // seria o `flex-shrink` do botão.
  const botao = regra('.abas button');
  assert.match(botao, /flex:0 0 auto/,
    'o botão voltou a poder encolher: com a faixa em `nowrap`, encolher é partir a palavra');
  assert.match(botao, /white-space:nowrap/);
});

test('o alvo de toque de 40px continua de pé', () => {
  // CORREÇÃO DE PADRÃO de 19/08/2026, e ela vale para as quatro telas. Medido
  // depois deste conserto: menor alvo = 40px nas quatro, a 375px e a 1440px.
  assert.match(regra('.abas button'), /min-height:40px/);
  const miudo = semComentarios.match(/@media\(max-width:400px\)\{[^]*?\n\}/);
  assert.ok(miudo, 'sumiu o ajuste da tela miúda');
  assert.match(miudo[0], /\.abas button\{[^}]*min-height:40px/,
    'o ajuste de tela miúda encolhe a fonte e o padding: sem repetir os 40px, o alvo some');
});

test('a aba ATIVA é trazida para a vista, e não fica escondida atrás da rolagem', () => {
  // Se a tela mostra "Relatórios" e a barra mostra as três primeiras, a pessoa
  // não sabe onde está. O toque num botão dá foco, e o navegador rola o que
  // ganha foco — mas isso é comportamento de navegador, não promessa: no
  // Safari do iPhone o toque nem sempre dá foco, e aba escolhida por código não
  // dá foco nenhum. Por isso a garantia é de um observador, que olha o
  // RESULTADO (qual botão tem a classe `on`) e não como ele chegou lá.
  const motor = readFileSync(new URL('./aba-ativa-a-vista.js', import.meta.url), 'utf8');
  assert.match(motor, /attributeFilter: \['class'\]/,
    'sem o filtro, qualquer mudança de estilo da tela dispara o observador à toa');
  assert.match(motor, /scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/,
    '`nearest` nos dois eixos: sem ele o padrão rolaria a PÁGINA para pôr a barra no alto '
    + 'a cada troca de aba');
  assert.match(motor, /button\.on/, 'o observador tem de seguir a classe que marca a ativa');

  // e ele está LIGADO: escrever o módulo não liga nada (é a mesma armadilha da
  // diretiva que ninguém registrou, no item 4 do PADRÃO)
  const moldura = readFileSync(new URL('../moldura-do-aplicativo.vue', import.meta.url), 'utf8');
  assert.match(moldura, /import \{ observarAbaAtiva \} from '\.\/compartilhado\/aba-ativa-a-vista\.js'/,
    'o observador não foi importado na moldura');
  assert.match(moldura, /\n\s*observarAbaAtiva\(\)/,
    'o observador foi importado e nunca chamado — módulo pronto e comportamento que não acontece');
});
