/* "ETIQUETA JÁ GRAVADA, SOBRESCREVER?"
 *
 * O pedido do dono: "quando for gravar uma etiqueta que já está gravada quero
 * que apareça algo como 'etiqueta já gravada, sobrescrever?'".
 *
 * Antes, a leitura de 'outra-peca' era o fim da linha: "separe ela e pegue uma
 * etiqueta em branco". Agora a tela OFERECE a sobrescrita — e é aqui que mora o
 * cuidado, porque do outro lado há duas bolsas.
 *
 * ⚠️ A REGRA QUE ESTE ARQUIVO EXISTE PARA SEGURAR: o banco primeiro, a etiqueta
 * depois. Gravando primeiro e registrando depois, uma falha na segunda metade
 * deixa a peça ANTIGA marcada como gravada com a etiqueta que acabou de ser
 * reciclada, e a NOVA sem marca nenhuma — duas bolsas com a mesma identidade.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8');
const template = fonte.slice(0, fonte.indexOf('<script setup>'));
const script = fonte.slice(fonte.indexOf('<script setup>'), fonte.indexOf('</script>'));

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

/** A pergunta, no template.
 *
 * ⚠️ AS DUAS ÂNCORAS MUDARAM EM 01/09/2026, e nenhuma linha da pergunta mudou
 * com elas. A aba Gravar virou a bancada, e a pergunta passou a ser desenhada
 * DENTRO dela, atravessando as três colunas do painel — daí a classe
 * `au-sobrescrita` ao lado de `au-confirma`, que é só a posição na grade.
 * A fileira de botões que some enquanto a pergunta está aberta também mudou de
 * nome: ela é a ação da bancada (`au-bancada-acao`), e não mais uma linha de
 * `au-acoes` solta no meio de uma coluna. */
const pergunta = (() => {
  const i = template.indexOf('<div v-if="sobrescrita" class="au-confirma au-sobrescrita">');
  assert.notEqual(i, -1, 'a pergunta de sobrescrever sumiu do template');
  return template.slice(i, template.indexOf('</section>', i));
})();

/* ── A OFERTA ────────────────────────────────────────────────────────────── */

/* ⚠️ A PERGUNTA MUDOU DE CASA em 01/09/2026, e não de conteúdo. Os DOIS caminhos
 * que gravam ao vivo — o celular encostado e o leitor de mesa — chegam nela, e
 * duas cópias divergiriam: a que ficasse para trás perguntaria sobre a bolsa
 * errada antes de apagar a identidade dela. Por isso ela mora em
 * `abrirPerguntaDeSobrescrita`, e é lá que estes testes olham agora. */

test('a leitura de outra peça passou a OFERECER, em vez de só mandar parar', () => {
  const corpo = corpoDaFuncao('gravarNaEtiqueta');
  const ramo = corpo.slice(corpo.indexOf("if (situacao === 'outra-peca')"),
    corpo.indexOf("if (situacao === 'confere')"));
  assert.match(ramo, /abrirPerguntaDeSobrescrita\(/, 'o ramo voltou a ser um beco sem saída');
  assert.match(corpoDaFuncao('abrirPerguntaDeSobrescrita'), /sobrescrita\.value = \{/);
  assert.match(ramo, /codigoDoEndereco\(antes\)/,
    'o código da peça antiga sai da própria leitura da etiqueta, não de um palpite');
  // e continua sem gravar nada por conta própria
  assert.doesNotMatch(ramo, /gravador\.gravar/,
    'a decisão é de quem está com a etiqueta na mão, não deste ramo');
  assert.match(ramo, /avisarNaTela\('falha'\)/, 'nenhuma saída de gravarNaEtiqueta fica sem sinal');
});

test('a pergunta diz QUAL BOLSA vai perder a identidade, não só o código', () => {
  // "K7M4X9QP2R" não é bolsa nenhuma; "Mônaco · Quartz · nº 7" é
  const corpo = corpoDaFuncao('abrirPerguntaDeSobrescrita').replace(/\s+/g, ' ');
  assert.match(corpo, /descricaoAntiga: descricaoDaPeca\(antiga \|\| \{ codigo: codigoAntigo \}/,
    'a descrição sai da conta pura, que já sabe montar modelo · cor · nº');
  assert.match(corpo, /descricaoNova: descricaoDaPeca\(peca, loteAtual\.value\)/);
  assert.match(pergunta, /\{\{ sobrescrita\.descricaoAntiga \}\}/);
  assert.match(pergunta, /\{\{ sobrescrita\.descricaoNova \}\}/);
});

test('a peça antiga que a tela não conhece não vira modelo inventado', () => {
  // lote excluído, ou etiqueta de outro ambiente: `descricaoDaPeca` diz que não
  // achou o lote em vez de escrever "undefined · undefined"
  const corpo = corpoDaFuncao('abrirPerguntaDeSobrescrita').replace(/\s+/g, ' ');
  assert.match(corpo, /antiga \? loteDaPeca\(antiga\.lote_id\) : null/);
});

test('a pergunta oferece OS DOIS caminhos que o dono pediu', () => {
  assert.match(pergunta, /<option value="fila">/, 'o caso normal: volta para a fila');
  assert.match(pergunta, /<option value="baixa">/, 'e a peça que não vira bolsa');
  assert.match(pergunta, /v-model="destinoDaAntiga"/);
  assert.match(script, /const destinoDaAntiga = ref\('fila'\)/,
    "nasce em 'fila' porque é o caso comum: etiqueta gravada que ficou de lado antes de costurar");
});

test('no destino baixa o motivo sai da lista que o banco aceita', () => {
  // texto livre aqui estouraria o `check` de `vessel_baixas.motivo`, e o banco
  // devolveria `motivo_invalido`
  const baixa = pergunta.slice(pergunta.indexOf(`v-if="destinoDaAntiga === 'baixa'"`));
  assert.match(baixa, /v-for="m in MOTIVOS_DE_BAIXA"/);
  assert.match(baixa, /v-model="motivoDaSobrescrita"/);
});

test('trocar de destino limpa o motivo', () => {
  // a chave 'extraviada' viraria o "motivo escrito" de uma peça que voltou para
  // a fila, e ninguém entenderia a trilha três meses depois
  const trecho = script.slice(script.indexOf('watch(destinoDaAntiga'));
  assert.match(trecho.slice(0, 120), /motivoDaSobrescrita\.value = ''/);
});

test('a tela cobra o motivo ANTES do banco, nos dois casos em que ele é obrigatório', () => {
  const corpo = corpoDaFuncao('sobrescreverEtiqueta').replace(/\s+/g, ' ');
  const cobranca = corpo.indexOf('motivoObrigatorio({ temGarantia: pedido.temGarantia, destino })');
  const chamada = corpo.indexOf("rpc('vessel_sobrescrever_etiqueta'");
  assert.notEqual(cobranca, -1, 'a tela parou de cobrar o motivo por conta própria');
  assert.ok(cobranca < chamada, 'cobrar depois de chamar o banco não adianta nada');
  // e as duas cobranças têm frases diferentes: falta de motivo de BAIXA não é a
  // mesma coisa que falta de motivo por causa da garantia de uma cliente
  assert.match(corpo, /destino === 'baixa' \? 'Escolha o motivo da baixa/);
  assert.match(corpo, /fraseDaRecusa\('motivo_obrigatorio'\)/);
});

test('a peça com garantia aparece avisada na própria pergunta', () => {
  assert.match(pergunta, /v-if="sobrescrita\.temGarantia"/);
  assert.match(pergunta, /A garantia continua valendo no código dela/);
});

/* ── O BANCO PRIMEIRO, A ETIQUETA DEPOIS ─────────────────────────────────── */

test('a gravação física só acontece DEPOIS de o banco confirmar', () => {
  const corpo = corpoDaFuncao('sobrescreverEtiqueta');
  const registro = corpo.indexOf("rpc('vessel_sobrescrever_etiqueta'");
  const recusa = corpo.indexOf('if (!data?.ok)');
  const gravacao = corpo.indexOf('await gravador.gravar(');
  assert.ok(registro !== -1 && recusa !== -1 && gravacao !== -1, 'faltou um dos três passos');
  assert.ok(registro < recusa && recusa < gravacao,
    'gravar antes de registrar deixa duas bolsas com a mesma identidade se a segunda metade falhar');
});

test('a troca inteira é UMA chamada só, e não duas da tela', () => {
  // entre "desmarcar a antiga" e "marcar a nova" haveria uma janela: rede
  // caindo, aba fechada, token expirando. O corpo de uma função plpgsql é uma
  // transação só.
  const corpo = corpoDaFuncao('sobrescreverEtiqueta');
  assert.doesNotMatch(corpo, /vessel_desmarcar_gravada|vessel_marcar_gravada|vessel_baixar_peca/,
    'a sobrescrita não se remonta com as funções soltas: ela é uma transação só');
});

test('a leitura de volta continua sendo a prova de que gravou', () => {
  const corpo = corpoDaFuncao('sobrescreverEtiqueta');
  const gravou = corpo.indexOf('await gravador.gravar(');
  const leu = corpo.indexOf('await gravador.lerUmaVez()');
  assert.ok(gravou < leu, 'marcar porque o write não deu erro é marcar no escuro');
  assert.match(corpo.slice(leu), /conferirLeitura\(depois, pedido\.codigoNovo\) !== 'confere'/);
});

test('a metade que falhou é CONTADA, com o caminho do conserto', () => {
  // a troca ficou registrada e a etiqueta não. A tela nunca mente: ela diz
  // exatamente o que sobrou e por onde se conserta (PADRAO item 9)
  const aviso = corpoDaFuncao('avisoDeMeiaSobrescrita').replace(/\s+/g, ' ');
  assert.match(aviso, /JÁ FOI REGISTRADA/);
  assert.match(aviso, /aba Etiquetas/, 'tem de dizer ONDE se conserta');
  const corpo = corpoDaFuncao('sobrescreverEtiqueta');
  // os caminhos que perdem a etiqueta depois de o banco mudar. Eram dois; com o
  // leitor de mesa são TRÊS: a leitura que não confere (celular), a falha do
  // chip (celular) e a escrita que não deu certo no leitor de mesa. Os três
  // dizem a MESMA coisa, porque o estrago é o mesmo.
  assert.equal((corpo.match(/avisoDeMeiaSobrescrita\(pedido\)/g) || []).length, 3,
    'todo caminho que perde a etiqueta depois do banco precisa do mesmo aviso');
});

test('a recarga só acontece quando o banco mudou', () => {
  // recarregando sempre, uma recusa (que não mudou nada) dispararia uma leitura
  // que pode falhar — e `carregar()` pinta a tela inteira de erro, levando junto
  // a frase da recusa que a pessoa precisa ler
  const corpo = corpoDaFuncao('sobrescreverEtiqueta');
  assert.match(corpo, /let oBancoMudou = false/);
  assert.match(corpo.slice(corpo.lastIndexOf('} finally {')), /if \(oBancoMudou\) await carregar\(\)/);
});

test('a recusa do banco vira frase, e a falha de rede diz que a etiqueta está intacta', () => {
  const corpo = corpoDaFuncao('sobrescreverEtiqueta').replace(/\s+/g, ' ');
  assert.match(corpo, /erroDaSobrescrita\.value = fraseDaRecusa\(data\?\.motivo, data\)/);
  assert.match(corpo, /NADA foi gravado na etiqueta/,
    'sem isso a pessoa não sabe se pode tentar de novo com a mesma etiqueta');
});

test('quando havia garantia, a tela avisa que ela continua valendo', () => {
  const corpo = corpoDaFuncao('sobrescreverEtiqueta').replace(/\s+/g, ' ');
  assert.match(corpo, /const eraDeCliente = data\.tinha_garantia/,
    'sai da RESPOSTA do banco: entre o clique e a escrita, uma cliente pode ter registrado');
  assert.match(corpo, /CONTINUA VALENDO/);
});

/* ── A PERGUNTA NÃO FICA FALANDO DA PEÇA ERRADA ──────────────────────────── */

test('trocar de lote e trocar a peça da vez apagam a pergunta', () => {
  const porLote = script.slice(script.indexOf('watch(loteEscolhido'));
  assert.match(porLote.slice(0, porLote.indexOf('})')), /sobrescrita\.value = null/,
    'a pergunta fala de DUAS peças pelo nome: sob um lote novo ela é do lote errado');
  const porPeca = script.slice(script.indexOf('watch(() => proxima.value?.codigo'));
  assert.match(porPeca.slice(0, porPeca.indexOf('})')), /sobrescrita\.value = null/,
    'com a peça da vez trocada por baixo, a pergunta prometeria uma e gravaria outra');
});

test('os botões normais somem enquanto a pergunta está na tela', () => {
  // "Gravar nesta etiqueta" ali do lado leria a MESMA etiqueta de novo e
  // devolveria a MESMA pergunta, e a pessoa acharia que travou
  assert.match(template, /<div v-if="!sobrescrita" class="au-bancada-acao">/);
  assert.match(pergunta, /@click="desistirDaSobrescrita"/, 'tem de dar para dizer não');
  assert.match(corpoDaFuncao('desistirDaSobrescrita'), /sobrescrita\.value = null/);
  assert.match(corpoDaFuncao('desistirDaSobrescrita'), /Não sobrescrevi nada/,
    'dizer não também é um resultado, e a tela tem de confirmar que nada aconteceu');
});

test('nada da pergunta fica clicável durante a gravação', () => {
  // trocar o destino no meio dos 8 segundos é o caminho que registra uma coisa e
  // grava outra — mesmo cuidado do seletor de lote
  for (const campo of ['destinoDaAntiga', 'motivoDaSobrescrita']) {
    const trecho = pergunta.slice(pergunta.indexOf(`v-model="${campo}"`));
    assert.match(trecho.slice(0, 120), /:disabled="gravando"/, `${campo} não trava durante a gravação`);
  }
});
