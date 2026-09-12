/* A BUSCA E O ARQUIVAMENTO — a LIGAÇÃO com a tela.
 *
 * As contas se provam em `busca-e-arquivamento.test.mjs`, sem navegador. O que
 * se prova AQUI é que a tela realmente as usa: que a aba Lotes abre nos em
 * andamento, que o seletor da aba Gravar só oferece lote com trabalho, que a
 * aba Etiquetas abre nos últimos 30 dias, e que as três dizem quantas de
 * quantas. É pelo código-fonte porque `node --test` não compila `.vue`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8');
const template = fonte.slice(0, fonte.indexOf('<script setup>'));
const script = fonte.slice(fonte.indexOf('<script setup>'), fonte.indexOf('</script>'));
const estilo = fonte.slice(fonte.indexOf('<style scoped>'));

const painel = readFileSync(new URL('./painel-de-busca.vue', import.meta.url), 'utf8');
const painelEstilo = painel.slice(painel.indexOf('<style scoped>'));

/** O bloco de uma aba, do `v-else-if` dela até o começo do próximo. */
function abaDe(chave, ateChave) {
  const ini = template.indexOf(`<template v-else-if="aba === '${chave}'">`);
  const fim = ateChave
    ? template.indexOf(`<template v-else-if="aba === '${ateChave}'">`)
    : template.length;
  assert.ok(ini !== -1 && fim > ini, `não achei o bloco da aba ${chave}`);
  return template.slice(ini, fim);
}

/* ── O PAINEL É UM SÓ, NAS DUAS ABAS QUE PROCURAM ENTRE MUITOS ───────────── */

/* ⚠️ ERAM TRÊS ABAS, E VIRARAM DUAS EM 01/09/2026. O painel saiu da aba Gravar,
 * e isso é o coração do redesenho que o dono pediu pela quarta vez: naquela aba
 * se escolhe UM lote, e o painel inteiro — busca, sete atalhos de data, período
 * exato e seletor de estado — comia 260px de altura que quem grava nunca usa. Ele
 * era o bloco 4 dos OITO que vinham antes da área de trabalho.
 *
 * NADA SE PERDEU (PADRÃO item 8): procurar entre muitos lotes é o propósito da
 * aba 1 Lotes, e de lá o "Gravar as etiquetas deste lote →" traz para a bancada
 * com o lote já escolhido. A ÚNICA coisa que o painel da aba Gravar fazia e o da
 * aba Lotes não faz — trazer lote ENCERRADO de volta para o seletor, que é o
 * único caminho para desfazer uma baixa num lote fechado — virou um interruptor
 * escrito, e o teste logo abaixo o guarda. */
test('as duas abas que procuram entre muitos usam o MESMO painel de busca', () => {
  // busca escrita duas vezes é busca que diverge: a aba que ficasse para trás
  // passaria a esconder dado que a outra acha
  for (const [chave, filtro] of [
    ['lotes', 'filtroDeLotes'], ['etiquetas', 'filtroDeEtiquetas'],
  ]) {
    const bloco = abaDe(chave, chave === 'etiquetas' ? 'registros' : 'gravar');
    assert.match(bloco, new RegExp(`<PainelDeBusca[^>]*v-model:filtro="${filtro}"`),
      `a aba ${chave} não tem o painel de busca`);
  }
  assert.match(script, /import PainelDeBusca from '\.\/painel-de-busca\.vue'/);
});

test('a aba Gravar NÃO tem busca, nem filtro, nem parágrafo de ajuda', () => {
  // ela é a bancada: um seletor compacto de lote no alto e o painel de trabalho
  // logo abaixo. "Sem busca, sem filtros, sem parágrafos, sem modo para entrar"
  // foi o pedido, com estas palavras.
  const aba = abaDe('gravar', 'etiquetas');
  assert.doesNotMatch(aba, /<PainelDeBusca/, 'a busca voltou para a bancada');
  assert.doesNotMatch(aba, /class="au-ajuda"/, 'o parágrafo de ajuda voltou para a bancada');
  assert.doesNotMatch(aba, /class="au-passos"/, 'os três passos voltaram — a barra de abas já é a sequência');
});

test('o único poder que a busca dali tinha continua alcançável', () => {
  // o seletor da aba Gravar só oferece lote com peça POR GRAVAR. Sem uma porta
  // para os encerrados, desfazer uma baixa num lote já fechado ficaria
  // inalcançável — a lista das baixadas mora nesta aba.
  const aba = abaDe('gravar', 'etiquetas');
  assert.match(aba, /@change="mostrarEncerrados\(\$event\.target\.checked\)"/,
    'sumiu o interruptor que traz os lotes encerrados de volta');
  assert.match(aba, /Mostrar também os lotes encerrados/);
  const corpo = script.slice(script.indexOf('function mostrarEncerrados('));
  assert.match(corpo.slice(0, corpo.indexOf('\n}')).replace(/\s+/g, ' '),
    /estado: ligado \? 'todos' : 'por_gravar'/,
    'o interruptor tem de escrever o MESMO estado que `lotesDoSeletor` lê');
});

test('cada aba busca por data, por texto e por estado', () => {
  const usos = [...template.matchAll(/<PainelDeBusca[^]*?\/>/g)].map((m) => m[0]);
  assert.equal(usos.length, 2, 'esperava o painel nas duas abas que procuram entre muitos');
  for (const uso of usos) {
    assert.match(uso, /:atalhos="ATALHOS_DE_DATA"/, 'sem atalho, ninguém filtra por data');
    assert.match(uso, /:estados="/);
    assert.match(uso, /rotulo-da-data="/, 'a data que se filtra é outra em cada aba');
    assert.match(uso, /dica="/, 'o campo tem de dizer o que dá para procurar nele');
    assert.match(uso, /:contagem="/, 'lista recortada sem número faz a pessoa achar que perdeu dado');
    assert.match(uso, /estado-padrao="/, 'sem ele o "Limpar" não sabe para onde voltar');
  }
});

test('a dica de cada campo cita o CÓDIGO DA PEÇA e o NÚMERO DE SÉRIE', () => {
  // quem está com a etiqueta na mão tem o código, e não o modelo — e desde
  // 02/09/2026 quem está com a BOLSA na mão tem o número de série, que é o que
  // está impresso nela. A dica só pode prometer o que a busca acha de verdade:
  // ela dizia "ou o nº da série" enquanto a busca não sabia procurar por ele.
  const dicas = [...template.matchAll(/dica="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(dicas.length, 2);
  for (const d of dicas) {
    assert.match(d, /código/i, `a dica "${d}" não diz que dá para buscar por código`);
    assert.match(d, /número de série/i, `a dica "${d}" não diz que dá para buscar pelo número de série`);
  }
});

/* ERAM TRÊS CONTAGENS, E SÃO DUAS: `contagemDoSeletor` existia para o painel de
 * busca da aba Gravar, e a frase "N de M lotes" só faz sentido em lista
 * RECORTADA por busca. Sem busca naquela aba, ela não contava recorte nenhum. */
test('as duas contagens dizem "N de M", e cada uma com a palavra certa', () => {
  for (const nome of ['contagemDeLotes', 'contagemDeEtiquetas']) {
    const i = script.indexOf(`const ${nome} = computed(`);
    assert.notEqual(i, -1, `${nome} sumiu`);
    const corpo = script.slice(i, script.indexOf('\n\n', i)).replace(/\s+/g, ' ');
    assert.match(corpo, /fraseDaContagem\(/, `${nome} não sai da conta pura`);
    assert.match(corpo, /um: '[^']+', muitos: '[^']+'/, `${nome} não diz o que está contando`);
  }
});

/* ── ABA LOTES: OS ENCERRADOS SAEM DA FRENTE, MAS NÃO SOMEM ──────────────── */

test('a aba Lotes abre nos EM ANDAMENTO', () => {
  assert.match(script, /const filtroDeLotes = ref\(\{ \.\.\.FILTRO_LIMPO, estado: 'andamento' \}\)/);
  assert.match(script, /const lotesVisiveis = computed\(\(\) => filtrarLotes\(lotes\.value, \{/,
    'a lista da aba sai do recorte puro, não de um filtro reescrito na tela');
});

test('o v-for da aba Lotes roda sobre o recorte, e não sobre a lista inteira', () => {
  assert.match(abaDe('lotes', 'gravar'), /v-for="l in lotesVisiveis"/);
});

test('"Ver encerrados (N)" existe, diz o número e tem volta', () => {
  const aba = abaDe('lotes', 'gravar');
  assert.match(aba, /Ver encerrados \(\{\{ lotesEncerrados \}\}\)/,
    'sem o número, ninguém sabe se vale a pena apertar');
  assert.match(aba, /Voltar aos em andamento/, 'ir sem voltar prende a pessoa no recorte');
  assert.match(script, /function verEncerrados\(\)/);
  assert.match(script, /function verEmAndamento\(\)/);
});

test('o cartão do lote diz o estado por ESCRITO, com o selo do PADRAO', () => {
  const aba = abaDe('lotes', 'gravar');
  assert.match(aba, /class="selo" :class="marcaDoLote\(l\.id\)\.selo"/);
  assert.match(aba, /\{\{ marcaDoLote\(l\.id\)\.rotulo \}\}/);
  assert.match(script, /const marcaDoLote = \(id\) => seloDoLote\(estadoDoLote\(pecasDoLote\(id\)\)\)/);
});

test('"nada encontrado" e "não há lote nenhum" são frases DIFERENTES', () => {
  // a tela nunca mente: dizer "nenhum lote criado ainda" para uma busca que não
  // achou nada esconderia 87 lotes
  const aba = abaDe('lotes', 'gravar');
  assert.match(aba, /Nenhum lote criado ainda/);
  assert.match(aba, /Nenhum lote com esse recorte/);
  assert.match(aba, /Há \{\{ lotes\.length \}\} lote\(s\) no total/,
    'a frase de "não achei" tem de dizer quantos existem');
});

/* ── ABA GRAVAR: SÓ QUEM TEM TRABALHO ────────────────────────────────────── */

test('o seletor de lote só oferece quem tem peça por gravar', () => {
  assert.match(abaDe('gravar', 'etiquetas'), /v-for="l in lotesDoSeletor"/);
  const i = script.indexOf('const lotesDoSeletor = computed(');
  assert.notEqual(i, -1, 'lotesDoSeletor sumiu');
  const corpo = script.slice(i, script.indexOf('\n\n', i)).replace(/\s+/g, ' ');
  assert.match(corpo, /lotesParaGravar\(lotes\.value, \{/);
  assert.match(corpo, /escolhido: loteEscolhido\.value/,
    'o lote escolhido nunca sai da lista: ao gravar a última peça ele encerra na hora');
  assert.match(corpo, /incluirEncerrados: filtroDeGravar\.value\.estado === 'todos'/,
    'sem esta porta, desfazer uma baixa num lote encerrado fica inalcançável');
});

test('sem nenhum lote por gravar, a tela DIZ isso — não mostra lista vazia', () => {
  const aba = abaDe('gravar', 'etiquetas');
  assert.match(aba, /v-if="!lotesComPecaPorGravar\(lotes, pecasDoLote\)"/);
  assert.match(aba, /estão encerrados/);
  assert.match(aba, /1 Lotes<\/strong>/, 'a frase tem de dizer para onde ir');
});

test('a aba Gravar abre no primeiro lote COM peça por gravar', () => {
  // com o lote de ontem encerrado, ela abria numa fila vazia dizendo "nada a
  // fazer aqui" com trinta etiquetas esperando no lote de baixo
  const corpo = script.slice(script.indexOf('if (!loteEscolhido.value && lotes.value.length)'));
  const ate = corpo.slice(0, corpo.indexOf('\n    }') + 6).replace(/\s+/g, ' ');
  assert.match(ate, /lotes\.value\.find\(\(l\) => !estadoDoLote\(pecasDoLote\(l\.id\)\)\.encerrado\)/);
  assert.match(ate, /\(pendente \|\| lotes\.value\[0\]\)\.id/,
    'sem nenhum pendente, cai no mais recente — quem veio desfazer uma baixa precisa dele');
});

/* ── ABA ETIQUETAS: OS ÚLTIMOS 30 DIAS ───────────────────────────────────── */

test('a aba Etiquetas abre nos últimos 30 dias', () => {
  const i = script.indexOf('const filtroDeEtiquetas = ref(');
  assert.notEqual(i, -1, 'o filtro da aba Etiquetas sumiu');
  const corpo = script.slice(i, script.indexOf('\n\n', i)).replace(/\s+/g, ' ');
  assert.match(corpo, /atalho: '30d'/);
  assert.match(corpo, /\.\.\.intervaloDoAtalho\('30d', new Date\(\)\)/,
    'o intervalo sai da conta pura, ancorado no dia de hoje — data cravada envelhece');
});

test('os dois recortes da aba Etiquetas são dois de propósito', () => {
  // `etiquetasDaAba` é o que EXISTE; `etiquetasFiltradas` é o que a pessoa
  // PEDIU. Com um só, a tela diria "nenhuma etiqueta gravada" para uma busca
  // que não achou nada
  assert.match(script, /const etiquetasFiltradas = computed\(\(\) => filtrarEtiquetas\(etiquetasDaAba\.value, \{/);
  assert.match(script, /const etiquetasVisiveis = computed\(\(\) => etiquetasFiltradas\.value\.slice\(0, quantasEtiquetas\.value\)\)/);
  const aba = abaDe('etiquetas', 'registros');
  assert.match(aba, /v-if="!etiquetasDaAba\.length"/);
  assert.match(aba, /v-else-if="!etiquetasFiltradas\.length"/);
  assert.match(aba, /Nenhuma etiqueta com esse recorte/);
});

test('a garantia da cliente é um dos estados que dá para buscar', () => {
  const i = script.indexOf('const etiquetasFiltradas = computed(');
  const corpo = script.slice(i, script.indexOf('\n\n', i)).replace(/\s+/g, ' ');
  assert.match(corpo, /comGarantia: comGarantia\.value/,
    'sem isto, o estado "com garantia de cliente" filtraria sempre vazio');
});

test('mudar a busca recomeça a lista do topo', () => {
  // com o limite crescido de uma busca larga, a busca seguinte desenharia 500
  // linhas de uma vez
  assert.match(script, /watch\(filtroDeEtiquetas, \(\) => \{ quantasEtiquetas\.value = DE_CADA_VEZ \}\)/);
});

/* ── O PAINEL POR DENTRO ─────────────────────────────────────────────────── */

test('o painel não filtra nada por conta própria: ele só devolve o pedido', () => {
  assert.doesNotMatch(painel, /\.filter\(/,
    'filtro escrito dentro do componente é filtro que nenhum teste puro alcança');
  assert.match(painel, /emit\('update:filtro'/);
});

test('o atalho de data escreve nos DOIS campos, e mexer na data à mão apaga o realce', () => {
  // assim o que a pessoa vê nos campos é exatamente o que está filtrando, e
  // nenhum chip fica aceso mentindo sobre o período
  assert.match(painel, /const \{ de, ate \} = intervaloDoAtalho\(chave, new Date\(\)\)/);
  assert.match(painel, /mudar\(\{ atalho: chave, de, ate \}\)/);
  assert.match(painel, /mudar\(\{ \[qual\]: valor, atalho: '' \}\)/);
});

test('o chip aceso não se distingue só pela cor', () => {
  assert.match(painel, /:aria-pressed="String\(filtro\.atalho === a\.chave\)"/);
});

test('o painel não inventa cor nem tamanho', () => {
  // PADRAO-DA-CENTRAL item 2: cor só de token, nunca hex
  const semComentario = painelEstilo.replace(/\/\*[^]*?\*\//g, '');
  assert.doesNotMatch(semComentario, /#[0-9a-fA-F]{3,8}\b/, 'hex de cor no painel de busca');
  assert.match(painelEstilo, /\.pb-chip\.on\{[^}]*color:var\(--accent-forte\)[^}]*background:var\(--accent-light\)/,
    'o par medido do PADRAO para cor sobre o próprio tom aguado');
});

test('todo alvo do painel nasce com 40px, e todo campo com 16px', () => {
  const campo = painelEstilo.match(/\.pb-campo input, \.pb-campo select\{([^}]*)\}/);
  assert.ok(campo, 'a regra-base dos campos do painel sumiu');
  assert.match(campo[1], /min-height:40px/);
  // O NÚMERO SAIU DAQUI, e não foi perdido: o tamanho vem do degrau
  // `--texto-campo` da escala da casa, cujo PISO é 16px — e há teste que
  // reprova se alguém baixar esse piso (`escala-de-texto.test.mjs`).
  assert.match(campo[1], /font-size:var\(--texto-campo\)/,
    'abaixo de 16px o iOS dá zoom ao focar');
  assert.match(painelEstilo, /\.pb-chip\{[^}]*min-height:40px/);
  assert.match(painelEstilo, /\.pb-limpar\{[^}]*min-height:40px/);
});

test('o @media do celular é a ÚLTIMA coisa do CSS do painel', () => {
  // duas regras de mesma especificidade: ganha a última. Uma regra-base escrita
  // DEPOIS do @media apaga o ajuste de celular em silêncio
  const ultimo = painelEstilo.lastIndexOf('@media (max-width:520px)');
  assert.notEqual(ultimo, -1, 'o ajuste de celular sumiu do painel');
  const depois = painelEstilo.slice(ultimo).replace(/@media \(max-width:520px\)\{[^]*?\n\}/, '');
  assert.equal(depois.replace(/<\/style>/, '').trim(), '',
    'tem regra escrita DEPOIS do @media de celular no painel de busca');
});

/* ── A AJUDA DENTRO DE CADA ABA ──────────────────────────────────────────── */

test('a ajuda da aba fica na tela, e sai do tutorial', () => {
  // Em QUATRO das cinco abas. Na Gravar não: ali a tela é uma bancada, e quem
  // grava a terceira etiqueta não lê parágrafo — a instrução vai para o guia,
  // atrás do "?". "Nada de parágrafo explicando botão" foi o pedido.
  assert.match(template, /<p v-if="aba !== 'gravar'" class="au-ajuda">\{\{ AJUDA_DA_ABA\[aba\] \}\}<\/p>/);
  assert.match(script, /AJUDA_DA_ABA,/, 'a ajuda não pode ser reescrita na tela');
});

test('a ajuda vem ANTES da corrente das abas, para não parti-la', () => {
  // `v-else-if` gruda no `v-if` anterior: um bloco plantado no meio faz a aba
  // Alertas inteira ser desenhada embaixo das outras
  assert.ok(template.indexOf('class="au-ajuda"') < template.indexOf('v-if="carregando"'));
});

/* ── O GUIA DE BANCADA ───────────────────────────────────────────────────── */

test('o guia desenha os itens de cada tela, não só o texto', () => {
  assert.match(template, /v-if="TELAS_DO_GUIA\[telaDoGuia\]\.itens" class="au-guia-itens"/);
  assert.match(template, /<dt>\{\{ i\.rotulo \}\}<\/dt>/);
  assert.match(template, /<dd>\{\{ i\.texto \}\}<\/dd>/);
});

test('o guia longo tem "Voltar", e a primeira tela não tem para onde voltar', () => {
  assert.match(template, /:disabled="telaDoGuia === 0"/);
  assert.match(script, /function voltarGuia\(\)/);
  assert.match(script, /telaAnteriorDoGuia\(telaDoGuia\.value\)/);
});

test('o miolo do guia rola DENTRO da caixa, e a caixa tem teto de altura', () => {
  // as telas do socorro têm quatro casos: no celular elas passam da altura da
  // tela, e quem rolasse a página atrás perderia o "Continuar"
  assert.match(estilo, /\.au-guia\{[^}]*max-height:88dvh/, '`dvh`, nunca `vh` (PADRAO item 4)');
  assert.match(estilo, /\.au-guia-miolo\{[^}]*overflow-y:auto/);
  assert.match(estilo, /\.au-guia-miolo\{[^}]*overscroll-behavior:contain/);
});

test('o botão do guia diz que o socorro está lá dentro', () => {
  // guia que a pessoa não sabe que existe é guia que ninguém reabre.
  //
  // ELE ERA UM LINK DE UMA LINHA E MEIA no alto da aba Gravar — o bloco 3 dos
  // oito que vinham antes da área de trabalho. Virou um alvo pequeno com o
  // ícone e a palavra "Guia", e a frase inteira continua onde ela é lida por
  // quem precisa dela: no `title` (o mouse parado em cima) e no `aria-label` (o
  // leitor de tela). O texto não se perdeu; ele parou de ocupar o melhor
  // espaço da tela toda vez, para sempre.
  assert.match(template, /title="Guia de bancada[^"]*deu errado, e agora[^"]*"/);
  assert.match(template, /aria-label="Guia de bancada[^"]*deu errado, e agora[^"]*"/);
});
