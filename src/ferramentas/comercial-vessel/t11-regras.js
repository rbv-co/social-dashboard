/* AS REGRAS DA T11 — as bases de controle do Stylist Circle: o funil da
 * stylist, a situação do encontro, o convite de cada convidada e o placar.
 *
 * ⚠️ AS LISTAS DAQUI SÃO ESPELHO DAS LISTAS FECHADAS DO BANCO
 * (`db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql`). O banco
 * é quem recusa; estas só dão o rótulo em português e decidem o que a tela
 * oferece. Um valor que só existisse aqui seria um botão que o banco recusa.
 *
 * ⚠️ E MORAM FORA DO `.vue` PELO MOTIVO DE SEMPRE: `.vue` não roda na suíte.
 */
import { proporcao, razao } from './estatistica.js'

// ── o funil da stylist ──────────────────────────────────────────────────────

/** Os onze estágios, na ordem do documento: o fluxo principal e as saídas. */
export const ESTAGIOS_DA_STYLIST = {
  prospectado: 'Prospectado',
  contatado: 'Contatado',
  interessado: 'Interessado',
  em_negociacao: 'Em negociação',
  ativado: 'Evento agendado e ativado',
  evento_realizado: 'Evento realizado',
  recorrente: 'Recorrente',
  sem_retorno: 'Sem retorno',
  nao_interessado: 'Não interessado',
  pausado: 'Pausado',
  inativo: 'Inativo',
}

/**
 * ⚠️ OS TRÊS DO MEIO NÃO SE ESCOLHEM: saem dos encontros, pelo gatilho do
 * banco. Oferecê-los no formulário seria deixar digitar um indicador — e o
 * banco recusaria com `estagio_automatico` de qualquer jeito.
 */
export const ESTAGIOS_AUTOMATICOS = ['ativado', 'evento_realizado', 'recorrente']

/**
 * O que o formulário de corrigir oferece. Quem já teve encontro (`ativada_em`)
 * não volta para antes dele: sobram só as saídas.
 */
export function estagiosDeEscolher(ativadaEm) {
  const antesDoEncontro = ['prospectado', 'contatado', 'interessado', 'em_negociacao']
  return Object.keys(ESTAGIOS_DA_STYLIST).filter((k) =>
    !ESTAGIOS_AUTOMATICOS.includes(k) && !(ativadaEm && antesDoEncontro.includes(k)))
}

export function seloDoEstagio(estagio) {
  const texto = ESTAGIOS_DA_STYLIST[estagio] || estagio || 'Sem estágio'
  if (['ativado', 'evento_realizado', 'recorrente'].includes(estagio)) return { texto, classe: 'cv-selo-viva' }
  return { texto, classe: 'cv-selo-fim' }
}

export const ORIGENS_DE_CONTATO = {
  indicacao: 'Indicação',
  pesquisa: 'Pesquisa',
  evento: 'Evento',
  inbound: 'Veio sozinha (inbound)',
}

export const LOJAS = { iguatemi: 'Iguatemi', tivoli: 'Tivoli', parkshopping: 'ParkShopping' }

// ── o encontro ──────────────────────────────────────────────────────────────

export const STATUS_DO_ENCONTRO = {
  em_planejamento: 'Em planejamento',
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  reagendado: 'Reagendado',
  cancelado: 'Cancelado',
  nao_realizado: 'Não realizado',
}

/** Os dois desfechos que o documento manda explicar. */
export function precisaDeMotivo(status) {
  return status === 'cancelado' || status === 'nao_realizado'
}

/**
 * O selo do encontro. ⚠️ ARQUIVADA VENCE: é o que não devia ter existido, e
 * dizer "Realizado" para uma duplicata arquivada contaria uma história falsa.
 */
export function seloDoStatus(e) {
  if (e?.arquivada) return { texto: 'Arquivada', classe: 'cv-selo-fim' }
  const status = e?.status || 'agendado'
  const texto = STATUS_DO_ENCONTRO[status] || status
  if (status === 'cancelado' || status === 'nao_realizado') return { texto, classe: 'cv-selo-fim' }
  return { texto, classe: 'cv-selo-viva' }
}

export function mensagemDeSituacaoDoEncontro(situacao) {
  switch (situacao) {
    case 'ok': return ''
    case 'sem_permissao': return 'Você não tem a permissão de Atendimentos para mudar a situação do encontro.'
    case 'nao_achei': return 'Não achei mais este encontro — a lista pode ter mudado. Recarregue e tente de novo.'
    case 'status_invalido': return 'Escolha uma situação da lista.'
    case 'sem_motivo': return 'Escreva o motivo. Encontro cancelado ou não realizado precisa dele.'
    case 'realizado_no_futuro': return 'A data de realização não pode ser depois de hoje.'
    default: return 'Não consegui gravar agora. Tente de novo em um instante.'
  }
}

// ── a convidada ─────────────────────────────────────────────────────────────

/** A situação do convite, calculada no banco (`vessel_situacao_do_convite`). */
export const SITUACOES_DO_CONVITE = {
  convidada: 'Convidada',
  convite_enviado: 'Convite enviado',
  confirmada: 'Confirmada',
  presente: 'Presente',
  nao_respondeu: 'Não respondeu',
  recusou: 'Recusou',
  nao_compareceu: 'Confirmou e não compareceu',
}

export function seloDoConvite(situacao) {
  const texto = SITUACOES_DO_CONVITE[situacao] || situacao || '—'
  if (situacao === 'presente' || situacao === 'confirmada') return { texto, classe: 'cv-selo-viva' }
  return { texto, classe: 'cv-selo-fim' }
}

/**
 * O que a convidada ainda pode ter marcado, na ordem em que acontece. Cada
 * gesto é UM botão, e só aparece quando faz sentido: "Convite enviado" some
 * depois de enviado; "Veio" e "Não veio" aparecem sempre, porque a gerente
 * pode ter de corrigir.
 */
export function gestosDaConvidada(c) {
  const g = []
  if (!c?.convite_enviado_em && !c?.rsvp && !['realizado', 'no_show'].includes(c?.status)) {
    g.push({ gesto: 'enviado', rotulo: 'Convite enviado' })
  }
  if (!['realizado', 'no_show'].includes(c?.status)) {
    if (c?.rsvp !== 'sim') g.push({ gesto: 'sim', rotulo: 'Confirmou' })
    if (c?.rsvp !== 'nao') g.push({ gesto: 'nao', rotulo: 'Recusou' })
  }
  if (c?.status !== 'realizado') g.push({ gesto: 'realizado', rotulo: 'Veio' })
  if (c?.status !== 'no_show') g.push({ gesto: 'no_show', rotulo: 'Não veio' })
  return g
}

/** Espelha só o que o banco confere primeiro; o resto é dele. */
export function problemasDaConvidada({ nome, whatsapp, email } = {}) {
  const p = []
  if (!nome || !String(nome).trim()) p.push('Escreva o nome da convidada.')
  const digitos = String(whatsapp || '').replace(/\D/g, '')
  if (digitos.length < 10) p.push('Escreva o WhatsApp com DDD.')
  const e = String(email || '').trim()
  if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) p.push('Este e-mail não parece completo.')
  return p
}

export function mensagemDeConvidar(situacao) {
  switch (situacao) {
    case 'ok': return ''
    case 'ja_estava': return 'Ela já estava neste encontro — é a mesma convidada, não uma segunda.'
    case 'sem_permissao': return 'Você não tem a permissão de Atendimentos para incluir convidadas.'
    case 'nao_achei': return 'Não achei mais este encontro — a lista pode ter mudado. Recarregue e tente de novo.'
    case 'encontro_fechado': return 'Este encontro foi cancelado ou arquivado: não recebe mais convidadas.'
    case 'sem_nome': return 'Escreva o nome da convidada.'
    case 'whatsapp_invalido': return 'Este WhatsApp não dá para usar. Confira o número (com DDD).'
    case 'email_invalido': return 'Este e-mail não parece completo.'
    default: return 'Não consegui incluir agora. Tente de novo em um instante.'
  }
}

export function mensagemDeMarcar(situacao) {
  switch (situacao) {
    case 'ok': return ''
    case 'sem_permissao': return 'Você não tem a permissão de Atendimentos para marcar isto.'
    case 'nao_achei': return 'Não achei mais esta convidada — recarregue e tente de novo.'
    default: return 'Não consegui gravar agora. Tente de novo em um instante.'
  }
}

/** "WhatsApp 55 19 99999-9999" legível, sem inventar dígito. */
export function telefoneLegivel(canonico) {
  const d = String(canonico || '').replace(/\D/g, '')
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (canonico || '')
}

// ── os 45 dias ──────────────────────────────────────────────────────────────

/**
 * O aviso de quem agenda antes da próxima data permitida (último encontro
 * realizado + 45 dias). ⚠️ É AVISO, NÃO TRAVA — o banco não recusa. Devolve a
 * frase, ou '' quando não há o que dizer.
 */
export function avisoDos45Dias(proximaDataPermitida, quandoEscolhido) {
  if (!proximaDataPermitida || !quandoEscolhido) return ''
  const dia = String(quandoEscolhido).slice(0, 10)
  const limite = String(proximaDataPermitida).slice(0, 10)
  if (dia >= limite) return ''
  const [a, m, d] = limite.split('-')
  return `Esta stylist só completa 45 dias do último encontro em ${d}/${m}/${a}. `
    + 'Dá para marcar assim mesmo, mas fica fora da cadência combinada.'
}

/**
 * A próxima data permitida de uma stylist, a partir da lista de encontros que
 * a tela do Private Edit já tem (`realizado_em` + 45 dias, do mais recente).
 * ⚠️ É A MESMA CONTA DE `vessel_rastreio_dos_stylists`, feita sobre os
 * encontros não arquivados — os mesmos que o banco considera.
 */
export function proximaDataPermitidaDaLista(encontros, stylist) {
  const datas = (Array.isArray(encontros) ? encontros : [])
    .filter((e) => e?.stylist === stylist && e?.status === 'realizado' && e?.realizado_em && !e?.arquivada)
    .map((e) => String(e.realizado_em).slice(0, 10)).sort()
  if (!datas.length) return null
  const [a, m, d] = datas[datas.length - 1].split('-').map(Number)
  const limite = new Date(Date.UTC(a, m - 1, d + 45))
  return limite.toISOString().slice(0, 10)
}

// ── o placar ────────────────────────────────────────────────────────────────

export const PERIODOS_DO_PLACAR = {
  mes: 'Este mês',
  '30': 'Últimos 30 dias',
  '90': 'Últimos 90 dias',
  tudo: 'Desde o início',
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * `p_de`/`p_ate` do placar, a partir de uma escolha e de "hoje" (local).
 * ⚠️ "Este mês" vai até o ÚLTIMO dia do mês, não até hoje: um encontro marcado
 * para o dia 28 é deste mês e tem de estar na conta de agendados.
 * ⚠️ "Desde o início" manda os dois nulos, e o banco não corta o futuro.
 */
export function periodoDoPlacar(escolha, hoje = new Date()) {
  const h = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  if (escolha === 'tudo') return { p_de: null, p_ate: null }
  if (escolha === 'mes') {
    return { p_de: ymd(new Date(h.getFullYear(), h.getMonth(), 1)),
             p_ate: ymd(new Date(h.getFullYear(), h.getMonth() + 1, 0)) }
  }
  const dias = Number(escolha) || 30
  const de = new Date(h); de.setDate(de.getDate() - (dias - 1))
  return { p_de: ymd(de), p_ate: ymd(h) }
}

/**
 * As taxas do placar, cada uma com o numerador e o denominador que a compõem.
 * ⚠️ PROPORÇÃO SÓ ONDE CADA UM DO DENOMINADOR PODE OU NÃO VIRAR O NUMERADOR
 * (ativada, realizado, presente, comprou). Ticket e receita por cabeça são
 * RAZÃO — passam de 1 e não têm faixa de erro de proporção.
 */
export function taxasDoPlacar(pl) {
  const n = (x) => Number(x) || 0
  return {
    ativacao: proporcao(n(pl?.ativadas), n(pl?.prospectadas)),
    realizacao: proporcao(n(pl?.encontros_realizados), n(pl?.encontros_agendados)),
    showRate: proporcao(n(pl?.presentes), n(pl?.confirmadas)),
    repeticao: proporcao(n(pl?.recorrentes_ate_o_fim), n(pl?.ativadas_ate_o_fim)),
    conversao: proporcao(n(pl?.compradoras), n(pl?.presentes)),
    ticket: razao(n(pl?.receita), n(pl?.vendas)),
    receitaPorConvidada: razao(n(pl?.receita), n(pl?.presentes)),
    receitaPorEncontro: razao(n(pl?.receita), n(pl?.encontros_realizados)),
    pecasPorCliente: razao(n(pl?.pecas), n(pl?.compradoras)),
  }
}
