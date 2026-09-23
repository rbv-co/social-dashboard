// AS CONTAS DA TELA DE ATENDIMENTOS — sem DOM, sem rede, com teste ao lado.
//
// Por que separado da tela: número que se lê na bancada não pode depender de
// abrir um navegador para conferir. A taxa de comparecimento é a meta do
// módulo 16 do Growth Plan (>= 75%), e ela nasce aqui.

/**
 * O QUE CONTA COMO "TINHA HORÁRIO MARCADO".
 *
 * ⚠️ `solicitado` NÃO ENTRA, e isso é decisão do plano, não economia: "pedido
 * de horário não é horário reservado" (módulo 16). Contar pedido como
 * agendamento afundaria a taxa de comparecimento com gente que nunca teve
 * horário — e a loja passaria a perseguir um número que mede outra coisa.
 *
 * `remarcado` e `cancelado` também ficam de fora: quem remarcou tem OUTRO
 * atendimento, e contar os dois contaria a mesma pessoa duas vezes.
 */
export const CONTAM_NA_TAXA = ['confirmado', 'realizado', 'no_show']

/**
 * Como cada situação se chama e se pinta.
 *
 * ⚠️ O `selo` É A CLASSE DE VERDADE, escrita por extenso, e o teste ao lado
 * confere cada uma contra `estilos-globais.css`. Na primeira versão eu inventei
 * `selo-aviso`, que não existe: os selos "Confirmado" e "ensaio" saíam SEM COR
 * nenhuma, e nada quebrou — classe de CSS que não existe não dá erro, só deixa
 * de pintar. Só apareceu na foto da tela.
 */
/*
 * O `tom` é a cor da SITUAÇÃO no cartão (filete) e no selo — a mesma régua do
 * Private Edit e do Stylist Circle (`--situacao-*` em estilos-globais.css,
 * classe `id-tom-<tom>` em identidade-da-ferramenta.css):
 *   pediu horário → andamento (azul: ainda vai acontecer)
 *   confirmado    → confirmada (verde-azulado: disse sim, ainda não veio)
 *   veio          → viva (verde)
 *   não veio      → faltou (vermelho suave: confirmou e não veio)
 *   cancelou      → queda (laranja: caiu)
 *   remarcou      → parada (cinza: esta linha deu lugar a outra)
 */
export const SITUACOES = {
  solicitado: { rotulo: 'Pediu horário', selo: 'selo-neutro', tom: 'andamento' },
  confirmado: { rotulo: 'Confirmado', selo: 'selo-info', tom: 'confirmada' },
  realizado: { rotulo: 'Veio', selo: 'selo-ok', tom: 'viva' },
  no_show: { rotulo: 'Não veio', selo: 'selo-erro', tom: 'faltou' },
  remarcado: { rotulo: 'Remarcou', selo: 'selo-neutro', tom: 'parada' },
  cancelado: { rotulo: 'Cancelou', selo: 'selo-neutro', tom: 'queda' },
}

/** O selo do que é linha de ensaio — laranja: "cuidado, isto não é real". */
export const SELO_DE_ENSAIO = 'selo-atencao'

/** As marcações do dia a dia. Cancelar NÃO está aqui — ver `podeCancelar`. */
export const MARCACOES = [
  { situacao: 'realizado', rotulo: 'Veio' },
  { situacao: 'no_show', rotulo: 'Não veio' },
  { situacao: 'remarcado', rotulo: 'Remarcou' },
]

/**
 * O que dá para marcar nesta linha.
 *
 * ⚠️ A LINHA NUNCA OFERECE O QUE ELA JÁ É: um atendimento marcado "Veio"
 * mostrando um botão "Veio" é ruído, e o que sobra lê-se como corrigir.
 *
 * ⚠️ E UMA LINHA CANCELADA OFERECE AS TRÊS. Parece contraintuitivo, e é de
 * propósito: cancelar por engano tem de ter volta. Esconder as marcações de uma
 * linha cancelada transformaria um clique errado em linha morta para sempre.
 */
export function marcacoesDe(status) {
  return MARCACOES.filter((m) => m.situacao !== status)
}

/**
 * Dá para cancelar esta linha?
 *
 * ⚠️ CANCELAR É O CONSERTO DO CARTÃO REPETIDO. O gerador não impede que a mesma
 * cliente ganhe dois convites para o mesmo dia — acontece quando a Client
 * Advisor erra o nome e refaz o cartão. O convite fantasma fica na agenda e
 * conta na taxa de comparecimento como alguém que não veio. Cancelado sai da
 * conta (ver CONTAM_NA_TAXA) sem destruir o atendimento nem a pessoa.
 *
 * ⚠️ E CANCELAR NÃO É UMA QUARTA MARCAÇÃO SOLTA NA LISTA. Ele é difícil de
 * desfazer no olho de quem lê ("sumiu da conta"), então na tela mora atrás de
 * um passo a mais — o padrão da casa proíbe botão de perigo repetido em toda
 * linha de uma lista.
 */
export const podeCancelar = (status) => status !== 'cancelado'

/** 'AAAA-MM-DD' pelo calendário LOCAL — `toISOString` daria o dia de UTC. */
export function diaLocal(data) {
  const d = data instanceof Date ? data : new Date(data)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * A janela de datas de cada período, em dia local.
 *
 * ⚠️ AS DUAS PONTAS SÃO INCLUSIVAS e o `ate` é sempre HOJE ou depois: a lista
 * precisa mostrar o que ainda VAI acontecer, não só o que já passou. Uma tela
 * de atendimentos que termina em "ontem" é uma agenda que não serve para
 * trabalhar.
 */
export function janelaDoPeriodo(periodo, hoje = new Date()) {
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  const mover = (dias) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias)
  if (periodo === 'hoje') return { de: diaLocal(base), ate: diaLocal(base) }
  if (periodo === 'semana') return { de: diaLocal(mover(-7)), ate: diaLocal(mover(7)) }
  if (periodo === 'proximos') return { de: diaLocal(base), ate: diaLocal(mover(30)) }
  return { de: diaLocal(mover(-30)), ate: diaLocal(mover(30)) }
}

/**
 * A faixa de cima: confirmados, quantos vieram e a taxa de comparecimento.
 *
 * ⚠️ A TAXA É NULA, NÃO ZERO, QUANDO NÃO HÁ BASE. Zero por cento é um fato
 * ("marcaram e ninguém veio"); "ainda não dá para dizer" é outro. Mostrar 0%
 * numa semana sem nenhum agendamento faria a loja correr atrás de um problema
 * que não existe.
 */
export function resumoDosAtendimentos(linhas) {
  const lista = Array.isArray(linhas) ? linhas : []
  const naBase = lista.filter((l) => CONTAM_NA_TAXA.includes(l.status))
  const vieram = lista.filter((l) => l.status === 'realizado').length
  const naoVieram = lista.filter((l) => l.status === 'no_show').length
  const aguardando = lista.filter((l) => l.status === 'confirmado').length
  return {
    total: lista.length,
    naBase: naBase.length,
    vieram,
    naoVieram,
    aguardando,
    pediramHorario: lista.filter((l) => l.status === 'solicitado').length,
    taxa: naBase.length ? vieram / naBase.length : null,
  }
}

/**
 * O que cada pessoa comprou POR CAUSA da visita.
 *
 * ⚠️ A JANELA É UMA ESCOLHA, E ELA PRECISA APARECER NA TELA. Do dia da visita
 * até `dias` depois. Não existe no dado nenhum campo dizendo "esta compra veio
 * daquela visita" — o que existe é a mesma pessoa comprando perto da data.
 * Chamar isso de "conversão" sem dizer a régua é inventar precisão: uma compra
 * no décimo dia entra ou não conforme o número aqui.
 *
 * Compra ANTES da visita nunca entra — não se prepara uma visita por causa de
 * uma compra que já aconteceu.
 */
export function comprasDaVisita(atendimento, pedidos, dias = 7) {
  const dia = diaLocal(atendimento?.quando || atendimento?.criado_em)
  if (!dia || !atendimento?.pessoa_id) return { pedidos: [], total: 0 }
  const [a, m, d] = dia.split('-').map(Number)
  const limite = diaLocal(new Date(a, m - 1, d + dias))
  const casados = (pedidos || []).filter((p) => {
    if (String(p.pessoa_id) !== String(atendimento.pessoa_id)) return false
    const quando = String(p.data_da_venda || p.data_do_pedido || '').slice(0, 10)
    return quando >= dia && quando <= limite
  })
  return {
    pedidos: casados,
    // ⚠️ `receita_liquida` é o dinheiro que ENTROU (itens já com desconto do
    // item, menos o desconto do pedido). O `total_do_bling` sai ~6% maior
    // porque não desconta o desconto do item — usá-lo aqui inflaria a
    // conversão de toda visita.
    total: casados.reduce((s, p) => s + Number(p.receita_liquida ?? p.total_corrigido ?? 0), 0),
  }
}

/** Agrupa por dia, do mais recente para o mais antigo. */
export function porDia(linhas) {
  const mapa = new Map()
  for (const l of Array.isArray(linhas) ? linhas : []) {
    const dia = diaLocal(l.quando || l.criado_em) || 'sem-data'
    if (!mapa.has(dia)) mapa.set(dia, [])
    mapa.get(dia).push(l)
  }
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dia, itens]) => ({
      dia,
      itens: itens.sort((x, y) => String(y.quando || '').localeCompare(String(x.quando || ''))),
    }))
}

/** 15:30 a partir do carimbo, no fuso de quem está lendo. */
export function horaCurta(quando) {
  if (!quando) return ''
  const d = new Date(quando)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "22/09", e o ano só quando não é o ano corrente. */
export function diaCurto(dia, hoje = new Date()) {
  if (!dia || dia === 'sem-data') return 'sem data'
  const [a, m, d] = String(dia).split('-')
  return Number(a) === hoje.getFullYear() ? `${d}/${m}` : `${d}/${m}/${a}`
}

/** (19) 99617-0272 a partir de 5519996170272. */
export function telefoneLegivel(bruto) {
  const so = String(bruto || '').replace(/\D/g, '')
  const sem55 = so.startsWith('55') && so.length >= 12 ? so.slice(2) : so
  if (sem55.length === 11) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 7)}-${sem55.slice(7)}`
  if (sem55.length === 10) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 6)}-${sem55.slice(6)}`
  return bruto || ''
}
