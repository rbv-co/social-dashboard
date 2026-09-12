// ESCAPAR CURINGA DE ILIKE — antes de usar um e-mail digitado como padrão de
// busca no PostgREST (`email=ilike.<padrão>`).
//
// `_` casa um caractere qualquer e `%` casa qualquer sequência no ILIKE — e
// e-mail com `_` é comum (erick_martins@...). Sem escapar, "erick_martins@"
// vira um padrão que TAMBÉM casa "erick.martins@", "erickXmartins@" etc.
// `encodeURIComponent` resolve transporte (URL), não metacaractere de padrão
// — os dois problemas são independentes e um não cobre o outro.
//
// Task 5 (D7): essa consulta decide (a) se um e-mail já tem conta, pra não
// aplicar perfil em conta alheia, e (b) qual `id` recebe o PATCH do perfil
// recém-criado. Um curinga não escapado nas duas faz a consulta casar CONTA
// DE OUTRA PESSOA — é o mesmo risco que a guarda de pré-existência existia
// pra fechar, só que por uma porta lateral.
//
// O `*` É CURINGA TAMBÉM, e só aqui. O PostgREST traduz `*` para `%` antes de
// mandar o padrão pro Postgres (`like`/`ilike`), então ele é um metacaractere a
// mais que o Postgres sozinho não tem. Quem lê só a documentação do Postgres não
// encontra esse — e `a*@rbv` sem escapar viraria `a%@rbv`, casando conta alheia
// pela mesma porta lateral que `_` abria.
//
// PURO: string entra, string sai. Sem rede, sem DOM.
export function paraIlike(email) {
  // A barra invertida vai PRIMEIRO. Se escapássemos `%`/`_`/`*` antes dela, a
  // própria barra que acabamos de inserir seria escapada de novo no passo
  // seguinte — dobrando o escape errado.
  return String(email || '').replace(/[\\%_*]/g, (m) => '\\' + m)
}
