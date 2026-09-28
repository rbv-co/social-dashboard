/* AS REGRAS DO EVENTO — a edição do Stylist Circle agora É O EVENTO, POR PRAÇA.
 *
 * Decisão do dono (25/09/2026): o placar não é mensal, é da edição. Limeira
 * pode estar na edição 2 com Campinas na 1 — por isso a edição pertence a uma
 * praça, e nunca ao calendário.
 *
 * ⚠️ O ENCONTRO (Private Edit) NÃO CAI NA EDIÇÃO PELA DATA: ele pertence ao
 * EVENTO DE ORIGEM da stylist — a edição em que ela esteve PRESENTE pela
 * primeira vez (`eventoDeOrigem`). Duas stylists da mesma praça podem estar
 * em eventos diferentes ao mesmo tempo; a data do encontro não decide nada.
 * (A regra antiga, por data/janela — `edicaoDoEncontro` —, saiu na Task 4
 * junto com o último uso, o "fora de edição" da tela do Private Edit.)
 *
 * ⚠️ O DIA DE UMA MARCA DA TURMA É O DIA EM SÃO PAULO, nunca em UTC — ver
 * `diaDoInstante`.
 */
import { hojeEmSaoPaulo } from './agenda-regras.js'
export const SITUACOES_DA_EDICAO = { planejada: 'Planejada', aberta: 'Aberta', encerrada: 'Encerrada' }

export const rotuloDaEdicao = (e) => `${e?.praca_nome ?? ''} · Edição ${e?.numero ?? '?'}`

/**
 * O MESMO rótulo, SEM a praça — para quando o contexto já diz qual é (um
 * select já recortado por praça, uma lista embaixo do nome da praça). Repetir
 * a praça nesses dois lugares foi achado na Rodada 1 de conserto da Task 7:
 * "Campinas · Vessel Campinas" e "Campinas · Edição 2" dentro de um select que
 * já só tem edição de Campinas.
 */
export const rotuloCurtoDaEdicao = (e) => `Edição ${e?.numero ?? '?'}${e?.nome ? ` — ${e.nome}` : ''}`

/* ⚠️ O DIA DE UM INSTANTE (`convidada_em`, `presente_em`…): é `timestamptz` e
 * chega em UTC. Cortar os 10 primeiros caracteres dá o dia em UTC — três
 * horas antes de São Paulo: a presença das 22h do dia do evento viraria o dia
 * SEGUINTE. O formatador é o MESMO que a casa já usa (`hojeEmSaoPaulo`,
 * agenda-regras.js). Data inválida devolve vazio em vez de estourar. */
const diaDoInstante = (q) => {
  if (!q) return ''
  const d = q instanceof Date ? q : new Date(q)
  return Number.isNaN(d.getTime()) ? '' : hojeEmSaoPaulo(d)
}
// 'AAAA-MM-DD…' → 'DD/MM' (o evento é deste ano ou do próximo: o dia e o mês bastam)
const diaEMes = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? `${m[3]}/${m[2]}` : ''
}

/* O EVENTO DE ORIGEM de uma stylist: a edição em que ela esteve PRESENTE pela
 * primeira vez. `linhas` = as linhas de participação dela em cada edição
 * (`[{ edicao_id, presente_em }]`); sem nenhuma presença, não tem origem.
 * ⚠️ Empate no MESMO instante (dado de teste/migração) desempata pelo menor
 * `edicao_id` — precisa de ALGUM critério determinístico, e é o único que não
 * depende da ordem de chegada das linhas. */
export function eventoDeOrigem(linhas) {
  const com = (Array.isArray(linhas) ? linhas : []).filter((l) => l?.presente_em)
  if (!com.length) return null
  com.sort((a, b) => (new Date(a.presente_em) - new Date(b.presente_em)) || (a.edicao_id - b.edicao_id))
  return com[0].edicao_id
}

/* O RÓTULO de um encontro: o da edição de ORIGEM da stylist dele — nunca a
 * edição vigente na data do encontro (ver aviso no topo do arquivo). Sem
 * stylist ou sem origem conhecida, 'Sem evento' — nunca esconder a linha. */
export function rotuloDoEncontro(encontro, origemPorStylist, edicoes) {
  const id = encontro?.stylist_id != null ? origemPorStylist?.[encontro.stylist_id] : null
  const ed = id != null ? (Array.isArray(edicoes) ? edicoes : []).find((e) => e.id === id) : null
  return ed ? rotuloDaEdicao(ed) : 'Sem evento'
}

const ROTULOS_DO_FUNIL = [
  ['convidadas', 'Convidadas'], ['confirmaram', 'Confirmaram'], ['presentes', 'Presentes'],
  ['agendaram', 'Agendaram Private Edit'], ['fizeram', 'Fizeram'], ['repetiram', 'Repetiram'],
]
const pct = (n, base) => (base > 0 ? Math.round((n / base) * 100) : null)

/* O FUNIL DE UM EVENTO: cada passo é medido SOBRE O ANTERIOR (a % de
 * confirmaram é sobre convidadas, a de presentes é sobre confirmaram, etc.) —
 * exceto o primeiro passo, que não tem % por não ter passo anterior.
 * ⚠️ "Agendaram/Fizeram/Repetiram" só contam quem tem ORIGEM NESTE evento —
 * uma stylist presente aqui mas com origem em outro evento não entra (o
 * Private Edit dela já está contado no funil de origem dela).
 * A META (`meta.pct`) é a % de agendaram sobre PRESENTES, não sobre convidadas
 * — e com zero presentes não existe percentual: `null` (a tela escreve "—"),
 * nunca 0%, que mentiria "meta não batida" quando não há base para medir. */
export function funilDoEvento(turma, encontros, edicaoId) {
  const t = Array.isArray(turma) ? turma : []
  const ev = Array.isArray(encontros) ? encontros : []
  const presentes = t.filter((s) => s.presente_em)
  const daqui = presentes.filter((s) => s.origem === edicaoId)
  const deles = (s) => ev.filter((e) => e.stylist_id === s.stylist_id)
  const realizados = (s) => deles(s).filter((e) => e.status === 'realizado').length
  const n = {
    convidadas: t.length,
    confirmaram: t.filter((s) => s.confirmou_em || s.presente_em).length,
    presentes: presentes.length,
    agendaram: daqui.filter((s) => deles(s).some((e) => e.status !== 'em_planejamento')).length,
    fizeram: daqui.filter((s) => realizados(s) >= 1).length,
    repetiram: daqui.filter((s) => realizados(s) >= 2).length,
  }
  const passos = ROTULOS_DO_FUNIL.map(([chave, rotulo], i) => ({
    chave, rotulo, n: n[chave], pct: i === 0 ? null : pct(n[chave], n[ROTULOS_DO_FUNIL[i - 1][0]]),
  }))
  const metaPct = pct(n.agendaram, n.presentes)
  return { passos, indisponiveis: t.filter((s) => s.indisponivel_em).length,
    meta: { pct: metaPct, bateu: metaPct == null ? null : metaPct >= 50 } }
}

export function placarPorEtapa(etapas, stylists) {
  const lista = Array.isArray(stylists) ? stylists : []
  return [...(Array.isArray(etapas) ? etapas : [])]
    .sort((a, b) => a.ordem - b.ordem)
    .map((e) => ({ id: e.id, nome: e.nome, ordem: e.ordem, tipo: e.tipo,
      stylists: lista.filter((s) => s?.etapa_id === e.id).length }))
}

/* A LINHA DA FICHA: de que evento ela veio — "Veio pelo evento: Edição 1 ·
 * Campinas · 15/10" (a data é a DO EVENTO, `comeca_em`). `edicao` é a edição
 * de ORIGEM (a da 1ª presença, `vessel_eventos_de_origem`); sem ela, "Ainda
 * sem evento" — escrito, nunca a linha sumida. */
export function fraseDaOrigem(edicao) {
  if (!edicao) return 'Ainda sem evento'
  const dia = diaEMes(edicao.comeca_em)
  return `Veio pelo evento: Edição ${edicao.numero ?? '?'} · ${edicao.praca_nome ?? ''}${dia ? ` · ${dia}` : ''}`
}

/* AS 3 MARCAS de uma linha da turma (`vessel_edicao_turma`), na ordem do
 * evento. "Confirmou" vale também para quem esteve presente sem a marca de
 * confirmação (pulou a etapa) — a MESMA conta do funil (`funilDoEvento`). */
export function marcasDaLinha(l) {
  const dia = (q) => diaEMes(diaDoInstante(q))
  const confirmou = !!(l?.confirmou_em || l?.presente_em)
  return [
    { chave: 'convidada', feita: !!l?.convidada_em,
      texto: l?.convidada_em ? `Convidada em ${dia(l.convidada_em)}` : 'Sem data de convite' },
    { chave: 'confirmou', feita: confirmou,
      texto: l?.confirmou_em ? `Confirmou em ${dia(l.confirmou_em)}` : (confirmou ? 'Confirmou' : 'Ainda não confirmou') },
    { chave: 'presente', feita: !!l?.presente_em,
      texto: l?.presente_em ? `Presente em ${dia(l.presente_em)}` : 'Ainda sem presença' },
  ]
}

/* A META DO GROWTH PLAN escrita: agendaram sobre PRESENTES ≥ 50%. Verde
 * (`viva`) se bateu, âmbar (`queda`) se não; sem presentes, "—" e SEM cor —
 * nunca 0%, que diria "não bateu" sem base para medir. Mesmo formato de
 * `metaDoComparecimento` (qualificacao-regras.js), lido por `meta-do-numero.vue`. */
export function metaDoEvento(meta) {
  const texto = 'meta: 50% ou mais das presentes'
  if (meta?.pct == null) return { valor: '—', tom: null, texto: 'sem presentes ainda', meta: texto }
  return meta.bateu
    ? { valor: `${meta.pct}%`, tom: 'viva', texto: 'meta batida', meta: texto }
    : { valor: `${meta.pct}%`, tom: 'queda', texto: 'abaixo da meta', meta: texto }
}

/* A VOLTA do "Indisponível na data": a nota que o banco grava no histórico de
 * etapas quando uma edição nova da praça abre ("Voltou: indisponível na
 * Edição N · Praça"). A MAIS RECENTE — ela pode ter voltado mais de uma vez. */
export function notaDaVolta(historico) {
  const voltas = (Array.isArray(historico) ? historico : [])
    .filter((h) => typeof h?.nota === 'string' && h.nota.startsWith('Voltou: indisponível'))
  voltas.sort((a, b) => String(b.em).localeCompare(String(a.em)))
  return voltas[0]?.nota ?? ''
}

/* A MESMA nota, só enquanto ela ainda está em CONVIDADO (a etapa para onde a
 * volta a levou): depois que avança, a volta é história, não notícia. */
export function notaDaVoltaSeAindaConvidada(historico, nomeDaEtapaAtual) {
  const convidada = String(nomeDaEtapaAtual ?? '').trim().toLowerCase() === 'convidado'
  return convidada ? notaDaVolta(historico) : ''
}
