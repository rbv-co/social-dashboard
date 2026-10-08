// supabase/functions/_shared/disparo-imediato.js
//
// DISPARO IMEDIATO: logo depois de a edge receptora gravar a linha em `mensagem_fila`, roda a MESMA rodada do robô
// (`rodarTudo`), só para o tipo certo (`inicio` ou `pedido`), em vez de esperar o minuto do pg_cron.
//
// Por que é seguro sem trava nova: `pegar_da_fila` reserva a linha (status `enviando`) com lock + `for update skip locked`;
// quem chega depois (o cron, ou outro webhook) não a vê. Modos, ENVIO_SO_PARA, janela de horário, bloqueados, trava
// cruzada e a reserva do Chatwoot são os de sempre, porque o código é o mesmo. `adiado`, `sem_link_ainda` e fora da
// janela devolvem a linha à fila: o robô de 1 min ou o próximo evento do checkout a pega.
//
// ⚠️ Atrás da flag DISPARO_IMEDIATO=true (padrão desligado = comportamento de sempre). NUNCA lança: o webhook responde
// como antes, qualquer que seja o resultado. Erro vai para o log sem telefone nem segredo.
import { rodarTudo } from './rodada-completa.js'

/** Tópicos da Shopify -> tipo da fila. checkouts/* = inicio (e é onde o link chega depois); orders/create|paid = pedido. */
export function tiposDoTopico(topico) {
  if (topico === 'checkouts/create' || topico === 'checkouts/update') return ['inicio']
  if (topico === 'orders/create' || topico === 'orders/paid') return ['pedido']
  return []
}

/**
 * @returns {Promise<{rodou:boolean, motivo?:string, status?:number}>} nunca rejeita.
 */
export async function dispararAgora({ env, sb, criarCliente, topico, limiteMs = 20000, agora = new Date() }) {
  try {
    if (env('DISPARO_IMEDIATO') !== 'true') return { rodou: false, motivo: 'desligado' }
    const tipos = tiposDoTopico(topico)
    if (!tipos.length) return { rodou: false, motivo: 'topico_sem_envio' }
    let timer
    const limite = new Promise((resolve) => { timer = setTimeout(() => resolve({ estourou: true }), limiteMs) })
    // Estourar o limite não cancela a rodada: o que já foi reservado termina ou, no pior caso, vira `travada` em 10 min (nunca reenvia).
    const r = await Promise.race([rodarTudo({ env, sb, criarCliente, agora, tipos }), limite]).finally(() => clearTimeout(timer))
    if (r.estourou) { console.error('disparo imediato passou do limite de tempo:', tipos.join(',')); return { rodou: true, motivo: 'limite_de_tempo' } }
    if (r.status !== 200) console.error('disparo imediato terminou com status', r.status, tipos.join(','))
    return { rodou: true, status: r.status }
  } catch (e) {
    console.error('falha no disparo imediato:', String(e?.message ?? e).slice(0, 120))
    return { rodou: false, motivo: 'excecao' }
  }
}
