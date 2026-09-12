// VALOR DE FILTRO DO POSTGREST — para usar um texto digitado por gente dentro
// de `coluna=eq.<valor>`.
//
// `,` `.` `:` `(` `)` fazem parte da GRAMÁTICA do filtro do PostgREST, não do
// valor. Um perfil chamado "Vendedora, Iguatemi" mandado cru vira uma consulta
// que o PostgREST lê como duas coisas — e uma consulta que erra de silêncio
// aqui é a diferença entre regravar o perfil certo e não achar perfil nenhum.
// O jeito documentado é mandar o valor entre aspas duplas, escapando com barra
// invertida as aspas e as barras que existirem dentro dele.
//
// `encodeURIComponent` resolve transporte (URL), não gramática de filtro — os
// dois problemas são independentes, e este módulo devolve o valor JÁ pronto
// para a URL, aspas incluídas. Mesma separação que existe em
// escapar-curinga-ilike.js, que é o irmão deste para `ilike`.
//
// PURO: string entra, string sai. Sem rede, sem DOM.
export function paraEq(valor) {
  // A barra invertida vai PRIMEIRO: escapar as aspas antes dela faria a barra
  // que acabamos de inserir ser escapada de novo no passo seguinte.
  const escapado = String(valor ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return encodeURIComponent('"' + escapado + '"')
}
