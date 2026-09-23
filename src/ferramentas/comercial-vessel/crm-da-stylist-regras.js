/* AS REGRAS DO CRM DA STYLIST — o quadro por etapas e o histórico de contatos.
 *
 * ⚠️ AS LISTAS SÃO ESPELHO DOS CHECK DE `vessel_stylist_contatos`, e a
 * sugestão de etapa é espelho de `vessel_stylist_sugestao_de_etapa`. O teste
 * lê a migration: se um lado mudar sozinho, a suíte reprova.
 *
 * ⚠️ A SUGESTÃO NUNCA MUDA NADA: a tela oferece "Mover para X?" e a Ionara
 * decide (decisão do dono, 22/09/2026).
 */
export const CANAIS = {
  whatsapp: 'WhatsApp', ligacao: 'Ligação', instagram: 'Instagram', email: 'E-mail', presencial: 'Presencial',
}
export const RESULTADOS = {
  sem_resposta: 'Sem resposta', conversou: 'Conversou', interesse: 'Demonstrou interesse',
  proposta: 'Pediu proposta', marcou_encontro: 'Marcou encontro', recusou: 'Recusou',
}
export const FLUXO_PRINCIPAL = ['prospectado', 'contatado', 'interessado', 'em_negociacao',
  'ativado', 'evento_realizado', 'recorrente']
export const SAIDAS = ['sem_retorno', 'nao_interessado', 'pausado', 'inativo']

const SUGERE = { conversou: 'contatado', interesse: 'interessado', proposta: 'em_negociacao' }
const MANUAL = { prospectado: 'contatado', contatado: 'interessado', interessado: 'em_negociacao' }

export function sugestaoDeEtapa(resultado, estagio, ativadaEm) {
  if (estagio === 'pausado' || estagio === 'inativo') return null
  if (resultado === 'recusou') return !ativadaEm && estagio !== 'nao_interessado' ? 'nao_interessado' : null
  const alvo = SUGERE[resultado]
  if (!alvo) return null
  // Quem saiu por "sem retorno" ou "não interessado" e voltou a conversar
  // volta ao funil — desde que ainda não tenha tido encontro.
  if (estagio === 'sem_retorno' || estagio === 'nao_interessado') return ativadaEm ? null : alvo
  const de = FLUXO_PRINCIPAL.indexOf(estagio)
  const para = FLUXO_PRINCIPAL.indexOf(alvo)
  return de >= 0 && para > de ? alvo : null
}

export function proximaEtapaManual(estagio) {
  return MANUAL[estagio] || null
}

/** Reabrir uma Saída. Quem já teve encontro volta pelo fato: "sem_retorno"
 * faz o gatilho do banco recalcular a etapa a partir dos encontros. */
export function reabrirPara(ativadaEm) {
  return ativadaEm ? 'sem_retorno' : 'prospectado'
}

export function prazoAtrasado(prazo, hoje) {
  return !!prazo && String(prazo).slice(0, 10) < String(hoje).slice(0, 10)
}

export function colunasDoQuadro(lista, hoje) {
  const colunas = Object.fromEntries(FLUXO_PRINCIPAL.map((e) => [e, []]))
  colunas.saidas = []
  for (const s of Array.isArray(lista) ? lista : []) {
    const destino = SAIDAS.includes(s?.estagio) ? 'saidas' : (colunas[s?.estagio] ? s.estagio : 'prospectado')
    colunas[destino].push(s)
  }
  const ordem = (a, b) => {
    const aa = prazoAtrasado(a.proxima_acao_em, hoje), bb = prazoAtrasado(b.proxima_acao_em, hoje)
    if (aa !== bb) return aa ? -1 : 1
    const pa = a.proxima_acao_em || '9999', pb = b.proxima_acao_em || '9999'
    if (pa !== pb) return pa < pb ? -1 : 1
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
  }
  for (const k of Object.keys(colunas)) colunas[k].sort(ordem)
  return colunas
}

const diaLocal = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export function ultimoContatoEscrito(iso, agora = new Date()) {
  if (!iso) return 'nenhum contato registrado'
  const dias = Math.round((diaLocal(agora) - diaLocal(new Date(iso))) / 86400000)
  if (dias <= 0) return 'último contato hoje'
  if (dias === 1) return 'último contato ontem'
  return `último contato há ${dias} dias`
}
