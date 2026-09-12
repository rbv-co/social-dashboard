// QUANTO CUSTOU UMA EXECUÇÃO DE ROBÔ — e a diferença entre "zero" e "não sei".
//
// O DEFEITO QUE ISTO CONSERTA (medido em 18/08/2026): o registro de telemetria
// devolvia **0** para qualquer execução sem modelo da Anthropic. Foi assim que
// **473 criativos** gerados com `gpt-image-2` — a API PAGA da OpenAI — ficaram
// gravados como US$ 0,00. E a tela do Status do Claude não só omitia: ela
// AFIRMAVA que "tarefas que criam imagens não usam a API paga, então custam R$ 0".
//
// É a mesma família que já custou caro aqui: falha virando número. Zero é uma
// afirmação forte — "não custou nada". Quando ninguém sabe, o certo é NULO.
//
// A ESCADA:
//   1. valor informado à mão vence sempre (quem chamou sabe melhor)
//   2. modelo da Anthropic → calcula pelos tokens, com o preço centralizado
//   3. modelo pago de fora (gpt-image-2) ou desconhecido → NULO, "não sei"
//   4. nenhum modelo → 0, e aqui zero é verdade (subir campanha não chama IA)
//
// PURO: sem rede, sem banco.

// Preço oficial da Anthropic (US$ por 1M tokens). Fonte única — o `lib-llm.mjs`
// tem uma tabela antiga com Opus 15/75 que NÃO serve para custo.
export const PRECO = {
  opus:   { in: 5, out: 25 },
  sonnet: { in: 3, out: 15 },
};

export function ehModeloAnthropic(modelo) {
  const m = String(modelo || '').toLowerCase();
  return m.includes('claude') || m.includes('opus') || m.includes('sonnet') || m.includes('haiku');
}

export function calcularUsd(modelo, inputTokens = 0, outputTokens = 0) {
  const p = String(modelo || '').toLowerCase().includes('opus') ? PRECO.opus : PRECO.sonnet;
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}

export function custoDaExecucao({ modelo = null, inputTokens = 0, outputTokens = 0, usd } = {}) {
  if (typeof usd === 'number' && Number.isFinite(usd)) return usd;
  if (!modelo) return 0;
  if (ehModeloAnthropic(modelo)) return calcularUsd(modelo, inputTokens, outputTokens);
  // Motor pago de fora, ou motor novo que ninguém ensinou a precificar. Nos dois
  // casos a resposta honesta é a mesma, e não é zero.
  return null;
}
