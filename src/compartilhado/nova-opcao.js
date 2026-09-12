// A REGRA DO "+" DE TODA A CENTRAL: decide se o nome digitado vira um cadastro
// novo ou se já existe e deve só ser selecionado. Lógica pura: não toca banco
// nem tela.
//
// Hoje ela serve TRÊS consumidores, e por isso mora aqui e não no Patrimônio:
//   - tela-de-patrimonio.vue          empresa, categoria, local, ambiente, tipo
//   - escolha-de-local-e-ambiente.vue marca, local e ambiente de qualquer tela
//   - escolha-de-pessoa.vue           a pessoa, e a marca e o setor dela
//
// Por que existe: antes, essas listas só cresciam por quem tivesse acesso à
// tela de Listas — e quem só cadastra bem ficava travado quando a marca, o
// local ou o tipo que precisava ainda não estava lá (caso real: a BMW nova
// da frota não aparecia em Tipo, só Fiat/Ford/Honda/Porsche/Volvo). Quem já
// pode cadastrar o bem passa a poder criar a opção que falta, sem sair do
// formulário.

// Compara ignorando maiúsculas/minúsculas e espaços nas pontas. Sem isso a
// lista vira "Volvo", "VOLVO" e "volvo" convivendo — que é o estado real
// hoje em Marcas/Tipos (Fiat e FORD já divergem assim).
export function normalizarNome(nome) {
  return (nome || '').trim().toLowerCase()
}

// Decide o que fazer com o nome que a pessoa digitou no "+":
//   - nome vazio/só espaço  → erro, com o que fazer
//   - já existe (ignorando caixa/espaço) → usar o que já existe, avisando
//   - inédito               → pode criar, com o nome já aparado
//
// `itensExistentes` é a lista JÁ FILTRADA pelo pai certo (os locais desta
// marca, os tipos desta categoria) — quem chama decide o escopo; esta função
// só compara nomes dentro do que recebeu.
export function resolverNovaOpcao(nomeDigitado, itensExistentes) {
  const nome = (nomeDigitado || '').trim()
  if (!nome) return { ok: false, mensagem: 'Digite um nome antes de criar.' }

  const chave = normalizarNome(nome)
  const existente = (itensExistentes || []).find((item) => normalizarNome(item?.nome) === chave)
  if (existente) return { ok: true, jaExistia: true, item: existente }

  return { ok: true, jaExistia: false, nome }
}
