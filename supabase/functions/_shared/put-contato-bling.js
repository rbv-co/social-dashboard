// supabase/functions/_shared/put-contato-bling.js
//
// PUT do contato do Bling pelo proxy do core (vessel-espelhar-lista, "completar o cadastro"), com o resultado já
// classificado para a rodada decidir o que fazer com a linha de `vessel_registros`:
//
//   'ok'         aplicado -> marcar a linha como feita.
//   'incerto'    504 `resultado_incerto` (ou queda/timeout): NÃO se sabe se o Bling aplicou, e o core repete esse mesmo 504 para a
//                mesma chave até alguém conciliar. Reprocessar não adianta e prenderia um dos 25 slots da rodada para sempre:
//                a rodada TIRA a linha da fila (bling_atualizado_em) e registra o aviso "conferir o contato no Bling".
//   'tentar_depois'  429/5xx do Bling: não foi aplicado; a linha fica na fila para a próxima rodada. Se o core REPETIU (replay) um
//                429/5xx gravado para a mesma chave, a chave congelaria a linha: refaz UMA vez com chave nova (o PUT leva o contato
//                inteiro, então repetir o mesmo corpo é idempotente). `limite` = true em 429 (a rodada para de bater no Bling).
//   'recusado'   outro 4xx do Bling: a linha fica na fila (como sempre).
//   'reautorizar' o Bling pede nova autorização.
//
// `chaveIdempotente` e `agora` são injetados (teste sem Deno/rede).

const transitorio = (r) => r.status === 429 || r.status >= 500

/** @returns {Promise<{tipo:'ok'|'incerto'|'tentar_depois'|'recusado'|'reautorizar', limite?:boolean, chave:string}>} */
export async function colocarContato({ proxy, contatoId, corpo, token, origem, chaveIdempotente, agora = Date.now() }) {
  const enviar = (chave) => proxy.chamar('PUT', `/contatos/${contatoId}`, { corpo, chave, token })
  let chave = await chaveIdempotente(origem, 'contato-completar', corpo)
  let r = await enviar(chave)
  if (!r.ok && !r.incerto && !r.reautorizar && r.replay && transitorio(r)) {
    // Janela de 15 min na chave: dentro dela, repetir é o mesmo pedido (o core não duplica); fora, é uma nova tentativa.
    chave = await chaveIdempotente(`${origem}:t${Math.floor(agora / 9e5)}`, 'contato-completar', corpo)
    r = await enviar(chave)
  }
  if (r.reautorizar) return { tipo: 'reautorizar', chave }
  if (r.incerto) return { tipo: 'incerto', chave }
  if (r.ok) return { tipo: 'ok', chave }
  if (transitorio(r)) return { tipo: 'tentar_depois', limite: r.status === 429, chave }
  return { tipo: 'recusado', chave }
}
