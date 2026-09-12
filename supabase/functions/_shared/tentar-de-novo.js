/* QUANDO VALE TENTAR DE NOVO NO BLING — e quando insistir só piora.
 *
 * POR QUE EXISTE (B20, medido em 18/08/2026): nas últimas 24h o `bling-proxy`
 * falhou em **15 de 759 chamadas (1,98%)**, enquanto as outras 13 funções somaram
 * ZERO falha. A repartição, medida no registro da Supabase:
 *
 *   · 8 × 504 — o Bling não respondeu, e a chamada morreu batendo em ~30s
 *   · 5 × 429 — o Bling limitando, e respondendo RÁPIDO (762 ms em média)
 *   · 2 × 404 — o item não existe mesmo. Isso é RESPOSTA, não falha.
 *
 * A LISTA DIZIA QUE ISSO "NÃO ERA NOSSO". Metade é: o nosso proxy chamava o
 * Bling **sem prazo próprio e sem tentar de novo**, então uma chamada lenta
 * ficava pendurada até a plataforma matar em 30s — e quem estava na tela
 * esperava os 30s para receber um erro. Dar prazo curto e tentar de novo troca
 * "esperar meio minuto e falhar" por "falhar rápido e conseguir na segunda".
 *
 * AS TRÊS REGRAS QUE MANDAM AQUI:
 *
 * 1. **404 e 403 NÃO se repetem.** Eles são a resposta do Bling, não uma falha
 *    dele. Repetir um 404 três vezes só faria a pessoa esperar o triplo para ler
 *    a mesma coisa — e ainda gastaria cota que faz falta nos 429.
 *
 * 2. **Só se repete o que é seguro repetir.** Toda chamada de DADO ao Bling
 *    neste proxy é GET (conferido no `index.ts`: o único POST é o do refresh do
 *    token, e ele JAMAIS passa por aqui — no Bling o refresh é de uso único, e
 *    repetir queimaria o token da empresa).
 *
 * 3. **Nunca começar uma tentativa que não cabe no tempo.** A plataforma mata a
 *    chamada perto dos 30s; se o que sobra não dá para uma tentativa inteira, é
 *    melhor devolver o erro agora, com frase em português, do que ser morto no
 *    meio e devolver nada — porque "nada" na tela vira "não sei o que aconteceu".
 *
 * PURO: sem rede, sem relógio próprio (quem passa o tempo decorrido é quem
 * chama). É o que permite provar a política sem depender do Bling estar de pé. */

/* Prazo de UMA tentativa — e este número saiu de medição, não de gosto.
 *
 * As 744 chamadas que deram certo nas últimas 24h (18/08/2026):
 *   p50 1,0s · p90 2,0s · p99 3,9s · a mais lenta de todas 12,7s
 *   acima de 8s: 4 chamadas · acima de 10s: 2 · acima de 15s: nenhuma
 *
 * 11s fica acima do p99 por larga margem. O preço dele é cortar ~1 chamada
 * honesta por dia — e mesmo essa é repetida, voltando em ~1s. O que ele evita é
 * a chamada pendurada até a plataforma matar em 30s, que aconteceu 8 vezes.
 *
 * ⚠️ NÃO SUBA ESTE NÚMERO SEM OLHAR O ORÇAMENTO: com 11s cabem duas tentativas
 * inteiras em 25s; com 14s não cabe nem a segunda, e o prazo curto deixaria de
 * servir para alguma coisa. */
export const PRAZO_POR_TENTATIVA_MS = 11000;

// O orçamento da chamada inteira. A plataforma mata perto dos 30s; parar em 25s
// deixa margem para o proxy montar e devolver a resposta de erro.
export const ORCAMENTO_MS = 25000;

/* Três tentativas: a primeira, e mais duas. Medido em 18/08, os 429 vieram em
 * rajada numa hora só, e o Bling respondeu a eles em 762ms — nesse caso as três
 * cabem com folga (dá ~4s no total).
 *
 * Quando a falha é LENTA (a tentativa queima os 11s), o orçamento deixa passar
 * duas, e a trava de tempo corta a terceira. Isso não é contradição: é a trava
 * fazendo o trabalho dela, e é melhor devolver o erro aos 22s do que ser morto
 * aos 30s sem devolver nada. */
export const TENTATIVAS_MAX = 3;

// A espera cresce: 600ms, depois 1200ms. Curta de propósito — há gente olhando
// a tela, e recuo longo demais estoura o orçamento antes da terceira tentativa.
const ESPERA_BASE_MS = 600;

const ehNumero = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Decide se tenta de novo, e quanto esperar antes.
 *
 * `status`            — o código HTTP, ou `null` se nem houve resposta.
 * `estourouOPrazo`    — a tentativa foi cortada no prazo, ou a rede falhou.
 * `msDecorridos`      — quanto já se gastou desde a PRIMEIRA tentativa.
 * `retryAfterSegundos`— o que o Bling pediu no cabeçalho `Retry-After`, se pediu.
 *
 * Devolve `{ repetir, esperarMs, motivo }`. O `motivo` é frase de gente: ele vai
 * parar no registro e, quando a última tentativa falha, na resposta.
 */
export function decidirRepeticao({
  tentativa,
  status = null,
  estourouOPrazo = false,
  msDecorridos = 0,
  retryAfterSegundos = null,
  // Quem está do outro lado. Só muda as frases — a política é a mesma, e ela
  // vale para qualquer API de fora: 404/403 é resposta, 429/5xx/mudo é falha
  // dele. Padrão 'Bling' porque foi de lá que a regra saiu, e assim o
  // bling-proxy (e os testes dele) não mudam uma linha.
  fornecedor = 'Bling',
  // Prazo e orçamento também variam por fornecedor: os 11s/25s saíram das
  // medições do Bling. Quem chama pode passar os seus.
  prazoPorTentativaMs = PRAZO_POR_TENTATIVA_MS,
  orcamentoMs = ORCAMENTO_MS,
} = {}) {
  const nao = (motivo) => ({ repetir: false, esperarMs: 0, motivo });

  // Deu certo não se repete — dito explicitamente para ninguém precisar deduzir.
  if (ehNumero(status) && status < 400) return nao('deu certo');

  // 404, 403, 400… são a RESPOSTA do Bling. Repetir não muda nada.
  const ehFalhaDele = estourouOPrazo || status === null || status === 429 || (ehNumero(status) && status >= 500);
  if (!ehFalhaDele) return nao(`o ${fornecedor} respondeu, e a resposta é essa`);

  if (tentativa >= TENTATIVAS_MAX) return nao(`já tentei ${TENTATIVAS_MAX} vezes`);

  let esperarMs = ESPERA_BASE_MS * 2 ** (tentativa - 1);
  // Quando o Bling DIZ quanto esperar, quem manda é ele: insistir antes só
  // renova a punição.
  if (status === 429 && ehNumero(retryAfterSegundos) && retryAfterSegundos > 0) {
    esperarMs = Math.max(esperarMs, Math.round(retryAfterSegundos * 1000));
  }

  // A tentativa seguinte tem de caber INTEIRA no que resta.
  if (msDecorridos + esperarMs + prazoPorTentativaMs > orcamentoMs) {
    return nao('não caberia outra tentativa no tempo desta chamada');
  }

  const motivo = estourouOPrazo
    ? `o ${fornecedor} não respondeu no prazo`
    : status === 429
      ? `o ${fornecedor} pediu para esperar`
      : status === null
        ? `a chamada não chegou ao ${fornecedor}`
        : `o ${fornecedor} falhou do lado dele (${status})`;
  return { repetir: true, esperarMs, motivo };
}

/** A frase que a tela recebe quando as tentativas acabaram. Diz o que houve e o
 *  que fazer — erro que só diz "erro" vira chamado. */
export function fraseDeDesistencia(motivo, tentativas, fornecedor = 'Bling') {
  return `Não consegui falar com o ${fornecedor} agora (${motivo}). `
    + `Tentei ${tentativas} ${tentativas === 1 ? 'vez' : 'vezes'}. `
    + `Tente de novo em instantes; se continuar, o ${fornecedor} está fora do ar.`;
}
