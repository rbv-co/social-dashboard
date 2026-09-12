// COMO LER A RESPOSTA DO `bling-proxy` — e por que isto não mora no `.vue`.
//
// O DEFEITO (medido em 18/08/2026): a tela consultava o Bling com
// `sbClient.functions.invoke(...)` e lia o resultado como
// `(r && r.data && r.data.data) || []`. Só que `functions.invoke` **não joga
// erro** quando a chamada falha: ele devolve `{ data: null, error }`. Então o
// `|| []` transformava Bling fora do ar em **lista vazia**.
//
// A consequência era pior do que parece. A `gcAbrirItem` JÁ TEM o `try/catch`
// certo, que escreve "Não consegui consultar o Bling agora. Tente de novo." —
// mas como a falha virava lista vazia, esse catch nunca disparava. A busca
// descia pelas quatro tentativas e terminava em **"Item X não encontrado no
// Bling"**. Ou seja: uma queda do Bling era anunciada ao usuário como "esse
// produto não existe", com a mensagem certa escrita e inalcançável.
//
// E não é raro: em 18/08 o `bling-proxy` falhou em **2,2%** das 721 chamadas de
// 24h — 8 tempos esgotados, 5 recusas por excesso e 3 não encontrado.
//
// Mora aqui, e não no `.vue`, porque `node --test` não compila arquivo de tela:
// lá dentro esta regra não teria como quebrar teste nenhum.
//
// PURO: sem rede, sem tela.

function subirSeFalhou(r) {
  const erro = r && r.error;
  if (!erro) return;
  const detalhe = (erro && erro.message) || String(erro);
  // O nome do proxy vai na mensagem de propósito: sem ele, o console mostra um
  // erro solto e quem for consertar começa procurando no Bling — o desperdício
  // que este projeto já pagou uma vez.
  throw new Error(`bling-proxy não respondeu: ${detalhe}`);
}

// A LISTA de produtos. Vazio continua sendo vazio — o item pode não existir
// mesmo, e esse é um resultado legítimo que a tela sabe mostrar.
export function listaDaResposta(r) {
  subirSeFalhou(r);
  const lista = r && r.data && r.data.data;
  return Array.isArray(lista) ? lista : [];
}

// UM produto. `null` é "não achei", e só isso.
export function detalheDaResposta(r) {
  subirSeFalhou(r);
  const item = r && r.data && r.data.data;
  return item && typeof item === 'object' ? item : null;
}
