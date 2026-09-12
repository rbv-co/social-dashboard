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
export function foiCortado(lista) {
  return Array.isArray(lista) && lista.length === LIMITE_AUDITORIA
}

// rotulos: array de nomes (string) das listas que bateram no limite — passe
// só os que vierem de foiCortado()===true. Valores falsy são ignorados, pra
// quem chama poder passar `cortouBens && 'bens'` direto.
export function avisoDeCorte(rotulos) {
  const quais = (rotulos || []).filter(Boolean)
  if (!quais.length) return ''
  return 'A lista de ' + quais.join(' e ') + ' bateu no limite de ' + LIMITE_AUDITORIA +
    ' linhas e pode estar CORTADA — os números da auditoria podem estar incompletos.'
}
