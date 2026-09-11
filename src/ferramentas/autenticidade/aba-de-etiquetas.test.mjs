/* A ABA ETIQUETAS — consertar o que foi gravado errado.
 *
 * O pedido do dono: "coloque uma aba de edição de etiquetas onde eu possa
 * apagar gravações e etc...".
 *
 * As contas puras se provam em `lotes.test.mjs` (etiquetasGravadas,
 * codigosComGarantia, motivoObrigatorio, descricaoDaPeca, as frases de recusa).
 * O que se prova AQUI é a LIGAÇÃO com a tela: que a aba entrou sem partir a
 * corrente das outras, que a peça com garantia aparece marcada, que o motivo é
 * cobrado ANTES do banco, e que a senha não sobrevive à ação. É pelo
 * código-fonte porque `node --test` não compila `.vue`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8');
const template = fonte.slice(0, fonte.indexOf('<script setup>'));
const script = fonte.slice(fonte.indexOf('<script setup>'), fonte.indexOf('</script>'));
const estilo = fonte.slice(fonte.indexOf('<style scoped>'));

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

/** O bloco inteiro da aba, do `v-else-if` dela até o da aba seguinte. */
const aba = template.slice(
  template.indexOf(`<template v-else-if="aba === 'etiquetas'">`),
  template.indexOf(`<template v-else-if="aba === 'registros'">`),
);

/* ── A ABA ENTROU SEM PARTIR A CORRENTE ──────────────────────────────────── */

test('a aba existe, e na ordem do caminho', () => {
  const lista = script.slice(script.indexOf('const ABAS = ['), script.indexOf(']', script.indexOf('const ABAS = [')));
  const chaves = [...lista.matchAll(/chave: '([\w-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(chaves, ['lotes', 'gravar', 'etiquetas', 'cartoes', 'registros', 'alertas'],
    'Etiquetas é o desfazer de Gravar: ela vem logo depois. Cartões EAN vem em '
    + 'seguida porque o número de série tem de estar resolvido antes de virar papel');
});

/* `v-else-if` GRUDA NO `v-if` ANTERIOR. Um `v-if` solto no meio parte a corrente
 * em duas, e o `v-else` do fim — a aba Alertas inteira — passa a ser desenhado
 * embaixo das outras abas. Já aconteceu nesta tela, medido a 375px em 30/08. */
test('a corrente das abas continua inteira, do carregando ao v-else final', () => {
  const corrente = [...template.matchAll(/v-(if="carregando"|else-if="falha"|else-if="aba === '\w+'")/g)]
    .map((m) => m[1]);
  assert.deepEqual(corrente, [
    'if="carregando"',
    'else-if="falha"',
    "else-if=\"aba === 'lotes'\"",
    "else-if=\"aba === 'gravar'\"",
    "else-if=\"aba === 'etiquetas'\"",
    "else-if=\"aba === 'cartoes'\"",
    "else-if=\"aba === 'registros'\"",
  ], 'a aba nova tem de ser um `v-else-if` entre Gravar e Registros, na mesma corrente');
  // e a aba Alertas continua sendo o `v-else` que fecha a corrente
  const alertas = template.indexOf('<!-- ── ALERTAS');
  assert.notEqual(alertas, -1, 'o bloco da aba Alertas sumiu');
  assert.match(template.slice(alertas, alertas + 260), /<template v-else>/,
    'a aba Alertas tem de continuar sendo o `v-else` logo depois de Registros');
});

/* ── A LISTA ─────────────────────────────────────────────────────────────── */

test('a lista traz só as JÁ GRAVADAS, e dá para filtrar por lote', () => {
  assert.match(script, /etiquetasGravadas\(pecas\.value, loteDaEtiqueta\.value \|\| null\)/,
    'a lista sai do recorte puro, não de um filtro reescrito na tela');
  assert.match(aba, /v-model="loteDaEtiqueta"/);
  assert.match(aba, /<option value="">Todos os lotes<\/option>/,
    'sem a opção de todos, não dá para achar a peça de quem não lembra o lote');
});

test('cada linha diz QUAL BOLSA é, não só o código', () => {
  // "K7M4X9QP2R" não é bolsa nenhuma; "Mônaco · Quartz · nº 7" é
  assert.match(aba, /descricaoDaPeca\(pc, loteDaPeca\(pc\.lote_id\)\)/);
  assert.match(aba, /Gravada em \{\{ dataCurta\(pc\.gravada_em\) \}\}/, 'tem de dizer QUANDO');
  assert.match(aba, /enderecoDaTag\(pc\.codigo\)/,
    'o endereço é o que está DENTRO da etiqueta: sem ele ninguém confere o que vai apagar');
  assert.match(aba, /estadoDaPeca\(pc\)\.selo/);
});

test('a peça com garantia de cliente aparece MARCADA na lista', () => {
  // sem isto, quem vai apagar a gravação não tem como saber que do outro lado
  // há uma cliente com uma bolsa na mão
  assert.match(aba, /v-if="temGarantia\(pc\.codigo\)"[^]{0,120}Garantia de cliente/);
  assert.match(script, /codigosComGarantia\(registros\.value\)/,
    'a garantia sai de vessel_registros, que a tela já lê — não é leitura nova');
});

test('a lista não desenha 500 linhas de uma vez, e diz quantas faltam', () => {
  assert.match(script, /etiquetasFiltradas\.value\.slice\(0, quantasEtiquetas\.value\)/);
  /* ⚠️ A GARANTIA MUDOU DE LUGAR, mas continua sendo a mesma. Em 04/09/2026 a
   * lista virou ÁRVORE (lote fora, etiquetas dentro), e o `v-for` das linhas
   * passou a rodar sobre `g.etiquetas`. A fatia paginada não sumiu: ela é o que
   * entra no agrupamento, uma camada acima. Se alguém agrupar
   * `etiquetasFiltradas` em vez de `etiquetasVisiveis`, a árvore desenha as 500
   * linhas de uma vez e o botão "faltam N" passa a mentir — por isso a
   * asserção segue o dado até onde ele agora mora, em vez de ser apagada. */
  assert.match(script, /agruparPorLote\(etiquetasVisiveis\.value/,
    'a árvore tem de ser montada sobre a FATIA, nunca sobre a lista inteira');
  assert.match(aba, /v-for="pc in g\.etiquetas"/, 'o v-for das linhas roda dentro do grupo');
  assert.match(aba, /v-for="g in gruposDeEtiquetas"/, 'o v-for de fora roda sobre os grupos');
  assert.match(aba, /faltam \{\{ etiquetasQueFaltamMostrar \}\}/,
    'lista que esconde sem avisar é lista que mente');
});

test('trocar de lote recomeça a lista e fecha a pergunta aberta', () => {
  const trecho = script.slice(script.indexOf('watch(loteDaEtiqueta'));
  const ate = trecho.slice(0, trecho.indexOf('})') + 2).replace(/\s+/g, ' ');
  assert.match(ate, /quantasEtiquetas\.value = DE_CADA_VEZ/,
    'o limite crescido de um lote de 500 faria o lote seguinte desenhar 500 linhas');
  assert.match(ate, /fecharApagar\(\)/,
    'a pergunta diz o código de UMA peça: peça errada na pergunta é pior que pergunta nenhuma');
});

test('quem só pode ver não ganha o botão que apaga', () => {
  assert.match(aba, /v-if="podeEditar && apagando\?\.codigo !== pc\.codigo"/);
});

/* ── DUAS PERGUNTAS, O MOTIVO E A SENHA ──────────────────────────────────── */

test('são duas perguntas, e a segunda não repete a primeira', () => {
  assert.match(aba, /v-if="etapaDeApagar === 1"/);
  assert.match(aba, /<template v-else>/);
  /* ⚠️ AS DUAS PERGUNTAS SE ACHAM PELO BLOCO DELAS, e não por contagem.
   * Este teste lia `textos[1]` e `textos[2]` da aba inteira, contando com o
   * aviso da garantia ser o de índice 0. Em 02/09/2026 chegou aqui uma terceira
   * caixa de `au-confirma-texto` — a de "marcar várias de uma vez pelo gravador
   * de mesa", que veio da aba Gravar — e a contagem passou a apontar para a
   * pergunta errada. Contagem de irmãos quebra toda vez que um irmão nasce. */
  const apagar = aba.slice(aba.indexOf('v-if="apagando?.codigo === pc.codigo"'));
  assert.ok(apagar, 'sumiu o bloco das duas perguntas de apagar a gravação');
  const textos = [...apagar.matchAll(/class="au-confirma-texto">([^]*?)<\/p>/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim());
  assert.ok(textos.length >= 2, 'faltou uma das perguntas');
  assert.notEqual(textos[0], textos[1], 'a segunda pergunta repete a primeira');
  assert.match(textos[1], /continua costurada dentro de uma bolsa/,
    'a segunda pergunta tem de dizer o que sobra no mundo depois de apagar');
});

test('o botão da primeira etapa avança, e não apaga', () => {
  /* ⚠️ O RECORTE ANCORA NO BLOCO DE APAGAR, e não na aba inteira — mesma lição
   * do teste logo acima, agora custando de novo. Ele procurava o PRIMEIRO
   * `<template v-else>` da aba; em 04/09/2026 nasceu acima dele o bloco de ler
   * qualquer etiqueta, com um `v-else` próprio, e o recorte passou a terminar
   * ANTES de começar — virando texto vazio, que casa com qualquer coisa e não
   * guarda nada. Marco de aba inteira quebra toda vez que um bloco nasce em
   * cima. */
  const bloco = aba.slice(aba.indexOf('v-if="apagando?.codigo === pc.codigo"'));
  const primeira = bloco.slice(bloco.indexOf('etapaDeApagar === 1'), bloco.indexOf('<template v-else>'));
  assert.ok(primeira, 'o recorte da primeira etapa veio vazio: o marco mudou de lugar');
  assert.doesNotMatch(primeira, /apagarGravacao/,
    'seriam duas perguntas de mentira: a primeira já apagaria');
  assert.match(primeira, /@click="etapaDeApagar = 2"/);
});

test('a TELA cobra o motivo antes do banco, quando há garantia', () => {
  // o banco recusa com `motivo_obrigatorio` — mas aí a pessoa já apertou o
  // botão, digitou a senha e esperou a rede para descobrir que faltava um campo
  // que estava na tela o tempo todo
  const corpo = corpoDaFuncao('apagarGravacao').replace(/\s+/g, ' ');
  const cobranca = corpo.indexOf('motivoObrigatorio({ temGarantia: alvo.temGarantia }) && !motivo');
  const chamada = corpo.indexOf("rpc('vessel_desmarcar_gravada'");
  assert.notEqual(cobranca, -1, 'a tela parou de cobrar o motivo por conta própria');
  assert.ok(cobranca < chamada, 'cobrar o motivo DEPOIS de chamar o banco não adianta nada');
  assert.match(corpo, /erroDeApagar\.value = fraseDaRecusa\('motivo_obrigatorio'\)/);
  // e a tela diz na hora que aquele campo é obrigatório, sem esperar o erro
  assert.match(aba, /motivoEhObrigatorio \? '' : ' \(opcional\)'/);
  assert.match(aba, /Esta peça tem garantia registrada por uma cliente/);
});

test('a senha é conferida no servidor ANTES de apagar', () => {
  const corpo = corpoDaFuncao('apagarGravacao').replace(/\s+/g, ' ');
  const conferir = corpo.indexOf('await conferirASenha(senha)');
  const apagar = corpo.indexOf("rpc('vessel_desmarcar_gravada'");
  assert.notEqual(conferir, -1, 'a aba parou de conferir a senha');
  assert.ok(conferir < apagar, 'conferir depois de apagar não confere coisa nenhuma');
  assert.match(aba, /v-model="senhaDeApagar" type="password"/);
});

test('a senha desta aba também não sobrevive à ação', () => {
  const corpo = corpoDaFuncao('apagarGravacao');
  assert.match(corpo.slice(corpo.lastIndexOf('} finally {')), /senhaDeApagar\.value = ''/);
  assert.match(corpoDaFuncao('fecharApagar'), /senhaDeApagar\.value = ''/);
  assert.match(corpoDaFuncao('pedirApagarGravacao'), /senhaDeApagar\.value = ''/);
});

test('a peça da pergunta é CONTADA no clique, não relida no fim', () => {
  // com a lista recarregando por baixo, reler a peça lá no fim faria a pergunta
  // falar de uma e apagar outra
  assert.match(corpoDaFuncao('pedirApagarGravacao'), /codigo: pc\.codigo/);
  assert.match(corpoDaFuncao('apagarGravacao'), /const alvo = apagando\.value/);
});

test('o motivo em branco vai NULO, e não string vazia', () => {
  // é o que o banco entende por "não escreveram motivo" (`nullif(trim(...), '')`)
  assert.match(corpoDaFuncao('apagarGravacao').replace(/\s+/g, ' '),
    /p_codigo: alvo\.codigo, p_motivo: motivo \|\| null/);
});

/* ── O AVISO DA GARANTIA ─────────────────────────────────────────────────── */

test('quando o banco diz que tinha garantia, a tela AVISA — e o aviso fica', () => {
  const corpo = corpoDaFuncao('apagarGravacao').replace(/\s+/g, ' ');
  assert.match(corpo, /const eraDeCliente = data\.tinha_garantia/,
    'quem sabe a verdade no instante da escrita é quem escreveu: o aviso sai da RESPOSTA');
  assert.match(corpo, /avisoDaGarantia\.value = /);
  assert.match(corpo, /CONTINUA VALENDO/,
    'a garantia da cliente continua valendo, e é isso que precisa estar escrito');
  assert.match(aba, /v-if="avisoDaGarantia"/, 'o aviso tem de ir para a tela, não só para o recado que some');
  assert.match(aba, /@click="avisoDaGarantia = ''"/, 'e tem de dar para dispensar');
});

test('o aviso só aparece quando há o que dizer', () => {
  // aviso que aparece sempre vira paisagem (PADRAO item 9)
  assert.match(script, /const avisoDaGarantia = ref\(''\)/);
});

test('a recusa do banco fica DENTRO da pergunta, onde a pessoa está olhando', () => {
  const corpo = corpoDaFuncao('apagarGravacao').replace(/\s+/g, ' ');
  assert.match(corpo, /if \(!data\?\.ok\) \{ erroDeApagar\.value = fraseDaRecusa\(data\?\.motivo, data\); return \}/);
});

/* ── O CSS NÃO PODE TER SIDO QUEBRADO ────────────────────────────────────── */

test('o @media do celular continua sendo a ÚLTIMA coisa do CSS', () => {
  // duas regras de mesma especificidade: ganha a última. Uma regra-base escrita
  // DEPOIS do @media apaga o ajuste de celular em silêncio
  const ultimo = estilo.lastIndexOf('@media (max-width:520px)');
  assert.notEqual(ultimo, -1, 'o ajuste de celular sumiu do CSS');
  const depois = estilo.slice(ultimo).replace(/@media \(max-width:520px\)\{[^]*?\n\}/, '');
  assert.equal(depois.replace(/<\/style>/, '').trim(), '',
    'tem regra escrita DEPOIS do @media de celular');
});

test('todo botão desta tela nasce com 40px de alvo', () => {
  // a regra estava repetida em quatro blocos, e cada bloco novo precisava
  // lembrar de repetir. O de agora não lembrou: o "Entendi" do aviso e o
  // "Mostrar mais" da aba nasceram com 37px, medidos a 375px.
  const base = estilo.match(/\n\.au-botao\{([^}]*)\}/);
  assert.ok(base, 'a regra-base do botão sumiu');
  assert.match(base[1], /min-height:40px/);
  assert.match(base[1], /box-sizing:border-box/, 'sem isto o padding soma por fora e a conta muda');
});

/* ── A BARRA DE ABAS É A DA CASA ────────────────────────────────────────────
 * ⚠️ ESTE BLOCO ESTÁ AO CONTRÁRIO DO QUE ESTAVA EM 30/08, E É DE PROPÓSITO.
 *
 * Antes ele exigia os overrides de uma barra PRÓPRIA (`.abas-barra` com fundo e
 * moldura, `flex-wrap:nowrap`, `overflow-x:auto`, `justify-content:flex-start`,
 * `border-bottom:0`, `margin-bottom:0`). O dono abriu a tela e viu na hora que
 * ela tinha ficado diferente da Frota, do Patrimônio e dos Acessos.
 *
 * O `nowrap` era a origem de todo o resto: ele fazia a fileira transbordar, e o
 * transbordo é que exigia desligar a centralização e pôr a rolagem. A `.abas`
 * global QUEBRA em duas linhas no celular — não transborda, não rola, não
 * esconde a primeira aba —, e é assim que as três telas irmãs se comportam.
 *
 * Agora o teste guarda o contrário: regra local de `.abas` nesta tela é o
 * caminho de volta para aquele defeito. */

test('a tela NÃO reescreve a barra de abas: ela usa a `.abas` global', () => {
  // a REGRA, e não a palavra: o comentário logo acima dela conta a história da
  // barra própria de propósito, para o próximo não a reinventar
  assert.doesNotMatch(estilo, /\n\s*\.abas-barra\s*\{/,
    'a barra própria voltou — esta tela tem de usar a `.abas` da casa, como Frota e Patrimônio');
  const proprias = [...estilo.matchAll(/(^|\n)\s*(\.abas[^{,\n]*)\{/g)].map((m) => m[2].trim());
  assert.deepEqual(proprias, [],
    `regra local de .abas nesta tela: ${proprias.join(', ')} — a barra é a global, e override local `
    + 'é o que deixou esta tela diferente das irmãs');
});

test('a barra é a global, com botões simples e a classe `on` na ativa', () => {
  // MUDOU EM 01/09/2026: a barra tinha um `v-if="!naBancada"` — ela sumia
  // enquanto se gravava de pé, porque a aba Gravar entrava num "modo bancada"
  // que tomava a tela. Esse modo era um remendo, e o dono reclamou da aba quatro
  // vezes: agora a aba Gravar JÁ É a bancada, não há modo para entrar nem para
  // sair, e a barra não tem mais por que sumir. Ela volta a ser exatamente o que
  // as telas irmãs têm: `<div class="abas" role="tablist">`, sem condição
  // nenhuma e sem uma regra local de CSS.
  assert.match(template, /<div class="abas" role="tablist">/,
    'a barra global é `<div class="abas" role="tablist">`, como na Frota');
  assert.doesNotMatch(template, /class="abas"[^>]*v-if|v-if=[^>]*class="abas"/,
    'a barra de abas voltou a sumir em alguma condição — ela é a mesma das irmãs, sempre');
  assert.match(template, /:class="\{ on: aba === ab\.chave \}"/,
    'a ativa se marca com a classe `on`, que é o que a `.abas` global pinta');
  // o `aria-selected` é melhoria de verdade e não muda a aparência: o
  // sublinhado da global também é cor, e cor sozinha some para quem não a vê
  assert.match(template, /:aria-selected="String\(aba === ab\.chave\)"/);
});

test('a barra mostra a SEQUÊNCIA: quatro passos numerados e duas consultas', () => {
  const lista = script.slice(script.indexOf('const ABAS = ['), script.indexOf('\n]', script.indexOf('const ABAS = [')));
  const numerados = [...lista.matchAll(/chave: '(\w+)', n: (\d)/g)].map((m) => [m[1], Number(m[2])]);
  assert.deepEqual(numerados, [['lotes', 1], ['gravar', 2], ['etiquetas', 3], ['cartoes', 4]],
    'os quatro primeiros são passos, na ordem em que se faz');
  assert.doesNotMatch(lista.slice(lista.indexOf("chave: 'registros'")), / n: /,
    'Garantias e Alertas não são passos: numerá-los mentiria sobre o fluxo');
  assert.match(lista, /chave: 'registros', rotulo: 'Garantias'/,
    'a lista das garantias das clientes se chama Garantias na tela');
  assert.match(lista, /separaAntes: true/, 'falta o separador entre os passos e as consultas');
  assert.match(template, /<span v-if="ab\.separaAntes" class="au-abas-sep" aria-hidden="true">/,
    'o separador é visual: sai da árvore de acessibilidade');
});

test('o número da aba não vira ruído no leitor de tela', () => {
  // ouvir "um lotes" não ajuda ninguém: o número é `aria-hidden` e volta
  // escrito por extenso no `aria-label`
  assert.match(template, /<span v-if="ab\.n" class="au-aba-n" aria-hidden="true">/);
  assert.match(template, /:aria-label="ab\.leitura"/);
  assert.match(script, /leitura: 'Passo 1: Lotes'/);
});

test('o que a tela acrescenta à barra global não mexe no desenho dela', () => {
  // altura, peso de fonte e sublinhado têm de continuar iguais aos da Frota
  const acrescentado = [...estilo.matchAll(/\n(\.au-abas?-\w+)\{([^}]*)\}/g)];
  assert.ok(acrescentado.length >= 2, 'sumiram as regras do número e do separador');
  for (const [, seletor, corpo] of acrescentado) {
    assert.doesNotMatch(corpo, /min-height|font-weight|border-bottom|text-transform|letter-spacing/,
      `${seletor} mexe no desenho da barra global — é o que deixaria esta tela diferente das irmãs`);
  }
});

test('o botão secundário das perguntas não reprova no tema escuro', () => {
  // com `--accent` puro sobre o fundo da caixa de aviso ele mede 4,46 no
  // escuro — reprova por pouco, e "por pouco" continua sendo reprovado.
  // Medido com o CSS do build: 4,46 → 6,02 no escuro e 5,87 → 7,91 no claro.
  assert.match(estilo, /\.au-confirma \.au-botao\.secundario\{color:var\(--accent-forte\)\}/);
});

/* ── MARCAR VÁRIAS DE UMA VEZ, PELO GRAVADOR DE MESA ─────────────────────────
 *
 * ⚠️ ISTO CHEGOU AQUI EM 02/09/2026, VINDO DA ABA GRAVAR, e o PADRÃO item 8
 * manda dizer onde cada coisa foi parar. O dono perguntou se a gaveta "Gravador
 * de mesa" da bancada ainda fazia sentido; a resposta foi que METADE não fazia:
 *
 *   · o botão "Baixar a lista das que faltam" SAIU DA FERRAMENTA — nasceu
 *     quando não existia programa de gravação, e hoje a lista em arquivo existe
 *     mais completa na aba Lotes ("Baixar a lista inteira", em CSV, com todas as
 *     peças). Quem guarda esse endereço é `modo-bancada.test.mjs`;
 *   · o CAMPO DE COLAR O RETORNO ficou, e é o que estes testes guardam. Ele
 *     marca cinquenta peças de uma vez a partir de um log, e sem o programa
 *     instalado é o único jeito de fazer isso sem cinquenta cliques. Não é
 *     redundante com caminho nenhum.
 *
 * POR QUE AQUI, e não na bancada: lá se grava UMA peça por vez, com a etiqueta
 * na mão. Colar um log é conserto EM BLOCO — que é o assunto desta aba, a mesma
 * que apaga uma gravação. As duas são a mesma decisão em direções opostas. */

test('o campo de colar o retorno do gravador mora nesta aba, e numa gaveta fechada', () => {
  assert.match(aba, /<details class="au-mais au-marcar-bloco">/,
    'sumiu a gaveta de marcar em bloco — sem ela, marcar cinquenta peças volta a ser '
    + 'cinquenta cliques');
  assert.match(aba, /v-model="textoDoGravador"[^]{0,200}class="au-colar"/,
    'sumiu o campo de colar o que o gravador de mesa devolveu');
  assert.match(aba, /@click="pedirParaMarcarPeloGravador"/,
    'o botão tem de abrir a pergunta, nunca marcar direto');
  // ela nasce FECHADA: é ação rara, e ação rara não ocupa espaço de tela para
  // sempre. `<details>` sem `open` é fechado.
  assert.doesNotMatch(aba, /<details class="au-mais au-marcar-bloco"[^>]*\bopen\b/,
    'a gaveta de marcar em bloco nasce aberta: ela é rara e destrutiva à sua maneira');
});

test('e ele saiu MESMO da aba Gravar — não ficou uma cópia nas duas', () => {
  // duas cópias do mesmo bloco divergem, e a que ficar para trás passa a marcar
  // peça por uma regra que a outra já não usa
  const gravar = template.slice(
    template.indexOf(`<template v-else-if="aba === 'gravar'">`),
    template.indexOf(`<template v-else-if="aba === 'etiquetas'">`),
  ).replace(/<!--[^]*?-->/g, '');
  assert.doesNotMatch(gravar, /textoDoGravador|class="au-colar"|pedirParaMarcarPeloGravador/,
    'o campo de colar continua na bancada: ou ele mudou de casa, ou ficou nas duas');
});

test('o recorte da marcação em bloco sai do seletor de lote desta aba', () => {
  // GANHO DA MUDANÇA: na bancada ele só conferia contra o lote da bancada. Aqui
  // o seletor abre em "Todos os lotes", e quem colou o log de duas fornadas
  // juntas não precisa mais colar duas vezes.
  const i = script.indexOf('const pecasDeMarcarEmBloco = computed(');
  assert.notEqual(i, -1, 'sumiu o recorte da marcação em bloco');
  const corpo = script.slice(i, script.indexOf('\n//', i)).replace(/\s+/g, ' ');
  assert.match(corpo, /loteDaEtiqueta\.value \? pecasDoLote\(loteDaEtiqueta\.value\) : pecas\.value/,
    'o recorte tem de seguir o seletor desta aba, e cair em TODAS as peças quando não há lote');
  assert.match(corpoDaFuncao('pedirParaMarcarPeloGravador'),
    /codigosNoTextoDoGravador\(\s*textoDoGravador\.value, pecasDeMarcarEmBloco\.value\)/,
    'a conferência tem de usar o recorte desta aba, e não o lote da bancada');
});

test('a tela diz contra o que está conferindo ANTES de a pessoa apertar', () => {
  // e não só depois, no aviso: marcar peça sem conferir etiqueta nenhuma é o
  // caminho mais perigoso desta ferramenta (PADRAO item 9 — a tela nunca mente)
  assert.match(aba, /\{\{ escopoDeMarcarEmBloco \}\}/);
  const i = script.indexOf('const escopoDeMarcarEmBloco = computed(');
  assert.notEqual(i, -1, 'sumiu a frase que diz o recorte');
  const corpo = script.slice(i, script.indexOf('))', i)).replace(/\s+/g, ' ');
  assert.match(corpo, /deste lote/);
  assert.match(corpo, /de todos os lotes/);
  assert.match(aba, /Isso não confere etiqueta nenhuma/,
    'este é o único caminho que marca sem conferir etiqueta, e tem de dizer isso');
});

test('o aviso dos ignorados diz coisa diferente em cada recorte', () => {
  // com um lote escolhido, código ignorado é de OUTRO lote (arquivo errado);
  // com "Todos os lotes", ele não é de peça nenhuma. Uma frase só para os dois
  // mandaria a pessoa procurar o defeito no lugar errado.
  const corpo = corpoDaFuncao('marcarPeloGravador').replace(/\s+/g, ' ');
  assert.match(corpo, /de OUTRO lote foram ignorados/);
  assert.match(corpo, /não constam em peça nenhuma e foram ignorados/);
});
