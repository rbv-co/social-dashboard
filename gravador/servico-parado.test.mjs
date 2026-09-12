import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traduzirCodigoDoPcsc, codigoDoPcsc } from './ponte-do-powershell.js';

/* ⚠️ O SERVIÇO DE CARTÃO INTELIGENTE DO WINDOWS PARANDO NO MEIO DO EXPEDIENTE.
 *
 * Aconteceu em 06/09/2026: tentaram resetar uma etiqueta, não resetou; tentaram
 * sobrescrever, não deu; e só depois apareceu a mensagem de que o serviço não
 * estava ativo. "Erro em cima de erro", nas palavras do dono.
 *
 * A causa: na ponte com o PowerShell, a primeira chamada de `SCardListReaders`
 * tinha o retorno DESCARTADO (`[void]`). Com o serviço parado ela falha, o
 * tamanho fica 0 e a ponte respondia OK COM LISTA VAZIA — e o programa
 * concluía "não achei nenhum leitor, confira o cabo USB e tente outra porta".
 * Conselho errado: o cabo estava bom.
 *
 * Falha não pode virar lista vazia. */

const PONTE = readFileSync(new URL('./ponte-do-powershell.js', import.meta.url), 'utf8');

test('⚠️ a primeira chamada de SCardListReaders NAO descarta o retorno', () => {
  assert.ok(!/\[void\]\[PcscPonte\]::SCardListReaders/.test(PONTE),
    'voltou o `[void]`: falha do servico vira lista vazia de novo');
  assert.match(PONTE, /\$r0 = \[PcscPonte\]::SCardListReaders/,
    'o retorno tem de ser guardado para poder ser conferido');
});

test('⚠️ codigo diferente de zero vira ERRO, e nao lista vazia', () => {
  // Sem prender a linha inteira: entre o `if` e o `Responder` passou a haver a
  // derrubada do contexto, e isso nao pode quebrar um teste que fala sobre
  // falha NAO virar lista vazia.
  const linha = PONTE.split('\n').find((l) => l.includes("$cmd -eq 'LEITORES'"));
  assert.ok(linha, 'nao achei o comando LEITORES');
  const depoisDoIf = linha.slice(linha.indexOf('if ($r0 -ne 0)'));
  assert.match(depoisDoIf.slice(0, 200), /Responder \$n 'ERRO'/,
    'sem isto o programa segue como se nao houvesse leitor');
  assert.ok(depoisDoIf.indexOf("Responder $n 'ERRO'") < depoisDoIf.indexOf("Responder $n 'OK'"),
    'a resposta de erro tem de vir ANTES da de sucesso neste ramo');
});

test('lista vazia DE VERDADE (retorno zero, tamanho zero) continua sendo lista vazia', () => {
  // Zero leitores com o servico bom e um estado legitimo — nao pode virar erro.
  assert.match(PONTE, /elseif \(\$tam -le 0\) \{ Responder \$n 'OK' ''/);
});

test('o serviço parado tem mensagem PROPRIA, e diz o que fazer', () => {
  for (const codigo of ['0x8010001D', '0x8010001E']) {
    const frase = traduzirCodigoDoPcsc(codigo);
    assert.match(frase, /Cartão Inteligente/, `${codigo} sem mensagem propria`);
    assert.match(frase, /Serviços/, `${codigo} nao diz onde religar`);
    assert.ok(!/USB|cabo|porta/i.test(frase),
      `${codigo} manda mexer no cabo — e o cabo nao e o problema`);
  }
});

test('⚠️ "nenhum leitor" e "serviço parado" NAO podem dar a mesma frase', () => {
  /* Foi essa confusao que fez a pessoa trocar de porta USB com o servico
   * parado. As duas causas pedem acoes diferentes. */
  assert.notEqual(traduzirCodigoDoPcsc('0x8010002E'), traduzirCodigoDoPcsc('0x8010001D'));
  assert.match(traduzirCodigoDoPcsc('0x8010002E'), /USB/, 'sem leitor: aí sim é cabo');
});

test('codigoDoPcsc acha o codigo no meio do texto do PowerShell', () => {
  assert.equal(codigoDoPcsc('SCardListReaders 0x8010001D'), '0X8010001D');
  assert.equal(codigoDoPcsc('sem codigo nenhum'), '');
});

// ── O CONTEXTO QUE NAO REABRIA ─────────────────────────────────────────────
/* Este e o defeito mais grave dos dois, e o que fez o conserto do lado do
 * Windows PARECER que nao funcionava: o contexto do PC/SC era aberto UMA VEZ,
 * quando o programa abria. Com o servico parando no meio do expediente, o
 * contexto morria — e a pessoa podia religar o servico que o programa continuava
 * quebrado ate ser FECHADO E ABERTO de novo. Ninguem adivinha isso. */

test('⚠️ abrir o contexto e uma FUNCAO, chamavel de novo', () => {
  assert.match(PONTE, /function AbrirContexto/,
    'sem funcao, o contexto so abre uma vez na vida do programa');
});

test('⚠️ o contexto morto e SOLTO antes de abrir outro', () => {
  // Sem soltar, cada tentativa vazaria um handle do Windows.
  assert.match(PONTE, /SCardReleaseContext\(\$script:ctx\)/);
});

test('o programa TENTA reabrir antes de responder que nao da', () => {
  assert.match(PONTE, /if \(\(-not \$ctxOk\) -and \(\$cmd -ne 'PING'\) -and \(\$cmd -ne 'SAIR'\)\) \{ AbrirContexto \}/,
    'a tentativa tem de vir ANTES da corrente de decisao, senao o comando nao segue quando a reabertura da certo');
});

test('⚠️ erro de servico DERRUBA o contexto, para o proximo comando reabrir', () => {
  /* Os tres codigos: NO_SERVICE (0x8010001D), SERVICE_STOPPED (0x8010001E) e
   * INVALID_HANDLE (0x80100003), em decimal com sinal, que e como o PowerShell
   * recebe o retorno da winscard.dll. */
  for (const codigo of ['-2146435043', '-2146435042', '-2146435069']) {
    assert.ok(PONTE.includes(codigo), `falta o codigo ${codigo} na lista que derruba o contexto`);
  }
  assert.match(PONTE, /-contains \$r0\) \{ \$script:ctxOk = \$false \}/);
});

test('PING continua respondendo sem tocar no leitor', () => {
  // Ele existe para dizer "o programa esta vivo" — se dependesse do contexto,
  // deixaria de responder justamente quando o leitor cai.
  assert.match(PONTE, /\$cmd -ne 'PING'/);
});
