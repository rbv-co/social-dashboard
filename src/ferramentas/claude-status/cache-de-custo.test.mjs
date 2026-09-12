import test from 'node:test';
import assert from 'node:assert/strict';
import { criarCacheDeCusto, chaveDaBusca, VALIDADE_MS } from './cache-de-custo.js';

// O "agora" é sempre passado à mão: teste que depende do relógio de verdade
// falha sozinho às três da manhã.
const T0 = 1_700_000_000_000;

test('a mesma pergunta feita duas vezes vira UMA chamada', () => {
  // É o caso real: o total do topo pede 30 dias, e o extrato abre em 30 dias.
  const c = criarCacheDeCusto();
  assert.equal(c.ler('custo-openai', 30, T0), null); // ninguém perguntou ainda
  c.guardar('custo-openai', 30, { totalUsd: 98.71 }, T0);
  assert.deepEqual(c.ler('custo-openai', 30, T0 + 1000), { totalUsd: 98.71 });
  assert.equal(c.tamanho, 1);
});

test('janelas diferentes são perguntas diferentes', () => {
  const c = criarCacheDeCusto();
  c.guardar('custo-openai', 30, { totalUsd: 98.71 }, T0);
  assert.equal(c.ler('custo-openai', 7, T0), null);
  assert.equal(chaveDaBusca('custo-openai', 7) === chaveDaBusca('custo-openai', 30), false);
});

test('fornecedores diferentes não se misturam — seria trocar uma fatura pela outra', () => {
  const c = criarCacheDeCusto();
  c.guardar('custo-anthropic', 30, { totalUsd: 10 }, T0);
  assert.equal(c.ler('custo-openai', 30, T0), null);
});

test('depois da validade, pergunta de novo', () => {
  const c = criarCacheDeCusto();
  c.guardar('custo-openai', 30, { totalUsd: 98.71 }, T0);
  assert.notEqual(c.ler('custo-openai', 30, T0 + VALIDADE_MS - 1), null);
  assert.equal(c.ler('custo-openai', 30, T0 + VALIDADE_MS), null);
  assert.equal(c.tamanho, 0, 'o vencido sai do lugar em vez de acumular');
});

test('ERRO NÃO É GUARDADO: só entra aqui o que deu certo', () => {
  // A regra vive em quem chama (só chama `guardar` no caminho bom), e este teste
  // existe para deixar a decisão escrita: se um dia alguém guardar o erro, dez
  // minutos de "não consegui puxar a conta da OpenAI" ficariam grudados na tela
  // mesmo depois de a OpenAI voltar.
  const c = criarCacheDeCusto();
  const resposta = { erro: 'costs_http_429' };
  if (!resposta.erro) c.guardar('custo-openai', 30, resposta, T0);
  assert.equal(c.ler('custo-openai', 30, T0), null);
  assert.equal(c.tamanho, 0);
});

test('limpar joga tudo fora — é o "atualizar agora"', () => {
  const c = criarCacheDeCusto();
  c.guardar('custo-openai', 30, { totalUsd: 1 }, T0);
  c.guardar('custo-anthropic', 30, { totalUsd: 2 }, T0);
  assert.equal(c.tamanho, 2);
  c.limpar();
  assert.equal(c.ler('custo-openai', 30, T0), null);
  assert.equal(c.tamanho, 0);
});

test('a conta da bronca: 4 chamadas por minuto viram 2 ao abrir', () => {
  // Simula o que a tela faz ao abrir, com o período no padrão de 30 dias:
  // topo pede as duas contas, extrato pede as duas contas.
  const c = criarCacheDeCusto();
  let idasNaRede = 0;
  const pedir = (funcao, dias, agora) => {
    const guardado = c.ler(funcao, dias, agora);
    if (guardado) return guardado;
    idasNaRede++;
    const dados = { totalUsd: 1 };
    c.guardar(funcao, dias, dados, agora);
    return dados;
  };
  pedir('custo-anthropic', 30, T0); // topo
  pedir('custo-openai', 30, T0);    // topo
  pedir('custo-anthropic', 30, T0); // extrato
  pedir('custo-openai', 30, T0);    // extrato
  assert.equal(idasNaRede, 2, 'o extrato reaproveita o que o topo já perguntou');

  // e trocar para 7 dias e voltar para 30 não repete a de 30
  pedir('custo-anthropic', 7, T0 + 5000);
  pedir('custo-anthropic', 30, T0 + 9000);
  assert.equal(idasNaRede, 3);
});
