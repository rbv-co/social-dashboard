// A RECARGA DE 5 MINUTOS DAS TELAS DE VENDA — quando ela deve acontecer, e
// quando é só desperdício.
//
// POR QUE EXISTE (medido em 27/08/2026): a `bling-proxy` recebeu 20.268
// chamadas em 24h, contra 721 medidas em 18/08. O Bling limitou 4.887 delas
// (~24%), e a política de repetição do B20 teve de resgatar quase todas.
//
// De onde vinha, medido conta a conta no registro do gateway:
//
//   Gabriel Alves     37.241 chamadas   ATIVO NAS 24 HORAS DO DIA
//   as outras cinco    3.316 chamadas   1 a 10 horas cada
//
// Uma conta sozinha fazia 92%, inclusive das 01h às 07h da manhã, em rajadas de
// ~266 chamadas de 5 em 5 minutos. Não era uso: era uma ABA ESQUECIDA aberta
// num computador que não dorme, recarregando a noite inteira uma tela que
// ninguém estava olhando.
//
// E o formato é o que machuca, não só o total: as 266 chamadas se espremem em
// ~3 minutos (~1,5/s, com picos acima do limite de 3/s do Bling). De madrugada
// isso dava 400 a 674 recusas por hora; em horário comercial, com o mesmo
// volume espalhado entre várias pessoas, dava 3 a 5.
//
// A REGRA, EM UMA FRASE: aba que ninguém está olhando não gasta cota.
//
// ⚠️ O CUIDADO QUE FAZ ISTO NÃO VIRAR DEFEITO: quem volta para a aba precisa
// ver número de agora, não o de três horas atrás. Pular a recarga escondida sem
// recarregar na volta trocaria "gasta demais" por "mostra número velho" — e
// número velho numa tela de dinheiro é pior que chamada a mais.
//
// PURO: não conhece `document`, `window` nem relógio. Quem passa o estado é
// quem chama, e é por isso que estas duas decisões têm teste.

// O tique de 5 minutos chegou. Recarrega?
//
// Só a visibilidade decide. Nada de "faz X horas que ninguém mexe": a tela é
// consultada por várias pessoas ao longo do dia, e quem está com ela aberta e
// visível quer o número vivo, mesmo sem clicar em nada.
export function decidirNoTique({ visivel }) {
  return visivel ? 'recarregar' : 'pular';
}

// A aba voltou a ficar visível. Recarrega agora, ou espera o próximo tique?
//
// Recarrega quando o que está na tela já passou do intervalo — ou seja, quando
// pelo menos um tique foi pulado enquanto ninguém olhava. Voltar para a aba e
// encarar número velho é exatamente o que esta regra não pode causar.
//
// `msDesdeAUltimaRecarga` ausente ou sem sentido (nunca carregou, relógio
// mexido) recarrega: na dúvida, o certo é buscar. O erro barato aqui é uma
// chamada a mais; o caro é dinheiro desatualizado na tela.
export function decidirAoVoltar({ msDesdeAUltimaRecarga, intervaloMs }) {
  // ⚠️ `null` ANTES do `Number`, e isto não é preciosismo: `Number(null)` é
  // ZERO, não `NaN`. Sem esta linha, "nunca carregou" passava por "carregou
  // agora mesmo" e a tela mandava ESPERAR — abrindo com número velho justamente
  // na primeira carga. É a mesma armadilha que fez `ia_execucoes.usd` transformar
  // "não sei" em R$ 0,00 por semanas (item B8).
  if (msDesdeAUltimaRecarga == null || intervaloMs == null) return 'recarregar';
  const ms = Number(msDesdeAUltimaRecarga);
  const intervalo = Number(intervaloMs);
  if (!Number.isFinite(ms) || !Number.isFinite(intervalo) || intervalo <= 0) return 'recarregar';
  return ms >= intervalo ? 'recarregar' : 'esperar';
}
