/* A PEÇA QUE SE GRAVA E A PEÇA QUE SE MARCA TÊM DE SER A MESMA.
 *
 * `gravarNaEtiqueta` escolhe a peça no começo (`const peca = proxima.value`) e
 * fica até 8 segundos com "Encoste a etiqueta…" na tela. Enquanto `marcarGravada`
 * relia `proxima.value` por conta própria, quem trocasse de lote no meio gravava
 * a etiqueta do lote A e marcava como pronta a peça do lote B — e a bolsa B saía
 * da fábrica marcada como pronta com a etiqueta EM BRANCO costurada dentro. A
 * leitura de volta não protegia nada nesse caminho: conferia A e marcava B.
 *
 * Isto se verifica no código-fonte porque `node --test` não compila `.vue`: teste
 * verde não é tela que abre, mas fonte é o que dá para ler daqui.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TELA = new URL('./tela-de-autenticidade.vue', import.meta.url).pathname;
const fonte = readFileSync(TELA, 'utf8');
const script = fonte.slice(fonte.indexOf('<script setup>'), fonte.indexOf('</script>'));
// até o <script setup>, e NÃO até o primeiro '</template>': a tela tem
// <template v-else-if> aninhados, e o primeiro fechamento é de um deles —
// cortar ali deixava a aba Gravar inteira fora da vistoria.
const template = fonte.slice(0, fonte.indexOf('<script setup>'));

/** O corpo de uma função do `<script setup>`, por contagem de chaves. */
function corpoDaFuncao(nome) {
  const abre = script.indexOf(`function ${nome}(`);
  assert.notEqual(abre, -1, `função ${nome} sumiu da tela`);
  let i = script.indexOf('{', abre);
  let nivel = 0;
  for (let j = i; j < script.length; j += 1) {
    if (script[j] === '{') nivel += 1;
    else if (script[j] === '}') { nivel -= 1; if (nivel === 0) return script.slice(i, j + 1); }
  }
  throw new Error(`não achei o fim de ${nome}`);
}

test('marcarGravada recebe o código da peça, e não relê a escolha da tela', () => {
  assert.match(
    script,
    /async function marcarGravada\(codigo = proxima\.value\?\.codigo\)/,
    'sem o parâmetro, marcarGravada volta a reler proxima.value e pode marcar outra peça',
  );
});

test('gravarNaEtiqueta marca SEMPRE a peça que ela mesma escolheu', () => {
  const corpo = corpoDaFuncao('gravarNaEtiqueta');
  const chamadas = [...corpo.matchAll(/marcarGravada\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.equal(chamadas.length, 2, 'gravarNaEtiqueta marca em dois pontos: já conferia, e depois de gravar');
  assert.deepEqual(
    chamadas, ['peca.codigo', 'peca.codigo'],
    'marcarGravada() sem argumento aqui relê proxima.value e marca a peça errada',
  );
});

/* O TESTE QUE IMPORTA: nenhum caminho chama `vessel_marcar_gravada` sem uma
 * leitura de volta que confere. É a regra inteira num teste só — e ela não
 * existia. O revisor apagou o bloco do LER DEPOIS de `gravarNaEtiqueta` inteiro
 * e os 3756 testes seguiram verdes: peça marcada como pronta com a etiqueta em
 * branco costurada dentro da bolsa, e a suíte sem piscar.
 *
 * Provado ao contrário antes de entrar: apagando o bloco do LER DEPOIS, este
 * teste fica vermelho. */
test('LER DEPOIS: entre gravar e marcar tem de haver leitura de volta que confere', () => {
  const corpo = corpoDaFuncao('gravarNaEtiqueta');
  const daGravacao = corpo.slice(corpo.indexOf('await gravador.gravar('));
  assert.notEqual(daGravacao, '', 'gravarNaEtiqueta parou de gravar a etiqueta');

  const ateMarcar = daGravacao.slice(0, daGravacao.indexOf('marcarGravada('));
  assert.notEqual(ateMarcar.length, 0, 'depois de gravar, nada marca a peça — a fila não anda');

  const leitura = ateMarcar.match(/const (\w+) = await gravador\.lerUmaVez\(/);
  assert.ok(
    leitura,
    'entre gravar e marcar não há segunda leitura da etiqueta: marcar porque o '
    + 'write não deu erro é marcar no escuro',
  );

  const semEspaco = ateMarcar.replace(/\s+/g, ' ');
  assert.match(
    semEspaco,
    new RegExp(`if \\(conferirLeitura\\(${leitura[1]}, peca\\.codigo\\) !== 'confere'\\) \\{[^}]*\\breturn\\b`),
    'a leitura de volta tem de ser COMPARADA com a peça e SAIR da função quando '
    + 'não confere; ler e seguir em frente não protege nada',
  );
});

/* A trava do NFC é PERMANENTE: etiqueta travada nunca mais se regrava. Trocar
 * este `false` por `true` queimaria etiqueta atrás de etiqueta, para sempre, e a
 * suíte inteira seguiria verde. Por isso o valor de nascimento é teste. */
test('a trava permanente da etiqueta nasce DESLIGADA', () => {
  assert.match(
    script,
    /const travarDepois = ref\(false\)/,
    'travarDepois = ref(true) trava toda etiqueta gravada, e trava não tem volta',
  );
});

/* Trocar de lote troca a peça da vez. O recado antigo — inclusive o "PARE: esta
 * etiqueta já tem OUTRA peça" — passaria a ser lido como se fosse do lote novo,
 * e a pergunta do gravador de mesa já carrega a lista de códigos contada do lote
 * anterior. */
test('trocar de lote apaga o recado e a pergunta do lote anterior', () => {
  const trecho = script.slice(script.indexOf('watch(loteEscolhido'));
  assert.notEqual(trecho, '', 'sem watch em loteEscolhido, o aviso do lote A fica sob o lote B');
  const ate = trecho.slice(0, trecho.indexOf('})') + 2).replace(/\s+/g, ' ');
  assert.match(ate, /recadoNfc\.value = ''/, 'o recado do lote anterior tem de sumir');
  assert.match(ate, /confirmacaoDoGravador\.value = null/, 'a pergunta contada no lote anterior tem de sumir');
});

test('o recado grande só diz "pronta" quando o banco confirmou', () => {
  const corpo = corpoDaFuncao('gravarNaEtiqueta');
  const semEspaco = corpo.replace(/\s+/g, ' ');
  assert.equal(
    (semEspaco.match(/recadoNfc\.value = await marcarGravada\(peca\.codigo\) \?/g) || []).length, 2,
    'os dois pontos que marcam têm de escolher o recado pelo resultado da marcação',
  );
  assert.doesNotMatch(
    semEspaco, /await marcarGravada\([^)]*\) recadoNfc\.value =/,
    'marcar e depois anunciar sem olhar o resultado é prometer o que não aconteceu',
  );
});

test('marcarGravada devolve sim ou não em todos os caminhos', () => {
  const corpo = corpoDaFuncao('marcarGravada');
  const retornos = [...corpo.matchAll(/\breturn\b([^\n]*)/g)].map((m) => m[1].trim().replace(/[;}].*$/, '').trim());
  assert.ok(retornos.length >= 4, `esperava ao menos 4 saídas, achei ${retornos.length}`);
  for (const r of retornos) {
    assert.ok(['true', 'false'].includes(r), `saída "${r || '(vazia)'}" não diz se marcou`);
  }
});

test('marcarGravada nunca é chamada sem parênteses', () => {
  // sem os parênteses o @click passaria o MouseEvent no lugar do código da peça.
  //
  // ELE SAIU DO TEMPLATE em 01/09/2026: o "✓ Gravei essa" era um dos SEIS
  // botões do mesmo peso da aba Gravar, e virou o botão principal único da
  // bancada — o mesmo botão que grava no leitor e no celular. Quem escolhe o
  // caminho é a conta pura (`acaoDaBancada`), e a tela só obedece. Então a
  // chamada mora agora em `tocarNaBancada`, e é lá que os parênteses importam.
  assert.doesNotMatch(
    template, /@click="marcarGravada"/,
    '@click="marcarGravada" entrega o evento do clique como código da peça',
  );
  const corpo = corpoDaFuncao('tocarNaBancada').replace(/\/\/[^\n]*/g, '');
  assert.match(corpo, /if \(chave === 'marcar'\) \{ marcarGravada\(\); return \}/,
    'o caminho do modo do aplicativo tem de chamar marcarGravada COM parênteses');
});

test('o seletor de lote trava enquanto grava', () => {
  assert.match(
    template, /<select v-model="loteEscolhido" :disabled="gravando">/,
    'sem travar, trocar de lote no meio da gravação escolhe outra peça',
  );
});

test('trocar para o modo do aplicativo trava enquanto grava', () => {
  // o recado (inclusive o "PARE: esta etiqueta já tem OUTRA peça") só é
  // desenhado dentro do v-if="gravaPorNfc": sair do modo no meio o apaga
  const bloco = template.slice(template.indexOf('Gravar pelo aplicativo') - 400,
    template.indexOf('Gravar pelo aplicativo'));
  assert.match(bloco, /:disabled="gravando"/);
});

test('o gravador de mesa não marca sem uma pergunta que diz o número', () => {
  assert.doesNotMatch(
    template, /@click="marcarPeloGravador"[^]{0,80}Marcar as gravadas/,
    'o botão tem de abrir a pergunta, nunca marcar direto',
  );
  assert.match(template, /@click="pedirParaMarcarPeloGravador"/);
  assert.match(
    template,
    /Marcar \{\{ confirmacaoDoGravador\.reconhecidos\.length \}\} peça\(s\) como gravadas\?/,
    'a pergunta precisa dizer QUANTAS peças serão marcadas',
  );
  assert.match(
    template, /Isso não confere etiqueta nenhuma/,
    'este é o único caminho que marca sem conferir etiqueta, e tem de dizer isso',
  );
  // e o marcar de verdade só roda a partir da resposta
  assert.match(corpoDaFuncao('marcarPeloGravador'), /const pedido = confirmacaoDoGravador\.value\s*\n\s*if \(!pedido\) return/);
});

test('nada de confirm() nativo — uiConfirm não existe neste projeto', () => {
  assert.doesNotMatch(fonte, /\bwindow\.confirm\(|[^.\w]confirm\(/);
});

/* O CAMPO QUE TIRA A PEÇA BAIXADA DA FILA É UMA STRING COMBINADA ENTRE DOIS
 * ARQUIVOS. `lotes.js` filtra a fila com `!p.baixada`, e quem preenche esse
 * campo é esta tela, ao carregar. Escrever `baixada_em`, `esta_baixada` ou
 * `baixa` do lado da tela não quebra build nem teste nenhum: a fila apenas
 * PARA DE FILTRAR, em silêncio, e a tela manda gravar a etiqueta de uma peça
 * dada como refugo — que iria costurada dentro de uma bolsa que não deveria
 * existir. Este teste amarra os dois lados no mesmo nome. */
test('a tela preenche EXATAMENTE o campo que tira a peça baixada da fila', () => {
  const regras = readFileSync(new URL('./lotes.js', import.meta.url).pathname, 'utf8');
  const filtro = regras.match(/const naFila = \(p\) => !p\.(\w+)/);
  assert.ok(filtro, 'naFila sumiu de lotes.js: sem ele a peça baixada volta para a fila');
  const campo = filtro[1];
  assert.equal(campo, 'baixada', 'o nome combinado é `baixada`, e é booleano');
  assert.match(
    corpoDaFuncao('carregar'),
    new RegExp(`\\.${campo} = Boolean\\(`),
    `carregar() tem de marcar a peça com \`${campo}\` booleano; outro nome não filtra nada`,
  );
});

/* Baixa DESFEITA é baixa que não vale mais. Lendo a tabela inteira, a peça cuja
 * baixa foi desfeita continuaria fora da fila para sempre — e o "Desfazer" da
 * tela pareceria não fazer efeito nenhum. */
test('a tela lê só as baixas ATIVAS', () => {
  assert.match(
    corpoDaFuncao('carregar'),
    /from\('vessel_baixas'\)[^\n]*\.is\('desfeita_em', null\)/,
    'sem o filtro de `desfeita_em` nula, desfazer a baixa não devolve a peça para a fila',
  );
});

/* UM `v-if` NO MEIO DE UM `v-if`/`v-else-if` PARTE A CORRENTE EM DUAS, e o Vue
 * não reclama de nada. O guia da primeira visita estava plantado entre a aba
 * Gravar e a aba Registros: a segunda metade recomeçava do zero e o `v-else`
 * dela — a aba ALERTAS inteira — era desenhada embaixo das abas Lotes e Gravar,
 * e embaixo do "Carregando…" também. Medido no navegador a 375px em 30/08, com
 * a aba Lotes escolhida e os três títulos de Alertas na tela ao mesmo tempo.
 *
 * Provado ao contrário: devolvendo o guia para o meio, os dois testes abaixo
 * ficam vermelhos. */
test('a corrente das abas não tem nada plantado no meio', () => {
  const inicio = template.indexOf("aba === 'lotes'");
  const fim = template.indexOf('── ALERTAS ──');
  assert.ok(inicio !== -1 && fim > inicio, 'a corrente das abas mudou de forma');
  const intrusos = template.slice(inicio, fim).split('\n')
    .filter((l) => /^ {4}<\w[^>]*\sv-if=/.test(l))
    .map((l) => l.trim());
  assert.deepEqual(intrusos, [], 'isto parte a corrente e desenha a aba errada junto');
});

test('o guia da primeira visita vem DEPOIS da corrente inteira', () => {
  const guia = template.indexOf('v-if="guiaAberto"');
  assert.notEqual(guia, -1, 'o guia da primeira visita sumiu da tela');
  for (const marca of ["aba === 'lotes'", "aba === 'gravar'", "aba === 'registros'", '── ALERTAS ──']) {
    assert.ok(template.indexOf(marca) < guia,
      `o bloco "${marca}" precisa vir antes do guia, senão a corrente das abas parte ali`);
  }
});

/* NENHUMA LEITURA DE `carregar()` PODE FALHAR EM SILÊNCIO, e cada uma mente de
 * um jeito diferente. A pior é a dos alertas: `resumoDeAlertas(null).limpo` dá
 * `true`, e a aba anuncia "Nada suspeito nos últimos 30 dias. Foram 0 leituras"
 * com uma bolsa extraviada sendo lida — falha virando "está tudo bem". Este
 * teste sai da PRÓPRIA lista do `Promise.all`: leitura nova entra conferida ou
 * reprova aqui. */
test('carregar() não deixa NENHUMA leitura falhar em silêncio', () => {
  const corpo = corpoDaFuncao('carregar');
  const lista = corpo.match(/const \[([^\]]+)\] = await Promise\.all/);
  assert.ok(lista, 'carregar() parou de ler tudo de uma vez');
  const nomes = lista[1].split(',').map((n) => n.trim()).filter(Boolean);
  assert.ok(nomes.length >= 5, `esperava ao menos 5 leituras, achei ${nomes.length}`);
  const semEspaco = corpo.replace(/\s+/g, ' ');
  for (const n of nomes) {
    const umPorUm = new RegExp(`if \\(${n}\\.error\\) throw`);
    const emLote = new RegExp(`for \\(const \\w+ of \\[[^\\]]*\\b${n}\\b[^\\]]*\\]\\)[^]*?\\.error\\) throw`);
    assert.ok(
      umPorUm.test(semEspaco) || emLote.test(semEspaco),
      `a leitura \`${n}\` pode falhar sem ninguém ver: lista vazia vira "não há nada"`,
    );

    /* E A OUTRA METADE DA MESMA PROMESSA. `leitura.error` só pega falha de rede
     * e de protocolo. As funções do banco deste painel respondem 200 com
     * `{ ok:false, motivo:'sem_permissao' }` quando o portão recusa: `error` vem
     * nulo, `data` vem cheio, e o `for` acima deixa passar.
     * `resumoDeAlertas({ok:false,motivo:'sem_permissao'})` não acha nenhuma das
     * três chaves e devolve `limpo: true` — a aba anunciava "Nada suspeito nos
     * últimos 30 dias" para quem simplesmente não podia ver os alertas.
     * Caminho real: quem tem a chave `autenticidade` no front e não no
     * `features[]` do banco. São dois lugares. */
    const recusaUmPorUm = new RegExp(`if \\(${n}\\.data && ${n}\\.data\\.ok === false\\) throw`);
    const recusaEmLote = new RegExp(
      `for \\(const \\w+ of \\[[^\\]]*\\b${n}\\b[^\\]]*\\]\\)[^]*?\\.data\\.ok === false\\) throw`,
    );
    assert.ok(
      recusaUmPorUm.test(semEspaco) || recusaEmLote.test(semEspaco),
      `a leitura \`${n}\` pode voltar com ok:false e ninguém ver: recusa do `
      + 'banco virando "está tudo bem" é o defeito mais caro deste projeto',
    );
  }
});

/* Dois toques rápidos disparam duas chamadas. O índice único do banco segura a
 * segunda, então o dado nunca corrompe — mas a pessoa lê "Esta peça já está
 * baixada" logo depois de baixá-la, e a tela parece contradizer o que ela acabou
 * de fazer. O `finally` é metade da trava: sem ele, uma recusa deixa a trava
 * presa e o botão nunca mais responde. */
test('baixar e desfazer não disparam duas vezes com dois toques', () => {
  for (const nome of ['baixarPeca', 'desfazerBaixa']) {
    const corpo = corpoDaFuncao(nome).replace(/\s+/g, ' ');
    assert.match(
      corpo, /if \(baixaEmVoo\.value\) return baixaEmVoo\.value = true/,
      `${nome} aceita o segundo toque antes de o primeiro voltar`,
    );
    assert.match(
      corpo, /finally \{ baixaEmVoo\.value = false \}/,
      `sem o finally, uma recusa deixa a trava de ${nome} presa para sempre`,
    );
  }
});

/* A pergunta de baixa diz o número de UMA peça. Com ela aberta, "Gravei essa"
 * continua clicável: gravando a última, `proxima` vira nulo, o bloco todo some e
 * `baixando` fica preso em `true` — depois um "Desfazer" devolve uma peça à fila
 * e o bloco voltava COM A PERGUNTA JÁ ABERTA, para a peça recém-restaurada. */
test('a pergunta de baixa não sobrevive à troca da peça da vez', () => {
  const trecho = script.slice(script.indexOf('watch(() => proxima.value?.codigo'));
  assert.notEqual(trecho, '', 'sem watch na peça da vez, a pergunta fica aberta para a peça errada');
  const ate = trecho.slice(0, trecho.indexOf('})') + 2).replace(/\s+/g, ' ');
  assert.match(ate, /baixando\.value = false/, 'trocar a peça da vez tem de fechar a pergunta');
});

/* A TELA TEM DE OFERECER EXCLUIR A PEÇA.
 *
 * `vessel_excluir_peca` foi para o ar concedida e provada, e ficou sem NENHUM
 * chamador: a tela só oferecia dar baixa. Duas consequências — o dono não tinha
 * como tirar uma peça sobrando de um lote, e a frase de recusa
 * `fraseDaRecusa('esta_gravada')` era inalcançável, ou seja, ninguém nunca ia
 * ler o conselho "dê baixa em vez de excluir". */
test('a aba Gravar oferece excluir a peça, ao lado de dar baixa', () => {
  assert.match(template, /Excluir esta peça/,
    'sem o botão, vessel_excluir_peca continua no ar sem nenhum chamador');
  assert.match(script, /rpc\('vessel_excluir_peca'/,
    'o botão precisa chamar a função do banco');
  // e a peça GRAVADA não pode aparecer com esse botão: ela pode estar dentro
  // de uma bolsa, e o caminho dela é a baixa
  assert.match(
    template,
    /v-if="!proxima\.gravada_em" class="au-link au-baixar" type="button"\s*\n?\s*@click="excluindoPeca = true"/,
    'o excluir da peça tem de sumir quando a peça já foi gravada',
  );
});

test('excluir a peça pergunta na tela antes, e a resposta é que exclui', () => {
  // a caixinha nativa do navegador é proibida neste projeto — o teste
  // "nada de confirm() nativo" já reprova a palavra escrita, inclusive em
  // comentário. Aqui se cobra a pergunta que a substitui.
  assert.match(template, /v-if="excluindoPeca" class="au-confirma"/,
    'sem a pergunta, o link excluiria a peça em um clique só');
  assert.match(template, /@click="excluirPeca\(proxima\.codigo\)"/,
    'só a resposta da pergunta chama a exclusão, e com o código da peça');
});

test('excluir a peça não dispara duas vezes com dois toques', () => {
  const corpo = corpoDaFuncao('excluirPeca').replace(/\s+/g, ' ');
  assert.match(corpo, /if \(exclusaoEmVoo\.value\) return exclusaoEmVoo\.value = true/,
    'excluirPeca aceita o segundo toque antes de o primeiro voltar');
  assert.match(corpo, /finally \{ exclusaoEmVoo\.value = false \}/,
    'sem o finally, uma recusa deixa a trava presa para sempre');
});

/* Botão desabilitado calado faz a pessoa achar que a ferramenta está quebrada —
 * é a doutrina que esta própria tela escreve nas frases de recusa. O "Desfazer"
 * das baixadas fica `:disabled` durante a chamada, e sem esta regra ele
 * continuava com a MESMA cara de clicável e sem efeito nenhum. */
test('link desabilitado parece desabilitado', () => {
  const estilo = fonte.slice(fonte.indexOf('<style scoped>'));
  assert.match(estilo, /\.au-link\[disabled\]\{/,
    'existe `:disabled` em .au-link no template e nenhuma regra de CSS para ele');
});
