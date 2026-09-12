/* VER AS PEÇAS DE UM LOTE — o buraco que o dono apontou.
 *
 * "Não consigo ver os links que já foram gravados em lotes". A tela inteira
 * mostrava UM código: o da próxima peça da fila. Depois de gravar e costurar,
 * ninguém respondia "qual link ficou na bolsa nº 7".
 *
 * As contas puras se provam em `lotes.test.mjs` (pecasEmOrdem, estadoDaPeca,
 * linhasDaListaDoLote). O que se prova AQUI é a LIGAÇÃO com a tela — e o que a
 * reorganização do cartão não pode ter derrubado. É pelo código-fonte porque
 * `node --test` não compila `.vue`, mesma técnica de
 * `gravar-marca-a-peca-certa.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8');
const template = fonte.slice(0, fonte.indexOf('<script setup>'));
const script = fonte.slice(fonte.indexOf('<script setup>'), fonte.indexOf('</script>'));
const estilo = fonte.slice(fonte.indexOf('<style scoped>'));
/** O cartão de um lote, na aba Lotes: do `v-for` até o fim do `.au-lista`. */
const cartao = template.slice(
  // `lotesVisiveis`, e não `lotes`: a aba passou a abrir nos lotes EM ANDAMENTO,
  // com os encerrados atrás do botão "Ver encerrados"
  template.indexOf('<div v-for="l in lotesVisiveis"'),
  template.indexOf("<!-- ── GRAVAR ──"),
);

test('o cartão do lote abre a lista das peças', () => {
  assert.match(cartao, /@click="alternarPecas\(l\.id\)"/,
    'sem isto o cartão volta a não ter caminho nenhum para as peças');
  assert.match(cartao, /v-if="loteAberto === l\.id" class="au-pecas"/);
});

test('cada peça mostra número, código, endereço e estado', () => {
  const lista = cartao.slice(cartao.indexOf('class="au-pecas"'));
  // A COLUNA "Nº" VIROU "Nº DE SÉRIE" em 02/09/2026. Ela não ganhou uma sétima
  // coluna ao lado: o número da peça sozinho só é único DENTRO de um lote (dois
  // lotes têm uma peça 3 cada), e o número de série é o que está impresso na
  // bolsa. Aqui o rótulo é o CURTO, porque o cabeçalho da coluna já diz o que o
  // número é.
  assert.match(lista, /\{\{ rotuloDaSerie\(pc, l, \{ curto: true \}\) \}\}/,
    'o número de série é por onde se procura a bolsa');
  assert.match(lista, /<span>Nº de série<\/span>/,
    'o cabeçalho tem de dizer que aquela coluna é o número de série');
  assert.match(lista, /\{\{ pc\.codigo \}\}/);
  assert.match(lista, /\{\{ enderecoDaTag\(pc\.codigo\) \}\}/);
  // o estado por escrito, e não só pela cor do selo: cor sozinha não é estado
  assert.match(lista, /rotuloDoMotivo\(pc\.baixa_motivo\)/, 'a baixada tem de dizer o MOTIVO');
  assert.match(lista, /Gravada em \{\{ dataCurta\(pc\.gravada_em\) \}\}/, 'a gravada tem de dizer QUANDO');
  assert.match(lista, /estadoDaPeca\(pc\)\.rotulo/);
});

test('o endereço da lista NUNCA é escrito à mão', () => {
  // ele vai gravado dentro de um chip costurado numa bolsa, onde não se
  // corrige. Domínio em dois lugares é domínio errado esperando acontecer.
  assert.doesNotMatch(template, /vesselbrasil\.com\.br/,
    'o template não escreve o domínio: ele sai de enderecoDaTag');
});

test('cada peça dá para copiar e para abrir numa aba nova', () => {
  assert.match(cartao, /@click="copiarEnderecoDaPeca\(pc\.codigo\)"/);
  assert.match(
    cartao,
    /<a class="au-link au-peca-botao" :href="enderecoDaTag\(pc\.codigo\)"\s*\n?\s*target="_blank" rel="noopener">/,
    'sem `rel="noopener"` a página aberta ganha uma alça para esta aqui',
  );
});

test('500 peças não são desenhadas de uma vez', () => {
  // um lote vai até 500. Desenhar as 500 de uma vez trava a tela do celular.
  assert.match(script, /pecasDoLoteAberto\.value\.slice\(0, quantasMostrar\.value\)/);
  assert.match(cartao, /v-for="pc in pecasVisiveis"/,
    'o v-for tem de rodar sobre a fatia, nunca sobre a lista inteira');
  // e a lista não pode esconder sem avisar: o botão diz quantas faltam
  assert.match(cartao, /faltam \{\{ pecasQueFaltamMostrar \}\}/);
});

test('abrir OUTRO lote recomeça o limite do zero', () => {
  // sem isto, o limite crescido de um lote de 500 faria o lote seguinte
  // desenhar 500 linhas de uma vez, que é o que este limite existe para evitar
  const corpo = script.slice(script.indexOf('function alternarPecas('));
  const ate = corpo.slice(0, corpo.indexOf('\n}')).replace(/\s+/g, ' ');
  assert.match(ate, /quantasMostrar\.value = DE_CADA_VEZ/);
});

/* ERAM DUAS LISTAS, E FICOU UMA (02/09/2026).
 *
 * `listaParaGravadorDeMesa` é a FILA DO QUE FALTA — tira as gravadas e as
 * baixadas — e alimentava o botão "Baixar a lista das que faltam", na gaveta da
 * aba Gravar. `linhasDaListaDoLote` CONTA A HISTÓRIA: sai com TODAS as peças,
 * para arquivar junto da ordem de produção.
 *
 * O dono perguntou se aquela gaveta ainda fazia sentido. O botão não fazia: ele
 * nasceu quando não existia programa de gravação, e hoje há três caminhos
 * melhores e uma lista em arquivo mais completa — esta segunda, que a aba Lotes
 * oferece como "Baixar a lista inteira". Duas listas para o mesmo dedo era uma
 * a mais, e a que saiu era a que sabia MENOS.
 *
 * A FUNÇÃO PURA CONTINUA EM `nfc-fila.js`, com os testes dela, e este teste
 * continua guardando a regra dela — ela é a única cópia de "a fila do que falta
 * são as não gravadas e não baixadas", e quem for apagá-la tem de apagar as
 * duas coisas de propósito, e não de passagem. */
test('a fila do que falta continua sendo só o que FALTA, mesmo sem chamador na tela', () => {
  const nfc = readFileSync(new URL('./nfc-fila.js', import.meta.url), 'utf8');
  const corpo = nfc.slice(nfc.indexOf('export function listaParaGravadorDeMesa'));
  assert.match(corpo.slice(0, corpo.indexOf('\n}')), /naFila\(p\) && !p\.gravada_em/,
    'a fila do gravador de mesa não pode passar a incluir as já gravadas');
  assert.doesNotMatch(script, /listaParaGravadorDeMesa\(/,
    'a tela voltou a chamar a fila do que falta: a lista em arquivo é a da aba Lotes, que '
    + 'sai com todas as peças');
});

test('a lista inteira do lote sai por uma função PRÓPRIA, com a data da tela', () => {
  const corpo = script.slice(script.indexOf('function baixarListaDoLote('));
  const ate = corpo.slice(0, corpo.indexOf('\n}')).replace(/\s+/g, ' ');
  assert.match(ate, /linhasDaListaDoLote\(doLote, \{ formatarData: dataCurta, sku: l\.sku \}\)/,
    'a data tem de vir do formatador da tela, que é o do fuso de São Paulo');
  assert.match(ate, /text\/csv/);
  assert.match(ate, /\\ufeff/, 'sem o BOM o Excel abre "Mônaco" como "MÃ´naco"');
});

/* PADRAO-DA-CENTRAL, ITEM 8: NADA SE PERDE AO REORGANIZAR.
 * O cartão do lote foi remexido para caber "Ver as peças". Numa reorganização
 * anterior desta base sumiram o e-mail, a data e TODAS as ações por pessoa —
 * inclusive um botão que ficou inalcançável. Esta é a lista do que o cartão
 * mostrava antes, conferida item a item. */
test('o cartão do lote não perdeu NADA do que já mostrava', () => {
  const antes = [
    ['modelo', /\{\{ l\.modelo \}\}/],
    ['progresso "N de M gravadas"', /progressoDoLote\(pecasDoLote\(l\.id\)\)\.texto \}\} gravadas/],
    ['cor', /v-if="l\.cor">\{\{ l\.cor \}\}/],
    ['referência', /ref\. \{\{ l\.sku \}\}/],
    ['quantidade', /\{\{ l\.quantidade \}\} \{\{ l\.quantidade === 1 \? 'peça' : 'peças' \}\}/],
    ['data de fabricação', /\{\{ dataCurta\(l\.fabricado_em\) \}\}/],
    ['ir gravar', /@click="irGravar\(l\.id\)"/],
    ['editar', /@click="abrirEdicao\(l\)"/],
    ['excluir', /@click="pedirExcluir\(l\.id\)"/],
    ['a pergunta de excluir', /v-if="excluindo === l\.id" class="au-confirma"/],
    ['o formulário de editar', /v-if="editando === l\.id" class="au-edicao"/],
    // o que o cartão GANHOU com o arquivamento: sem o estado escrito,
    // "encerrado" seria uma regra invisível que só se percebe quando o lote
    // some da lista
    ['o estado do lote, escrito', /marcaDoLote\(l\.id\)\.rotulo/],
  ];
  const sumiram = antes.filter(([, regra]) => !regra.test(cartao)).map(([nome]) => nome);
  assert.deepEqual(sumiram, [], 'sumiu do cartão do lote: ' + sumiram.join(', '));
});

test('editar e excluir continuam atrás de podeEditar', () => {
  assert.match(cartao, /<template v-if="podeEditar">\s*\n\s*<button class="au-link" type="button" @click="abrirEdicao\(l\)">/,
    'quem só pode ver não pode ganhar os botões de mexer');
});

/* A ORDEM DAS REGRAS DE CSS. Duas regras de mesma especificidade: ganha a
 * ÚLTIMA. Uma regra-base escrita DEPOIS do `@media` de celular apaga o ajuste
 * de celular em silêncio — sem erro, sem aviso, e só se vê no aparelho. */
test('o @media do celular é a ÚLTIMA coisa do CSS', () => {
  const ultimo = estilo.lastIndexOf('@media (max-width:520px)');
  assert.notEqual(ultimo, -1, 'o ajuste de celular sumiu do CSS');
  const depois = estilo.slice(ultimo).replace(/@media \(max-width:520px\)\{[^]*?\n\}/, '');
  assert.equal(
    depois.replace(/<\/style>/, '').trim(), '',
    'tem regra escrita DEPOIS do @media de celular: com a mesma especificidade '
    + 'ela ganha, e o recuo de celular é ignorado sem ninguém ver',
  );
});
