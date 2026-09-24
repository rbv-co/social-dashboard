/* AS REGRAS DO CRM DA STYLIST — o quadro por etapas, a tela "Etapas do funil"
 * e o histórico de contatos.
 *
 * ⚠️ DESDE 24/09/2026 O FUNIL É CONFIGURÁVEL (decisão do dono): as etapas são
 * linhas de `vessel_stylist_etapas`, lidas por `vessel_stylist_etapas()`, cada
 * uma com { id, nome, ordem, tipo: 'funil' | 'saida', conta_como_prospectada,
 * stylists }. NADA MUDA DE ETAPA SOZINHO: nem encontro, nem contato. Quem muda
 * é a pessoa, na ficha ou no quadro (`vessel_stylist_mover_de_etapa`).
 *
 * ⚠️ AS LISTAS DE CANAL E RESULTADO SÃO ESPELHO DOS CHECK DE
 * `vessel_stylist_contatos`. O teste lê a migration: se um lado mudar sozinho,
 * a suíte reprova.
 */
import { posicaoDaFaixa } from './qualificacao-regras.js'

export const CANAIS = {
  whatsapp: 'WhatsApp', ligacao: 'Ligação', instagram: 'Instagram', email: 'E-mail', presencial: 'Presencial',
}
export const RESULTADOS = {
  sem_resposta: 'Sem resposta', conversou: 'Conversou', interesse: 'Demonstrou interesse',
  proposta: 'Pediu proposta', marcou_encontro: 'Marcou encontro', recusou: 'Recusou',
}

// ── as etapas ───────────────────────────────────────────────────────────────
const porOrdem = (a, b) => (a.ordem - b.ordem) || (a.id - b.id)

/** As etapas de funil, na ordem. */
export function etapasDoFunil(etapas) {
  return (Array.isArray(etapas) ? etapas : []).filter((e) => e?.tipo === 'funil').sort(porOrdem)
}

/** As saídas, na ordem. */
export function etapasDeSaida(etapas) {
  return (Array.isArray(etapas) ? etapas : []).filter((e) => e?.tipo === 'saida').sort(porOrdem)
}

/** A próxima etapa de FUNIL depois da atual, pela ordem — ou nula (última, ou
 * a atual é uma saída: de saída não se "avança", se escolhe). */
export function proximaEtapa(etapas, etapaId) {
  const todas = (Array.isArray(etapas) ? etapas : []).slice().sort(porOrdem)
  const atual = todas.find((e) => e.id === etapaId)
  if (!atual || atual.tipo !== 'funil') return null
  return todas.find((e) => e.tipo === 'funil' && porOrdem(e, atual) > 0) || null
}

/** A primeira etapa de funil: onde entra quem é cadastrada. */
export function primeiraEtapa(etapas) {
  return etapasDoFunil(etapas)[0] || null
}

/** O mapa { "id": nome } que o filtro "Etapa" da barra usa (o valor do
 * `<select>` é texto, por isso a chave também). Funil primeiro, saídas depois. */
export function etapasParaFiltrar(etapas) {
  return Object.fromEntries([...etapasDoFunil(etapas), ...etapasDeSaida(etapas)].map((e) => [String(e.id), e.nome]))
}

export function prazoAtrasado(prazo, hoje) {
  return !!prazo && String(prazo).slice(0, 10) < String(hoje).slice(0, 10)
}

/**
 * O quadro: uma coluna por etapa de FUNIL, na ordem, e as saídas juntas numa
 * coluna só, no fim. Devolve [{ chave, titulo, etapa, stylists }].
 * ⚠️ Uma stylist com etapa que a lista de etapas não conhece (a lista mudou
 * entre as duas leituras) cai na PRIMEIRA coluna, nunca some do quadro.
 * ⚠️ `ordem: 'faixa'` (scorecard, 24/09): dentro de cada coluna, A, B, C e sem
 * nota primeiro — e só depois o prazo. Sem ela, a ordem de sempre (atrasada,
 * prazo, nome). A nota NÃO muda a coluna de ninguém: só a ordem dentro dela.
 */
export function colunasDoQuadro(lista, etapas, hoje, ordem = null) {
  const funil = etapasDoFunil(etapas)
  const saidas = new Set(etapasDeSaida(etapas).map((e) => e.id))
  const colunas = funil.map((e) => ({ chave: String(e.id), titulo: e.nome, etapa: e, stylists: [] }))
  const saida = { chave: 'saidas', titulo: 'Saídas', etapa: null, stylists: [] }
  for (const s of Array.isArray(lista) ? lista : []) {
    if (saidas.has(s?.etapa_id)) { saida.stylists.push(s); continue }
    const destino = colunas.find((c) => c.etapa.id === s?.etapa_id) || colunas[0]
    if (destino) destino.stylists.push(s)
  }
  const porPrazo = (a, b) => {
    const aa = prazoAtrasado(a.proxima_acao_em, hoje), bb = prazoAtrasado(b.proxima_acao_em, hoje)
    if (aa !== bb) return aa ? -1 : 1
    const pa = a.proxima_acao_em || '9999', pb = b.proxima_acao_em || '9999'
    if (pa !== pb) return pa < pb ? -1 : 1
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
  }
  const porFaixa = (a, b) => (posicaoDaFaixa(a.faixa) - posicaoDaFaixa(b.faixa)) || porPrazo(a, b)
  const todas = [...colunas, saida]
  for (const c of todas) c.stylists.sort(ordem === 'faixa' ? porFaixa : porPrazo)
  return todas
}

/** O que está errado no nome de uma etapa, antes de ir ao banco (o banco
 * confere de novo: nome repetido é dele). */
export function problemasDaEtapa(nome) {
  const t = String(nome ?? '').trim()
  if (!t) return ['Escreva o nome da etapa.']
  if (t.length > 60) return ['O nome da etapa passa de 60 letras. Encurte um pouco.']
  return []
}

/** A frase de cada recusa das funções das etapas e de mover a stylist. */
export function mensagemDasEtapas(situacao) {
  switch (situacao) {
    case 'ok': case 'sem_mudanca': return ''
    case 'sem_permissao': return 'Você não tem a permissão de editar o Stylist Circle para mexer nas etapas.'
    case 'sem_nome': return 'Escreva o nome da etapa.'
    case 'nome_longo': return 'O nome da etapa passa de 60 letras. Encurte um pouco.'
    case 'nome_repetido': return 'Já existe uma etapa com este nome.'
    case 'tipo_invalido': return 'Escolha se a etapa é do funil ou uma saída.'
    case 'nao_achei': return 'Não achei mais esta etapa — a lista pode ter mudado. Recarregue e tente de novo.'
    case 'no_limite': return 'Ela já está na ponta da lista.'
    case 'ultima_do_funil': return 'O funil precisa de pelo menos uma etapa. Esta é a última.'
    case 'etapa_marcada':
      return 'Esta é a etapa que conta como prospectada. Marque outra antes de excluí-la ou de torná-la saída.'
    case 'saida_nao_conta': return 'Uma saída não pode contar como prospectada. Escolha uma etapa do funil.'
    case 'precisa_destino': return 'Há parceiras nesta etapa. Escolha para onde elas vão antes de excluir.'
    case 'destino_invalido': return 'Escolha outra etapa como destino.'
    case 'etapa_invalida': return 'Esta etapa não existe mais. Recarregue e escolha de novo.'
    case 'direcao_invalida': return 'Não consegui mover agora. Tente de novo em um instante.'
    default: return 'Não consegui gravar agora. Tente de novo em um instante.'
  }
}

/** O porquê de uma linha do histórico de etapas, em palavras. */
export function motivoDoHistorico(motivo) {
  return { cadastro: 'Cadastro', mudanca: 'Mudou de etapa', etapa_excluida: 'A etapa foi excluída' }[motivo] || motivo || ''
}

const diaLocal = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export function ultimoContatoEscrito(iso, agora = new Date()) {
  if (!iso) return 'nenhum contato registrado'
  const dias = Math.round((diaLocal(agora) - diaLocal(new Date(iso))) / 86400000)
  if (dias <= 0) return 'último contato hoje'
  if (dias === 1) return 'último contato ontem'
  return `último contato há ${dias} dias`
}
