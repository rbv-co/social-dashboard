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
import { ErroChatwoot } from './cliente-chatwoot.js'

/** Tópicos da Shopify -> tipo da fila. checkouts/* = inicio (e é onde o link chega depois); orders/create|paid = pedido. */
export function tiposDoTopico(topico) {
  if (topico === 'checkouts/create' || topico === 'checkouts/update') return ['inicio']
  if (topico === 'orders/create' || topico === 'orders/paid') return ['pedido']
  return []
}

/** Métodos do cliente que ainda NÃO enviaram nada: depois do limite, passam a falhar para a rodada devolver o resto da fila. */
const ANTES_DO_ENVIO = ['reservarAviso', 'respondeu', 'acharOuCriarContato', 'abrirConversa']

/**
 * ⚠️ NÃO encerra o `waitUntil` antes de a rodada terminar (a promessa devolvida só resolve com a rodada completa): se o
 * `waitUntil` terminasse com a rodada ainda andando, o isolate podia ser encerrado no meio e deixar linhas `enviando`
 * (viram `falhou/travada_sem_confirmacao` em 10 min = mensagem perdida). O limite (padrão 120 s, coerente com o limite
 * real do runtime) é um CANCELAMENTO: ao estourar, a rodada não começa mais nenhuma linha (o cliente passa a falhar
 * antes de enviar) e o que ela já reservou volta à fila SEM contar tentativa; só quem já estava no meio do
 * `enviarTemplate` termina sozinho (a mensagem pode ter saído: nunca é devolvida nem reenviada).
 * @returns {Promise<{rodou:boolean, motivo?:string, status?:number}>} nunca rejeita.
 */
export async function dispararAgora({ env, sb, criarCliente, topico, limiteMs = 120000, gracaMs = 30000, agora = new Date() }) {
  try {
    if (env('DISPARO_IMEDIATO') !== 'true') return { rodou: false, motivo: 'desligado' }
    const tipos = tiposDoTopico(topico)
    if (!tipos.length) return { rodou: false, motivo: 'topico_sem_envio' }
    let estourou = false
    const timer = setTimeout(() => { estourou = true }, limiteMs)
    const cancelada = () => new ErroChatwoot(0, 'rodada_cancelada_por_limite_de_tempo', 'cancelado')
    // Depois do limite o que volta à fila não gasta tentativa (não foi culpa da linha).
    const sbEnvolvido = new Proxy(sb, {
      get: (alvo, nome) => nome !== 'rpc' ? alvo[nome]
        : (rpcNome, args) => alvo.rpc(rpcNome, estourou && rpcNome === 'devolver_da_fila' ? { ...args, p_contar: false } : args),
    })
    const criarClienteEnvolvido = (cfg) => {
      const c = criarCliente(cfg)
      return new Proxy(c, {
        get: (alvo, nome) => (ANTES_DO_ENVIO.includes(nome) && typeof alvo[nome] === 'function')
          ? async (...a) => { if (estourou) throw cancelada(); return alvo[nome](...a) }
          : alvo[nome],
      })
    }
    // Rede de segurança: uma chamada ao banco que nunca responde não pode prender o waitUntil para sempre.
    let duro
    const preso = new Promise((resolve) => { duro = setTimeout(() => resolve({ preso: true }), limiteMs + gracaMs) })
    let r
    try { r = await Promise.race([rodarTudo({ env, sb: sbEnvolvido, criarCliente: criarClienteEnvolvido, agora, tipos }), preso]) } finally { clearTimeout(timer); clearTimeout(duro) }
    if (r.preso) estourou = true
    if (estourou) { console.error('disparo imediato passou do limite de tempo; o resto da fila foi devolvido:', tipos.join(',')); return { rodou: true, motivo: 'limite_de_tempo', ...(r.preso ? {} : { status: r.status }) } }
    if (r.status !== 200) console.error('disparo imediato terminou com status', r.status, tipos.join(','))
    return { rodou: true, status: r.status }
  } catch (e) {
    console.error('falha no disparo imediato:', String(e?.message ?? e).slice(0, 120))
    return { rodou: false, motivo: 'excecao' }
  }
}
