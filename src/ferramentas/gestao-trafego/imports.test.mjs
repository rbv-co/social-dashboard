import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { guardarImports, scriptDoVue, semComentarios } from '../../compartilhado/guarda-de-imports.mjs'

// TODO NOME DE MÓDULO USADO NUMA TELA DESTA PASTA PRECISA ESTAR IMPORTADO.
//
// Chamar uma função de um vizinho e esquecer de importá-la NÃO quebra o
// `npm run build`: o Vite supõe que é global do navegador. O erro só nasce
// quando alguém clica — o Vue aborta o desenho no meio e o painel fica EM
// BRANCO, muitas vezes sem nada no console.
//
// Já derrubou tela quatro vezes: Gestão de Tráfego (29/07, duas no mesmo dia),
// Admin (05/08) e Patrimônio (10/08, as abas Planilha e Resumo em branco).
//
// A dor desta pasta (29/07/2026): a aba Campanhas quebrou inteira duas vezes no
// mesmo dia — primeiro `card`, depois `baldeEfetivo` — e das duas o build
// passou. Na terceira foi `ALVOS[o]`: constante usada como objeto, que a
// primeira versão do guarda não pegava.
//
// O motor mora em `src/compartilhado/guarda-de-imports.mjs` e se testa em
// `guarda-de-imports.test.mjs`. Pasta nova nasce com este arquivo.

guardarImports(import.meta.url, {
  // Quantas telas a pasta tem hoje. Se cair, é `.vue` sumindo — e o guarda
  // passaria por estar vazio, que é o mesmo que não existir. Mexer aqui é de
  // propósito, nunca de passagem.
  minimoDeTelas: 1,
})

// ─────────────────────────────────────────────────────────────────────────────
// Daqui para baixo, três guardas que só existem nesta pasta. Eles não são sobre
// import: são sobre outras três maneiras de a tela quebrar sem o build perceber.

const AQUI = dirname(fileURLToPath(import.meta.url));

// O script da tela, sem comentários nem texto entre aspas. Os dois guardas
// abaixo leem daqui.
function scriptDaTela() {
  return scriptDoVue(readFileSync(join(AQUI, 'tela-de-gestao-trafego.vue'), 'utf8'));
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL NÃO PODE MORAR DENTRO DE UMA ABA.
//
// O defeito real (2026-08-03): o modal de criativo/gastos nasceu dentro de
// `#gt-painel-campanhas` e funcionava, porque só era aberto pela lista de
// anúncios — que vive nessa aba. Quando a Fila passou a abri-lo (a lupa do
// criativo e o botão de gastos), ele parou de aparecer: a troca de aba põe o
// painel em `display:none`, e ancestral escondido esconde o filho por mais que
// se mande `display:flex` nele.
//
// O clique rodava. A função rodava. Nada acontecia, e NENHUM erro aparecia no
// console — o pior formato de falha que existe. Nem o build nem os testes de
// unidade pegam isso, porque é uma relação entre dois pedaços de HTML.
test('o modal de criativo/gastos NÃO está dentro do painel de campanhas', () => {
  const vue = readFileSync(new URL('./tela-de-gestao-trafego.vue', import.meta.url), 'utf8');
  const abre = vue.indexOf('<div id="gt-painel-campanhas">');
  assert.ok(abre > -1, 'o painel de campanhas sumiu — atualize este teste');

  // Onde o painel FECHA: conta as <div> abertas e fechadas a partir dele.
  let i = abre, nivel = 0, fecha = -1;
  const tags = /<div\b[^>]*>|<\/div>/g;
  tags.lastIndex = abre;
  let m;
  while ((m = tags.exec(vue))) {
    nivel += m[0] === '</div>' ? -1 : 1;
    if (nivel === 0) { fecha = m.index; break; }
    i = m.index;
  }
  assert.ok(fecha > abre, 'não consegui achar o fim do painel de campanhas');

  const dentro = vue.slice(abre, fecha);
  // O assistente de nova campanha entra na MESMA lista: ele é aberto pelo botão
  // da barra de abas, que fica visível em qualquer aba — então se ele morasse
  // dentro do painel de Campanhas, abriria invisível a partir da Fila ou da
  // régua, exatamente como o modal de criativo abriu.
  for (const id of ['gt-cr-overlay', 'gt-cr-modal', 'gt-novo-ov', 'gt-novo-modal']) {
    assert.ok(!dentro.includes(`id="${id}"`),
      `${id} está DENTRO de #gt-painel-campanhas — some quando outra aba está ativa`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO CHAMADA POR onclick="..." NO TEMPLATE PRECISA ESTAR EM window.
//
// O `<script setup>` do Vue tem escopo de módulo: um `onclick="_gtNovoFechar()"`
// literal no HTML é avaliado no escopo GLOBAL, onde nada disso existe. Só
// funciona porque o fim do arquivo faz `Object.assign(window, {...})` — e
// esquecer um nome ali dá "_gtNovoFechar is not defined" no clique, sem que o
// build ou qualquer teste de unidade percebam.
test('toda função chamada por onclick no template está exposta em window', () => {
  const vue = readFileSync(new URL('./tela-de-gestao-trafego.vue', import.meta.url), 'utf8');
  const template = vue.slice(0, vue.indexOf('<script'));
  const bloco = vue.slice(vue.indexOf('Object.assign(window, {'));
  const expostas = new Set((bloco.slice(0, bloco.indexOf('})')).match(/\w+/g) || []));

  const faltando = [];
  for (const m of template.matchAll(/onclick="([^"]+)"/g)) {
    for (const chamada of m[1].matchAll(/(?:^|[;\s])(\w+)\s*\(/g)) {
      const nome = chamada[1];
      // `event.stopPropagation()` e afins são do próprio navegador.
      if (nome === 'stopPropagation' || nome === 'event') continue;
      if (!expostas.has(nome)) faltando.push(nome);
    }
  }
  assert.deepEqual([...new Set(faltando)], [],
    'estes nomes são chamados por onclick no template mas não estão em Object.assign(window, {...})');
});

test('o proprio teste de window enxerga um nome faltando', () => {
  const expostas = new Set(['alfa']);
  const template = '<button onclick="beta()">x</button>';
  const faltando = [];
  for (const m of template.matchAll(/onclick="([^"]+)"/g)) {
    for (const c of m[1].matchAll(/(?:^|[;\s])(\w+)\s*\(/g)) if (!expostas.has(c[1])) faltando.push(c[1]);
  }
  assert.deepEqual(faltando, ['beta']);
});

// ─────────────────────────────────────────────────────────────────────────────
// TODA GLOBAL `_gt*` USADA PRECISA SER DECLARADA NO ARQUIVO.
//
// O DEFEITO REAL (03/08/2026): escrevi `_gtNovoPubsDoPerfil` em quatro lugares e
// a linha do `let` não entrou. `npm run build` passou — o Vite não resolve
// identificadores livres — e os testes passaram, porque nenhum deles executa
// essa função. O erro só apareceu no clique, na conta real:
// `ReferenceError: _gtNovoPubsDoPerfil is not defined`.
//
// É PRIMO do teste de imports lá em cima, e o complementa: aquele pega nome de
// MÓDULO usado sem importar; este pega variável de ARQUIVO usada sem declarar.
// Os dois têm a mesma causa — o build não olha, e o dono descobre clicando.
test('toda global _gt* usada na tela está declarada nela', () => {
  const script = scriptDaTela();

  // Onde um nome NASCE: let/const/var/function, parâmetro não conta (é local).
  const declarados = new Set();
  for (const m of script.matchAll(/\b(?:let|const|var)\s+([\w$]+)/g)) declarados.add(m[1]);
  for (const m of script.matchAll(/\bfunction\s+([\w$]+)/g)) declarados.add(m[1]);
  // Declaração em lista: `let a=1, b=2;`
  for (const m of script.matchAll(/\b(?:let|const|var)\s+[^;\n]+/g)) {
    for (const n of m[0].matchAll(/[,(]\s*([\w$]+)\s*=/g)) declarados.add(n[1]);
  }

  const usados = new Set();
  for (const m of script.matchAll(/(^|[^\w.$'"`])(_gt[\w$]*)/gm)) usados.add(m[2]);

  const faltando = [...usados].filter((n) => !declarados.has(n)).sort();
  assert.deepEqual(faltando, [],
    'estes nomes _gt* são usados mas nunca declarados — ReferenceError no clique, e o build NÃO pega');
});

test('o proprio teste de globais enxerga uma que falta', () => {
  // Sem isto o teste poderia estar sempre passando por engano.
  const script = 'let _gtA=1;\nfunction f(){ _gtA=2; _gtB=3; }';
  const declarados = new Set();
  for (const m of script.matchAll(/\b(?:let|const|var)\s+([\w$]+)/g)) declarados.add(m[1]);
  const usados = new Set();
  for (const m of script.matchAll(/(^|[^\w.$'"`])(_gt[\w$]*)/gm)) usados.add(m[2]);
  assert.deepEqual([...usados].filter((n) => !declarados.has(n)), ['_gtB']);
});

// ─────────────────────────────────────────────────────────────────────────────
// TUDO QUE O ASSISTENTE LÊ, A TELA PRECISA PASSAR.
//
// O DEFEITO REAL (03/08/2026): `montarAssistente` lia `o.publicacoes` e
// `o.carregandoPublicacoes`, e a chamada em tela-de-gestao-trafego.vue não
// passava nenhum dos dois. O desenho recebia `undefined`, caía no ramo de lista
// vazia e dizia "este perfil não tem publicação nenhuma" — enquanto a lista
// carregada estava ali do lado, com doze itens.
//
// Foi o terceiro defeito do MESMO feitio no mesmo dia: o build não olha, os
// testes de unidade passam (eles montam o objeto na mão, completo), e quem
// descobre é o dono clicando. Os outros dois já viraram teste aqui em cima —
// nome de módulo sem import, e global sem declaração. Este é o contrato entre
// os dois arquivos.
test('a tela passa TODAS as opções que o assistente lê', () => {
  const assistente = semComentarios(readFileSync(join(AQUI, 'assistente-campanha.js'), 'utf8'));
  const vue = scriptDaTela();

  // O que o desenho lê do objeto de opções.
  const lidas = new Set();
  for (const m of assistente.matchAll(/\bo\.([a-zA-Z]\w*)/g)) lidas.add(m[1]);

  // A chamada da tela: de `montarAssistente({` até o fecho.
  const inicio = vue.indexOf('montarAssistente({');
  assert.ok(inicio > -1, 'a tela não chama montarAssistente — atualize este teste');
  const trecho = vue.slice(inicio, vue.indexOf('});', inicio));
  const passadas = new Set();
  for (const m of trecho.matchAll(/(^|[{,\s])(\w+)\s*:/g)) passadas.add(m[2]);

  // `estado` é lido como `o.estado` e passado como `estado` — o mesmo nome dos
  // dois lados, que é justamente o contrato que este teste protege.
  const faltando = [...lidas].filter((n) => !passadas.has(n)).sort();
  assert.deepEqual(faltando, [],
    'o assistente lê estas opções e a tela não as passa — o desenho recebe undefined e mente na tela');
});

test('o proprio teste de opcoes enxerga uma que falta', () => {
  const assistente = 'function d(e,o){ return o.alfa + o.beta }';
  const trecho = 'montarAssistente({ doc:document, alfa:1,';
  const lidas = new Set([...assistente.matchAll(/\bo\.([a-zA-Z]\w*)/g)].map((m) => m[1]));
  const passadas = new Set([...trecho.matchAll(/(^|[{,\s])(\w+)\s*:/g)].map((m) => m[2]));
  assert.deepEqual([...lidas].filter((n) => !passadas.has(n)), ['beta']);
});

test('o teste de imports nao le TEXTO DE TELA como se fosse codigo', () => {
  // O falso positivo real (03/08/2026): a tela tem a frase '<b>Nada mudou.</b>'
  // e rascunhos.js exporta uma funcao `mudou`. O teste acusou um import que nao
  // faltava. Vale para todo nome exportado que tambem e palavra comum
  // ("linha", "quando", "passo").
  const bruto = [
    "import { mudou as rascunhoMudou } from './rascunhos.js'",
    "_gtPubStatus('<b>Nada mudou.</b>')",
    'if (rascunhoMudou(a, b)) {}',
  ].join('\n');
  const script = semComentarios(bruto);
  const usado = (nome) => new RegExp('(^|[^\\w.$\'"`])' + nome + '\\s*[([.,);\\]}]', 'm').test(script);
  assert.equal(usado('mudou'), false, 'leu a frase da tela como uso da funcao');
  assert.equal(usado('rascunhoMudou'), true, 'deixou de ver o uso de verdade');
});
