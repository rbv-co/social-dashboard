import { test } from 'node:test';
import assert from 'node:assert/strict';
import { custoDaExecucao, ehModeloAnthropic } from './custo-da-execucao.mjs';

test('valor informado à mão sempre vence', () => {
  assert.equal(custoDaExecucao({ usd: 1.23, modelo: 'claude-opus-4-8' }), 1.23);
  assert.equal(custoDaExecucao({ usd: 0, modelo: 'gpt-image-2' }), 0);
});

test('modelo da Anthropic: calcula pelos tokens', () => {
  const v = custoDaExecucao({ modelo: 'claude-opus-4-8', inputTokens: 1e6, outputTokens: 0 });
  assert.equal(v, 5);
  assert.equal(custoDaExecucao({ modelo: 'claude-sonnet-4-6', inputTokens: 1e6, outputTokens: 0 }), 3);
});

// O DEFEITO QUE ISTO CONSERTA: o código antigo devolvia 0 para qualquer coisa
// sem modelo da Anthropic. Foi assim que 473 criativos gerados com gpt-image-2
// — API PAGA da OpenAI — ficaram gravados como US$ 0,00, e a tela passou a
// AFIRMAR que criar imagem custa R$ 0.
test('modelo pago de fora da Anthropic devolve NULO, não zero', () => {
  assert.equal(custoDaExecucao({ modelo: 'gpt-image-2', itens: 20 }), null);
  assert.equal(custoDaExecucao({ modelo: 'gpt-image-2' }), null);
});

// Isto NÃO é o defeito: tarefa que não chama IA nenhuma custa zero de verdade
// (subir campanha, excluir remessa). Zero aqui é uma afirmação correta.
test('tarefa sem modelo nenhum continua custando zero', () => {
  assert.equal(custoDaExecucao({ modelo: null }), 0);
  assert.equal(custoDaExecucao({}), 0);
});

test('nulo e zero são coisas diferentes, e o teste exige isso', () => {
  assert.notEqual(custoDaExecucao({ modelo: 'gpt-image-2' }), 0);
  assert.strictEqual(custoDaExecucao({ modelo: 'gpt-image-2' }), null);
});

test('reconhece os modelos da Anthropic pelo nome', () => {
  assert.equal(ehModeloAnthropic('claude-opus-4-8'), true);
  assert.equal(ehModeloAnthropic('claude-sonnet-4-6'), true);
  assert.equal(ehModeloAnthropic('claude-sonnet-4-6+claude-opus-4-8'), true);
  assert.equal(ehModeloAnthropic('gpt-image-2'), false);
  assert.equal(ehModeloAnthropic(null), false);
});

// Modelo desconhecido não pode virar zero por descuido: se alguém plugar um
// motor novo e esquecer o preço, o extrato tem de dizer "não sei".
test('modelo desconhecido também devolve nulo', () => {
  assert.equal(custoDaExecucao({ modelo: 'motor-novo-qualquer' }), null);
});
