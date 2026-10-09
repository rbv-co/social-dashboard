// supabase/functions/_shared/trava-cruzada.js
//
// TRAVA CRUZADA: nenhuma mensagem automática de abandono (inicio / 24 h / follow-up) sai se o mesmo telefone já
// recebeu outra, de qualquer tipo, nas últimas 20 h (RPC `avaliar_trava_cruzada`, que usa `recebeu_mensagem_automatica` e
// lê `mensagem_fila` e `checkout_abandono`; também espera quando outra linha do telefone está `enviando`). Flag ABANDONO_TRAVA_CRUZADA, padrão LIGADA: só desliga com false/0/off/nao.
export const MOTIVO_TRAVA_CRUZADA = 'ignorada_trava_cruzada'
export const HORAS_DA_TRAVA = 20

export const travaCruzadaLigada = (valor) => !['false', '0', 'off', 'nao', 'não'].includes(String(valor ?? '').trim().toLowerCase())

/**
 * RPC `avaliar_trava_cruzada` (migration 2026-10-09-trava-cruzada-considera-enviando.sql): além do que já foi `enviada`,
 * olha as linhas `enviando` de OUTRA chave do mesmo telefone (rodadas concorrentes do disparo imediato). Entre duas
 * `enviando`, vence a reservada primeiro (o pedido sempre vence); a outra recebe 'esperar'. `tipo`/`chave` identificam
 * a linha de quem pergunta ('abandono' + token no robô do abandono).
 * @returns {Promise<'barrar'|'esperar'|'liberar'|'erro'>} Falha ou resposta desconhecida = 'erro' (quem chama devolve o item: "não sei" não libera).
 */
export async function checarTravaCruzada(sb, telefone, { tipo, chave } = {}) {
  const r = await sb.rpc('avaliar_trava_cruzada', { p_telefone: telefone, p_horas: HORAS_DA_TRAVA, p_tipo: tipo ?? null, p_chave: chave ?? null })
  if (r.error) { console.error('falha em avaliar_trava_cruzada:', r.error.message); return 'erro' }
  return ['barrar', 'esperar', 'liberar'].includes(r.data) ? r.data : 'erro'
}
