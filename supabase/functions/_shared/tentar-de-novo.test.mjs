import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decidirRepeticao,
  fraseDeDesistencia,
  PRAZO_POR_TENTATIVA_MS,
  ORCAMENTO_MS,
  TENTATIVAS_MAX,
} from './tentar-de-novo.js';

// ── O que NÃO se repete ──────────────────────────────────────────────────────

test('deu certo não se repete', () => {
  const d = decidirRepeticao({ tentativa: 1, status: 200 });
  assert.equal(d.repetir, false);
});

// O DEFEITO QUE ISTO IMPEDE: 2 dos 15 erros medidos em 18/08 eram 404 — item
// que não existe. Repetir isso três vezes faria a pessoa esperar o triplo para
// ler exatamente a mesma resposta, e gastaria cota que faz falta nos 429.
test('404 é resposta, não falha: não se repete', () => {
  const d = decidirRepeticao({ tentativa: 1, status: 404 });
  assert.equal(d.repetir, false);
  assert.match(d.motivo, /respondeu/);
});

test('403 e 400 também não se repetem', () => {
  assert.equal(decidirRepeticao({ tentativa: 1, status: 403 }).repetir, false);
  assert.equal(decidirRepeticao({ tentativa: 1, status: 400 }).repetir, false);
});

// ── O que se repete ──────────────────────────────────────────────────────────

test('429 se repete, com espera', () => {
  const d = decidirRepeticao({ tentativa: 1, status: 429 });
  assert.equal(d.repetir, true);
  assert.ok(d.esperarMs > 0);
});

test('quando o Bling diz quanto esperar, quem manda é ele', () => {
  const d = decidirRepeticao({ tentativa: 1, status: 429, retryAfterSegundos: 2 });
  assert.equal(d.repetir, true);
  assert.equal(d.esperarMs, 2000);
});

test('prazo estourado se repete — é o caso dos 8 erros de 30s', () => {
  const d = decidirRepeticao({ tentativa: 1, estourouOPrazo: true });
  assert.equal(d.repetir, true);
  assert.match(d.motivo, /não respondeu/);
});

test('erro do lado do Bling (5xx) se repete', () => {
  assert.equal(decidirRepeticao({ tentativa: 1, status: 502 }).repetir, true);
  assert.equal(decidirRepeticao({ tentativa: 1, status: 504 }).repetir, true);
});

test('sem resposta nenhuma (rede) se repete', () => {
  const d = decidirRepeticao({ tentativa: 1, status: null });
  assert.equal(d.repetir, true);
});

// ── Os freios ────────────────────────────────────────────────────────────────

test('a espera cresce entre as tentativas', () => {
  const a = decidirRepeticao({ tentativa: 1, status: 429 }).esperarMs;
  const b = decidirRepeticao({ tentativa: 2, status: 429 }).esperarMs;
  assert.ok(b > a, `esperava recuo maior na 2ª (${a} → ${b})`);
});

test('na última tentativa, para', () => {
  const d = decidirRepeticao({ tentativa: TENTATIVAS_MAX, status: 429 });
  assert.equal(d.repetir, false);
  assert.match(d.motivo, /já tentei/);
});

// O DEFEITO QUE ISTO IMPEDE: começar uma tentativa de 10s quando faltam 3s para
// a plataforma matar a chamada. Ela seria cortada no meio e a tela receberia
// NADA — e "nada" vira "não sei o que aconteceu" para quem está olhando.
test('não começa tentativa que não cabe no tempo que resta', () => {
  const quaseNoFim = ORCAMENTO_MS - PRAZO_POR_TENTATIVA_MS + 1;
  const d = decidirRepeticao({ tentativa: 1, status: 429, msDecorridos: quaseNoFim });
  assert.equal(d.repetir, false);
  assert.match(d.motivo, /não caberia/);
});

test('Retry-After longo demais não cabe, e a resposta é honesta em vez de esperar', () => {
  const d = decidirRepeticao({ tentativa: 1, status: 429, retryAfterSegundos: 60 });
  assert.equal(d.repetir, false);
  assert.match(d.motivo, /não caberia/);
});

// Roda a política do começo ao fim, como o proxy roda, e devolve quantas
// tentativas houve e quanto tempo gastou.
function rodadaInteira(custoDeCadaTentativa, falha) {
  let decorrido = 0, tentativas = 0;
  for (let t = 1; t <= TENTATIVAS_MAX + 5; t++) {   // folga: se passar disso, há laço solto
    tentativas++;
    decorrido += custoDeCadaTentativa;
    const d = decidirRepeticao({ tentativa: t, msDecorridos: decorrido, ...falha });
    if (!d.repetir) break;
    decorrido += d.esperarMs;
  }
  return { tentativas, decorrido };
}

// A rajada de 429 medida em 18/08 respondia em 762ms. Aí as três tentativas
// cabem com folga — é o caso em que repetir de fato salva a chamada.
test('falha RÁPIDA (429): as três tentativas acontecem, e sobra tempo', () => {
  const r = rodadaInteira(800, { status: 429 });
  assert.equal(r.tentativas, TENTATIVAS_MAX);
  assert.ok(r.decorrido < ORCAMENTO_MS / 2, `gastou ${r.decorrido}ms`);
});

// Quando cada tentativa queima o prazo inteiro, a trava de tempo corta a
// terceira — de propósito. Duas tentativas honestas valem mais que uma terceira
// que seria morta no meio, devolvendo NADA para a tela.
test('falha LENTA (prazo estourado): para em 2, e dentro do orçamento', () => {
  const r = rodadaInteira(PRAZO_POR_TENTATIVA_MS, { estourouOPrazo: true });
  assert.equal(r.tentativas, 2);
  assert.ok(r.decorrido <= ORCAMENTO_MS, `gastou ${r.decorrido}ms, além do orçamento`);
});

// A trava que importa de verdade: aconteça o que acontecer, a política nunca
// autoriza gastar mais do que o orçamento — senão a plataforma mata a chamada.
test('nenhum caminho passa do orçamento', () => {
  for (const custo of [0, 500, 800, 3000, 8000, PRAZO_POR_TENTATIVA_MS]) {
    for (const falha of [{ status: 429 }, { status: 500 }, { estourouOPrazo: true }, { status: null }]) {
      const r = rodadaInteira(custo, falha);
      assert.ok(r.decorrido <= ORCAMENTO_MS,
        `custo ${custo} + ${JSON.stringify(falha)} gastou ${r.decorrido}ms`);
      assert.ok(r.tentativas <= TENTATIVAS_MAX,
        `custo ${custo} + ${JSON.stringify(falha)} fez ${r.tentativas} tentativas`);
    }
  }
});

test('a frase da desistência diz o que houve e o que fazer', () => {
  const f = fraseDeDesistencia('o Bling não respondeu no prazo', 3);
  assert.match(f, /Bling/);
  assert.match(f, /3 vezes/);
  assert.match(f, /Tente de novo/);
});

// ── a política serve a QUALQUER fornecedor (19/08/2026) ─────────────────────
// Nasceu para o Bling, mas nada nela é do Bling: "404 é resposta, 429 é falha
// dele" vale igual para a API de custos da OpenAI, que em 24h devolveu 500 em 3
// de 26 chamadas do `custo-openai`. Trocar só as frases evita a gambiarra de
// copiar o arquivo — e um erro que diz "não consegui falar com o Bling" numa
// tela de custo da OpenAI manda a pessoa investigar o lugar errado.

test('o nome do fornecedor entra nas frases, e o padrão continua Bling', () => {
  const oa = decidirRepeticao({ tentativa: 1, status: 429, fornecedor: 'OpenAI' });
  assert.match(oa.motivo, /OpenAI/);
  assert.doesNotMatch(oa.motivo, /Bling/);

  // sem passar nada, nada muda para quem já usava
  const bl = decidirRepeticao({ tentativa: 1, status: 429 });
  assert.match(bl.motivo, /Bling/);

  assert.match(fraseDeDesistencia('deu ruim', 2, 'OpenAI'), /OpenAI/);
  assert.match(fraseDeDesistencia('deu ruim', 2), /Bling/);
});

test('404 continua sendo RESPOSTA, seja de quem for', () => {
  for (const forn of ['Bling', 'OpenAI', 'Anthropic']) {
    const r = decidirRepeticao({ tentativa: 1, status: 404, fornecedor: forn });
    assert.equal(r.repetir, false);
    assert.match(r.motivo, new RegExp(forn));
  }
});

test('prazo e orçamento próprios: o que cabe para um não cabe para o outro', () => {
  // mesma situação, dois orçamentos. Com o do Bling (25s) ainda cabe outra
  // tentativa aos 10s; com um orçamento apertado de 12s, não cabe — e a
  // política tem de dizer NÃO em vez de começar algo que será morto no meio.
  const folgado = decidirRepeticao({ tentativa: 1, status: 500, msDecorridos: 10000 });
  assert.equal(folgado.repetir, true);

  const apertado = decidirRepeticao({
    tentativa: 1, status: 500, msDecorridos: 10000,
    prazoPorTentativaMs: 6000, orcamentoMs: 12000,
  });
  assert.equal(apertado.repetir, false);
  assert.match(apertado.motivo, /não caberia/);
});
