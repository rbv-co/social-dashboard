/* O MATERIAL DO LOTE NO PAINEL — a entrega da Fase 2, tarefa 3.
 *
 * POR QUE ELA EXISTIU. Desde 18/09/2026 a garantia depende de
 * `vessel_lotes.material`: canvas dá 2 anos, couro dá 6 meses, e lote SEM
 * material deixa toda peça dele sem data de fim. Só que não havia porta nenhuma
 * para preencher esse campo — a lista do dono foi uma migration, o gatilho de
 * herança só copia de um lote irmão do mesmo SKU, e a varredura do Bling é só
 * leitura. Lote de produto NOVO ficava sem material para sempre.
 *
 * O QUE ESTE ARQUIVO PROVA:
 *   1. as contas puras de `material-do-lote.js` (sem DOM, sem rede);
 *   2. a LIGAÇÃO com a tela — pelo código-fonte, porque `node --test` não
 *      compila `.vue` (mesma técnica de `ver-as-pecas-do-lote.test.mjs`);
 *   3. que a migration da gravação existe e é a que a tela chama;
 *   4. que a folha de estilo desta tela não tem comentário sem abertura — o
 *      defeito que estava matando o `@media` de celular inteiro (ver o fim).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MATERIAIS, AVISO_SEM_MATERIAL, rotuloDoMaterial, prazoDoMaterialDoLote,
  origemDoMaterial, resumoDoMaterialDoLote, sugestaoParaATela,
  materialSugeridoParaMarcar, fraseDaRecusaDoMaterial,
} from './material-do-lote.js';
import { classificarMaterial } from './material-do-produto.js';

const fonte = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8');
const template = fonte.slice(0, fonte.indexOf('<script setup>'));
const script = fonte.slice(fonte.indexOf('<script setup>'), fonte.indexOf('</script>'));
const estilo = fonte.slice(fonte.indexOf('<style scoped>'));
const cartao = template.slice(
  template.indexOf('<div v-for="l in lotesVisiveis"'),
  template.indexOf('<!-- ── GRAVAR ──'),
);
const migration = readFileSync(
  new URL('../../../db/migrations/2026-09-19-vessel-material-do-lote-pelo-painel.sql', import.meta.url),
  'utf8');

/* ── 1. AS CONTAS PURAS ─────────────────────────────────────────────────── */

test('os dois materiais da tela são os dois que o banco aceita', () => {
  // Opção na tela que o banco recusa é campo que aceita e joga fora (PADRÃO
  // item 9). A trava da coluna é `material in ('canvas','couro')`.
  assert.deepEqual(MATERIAIS.map((m) => m.valor), ['canvas', 'couro']);
  assert.match(migration, /not in \('canvas', 'couro'\)/,
    'a função do banco tem de recusar qualquer coisa fora da lista');
});

test('cada material diz o prazo que dá', () => {
  // 2 anos e 6 meses são a decisão do dono de 18/09/2026, e é o que muda a vida
  // de quem está escolhendo: sem o prazo escrito, "canvas ou couro" é uma
  // pergunta sobre pano, não sobre garantia.
  assert.match(prazoDoMaterialDoLote('canvas'), /2 anos/);
  assert.match(prazoDoMaterialDoLote('couro'), /6 meses/);
  assert.equal(prazoDoMaterialDoLote(null), null);
  assert.equal(rotuloDoMaterial('canvas'), 'Canvas');
  assert.equal(rotuloDoMaterial('couro'), 'Couro');
  assert.equal(rotuloDoMaterial(''), null);
});

test('as quatro origens viram português, e nenhuma some', () => {
  // A lista é fechada no banco (`material_fonte_check`). Origem que a tela não
  // souber traduzir apareceria em branco, e "de onde veio" sumiria da tela.
  for (const fonteDoBanco of ['dono', 'bling_estrutura', 'painel', 'herdado']) {
    assert.ok(origemDoMaterial(fonteDoBanco), `${fonteDoBanco} ficou sem frase`);
  }
  assert.equal(origemDoMaterial('inventado'), null);
  assert.equal(origemDoMaterial(null), null);
});

test('"herdado" avisa que NINGUÉM olhou este lote', () => {
  // É a origem mais perigosa: o material veio do lote anterior do mesmo SKU.
  // Se a produção trocou de material sem trocar de referência, o erro mora
  // exatamente aí — e sem esta frase ele é invisível.
  assert.match(origemDoMaterial('herdado'), /ningu[ée]m conferiu/i);
});

test('lote sem material avisa que as peças ficam sem data de garantia', () => {
  const r = resumoDoMaterialDoLote({ material: null, material_fonte: null });
  assert.equal(r.temMaterial, false);
  assert.equal(r.rotulo, null);
  assert.equal(r.aviso, AVISO_SEM_MATERIAL);
  assert.match(AVISO_SEM_MATERIAL, /sem data de fim da garantia/i,
    'o aviso tem de dizer a CONSEQUÊNCIA, não só que falta preencher');
});

test('lote com material mostra material, prazo e de onde veio', () => {
  const r = resumoDoMaterialDoLote({ material: 'couro', material_fonte: 'herdado' });
  assert.equal(r.temMaterial, true);
  assert.equal(r.rotulo, 'Couro');
  assert.match(r.prazo, /6 meses/);
  assert.match(r.origem, /herdado/);
  assert.equal(r.aviso, '');
});

test('material gravado que a tela não conhece NÃO vira "sem material"', () => {
  // Seria a tela mentindo sobre o que está gravado. Mostra-se o valor cru, e
  // fica evidente que alguém precisa olhar.
  const r = resumoDoMaterialDoLote({ material: 'jeans', material_fonte: 'dono' });
  assert.equal(r.temMaterial, true);
  assert.equal(r.rotulo, 'jeans');
  assert.equal(r.aviso, '');
});

/* ── 2. A SUGESTÃO NÃO CHUTA ────────────────────────────────────────────── */

test('estrutura que decide vira sugestão COM a evidência', () => {
  const r = classificarMaterial({
    componentes: ['MundoCamurca - Couro - Camurca Cyrene Preta', 'Reforco Nylon 600', 'Ziper 5mm'],
  });
  const s = sugestaoParaATela(r);
  assert.equal(s.estado, 'sugerido');
  assert.equal(s.material, 'couro');
  assert.equal(s.podeUsar, true);
  assert.ok(s.evidencia.length, 'sem evidência a sugestão é um palpite de origem desconhecida');
  assert.equal(materialSugeridoParaMarcar(s), 'couro');
});

test('estrutura AMBÍGUA diz que é ambígua e não marca nada', () => {
  // A regra do dono: na dúvida, não chuta. Ambíguo é uma PERGUNTA, não uma
  // resposta com menos confiança — marcar de véspera seria chutar com aparência
  // de conferido.
  const r = classificarMaterial({
    componentes: ['Camurca Bristol Oliva', 'Napa Fly Preto Brilho'],
  });
  assert.equal(r.ambiguo, true);
  const s = sugestaoParaATela(r);
  assert.equal(s.estado, 'ambiguo');
  assert.equal(s.material, null);
  assert.equal(s.podeUsar, false, 'ambíguo não pode ganhar botão de "usar"');
  assert.equal(materialSugeridoParaMarcar(s), null, 'ambíguo não marca opção nenhuma');
  assert.match(s.frase, /voc[êe]/i, 'tem de dizer que quem escolhe é a pessoa');
});

test('sem estrutura no Bling não vira sugestão nenhuma', () => {
  const s = sugestaoParaATela({ erro: 'este produto não tem estrutura de insumos cadastrada' });
  assert.equal(s.estado, 'sem_estrutura');
  assert.equal(s.podeUsar, false);
  assert.equal(materialSugeridoParaMarcar(s), null);
  assert.match(s.frase, /estrutura de insumos/);
});

test('a recusa do banco vira frase, e motivo desconhecido aparece CRU', () => {
  assert.match(fraseDaRecusaDoMaterial('sem_permissao'), /permiss[ãa]o/);
  assert.match(fraseDaRecusaDoMaterial('lote_nao_existe'), /n[ãa]o existe/);
  assert.match(fraseDaRecusaDoMaterial('material_invalido'), /canvas ou couro/);
  // Recusa que a tela não sabe traduzir é recusa que alguém precisa VER — some
  // numa frase genérica e o defeito fica escondido por horas.
  assert.match(fraseDaRecusaDoMaterial('coisa_nova'), /coisa_nova/);
});

/* ── 3. A LIGAÇÃO COM A TELA ────────────────────────────────────────────── */

test('o cartão do lote mostra o material e de onde ele veio', () => {
  assert.match(cartao, /materialDoLote\(l\)\.rotulo/, 'o material sumiu do cartão');
  assert.match(cartao, /materialDoLote\(l\)\.origem/, 'de onde veio o material sumiu do cartão');
  assert.match(cartao, /materialDoLote\(l\)\.prazo/, 'o prazo do material sumiu do cartão');
});

test('o aviso de "sem material" só aparece no lote que não tem', () => {
  // Aviso que aparece sempre vira paisagem (PADRÃO item 9).
  assert.match(cartao, /v-if="!materialDoLote\(l\)\.temMaterial"[^>]*au-aviso-material/);
  assert.match(cartao, /\{\{ AVISO_SEM_MATERIAL \}\}/);
});

test('escolher o material fica atrás do MESMO portão de editar o lote', () => {
  // Nenhuma permissão nova, nenhum mexer em `is_vessel_admin`: quem já pode
  // mexer no lote pode escolher o material dele.
  const atras = cartao.slice(cartao.indexOf('<template v-if="podeEditar">'));
  assert.match(atras, /@click="alternarMaterial\(l\)"/,
    'o botão do material tem de estar DENTRO do `v-if="podeEditar"`');
  assert.match(script, /const podeEditar = computed\(\(\) => hasPermission\('autenticidade', 'editar'\)\)/,
    'o portão da tela mudou — o material segue ele, não uma permissão própria');
  // E NENHUMA PERMISSÃO NOVA ENTROU NA TELA: toda pergunta de crachá desta
  // ferramenta continua sendo sobre a chave `autenticidade`.
  const chaves = [...script.matchAll(/hasPermission\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(chaves)], ['autenticidade'],
    'apareceu uma chave de permissão nova nesta tela: ' + [...new Set(chaves)].join(', '));
  // e o material não ganhou uma trava própria de admin do selo na tela — quem
  // recusa é a função do banco
  const salvar = script.slice(script.indexOf('async function salvarMaterial('));
  assert.doesNotMatch(salvar.slice(0, salvar.indexOf('\n}\n')), /is_vessel_admin/);
});

test('a gravação passa pela função do banco, NUNCA por update direto', () => {
  // `vessel_lotes` não tem política de escrita: um `update` pelo cliente volta
  // 0 linhas SEM erro, e a tela anunciaria "salvo" com nada salvo.
  assert.match(script, /sbClient\.rpc\('vessel_definir_material_do_lote'/);
  assert.doesNotMatch(script, /from\('vessel_lotes'\)\s*\.\s*update/,
    'update direto em vessel_lotes volta 0 linhas sem erro');
  // e o par `error` / `data.ok` tem de ser tratado nos dois lados
  const corpo = script.slice(script.indexOf('async function salvarMaterial('));
  const ate = corpo.slice(0, corpo.indexOf('\n}'));
  assert.match(ate, /if \(error\)/, 'falha de rede/permissão tem de aparecer');
  assert.match(ate, /if \(!data\?\.ok\)/, 'recusa de regra de negócio tem de aparecer');
});

test('nada é gravado sozinho: a sugestão só PREENCHE a escolha', () => {
  const corpo = script.slice(script.indexOf('function usarSugestaoDeMaterial('));
  const ate = corpo.slice(0, corpo.indexOf('\n}'));
  assert.doesNotMatch(ate, /rpc\(/, 'usar a sugestão não pode gravar — gravar é outro clique');
  assert.match(ate, /materialEscolhido\.value = /);
  assert.match(ate, /podeUsar/, 'sugestão ambígua não pode preencher nada');
  // e o botão de "usar" só existe quando a regra tem certeza
  assert.match(cartao, /v-if="sugestaoDoMaterial\.podeUsar"/);
});

test('a evidência aparece na tela, e não só a conclusão', () => {
  assert.match(cartao, /v-for="c in sugestaoDoMaterial\.evidencia"/,
    'sem os componentes que decidiram, quem confirma não tem como discordar');
});

test('a sugestão do Bling só sai quando alguém PEDE', () => {
  // São três a quatro idas ao Bling por lote. Abrir o bloco não pode custar
  // isso, e ninguém pode ficar esperando o Bling para escolher um material que
  // está com a bolsa na mão.
  assert.match(cartao, /@click="buscarSugestaoDeMaterial\(l\)"/);
  const corpo = script.slice(script.indexOf('async function buscarSugestaoDeMaterial('));
  const ate = corpo.slice(0, corpo.indexOf('\n}\n'));
  assert.match(ate, /classificarMaterial\(/,
    'a regra é a de material-do-produto.js, a mesma do robô — nunca uma cópia');
  assert.match(ate, /catch/, 'falhar em sugerir não pode travar a escolha');
});

test('fechar o bloco limpa a sugestão do lote anterior', () => {
  // A evidência é de UM SKU. Viva entre um lote e outro, ela apontaria os
  // componentes de uma bolsa dentro do cartão de outra.
  const corpo = script.slice(script.indexOf('function fecharMaterial('));
  const ate = corpo.slice(0, corpo.indexOf('\n}'));
  assert.match(ate, /sugestaoDoMaterial\.value = null/);
  assert.match(ate, /materialEscolhido\.value = ''/);
});

test('o cartão do lote não perdeu NADA do que já mostrava', () => {
  // PADRÃO item 8, conferido item a item — o cartão ganhou duas coisas e não
  // pode ter perdido nenhuma.
  const antes = [
    ['modelo', /\{\{ l\.modelo \}\}/],
    ['progresso', /progressoDoLote\(pecasDoLote\(l\.id\)\)\.texto \}\} gravadas/],
    ['cor', /v-if="l\.cor">\{\{ l\.cor \}\}/],
    ['referência', /ref\. \{\{ l\.sku \}\}/],
    ['quantidade', /\{\{ l\.quantidade \}\} \{\{ l\.quantidade === 1 \? 'peça' : 'peças' \}\}/],
    ['data de fabricação', /\{\{ dataCurta\(l\.fabricado_em\) \}\}/],
    ['ir gravar', /@click="irGravar\(l\.id\)"/],
    ['ver as peças', /@click="alternarPecas\(l\.id\)"/],
    ['editar', /@click="abrirEdicao\(l\)"/],
    ['excluir', /@click="pedirExcluir\(l\.id\)"/],
    ['estado do lote', /marcaDoLote\(l\.id\)\.rotulo/],
  ];
  const sumiram = antes.filter(([, r]) => !r.test(cartao)).map(([n]) => n);
  assert.deepEqual(sumiram, [], 'sumiu do cartão do lote: ' + sumiram.join(', '));
});

test('abrir uma gaveta do cartão fecha as outras duas', () => {
  // Três caixas abertas uma embaixo da outra empurram o lote seguinte para fora
  // da vista no celular.
  const alternar = script.slice(script.indexOf('function alternarMaterial('));
  const ate = alternar.slice(0, alternar.indexOf('\n}'));
  assert.match(ate, /editando\.value = null/);
  assert.match(ate, /fecharExcluir\(\)/);
  assert.match(script.slice(script.indexOf('function abrirEdicao(')), /fecharMaterial\(\)/);
});

/* ── 4. A MIGRATION ─────────────────────────────────────────────────────── */

test('a migration tem o portão, a lista fechada e o revoke das irmãs', () => {
  assert.match(migration, /if not public\.is_vessel_admin\(\)/,
    'quem recusa é o banco, não a tela');
  assert.match(migration, /material_fonte = 'painel'/,
    'gravar pelo painel tem de marcar a fonte como painel');
  assert.match(migration, /revoke all on function public\.vessel_definir_material_do_lote\(uuid, text\) from anon/,
    'revogar só de `public` não fecha para `anon`');
  assert.match(migration, /grant execute on function public\.vessel_definir_material_do_lote\(uuid, text\) to authenticated/);
});

test('a ação nova entrou na lista fechada da trilha', () => {
  // `CHECK` na trilha derruba a TRANSAÇÃO INTEIRA: sem esta linha, a gravação
  // do material falharia por causa da linha de histórico.
  const lista = migration.slice(migration.indexOf('vessel_edicoes_acao_check'));
  assert.match(lista, /'material_do_lote'/);
  // e as doze que já existiam continuam lá
  for (const velha of ['desmarcar_gravada', 'lote_excluido', 'transferida_pela_dona', 'numero_trocado']) {
    assert.match(lista, new RegExp(`'${velha}'`), `${velha} sumiu da lista da trilha`);
  }
});

test('a função NÃO aceita limpar o material', () => {
  // Limpar zeraria a `garantia_ate` de toda peça já registrada do lote. Tirar a
  // data do certificado de uma cliente não pode ser efeito colateral de um
  // clique num seletor.
  assert.match(migration, /v_material is null or v_material not in/,
    'nulo tem de cair em `material_invalido`');
});

/* ── 5. A FOLHA DE ESTILO NÃO PODE TER COMENTÁRIO SEM ABERTURA ──────────── */

test('todo comentário do CSS desta tela abre antes de fechar', () => {
  /* ⚠️ ESTE TESTE NASCEU DE UM DEFEITO MEDIDO, não de zelo.
   *
   * Na `main` de 18/09/2026, o comentário que explica por que o `@media` de
   * celular fica por último estava SEM o `/*` de abertura. O navegador então
   * lia `@media` + o texto do comentário + `@media (max-width:520px)` como UMA
   * regra só, com condição inválida — e DESCARTAVA O BLOCO INTEIRO.
   *
   * Medido no Chrome pelo CSSOM: `@media not all, not all, not all` com as 19
   * regras de celular dentro, todas mortas. O teste que existia
   * (`o @media do celular é a ÚLTIMA coisa do CSS`) passava, porque ele lê o
   * TEXTO do arquivo — e o texto estava na ordem certa.
   */
  const semComentarios = estilo.replace(/\/\*[^]*?\*\//g, '');
  const orfaos = [...semComentarios.matchAll(/\*\//g)];
  assert.equal(orfaos.length, 0,
    'há um `*/` sem `/*` antes dele. O navegador engole tudo até o próximo `{` '
    + '— já matou o `@media` de celular inteiro desta tela.');
});

test('o aviso de "sem material" não desmonta a grade do computador', () => {
  /* MEDIDO a 1440px em 19/09/2026. A grade manda o cartão que tem um
     `.au-confirma` dentro ocupar a linha inteira e SUBIR para o alto
     (`order:-1`) — porque `.au-confirma` era sempre uma conversa (excluir,
     editar). O aviso de "lote sem material" reaproveita esse desenho e NÃO é
     conversa: sem o `:not`, todo lote sem material virava faixa e pulava para
     a frente, e a grade de três colunas virava pilha fora de ordem. */
  const regra = estilo.slice(estilo.indexOf('.au-grade-de-lotes > .au-card:has(.au-pecas)'));
  const ate = regra.slice(0, regra.indexOf('}') + 1);
  assert.match(ate, /:has\(\.au-confirma:not\(\.au-aviso-material\)\)/,
    'o aviso de "sem material" voltou a arrastar o cartão para a linha inteira');
  assert.match(ate, /:has\(\.au-material-edicao\)/,
    'o bloco de escolher o material É conversa: ele tem de ocupar a linha inteira');
});

test('o @media do celular continua sendo a ÚLTIMA coisa do CSS', () => {
  // O bloco novo do material entrou ANTES dele, de propósito: regra-base
  // escrita depois apagaria o ajuste de celular em silêncio.
  const ultimo = estilo.lastIndexOf('@media (max-width:520px)');
  const material = estilo.lastIndexOf('.au-material-edicao{');
  assert.ok(material !== -1, 'o bloco do material sumiu do CSS');
  assert.ok(material < ultimo, 'o CSS do material foi escrito DEPOIS do @media de celular');
});
