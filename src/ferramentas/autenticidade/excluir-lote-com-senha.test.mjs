/* EXCLUIR LOTE: DUAS PERGUNTAS E A SENHA.
 *
 * O pedido do dono, com as palavras dele: "eu quero poder apagar lotes com
 * dupla pergunta se realmente quer fazer isso e pedir senha".
 *
 * ⚠️ O QUE A SENHA É: fricção contra quem senta num computador destravado e sai
 * clicando, e contra o próprio dono apertando "excluir" sem pensar. ELA NÃO É
 * COFRE — quem quiser chamar `vessel_excluir_lote` sem passar por aqui abre o
 * console e chama. Quem manda de verdade é o portão do banco
 * (`is_vessel_admin()` por dentro da função, mais o revoke/grant de quem pode
 * executá-la). O que estes testes seguram é a PORTA DA FRENTE.
 *
 * É pelo código-fonte porque `node --test` não compila `.vue` — mesma técnica de
 * `gravar-marca-a-peca-certa.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8');
const template = fonte.slice(0, fonte.indexOf('<script setup>'));
const script = fonte.slice(fonte.indexOf('<script setup>'), fonte.indexOf('</script>'));
/** O script SEM comentário: o comentário de `conferirASenha` cita o
 * `signInWithPassword` justamente para explicar por que ele NÃO está no código,
 * e uma busca pela palavra crua acusaria a própria explicação. */
const codigo = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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

/** A pergunta de excluir, dentro do cartão do lote. */
const pergunta = template.slice(
  template.indexOf('<div v-if="excluindo === l.id" class="au-confirma">'),
  template.indexOf('<div v-if="editando === l.id" class="au-edicao">'),
);

/* ── AS DUAS PERGUNTAS ───────────────────────────────────────────────────── */

test('são DUAS perguntas, e a segunda não é a primeira de novo', () => {
  assert.match(pergunta, /v-if="etapaDeExcluir === 1"/, 'a primeira etapa sumiu');
  assert.match(pergunta, /<template v-else>/, 'a segunda etapa sumiu');
  // duas vezes a mesma frase vira um "sim, sim" automático e o segundo clique
  // não decide nada
  const primeira = pergunta.slice(pergunta.indexOf('etapaDeExcluir === 1'), pergunta.indexOf('<template v-else>'));
  const segunda = pergunta.slice(pergunta.indexOf('<template v-else>'));
  const texto = (t) => (t.match(/class="au-confirma-texto">([^]*?)<\/p>/) || [, ''])[1].replace(/\s+/g, ' ').trim();
  assert.notEqual(texto(primeira), '', 'a primeira pergunta ficou sem texto');
  assert.notEqual(texto(segunda), '', 'a segunda pergunta ficou sem texto');
  assert.notEqual(texto(primeira), texto(segunda), 'a segunda pergunta repete a primeira');
});

test('a segunda pergunta diz o que se PERDE, com o número de peças', () => {
  const segunda = pergunta.slice(pergunta.indexOf('<template v-else>'));
  assert.match(segunda, /pecasDoLote\(l\.id\)\.length/,
    'o número tem de sair das peças de verdade, não de um texto solto');
  assert.match(segunda, /não consta/i,
    'quem encostar o celular numa etiqueta apagada lê isso — tem de estar escrito');
});

test('a primeira etapa não pede senha, e a segunda pede', () => {
  const primeira = pergunta.slice(pergunta.indexOf('etapaDeExcluir === 1'), pergunta.indexOf('<template v-else>'));
  assert.doesNotMatch(primeira, /type="password"/, 'a senha é da SEGUNDA pergunta');
  const segunda = pergunta.slice(pergunta.indexOf('<template v-else>'));
  assert.match(segunda, /v-model="senhaDaExclusao" type="password"/);
});

test('o botão da primeira etapa avança, e não exclui', () => {
  const primeira = pergunta.slice(pergunta.indexOf('etapaDeExcluir === 1'), pergunta.indexOf('<template v-else>'));
  assert.doesNotMatch(primeira, /excluirLote\(/,
    'a primeira pergunta não pode ter o botão que apaga: seriam duas perguntas de mentira');
  assert.match(primeira, /@click="etapaDeExcluir = 2"/);
});

test('a pergunta abre SEMPRE na primeira etapa, com o campo de senha limpo', () => {
  // uma pergunta que abre já na etapa 2, com a senha de antes escrita, fica a um
  // clique de apagar o lote errado
  const corpo = corpoDaFuncao('pedirExcluir').replace(/\s+/g, ' ');
  assert.match(corpo, /etapaDeExcluir\.value = 1/);
  assert.match(corpo, /senhaDaExclusao\.value = ''/);
  assert.match(corpo, /erroDaSenha\.value = ''/);
});

/* ── A SENHA ─────────────────────────────────────────────────────────────── */

test('a senha é conferida no SERVIDOR antes da primeira escrita', () => {
  const corpo = corpoDaFuncao('excluirLote').replace(/\s+/g, ' ');
  const conferir = corpo.indexOf('await conferirASenha(senha)');
  const apagar = corpo.indexOf("rpc('vessel_excluir_lote'");
  assert.notEqual(conferir, -1, 'a exclusão parou de conferir a senha');
  assert.notEqual(apagar, -1, 'a chamada que apaga sumiu');
  assert.ok(conferir < apagar, 'conferir DEPOIS de apagar não confere coisa nenhuma');
  assert.match(corpo, /if \(!conferida\.ok\) \{ erroDaSenha\.value = fraseDaSenha\(conferida\.erro\); return \}/,
    'senha errada tem de dizer isso e não executar nada');
});

test('a conferência vai pela edge, e nunca pelo signInWithPassword da tela', () => {
  // `signInWithPassword` no cliente TROCA A SESSÃO — token novo, com a pergunta
  // e o lote pela metade na tela. Foi o motivo de a edge `conferir-senha`
  // existir, e está escrito no cabeçalho dela.
  assert.match(corpoDaFuncao('conferirASenha'),
    /sbClient\.functions\.invoke\('conferir-senha', \{ body: \{ senha \} \}\)/);
  assert.doesNotMatch(codigo, /signInWithPassword/,
    'trocar a sessão no meio da pergunta derruba a própria tela que está perguntando');
});

test('a edge recusa FORA do 2xx, e o motivo real tem de ser lido do erro', () => {
  // 429 (bloqueado), 401 (sem sessão) e 400 (sem senha) chegam como `error` com
  // `data` NULO. Lendo só o `data`, "bloqueado por dez minutos" apareceria como
  // "senha incorreta" e a pessoa tentaria de novo sem parar.
  const corpo = corpoDaFuncao('conferirASenha').replace(/\s+/g, ' ');
  assert.match(corpo, /error\.context\?\.json\?\.\(\)/);
  assert.match(corpo, /detalhe\?\.erro \|\| 'falha_interna'/);
});

test('falha em conferir é senha RECUSADA, nunca concedida por acidente', () => {
  const corpo = corpoDaFuncao('conferirASenha');
  const pego = corpo.slice(corpo.indexOf('} catch'));
  assert.match(pego, /return \{ ok: false/, 'o caminho de exceção não pode devolver ok:true');
});

/* ── A SENHA NÃO SOBREVIVE À AÇÃO ────────────────────────────────────────── */

test('a senha é apagada em TODOS os caminhos, e nunca vai para o localStorage', () => {
  const corpo = corpoDaFuncao('excluirLote');
  const fim = corpo.slice(corpo.lastIndexOf('} finally {'));
  assert.match(fim, /senhaDaExclusao\.value = ''/,
    'no `finally` porque o caminho que falhou também tem de limpar');
  assert.match(corpoDaFuncao('fecharExcluir'), /senhaDaExclusao\.value = ''/,
    'cancelar tem de tirar a senha da memória junto com a pergunta');
  assert.doesNotMatch(codigo, /localStorage[^\n]*senha|senha[^\n]*localStorage/i,
    'senha em depósito do navegador fica lá depois de a pessoa fechar a aba');
});

test('abrir o editor fecha a pergunta pela porta que limpa a senha', () => {
  assert.match(corpoDaFuncao('abrirEdicao'), /fecharExcluir\(\)/,
    '`excluindo.value = null` sozinho deixaria a senha digitada viva na memória');
});

/* ── E O QUE JÁ EXISTIA CONTINUA LÁ (PADRAO-DA-CENTRAL, item 8) ──────────── */

test('a pergunta de excluir não perdeu nada do que já dizia', () => {
  const antes = [
    ['o modelo do lote', /Excluir o lote <strong>\{\{ l\.modelo \}\}<\/strong>/],
    ['a quantidade de etiquetas', /\{\{ l\.quantidade \}\} etiquetas dele\?/],
    ['o aviso de que só sai lote sem gravação', /Só dá para excluir lote em que nenhuma etiqueta foi gravada/],
    ['o botão de cancelar', /@click="fecharExcluir"/],
  ];
  const sumiram = antes.filter(([, regra]) => !regra.test(pergunta)).map(([nome]) => nome);
  assert.deepEqual(sumiram, [], 'sumiu da pergunta de excluir: ' + sumiram.join(', '));
});

test('nada de confirm() nativo, nem aqui', () => {
  assert.doesNotMatch(fonte, /\bwindow\.confirm\(|[^.\w]confirm\(/);
});
