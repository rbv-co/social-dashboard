// supabase/functions/_shared/trava-cruzada.js
//
// TRAVA CRUZADA: nenhuma mensagem automática de abandono (inicio / 24 h / follow-up) sai se o mesmo telefone já
// recebeu outra, de qualquer tipo, nas últimas 20 h (RPC `recebeu_mensagem_automatica`, lê `mensagem_fila` e
// `checkout_abandono`). Flag ABANDONO_TRAVA_CRUZADA, padrão LIGADA: só desliga com false/0/off/nao.
export const MOTIVO_TRAVA_CRUZADA = 'ignorada_trava_cruzada'
export const HORAS_DA_TRAVA = 20

export const travaCruzadaLigada = (valor) => !['false', '0', 'off', 'nao', 'não'].includes(String(valor ?? '').trim().toLowerCase())

/** @returns {Promise<'barrar'|'liberar'|'erro'>} Falha na leitura = 'erro' (quem chama devolve o item: "não sei" não libera). */
export async function checarTravaCruzada(sb, telefone) {
  const r = await sb.rpc('recebeu_mensagem_automatica', { p_telefone: telefone, p_horas: HORAS_DA_TRAVA })
  if (r.error) { console.error('falha em recebeu_mensagem_automatica:', r.error.message); return 'erro' }
  return r.data === true ? 'barrar' : 'liberar'
}
