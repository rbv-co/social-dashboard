/* O MODO BANCADA — a prova da conta pura, e a prova de que a tela usa ela.
 *
 * POR QUE ESTE ARQUIVO EXISTE. O dono usou a aba Gravar de pé e disse: "ta muito
 * ruim o layout e visual, n ta funcional, está confuso, texto maiores que
 * outros, espaços vazios, não centralizados, uma criança de 5 anos precisa
 * conseguir fazer o processo, precisa ser didático, fácil, FUNCIONAL". O modo
 * bancada é a resposta: um painel de máquina, com a peça da vez em letra
 * garrafal, o estado, o progresso e UM botão.
 *
 * O QUE SE PROVA AQUI:
 *   1. a conta pura — qual estado sai de qual fase, e a frase de cada estado;
 *   2. a única ação, e o que ela chama;
 *   3. quando o modo pode ser ligado, e quando ele TEM de se desligar sozinho;
 *   4. a ligação com a tela, pelo código-fonte, porque `node --test` não compila
 *      `.vue`;
 *   5. as regras de desenho que o dono pediu com estas palavras — TRÊS tamanhos
 *      de texto e UMA ação principal. Elas são o pedido, então elas têm teste:
 *      sem isto, o quarto tamanho volta na próxima entrega e ninguém vê.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FASES, MODOS, nomeDoModo, estadoDaBancada, acaoDaBancada,
  podeEntrarNaBancada, precisaSairDaBancada, bancadaLembrada, lembrarBancada,
} from './modo-bancada.js';

const fonte = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8');
const template = fonte.slice(0, fonte.indexOf('<script setup>'));
const script = fonte.slice(fonte.indexOf('<script setup>'), fonte.indexOf('</script>'));
const estilo = fonte.slice(fonte.indexOf('<style scoped>'));
/* SEM OS COMENTÁRIOS. Eles CITAM os nomes velhos por escrito, de propósito —
 * é assim que a explicação de por que uma coisa saiu fica junto do lugar de onde
 * ela saiu. Procurar o nome no arquivo inteiro acharia a própria explicação, e é
 * assim que nasce defeito falso. */
const codigo = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** A gaveta "Mais opções deste lote", do miolo dela até o fecho do `<details>`.
 *
 * ⚠️ OS COMENTÁRIOS DE HTML SAEM ANTES, e isso não é asseio: em 02/09/2026 o
 * comentário que explica por que o botão "Baixar a lista das que faltam" foi
 * apagado CITA o rótulo dele entre aspas — e o teste de PADRÃO item 8 logo
 * abaixo procura rótulo por `includes()`. Sem esta linha, ele encontraria o
 * botão dentro da própria explicação de que o botão não existe mais, e passaria
 * verde para sempre. */
const gaveta = (() => {
  const i = template.indexOf('class="au-mais-miolo"');
  assert.notEqual(i, -1, 'sumiu a gaveta das ações raras');
  return template.slice(i, template.indexOf('</details>', i)).replace(/<!--[^]*?-->/g, '');
})();

/** O corpo de uma função do `<script setup>`, por contagem de chaves. */
function corpoDaFuncao(nome) {
  const abre = script.indexOf(`function ${nome}(`);
  assert.notEqual(abre, -1, `função ${nome} sumiu da tela`);
  let nivel = 0;
  const i = script.indexOf('{', abre);
  for (let j = i; j < script.length; j += 1) {
    if (script[j] === '{') nivel += 1;
    else if (script[j] === '}') { nivel -= 1; if (nivel === 0) return script.slice(i, j + 1); }
  }
  throw new Error(`não achei o fim de ${nome}`);
}

/* ── 1. O ESTADO, E A FRASE DE CADA ESTADO ────────────────────────────────── */

test('cada fase tem um estado, e nenhum estado sai sem título e sem detalhe', () => {
  // "Deu erro" sozinho, de pé na bancada com uma bolsa na mão, não diz o que
  // fazer — e a pessoa ou joga fora uma etiqueta boa ou costura uma muda.
  for (const fase of FASES) {
    for (const modo of MODOS) {
      const e = estadoDaBancada({ fase, modo });
      assert.equal(e.chave, fase, `a fase ${fase} não voltou como chave`);
      assert.ok(e.titulo.trim(), `a fase ${fase} (${modo}) saiu sem título`);
      assert.ok(e.detalhe.trim().length > 20,
        `a fase ${fase} (${modo}) saiu sem dizer o que fazer`);
      assert.ok(['neutro', 'agindo', 'ok', 'erro'].includes(e.tom),
        `a fase ${fase} saiu com um tom que o CSS não pinta: ${e.tom}`);
    }
  }
});

test('a sequência de estados é a que o dono descreveu', () => {
  assert.equal(estadoDaBancada({ fase: 'esperando' }).titulo, 'Encoste a etiqueta');
  assert.equal(estadoDaBancada({ fase: 'gravando' }).titulo, 'Gravando…');
  assert.equal(estadoDaBancada({ fase: 'ok' }).titulo, 'Pronto');
  assert.equal(estadoDaBancada({ fase: 'erro' }).titulo, 'Deu erro');
});

test('o tom de cada estado é o que a cor vai dizer', () => {
  assert.equal(estadoDaBancada({ fase: 'parado' }).tom, 'neutro');
  assert.equal(estadoDaBancada({ fase: 'esperando' }).tom, 'agindo');
  assert.equal(estadoDaBancada({ fase: 'gravando' }).tom, 'agindo');
  assert.equal(estadoDaBancada({ fase: 'ok' }).tom, 'ok');
  assert.equal(estadoDaBancada({ fase: 'fim' }).tom, 'ok');
  assert.equal(estadoDaBancada({ fase: 'erro' }).tom, 'erro');
});

test('o recado da sequência VENCE o texto padrão', () => {
  // é a única frase que sabe a diferença entre "a etiqueta ficou pela metade,
  // separe" e "o leitor está ocupado, a etiqueta está boa". Texto genérico por
  // cima dele é a tela mentindo.
  const dito = 'A gravação parou na metade: SEPARE ESTA ETIQUETA e pegue outra.';
  assert.equal(estadoDaBancada({ fase: 'erro', recado: dito }).detalhe, dito);
  assert.equal(estadoDaBancada({ fase: 'ok', recado: 'Peça 5 gravada.' }).detalhe, 'Peça 5 gravada.');
  // recado em branco não apaga a frase: sobra o texto padrão, nunca o vazio
  assert.ok(estadoDaBancada({ fase: 'erro', recado: '   ' }).detalhe.trim());
});

test('nenhuma frase do modo manda trocar a etiqueta', () => {
  // a mesma cicatriz do `InvalidStateError` e das frases do leitor de mesa:
  // quando o problema é do aparelho, a etiqueta está boa — e quem troca etiqueta
  // boa joga bolsa fora, uma atrás da outra.
  for (const fase of FASES) {
    for (const modo of MODOS) {
      const { titulo, detalhe } = estadoDaBancada({ fase, modo });
      assert.doesNotMatch(`${titulo} ${detalhe}`, /troque a etiqueta|jogue (a etiqueta )?fora|separe esta/i,
        `a fase ${fase} (${modo}) manda mexer na etiqueta sem saber se ela está boa`);
    }
  }
});

test('fase e modo desconhecidos caem no caminho seguro, sem estourar', () => {
  const e = estadoDaBancada({ fase: 'inventada', modo: 'inventado' });
  assert.equal(e.chave, 'parado');
  assert.ok(e.detalhe.trim());
  assert.equal(estadoDaBancada().chave, 'parado');
});

test('o modo em uso tem nome escrito, sempre', () => {
  assert.equal(nomeDoModo('mesa'), 'Leitor de mesa');
  assert.equal(nomeDoModo('celular'), 'Celular encostado');
  assert.equal(nomeDoModo('copiar'), 'Pelo aplicativo');
  assert.ok(nomeDoModo('qualquer outra coisa').trim(), 'modo sem nome deixa a tela muda');
});

/* ── 2. A ÚNICA AÇÃO ──────────────────────────────────────────────────────── */

test('há UMA ação por vez, e ela sempre tem rótulo', () => {
  for (const fase of FASES) {
    for (const modo of MODOS) {
      const a = acaoDaBancada({ fase, modo });
      assert.ok(a.rotulo.trim(), `a fase ${fase} (${modo}) deixou o botão sem rótulo`);
      assert.ok(['gravar', 'marcar', 'sair'].includes(a.chave), `chave desconhecida: ${a.chave}`);
      assert.equal(typeof a.ocupado, 'boolean');
    }
  }
});

test('enquanto grava o botão TRAVA, e não some', () => {
  // botão que some no meio faz a pessoa procurar, e procurar com a etiqueta na
  // mão é tirar a etiqueta de cima do leitor
  for (const fase of ['esperando', 'gravando']) {
    const a = acaoDaBancada({ fase, modo: 'mesa' });
    assert.equal(a.ocupado, true);
    assert.ok(a.rotulo.trim());
  }
  assert.equal(acaoDaBancada({ fase: 'parado', modo: 'mesa' }).ocupado, false);
});

test('cada modo chama o caminho dele', () => {
  assert.equal(acaoDaBancada({ fase: 'parado', modo: 'mesa' }).chave, 'gravar');
  assert.equal(acaoDaBancada({ fase: 'parado', modo: 'celular' }).chave, 'gravar');
  // no modo do aplicativo quem grava é o celular da pessoa; aqui só se confirma
  assert.equal(acaoDaBancada({ fase: 'parado', modo: 'copiar' }).chave, 'marcar');
});

test('sem peça por gravar o botão vira a porta de saída', () => {
  const a = acaoDaBancada({ fase: 'fim', modo: 'mesa' });
  assert.equal(a.chave, 'sair');
  assert.equal(a.ocupado, false);
});

/* ── 3. QUANDO O MODO APARECE, E QUANDO ELE SAI ───────────────────────────── */

test('só entra na bancada quem pode gravar, com lote e com peça na fila', () => {
  const cheio = { podeEditar: true, temLote: true, temPecaPorGravar: true };
  assert.equal(podeEntrarNaBancada(cheio), true);
  assert.equal(podeEntrarNaBancada({ ...cheio, podeEditar: false }), false);
  assert.equal(podeEntrarNaBancada({ ...cheio, temLote: false }), false);
  assert.equal(podeEntrarNaBancada({ ...cheio, temPecaPorGravar: false }), false);
  assert.equal(podeEntrarNaBancada(), false);
});

test('a pergunta de sobrescrever TIRA a tela do modo bancada', () => {
  // ela tem dois seletores, o aviso de garantia de cliente e um motivo
  // obrigatório, e apaga a identidade de uma bolsa. Copiá-la para dentro do
  // painel seria a segunda cópia da pergunta mais perigosa da ferramenta.
  assert.equal(precisaSairDaBancada({ sobrescrita: { codigoAntigo: 'ABC' } }), true);
  assert.equal(precisaSairDaBancada({ sobrescrita: null }), false);
  assert.equal(precisaSairDaBancada(), false);
});

test('a escolha do modo fica lembrada, e o depósito quebrado não derruba a tela', () => {
  const guardado = new Map();
  const bom = { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, v) };
  assert.equal(bancadaLembrada(bom), false);
  assert.equal(lembrarBancada(true, bom), true);
  assert.equal(bancadaLembrada(bom), true);
  lembrarBancada(false, bom);
  assert.equal(bancadaLembrada(bom), false);

  // `localStorage` ESTOURA em janela anônima e com dados de site bloqueados
  const quebrado = {
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
  };
  assert.equal(bancadaLembrada(quebrado), false);
  assert.equal(lembrarBancada(true, quebrado), false);
});

/* ── 4. A LIGAÇÃO COM A TELA ──────────────────────────────────────────────── */

/* ⚠️ ERAM SETE NOMES, E SÃO TRÊS DESDE 01/09/2026. Não é código que sumiu: é o
 * MODO que sumiu. `podeEntrarNaBancada`, `bancadaLembrada` e `lembrarBancada`
 * gateavam e lembravam um interruptor que ligava este desenho por cima do outro
 * — e o dono reclamou da aba assim quatro vezes. A aba Gravar VIROU a bancada:
 * escolheu o lote, trabalha. `precisaSairDaBancada` também saiu, porque ela
 * tirava a tela do modo quando a pergunta de sobrescrever aparecia, e agora essa
 * pergunta nasce dentro da própria bancada, na largura inteira do painel.
 * As quatro continuam no módulo, com os testes delas logo acima — quem apagar
 * apaga as duas coisas de propósito, e não de passagem. */
test('a tela chama a conta pura, e não reescreve nenhuma frase', () => {
  assert.match(script, /from '\.\/modo-bancada\.js'/, 'a tela não importa o módulo');
  for (const nome of ['estadoDaBancada', 'acaoDaBancada', 'nomeDoModo']) {
    assert.match(script, new RegExp(`\\b${nome}\\b`), `a tela não usa ${nome}`);
  }
  // e o modo NÃO pode voltar por uma porta lateral: nada de interruptor
  assert.doesNotMatch(codigo, /\bmodoBancada\b|\bnaBancada\b|\bentrarNaBancada\b|\bsairDaBancada\b/,
    'voltou um modo para entrar — se a aba precisa de um modo, a aba deveria SER aquilo');
  // as frases de estado moram no módulo, que se prova. Uma cópia no `.vue` não
  // teria teste nenhum — `node --test` não compila `.vue`.
  for (const frase of ['Encoste a etiqueta', 'Gravando…', 'Deu erro']) {
    assert.ok(!template.includes(`>${frase}<`),
      `a frase "${frase}" foi escrita à mão no template, fora da conta que se prova`);
  }
});

test('a fase da bancada nasce em UM lugar só para o ✓ e o ✗', () => {
  // escrever a fase em cada caminho de gravação seria a segunda cópia da mesma
  // decisão, e a que ficasse para trás deixaria o painel dizendo "Gravando…"
  // com a etiqueta já fora do leitor
  const corpo = corpoDaFuncao('avisarNaTela');
  assert.match(corpo, /faseDaBancada\.value = /,
    'o único ponto que sabe se a gravação terminou bem parou de dizer a fase');
  const quantas = (script.match(/faseDaBancada\.value = sinal/g) || []).length;
  assert.equal(quantas, 1, 'a tradução de sinal para fase foi copiada para outro lugar');
});

test('o painel NÃO depende do sinal que some sozinho', () => {
  // `sinalDaGravacao` some em 2,6s porque é desenho de canto de olho. A frase
  // grande do painel é o que se lê com a bolsa na mão: erro que some em dois
  // segundos é a tela escondendo o que a pessoa precisa.
  assert.match(script, /const estadoDaBancadaAgora = computed\(\(\) => estadoDaBancada\(\{/);
  const bloco = script.slice(
    script.indexOf('const estadoDaBancadaAgora'),
    script.indexOf('const acaoDaBancadaAgora'),
  );
  assert.doesNotMatch(bloco, /sinalDaGravacao/,
    'o estado do painel voltou a sair do sinal que se apaga em 2,6 segundos');
});

test('a fase vem pelo segundo argumento do `aoContar`, não de ler a frase', () => {
  // adivinhar o estado pelo texto faria alguém melhorar uma palavra na sequência
  // e o painel parar de mudar de estado, em silêncio
  const sequencia = readFileSync(
    new URL('./gravador-de-mesa/gravar-pelo-leitor-de-mesa.js', import.meta.url), 'utf8');
  assert.match(sequencia, /aoContar\([^)]*, 'esperando'\)/);
  assert.match(sequencia, /aoContar\([^)]*, 'gravando'\)/);
  assert.match(script, /aoContar: \(frase, fase\) =>/);
});

test('a pergunta de sobrescrever nasce DENTRO da bancada, na largura inteira', () => {
  // ela tinha de tirar a tela do modo porque não cabia num painel de máquina.
  // Sem modo nenhum, ela é desenhada onde a pessoa já está olhando — e o botão
  // de gravar sai de cena enquanto ela está na tela, senão "Gravar nesta
  // etiqueta" ali do lado leria a MESMA etiqueta e devolveria a MESMA pergunta.
  assert.match(template, /<div v-if="sobrescrita" class="au-confirma au-sobrescrita">/);
  assert.match(template, /<div v-if="!sobrescrita" class="au-bancada-acao">/);
  const grande = estilo.slice(estilo.indexOf('@media (min-width:900px){'));
  assert.match(grande, /\.au-sobrescrita\{grid-column:1 \/ -1/,
    'espremida numa coluna, a pergunta mais perigosa da ferramenta é onde o dedo erra o botão');
});

test('nada do que saiu da frente da bancada ficou inalcançável (PADRAO item 8)', () => {
  // As ações raras saíram da FRENTE, não da ferramenta: elas moram atrás de UM
  // ponto de acesso discreto — "Mais opções deste lote". Antes eram seis links
  // do mesmo peso soltos na tela, e seis do mesmo peso é o mesmo que nenhum.
  assert.match(template, /<span>Mais opções deste lote<\/span>/, 'sumiu o ponto de acesso');
  assert.match(template, /@click="abrirGuia"/, 'o guia ficou sem chamador');
  for (const marca of [
    'Dar baixa nesta peça', 'Excluir esta peça',
    'Gravar pelo aplicativo', 'Gravar pelo leitor de mesa', 'Gravar encostando o celular',
    'Travar a etiqueta depois de gravar',
    'Mostrar também os lotes encerrados', 'Desfazer',
  ]) {
    assert.ok(gaveta.includes(marca), `"${marca}" sumiu da gaveta — e da ferramenta`);
  }
  /* ⚠️ TRÊS RÓTULOS SAÍRAM DESTA LISTA EM 02/09/2026, e o item 8 do PADRÃO
   * continua valendo — por isso eles não sumiram do teste, mudaram de asserção.
   * O dono perguntou se a gaveta "Gravador de mesa" ainda fazia sentido, e a
   * resposta foi que metade não fazia:
   *   · "Baixar a lista das que faltam" SAIU DA FERRAMENTA. É a única coisa que
   *     esta entrega apaga de verdade. Ela nasceu quando não existia programa de
   *     gravação nenhum; hoje há três caminhos melhores (os três "Gravar pelo…"
   *     acima, que continuam nesta lista) e uma lista em arquivo mais completa
   *     na aba Lotes — "Baixar a lista inteira", em CSV, com TODAS as peças. As
   *     duas asserções abaixo guardam esse endereço: se o botão da aba Lotes
   *     sumir um dia, ninguém mais tem os endereços em arquivo;
   *   · o campo de colar o retorno e o "Marcar as gravadas" MUDARAM DE CASA,
   *     para a aba Etiquetas — colar um log é conserto EM BLOCO, e nunca foi da
   *     bancada. O teste de endereço deles está em `aba-de-etiquetas.test.mjs`. */
  for (const foi of ['Baixar a lista das que faltam', 'Marcar as gravadas', 'Cole aqui o que o gravador']) {
    assert.ok(!gaveta.includes(foi),
      `"${foi}" voltou para a gaveta da bancada — ela é para gravar UMA peça por vez`);
  }
  assert.match(template, /@click="baixarListaDoLote\(l\)"[^]{0,80}Baixar a lista inteira/,
    'sumiu o "Baixar a lista inteira" da aba Lotes, que é o endereço para onde a lista em '
    + 'arquivo foi — sem ele, os endereços em arquivo ficam inalcançáveis');
  assert.doesNotMatch(script, /function baixarListaDoGravador\(/,
    'a lista "das que faltam" voltou: são duas listas para o mesmo dedo, e a da aba Lotes '
    + 'sai mais completa');
  // e a gaveta é UMA: duas gavetas é o mesmo problema em ponto menor
  /* ⚠️ A CONTA MUDOU DE ESCOPO EM 02/09/2026, e a regra continua a mesma.
   * Ela contava `<details class="au-mesa` no TEMPLATE INTEIRO, porque a única
   * gaveta da ferramenta era esta. Agora há uma segunda, na aba Etiquetas —
   * "Marcar várias de uma vez pelo gravador de mesa", que veio daqui. A regra
   * que importa nunca foi "uma gaveta na ferramenta": é UMA gaveta NA BANCADA,
   * porque duas portas de ação rara na mesma tela é o mesmo problema em ponto
   * menor. Por isso a conta agora é dentro da aba Gravar.
   * (`au-mesa` também deixou de existir: era o resto do nome do bloco "gravador
   * de mesa", que saiu daqui nesta entrega. A classe é `au-mais`.) */
  const abaGravar = template.slice(
    template.indexOf(`<template v-else-if="aba === 'gravar'">`),
    template.indexOf(`<template v-else-if="aba === 'etiquetas'">`),
  );
  assert.equal((abaGravar.match(/<details class="au-mais/g) || []).length, 1,
    'voltou a haver mais de uma gaveta na aba Gravar');
});

/* ── 5. AS REGRAS DE DESENHO QUE O DONO PEDIU ─────────────────────────────── */

/** O CSS do modo bancada: da abertura do bloco até o fim do arquivo. */
const cssDaBancada = estilo.slice(estilo.indexOf('.au-bancada{'));

test('TRÊS tamanhos de texto no modo bancada, e três só', () => {
  // "texto maiores que outros" foi a queixa, e a regra continua a mesma: três
  // degraus, e nenhuma regra do modo escreve `font-size` de outro jeito — é por
  // isso que dá para contar lendo o CSS.
  //
  // O QUE MUDOU EM 01/09/2026: os três degraus deixaram de ser variáveis DESTA
  // TELA (`--bancada-peca`, `--bancada-estado`, `--bancada-resto`) e passaram a
  // ser degraus da escala da casa, em `estilos-globais.css`. O desenho é o
  // mesmo; o que saiu foi a escala particular — que é como a Central chegou a
  // quinze tamanhos numa tela só.
  const DA_CASA = ['var(--texto-numero)', 'var(--texto-titulo)', 'var(--texto-corpo)'];
  const declaracoes = [...cssDaBancada.matchAll(/\.au-(bancada|entrada-bancada)[^{}]*\{[^}]*\}/g)]
    .flatMap((m) => [...m[0].matchAll(/font-size:\s*([^;}]+)/g)].map((f) => f[1].trim()));
  const forasteiros = declaracoes.filter((d) => !DA_CASA.includes(d));
  assert.deepEqual(forasteiros, [],
    'apareceu um tamanho de texto fora dos três degraus do modo bancada');

  // e os três continuam sendo TRÊS: um quarto papel aqui é o desenho que o dono
  // reprovou voltando
  assert.equal(new Set(declaracoes).size, 3,
    `o painel usa ${new Set(declaracoes).size} tamanhos: ${[...new Set(declaracoes)].join(', ')}`);

  // a escala particular não pode voltar por uma porta lateral
  for (const velho of ['--bancada-peca', '--bancada-estado', '--bancada-resto']) {
    assert.doesNotMatch(cssDaBancada, new RegExp(velho),
      `${velho} voltou: o modo bancada usa os degraus da casa`);
  }
});

test('a cor de estado do painel sai de token, nunca de hex', () => {
  const tons = [...cssDaBancada.matchAll(/\.au-bancada-(neutro|agindo|ok|erro)\{--bancada-cor:([^}]+)\}/g)];
  assert.equal(tons.length, 4, 'faltou um tom de estado');
  for (const [, nome, valor] of tons) {
    assert.match(valor, /^var\(--[\w-]+\)$/, `o tom ${nome} não sai de token: ${valor}`);
  }
});

test('a cor NUNCA é o único aviso', () => {
  // o título diz o estado por escrito, e ele é irmão da moldura colorida
  assert.match(template, /<p class="au-bancada-titulo">\{\{ estadoDaBancadaAgora\.titulo \}\}<\/p>/);
  assert.match(template, /<p class="au-bancada-detalhe">\{\{ estadoDaBancadaAgora\.detalhe \}\}<\/p>/);
  // e a peça da vez na fila não se distingue só pelo fundo: a palavra "agora"
  // (com A maiúsculo: a fila era desenhada DUAS vezes neste arquivo, uma para o
  // modo e outra para fora dele, com dois selos diferentes para a mesma coisa.
  // Sobrou uma, e ela usa o selo escrito das classes prontas.)
  assert.match(template, /'Agora' : estadoDaPeca\(pf\)\.rotulo/);
});

test('UMA ação principal na obra, e um botão só a carrega', () => {
  // O RECORTE MUDOU em 01/09/2026: ele ia do `<section>` até o `</section>`, e
  // ali dentro passou a viver também a pergunta de sobrescrever, que é um bloco
  // com a decisão DELA e o botão principal DELA. O que este teste guarda é a
  // obra — o número, o estado, a ação e o progresso —, que é onde a pessoa fica
  // olhando enquanto grava cinquenta etiquetas.
  const obra = template.slice(
    template.indexOf('<div class="au-bancada-obra">'),
    template.indexOf('<div v-if="filaAoRedor.length > 1"'),
  );
  const principais = (obra.match(/class="au-botao/g) || []).length;
  assert.equal(principais, 1,
    'a obra voltou a ter mais de uma ação principal — duas competindo é o mesmo que nenhuma');
  assert.match(obra, /@click="tocarNaBancada"/);
  // e a gaveta das ações raras não tem NENHUM botão principal SOLTO: tudo lá
  // fora das perguntas é secundário ou link. Cada pergunta que abre lá dentro é
  // um bloco com UMA decisão, e o botão principal dela é o "sim" daquela
  // decisão — é o mesmo desenho das outras quatro perguntas desta tela.
  const semPerguntas = gaveta.replace(/<div v-if="[^"]*" class="au-confirma">[^]*?<\/div>\s*<\/div>/g, '');
  const soltos = [...semPerguntas.matchAll(/class="au-botao"[^>]*>\s*([^<]{3,40})/g)]
    .map((m) => m[1].trim().replace(/\s+/g, ' '));
  assert.deepEqual(soltos, [],
    'botão principal solto na gaveta das ações raras: ' + soltos.join(' | '));
});

test('o endereço deixa de ser o maior elemento nos modos automáticos', () => {
  // ali ele é CONFERÊNCIA, não leitura: quem lê é a máquina. Só no modo de
  // copiar ele volta a ser grande e selecionável.
  assert.match(cssDaBancada,
    /\.au-bancada-endereco\{[^}]*font-size:var\(--texto-corpo\)/);
  assert.match(cssDaBancada,
    /\.au-bancada \.au-endereco\{font-size:var\(--texto-titulo\)/);
  assert.match(template, /modoDaBancada === 'copiar'/);
});

test('o painel do computador é DUAS COLUNAS que enchem a largura', () => {
  // ⚠️ ESTE TESTE TROCOU DE REGRA DUAS VEZES, e as duas vieram do dono.
  //
  // 1ª FORMA — QUATRO COLUNAS: obra 720px, fila 340px e duas de `1fr` iguais
  // nas pontas, que centravam o grupo. Centrava mesmo (174px de margem de cada
  // lado, simétricos) e o dono disse que "o painel de trabalho ocupa a metade
  // esquerda, a fila fica numa coluna estreita e sobra faixa à direita". O
  // grupo usava 1092 de 1440 (75,8%). Simetria não é aproveitamento.
  //
  // 2ª FORMA — obra `1fr` + fila `min(420px, 30%)`. A largura passou a 96,7%,
  // e mesmo assim o dono voltou: "na aba gravar no computador ainda não está
  // usando toda a lateral, acredito que se você fizer duas colunas, de um lado
  // a animação de gravação e na direita o link e os botões". A conta dá razão a
  // ele: a coluna da direita era uma LISTA de linhas curtas, e a da esquerda
  // tinha tudo empilhado — o maior vazio contínuo do painel media 1224 × 72px,
  // a faixa à direita do "nº 5 de 12", e o botão de 360px morava numa coluna de
  // 942 com 582px de nada ao lado. A largura estava ocupada por moldura, não
  // por conteúdo.
  //
  // 3ª FORMA, esta: ESQUERDA o que acontece (número + anéis grandes + estado),
  // DIREITA o que você faz (endereço + botões + progresso), e a fila numa FAIXA
  // embaixo das duas.
  //
  // O QUE ESTE TESTE GUARDA, e são as três coisas que quebram calado:
  //   1. não voltar a haver coluna de MARGEM — as duas colunas são de conteúdo,
  //      e o recuo é o mesmo 24px do resto da ferramenta (PADRÃO item 7);
  //   2. a coluna da ação não passar da do trabalho. Travada em `680px`, a
  //      900px de tela ela ficaria com 680 e o trabalho com 140 — a lateral
  //      MAIS LARGA que o trabalho, que foi o defeito da 1ª forma. O
  //      `min(680px, 47%)` é o conserto: 654,2 a 1440px, 400,4 a 900px, e a do
  //      trabalho sempre maior. E os 47% não são gosto: o endereço da peça mede
  //      541,9px em `--fonte-dados` no degrau `--texto-titulo`, e com o recuo da
  //      caixa pede 576 para não quebrar no meio do código — que é o que a
  //      pessoa lê e copia. Com 44% ele cabia com 2,5px de folga, que uma fonte
  //      de reserva come inteira; com 47% sobram 78;
  //   3. a fila continuar existindo, atravessada, e não voltar a ser a terceira
  //      coluna estreita.
  //
  // A centralização que importava continua: é a VERTICAL, no `align-self:center`
  // com o teto de altura — e ela tem teste próprio logo abaixo.
  const grande = estilo.slice(
    estilo.indexOf('@media (min-width:900px){'),
    estilo.lastIndexOf('@media (max-width:520px){'),
  );
  assert.match(grande, /\.au-bancada\{\s*display:grid;/);
  const colunas = grande.match(/\.au-bancada\{[^}]*grid-template-columns:([^;]+);/);
  assert.ok(colunas, 'sumiu o `grid-template-columns` da bancada');
  assert.equal(colunas[1].trim(), 'minmax(0,1fr) minmax(0,min(680px, 47%))',
    'a bancada voltou a ter coluna de margem, ou a coluna da ação voltou a ter largura fixa');
  assert.match(grande, /\.au-bancada-obra\{grid-column:1; grid-row:2; align-self:center;/);
  assert.match(grande, /\.au-bancada-comandos\{grid-column:2; grid-row:2; align-self:center;/);
  assert.match(grande, /\.au-bancada-fila\{[^}]*grid-column:1 \/ -1/,
    'a fila voltou a ser uma coluna estreita: ela é a faixa embaixo das duas');
});

test('os anéis crescem no computador — é o que se vê de longe, de pé', () => {
  // O pedido do dono foi "de um lado a animação de gravação", e animação que se
  // vê de longe não é a mesma de 104px que cabe ao lado do texto num celular.
  // No computador ela sobe para o alto do bloco de estado e dobra de tamanho.
  const grande = estilo.slice(
    estilo.indexOf('@media (min-width:900px){'),
    estilo.lastIndexOf('@media (max-width:520px){'),
  );
  assert.match(grande, /\.au-aneis-caixa\{width:200px; height:200px;\}/,
    'os anéis voltaram ao tamanho de celular no computador');
  assert.match(grande, /\.au-bancada-estado\{\s*flex-direction:column;/,
    'o bloco de estado voltou a pôr os anéis ao lado do texto no computador');
  // e no celular NADA disso vale: lá a largura é o recurso escasso, e os anéis
  // ficam ao lado do texto, com 72px
  const celular = estilo.slice(estilo.lastIndexOf('@media (max-width:520px){'));
  assert.match(celular, /\.au-aneis-caixa\{width:72px; height:72px;\}/,
    'o ajuste de celular dos anéis sumiu');
});

test('o botão da bancada tem teto de largura — botão que atravessa meia tela vira faixa', () => {
  // Medido a 1440px antes desta entrega: com `flex:1 1 200px` ele esticava para
  // a coluna inteira, 720 de 1440 — exatamente meia tela. O dono: "o botão
  // principal está enorme, largura de meia tela para uma ação".
  //
  // O QUE NÃO PODE VOLTAR JUNTO: o alvo. O que precisa ser grande numa bancada
  // é a ÁREA que o dedo acerta com a bolsa na outra mão, e quem dá isso é a
  // ALTURA. Por isso os 72px continuam aqui, do lado do teto de largura.
  const grande = estilo.slice(
    estilo.indexOf('@media (min-width:900px){'),
    estilo.lastIndexOf('@media (max-width:520px){'),
  );
  const regra = grande.match(/\.au-bancada-botao\{([^}]*)\}/);
  assert.ok(regra, 'sumiu a regra do botão na tela grande');
  assert.match(regra[1], /flex:0 1 360px/,
    'o botão voltou a esticar para a coluna inteira');
  assert.match(regra[1], /min-height:72px/,
    'o alvo da bancada tem de continuar alto: é a altura que o dedo acerta');
  // e no celular ele continua ocupando a largura, que lá é o certo
  const base = estilo.slice(0, estilo.indexOf('@media (min-width:900px){'));
  assert.match(base, /\.au-bancada-botao\{\s*flex:1 1 200px;/,
    'a regra-base do botão mudou: no celular ele tem de ocupar a largura toda');
});

test('o estado e a ação são VIZINHOS na ordem da tela', () => {
  // quem lê "ponha a etiqueta" precisa ter o botão no campo de visão, sem
  // procurar. Numa versão anterior o botão morava no pé da tela e o olho fazia
  // mil pixels entre o que está acontecendo e o que se aperta.
  const bloco = template.slice(
    template.indexOf('<div class="au-bancada-obra">'),
    template.indexOf('<div v-if="filaAoRedor.length > 1"'),
  );
  const ordem = ['au-bancada-peca', 'au-bancada-estado', 'au-bancada-acao', 'au-bancada-progresso']
    .map((c) => bloco.indexOf(`class="${c}"`));
  assert.ok(ordem.every((i) => i > 0), 'sumiu um dos quatro blocos do painel');
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem,
    'a ordem do painel mudou: peça → estado → ação → progresso');
});

test('o ajuste de celular do painel mora no `@media` do FIM do arquivo', () => {
  // as regras-base do `.au-bancada` são escritas DEPOIS do bloco da tela
  // grande: com a mesma especificidade, quem vem por último ganha, e lá em cima
  // estes ajustes seriam ignorados em silêncio
  const celular = estilo.slice(estilo.lastIndexOf('@media (max-width:520px){'));
  assert.match(celular, /\.au-bancada\{padding-left:16px/);
  assert.ok(estilo.lastIndexOf('@media (max-width:520px){') > estilo.indexOf('.au-bancada{'),
    'o bloco do celular foi escrito ANTES das regras-base do painel');
});
