// Lógica pura: detecta corte silencioso nas consultas da Auditoria. Sem
// `.limit()` explícito, o PostgREST corta em 1000 linhas por padrão — e faz
// isso SEM erro, sem aviso, devolvendo uma lista incompleta que parece
// completa. patrimonio_bens e frota_veiculos são consultados inteiros aqui
// (hoje 361 e 9 linhas); quando um dos dois passar deste limite, a Auditoria
// vai mentir sem que ninguém desconfie, porque a tela continua parecendo
// cheia. Sem DOM, sem banco — só decide se o número bate no limite e, se
// bater, escreve a frase que vai pro mesmo aviso (_acAudAviso) que a tela já
// usa pra "não consegui carregar".

// Bem acima do que existe hoje nas duas tabelas — dá folga real antes de
// cortar de verdade, mas ainda é um número finito que o PostgREST respeita.
export const LIMITE_AUDITORIA = 5000

// Não dá pra distinguir "vieram exatamente LIMITE_AUDITORIA linhas, e é
// tudo" de "cortou em LIMITE_AUDITORIA". Errar para o lado de avisar demais
// (falso positivo raríssimo) é preferível a fingir que está completo.
// `limite`: o que a consulta de fato pediu. Pela API em Go o teto é 1000 (o `limit` de 5000 seria recusado),
// então a tela passa o dela e a frase abaixo diz o número certo.
export function foiCortado(lista, limite = LIMITE_AUDITORIA) {
  return Array.isArray(lista) && lista.length === limite
}

// rotulos: array de nomes (string) das listas que bateram no limite — passe
// só os que vierem de foiCortado()===true. Valores falsy são ignorados, pra
// quem chama poder passar `cortouBens && 'bens'` direto. Uma entrada pode ser
// `{ rotulo, limite }` quando o limite dela não é o LIMITE_AUDITORIA.
export function avisoDeCorte(rotulos) {
  const quais = (rotulos || []).filter(Boolean).map((r) => (typeof r === 'string' ? { rotulo: r, limite: LIMITE_AUDITORIA } : r))
  if (!quais.length) return ''
  const limites = [...new Set(quais.map((q) => q.limite))]
  return 'A lista de ' + quais.map((q) => q.rotulo).join(' e ') + ' bateu no limite de ' + limites.join(' / ') +
    ' linhas e pode estar CORTADA — os números da auditoria podem estar incompletos.'
}
