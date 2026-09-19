// supabase/functions/vessel-lembretes/robo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * Este robô manda e-mail sozinho, uma vez por dia, para endereços que pessoas
 * digitaram numa página aberta. Os três jeitos de ele estragar alguma coisa
 * são os três que este arquivo guarda:
 *
 *   1. nascer sem o portão do cron — virava um endereço na internet que
 *      dispara e-mail da marca para quem quiser (foi o que aconteceu com o
 *      `auditar-dados`, ver o cabeçalho de `_shared/segredo-de-cron.ts`);
 *   2. marcar como enviado o que não saiu — a cliente nunca recebe, e ninguém
 *      descobre, porque a linha já saiu da fila;
 *   3. cravar prazo de garantia no texto (2 anos / 6 meses dependem do
 *      material da peça, que este robô não conhece).
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTE = readFileSync(join(AQUI, 'index.ts'), 'utf8');
// ⚠️ ALGUMAS GUARDAS TÊM DE OLHAR SÓ O CÓDIGO. O arquivo EXPLICA, em
// comentário, por que NÃO crava prazo de garantia — e uma guarda que procura
// "2 anos" no texto inteiro reprovaria justamente a explicação que a torna
// desnecessária. Aqui as linhas de comentário saem antes. (Só linhas inteiras
// de `//`: recortar no `//` de dentro da linha comeria `https://`.)
const SO_CODIGO = FONTE.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('⚠️ o portão do cron vem ANTES de qualquer coisa', () => {
  assert.match(FONTE, /import \{ exigirSegredoDeCron \} from '\.\.\/_shared\/segredo-de-cron\.ts'/,
    'o portão é o mesmo dos outros 12 robôs: não se escreve um novo');
  assert.match(FONTE, /const ROBO = 'vessel-lembretes'/,
    'o nome do segredo é o nome do robô, como nas irmãs');
  assert.match(FONTE, /exigirSegredoDeCron\(req,\s*ROBO\)/);

  // E é a PRIMEIRA coisa dentro do Deno.serve: qualquer leitura de banco antes
  // dele já seria trabalho feito para quem não tem a chave.
  const dentro = FONTE.slice(FONTE.indexOf('Deno.serve('));
  const portao = dentro.indexOf('exigirSegredoDeCron');
  const banco = dentro.indexOf('.rpc(');
  assert.ok(portao > -1 && (banco === -1 || portao < banco),
    'o portão tem de vir antes da primeira ida ao banco');
});

test('⚠️ marcar enviado SÓ depois de o e-mail sair', () => {
  // A ordem no texto não prova a ordem de execução, mas prova a intenção — e
  // o que se quer impedir é alguém marcar primeiro "para não esquecer".
  const posEnvio = FONTE.indexOf('mandarEmail(');
  const posMarca = FONTE.indexOf('vessel_lembrete_marcar_enviado');
  assert.ok(posEnvio > -1, 'o robô tem de mandar o e-mail pela ZeptoMail');
  assert.ok(posMarca > posEnvio, 'a marca de envio vem DEPOIS do envio');

  // E o que falhou SAI DO CAMINHO antes de chegar na marca: `if (!enviou)` +
  // `continue`. Sem essa saída, um envio recusado seria marcado como enviado e
  // a cliente nunca receberia — sem ninguém descobrir.
  assert.match(SO_CODIGO, /if \(!enviou\)[\s\S]{0,500}continue;/,
    'e-mail que falhou não pode ser marcado: ele fica para a próxima rodada');
  const saida = SO_CODIGO.indexOf('if (!enviou)');
  assert.ok(saida > -1 && saida < SO_CODIGO.indexOf('vessel_lembrete_marcar_enviado'),
    'a saída do que falhou vem ANTES da marca');
});

test('⚠️ o que falhar fica para a próxima rodada, com o motivo no log', () => {
  assert.match(FONTE, /console\.(error|warn)\(/,
    'falha calada é o pior defeito deste projeto');
  // O log não pode levar o e-mail inteiro nem o token do link.
  const logs = SO_CODIGO.match(/console\.[a-z]+\([^\n]*/g) ?? [];
  for (const l of logs) {
    assert.ok(!/\.token\b|\btoken\b/.test(l),
      `o token do link de parar não pode ir para log: ${l}`);
    assert.ok(!/\.email\b/.test(l) || /mascararEmail/.test(l),
      `o e-mail vai mascarado para o log, nunca inteiro: ${l}`);
  }
});

test('⚠️ o e-mail usa o texto compartilhado — nada de texto solto aqui', () => {
  assert.match(FONTE, /import \{[^}]*textoDoLembrete[^}]*\} from '\.\.\/_shared\/email-textos\.js'/);
  assert.match(FONTE, /import \{ mandarEmail \} from '\.\.\/_shared\/email-zeptomail\.ts'/);
});

test('⚠️ nenhum prazo de garantia cravado no robô', () => {
  // Canvas 2 anos, couro 6 meses, contados da compra. Este robô não recebe o
  // material da peça — qualquer prazo aqui seria mentira para metade delas.
  assert.doesNotMatch(SO_CODIGO.toLowerCase(), /\b2 anos\b|24 meses|dois anos|6 meses|seis meses/);
});

test('⚠️ o link do certificado e o de parar apontam para o site da marca', () => {
  assert.match(FONTE, /https:\/\/vesselbrasil\.com\.br/);
  assert.match(FONTE, /\/verify\//, 'o certificado mora em /verify/<código>');
  assert.match(FONTE, /parar-lembrete/, 'a tela de parar mora em /verify/parar-lembrete');
});

test('⚠️ o robô não inventa regra: quem escolhe as linhas é o banco', () => {
  assert.match(FONTE, /vessel_lembretes_a_enviar/);
  // Nada de contar 7 ou 30 dias aqui: a fila e os prazos moram no banco, que
  // é onde a trava vale mesmo quando alguém chama a edge por fora.
  assert.doesNotMatch(SO_CODIGO, /7\s*\*\s*24|30\s*\*\s*24|864000|2592000/,
    'o prazo mora no banco, não no JavaScript');
});

test('⚠️ o robô responde com o resumo da rodada — 200 mesmo quando nada venceu', () => {
  assert.match(FONTE, /mandados/, 'o resumo diz quantos saíram');
  assert.match(FONTE, /falharam/, 'e quantos ficaram para a próxima');
});
