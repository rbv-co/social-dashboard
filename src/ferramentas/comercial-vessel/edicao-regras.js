/* AS REGRAS DA EDIÇÃO — a rodada do Stylist Circle, POR PRAÇA.
 *
 * Decisão do dono (25/09/2026): o placar não é mensal, é da edição. Limeira
 * pode estar na edição 2 com Campinas na 1 — por isso a edição pertence a uma
 * praça, e nunca ao calendário.
 *
 * ⚠️ O ENCONTRO NÃO GUARDA EDIÇÃO: ele pertence à edição da praça dele cuja
 * janela contém o dia. Guardar a edição no encontro faria a mesma data virar
 * duas edições diferentes se alguém corrigisse a janela depois.
 * ⚠️ Encontro fora de qualquer janela devolve NULO e a tela escreve "fora de
 * edição". Sumir com ele seria a tela mentindo.
 *
 * ⚠️ O DIA DO ENCONTRO É O DIA EM SÃO PAULO, nunca em UTC — ver `diaDoInstante`.
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

/* O DIA DE UMA DATA DE CALENDÁRIO (`comeca_em`, `termina_em`): são `date` no
 * banco e chegam como 'AAAA-MM-DD'. Sem hora, sem fuso — cortar é o certo. */
const dia = (q) => (q ? String(q).slice(0, 10) : '')

/* ⚠️ O DIA DE UM INSTANTE (`quando`): é `timestamptz` e chega em UTC. Cortar
 * os 10 primeiros caracteres dá o dia em UTC, e o banco decide a mesma coisa
 * em São Paulo (`(e.quando at time zone 'America/Sao_Paulo')::date`, no `ev`
 * de `vessel_placar_da_edicao`) — três horas de diferença.
 *
 * O estrago: um encontro das 21h em diante no ÚLTIMO dia da janela vira o dia
 * SEGUINTE em UTC. A tela escrevia "fora de edição" enquanto o placar, ao
 * lado, contava o mesmo encontro na edição certa. Um encontro às 21h de
 * 30/09 em São Paulo é 00h de 01/10 em UTC — e a janela terminava em 30/09.
 *
 * O formatador é o MESMO que a casa já usa (`hojeEmSaoPaulo`, agenda-regras.js),
 * e é o mesmo que o banco de mentira usa (`diaEmSaoPaulo`): uma conta só, nos
 * três lugares. Data inválida devolve vazio em vez de estourar — a tela
 * escreve "fora de edição", que é a verdade quando não dá para saber o dia. */
const diaDoInstante = (q) => {
  if (!q) return ''
  const d = q instanceof Date ? q : new Date(q)
  return Number.isNaN(d.getTime()) ? '' : hojeEmSaoPaulo(d)
}

export function edicaoDoEncontro(encontro, edicoes) {
  const d = diaDoInstante(encontro?.quando)
  if (!d) return null
  return (Array.isArray(edicoes) ? edicoes : []).find((e) => e.praca_id === encontro?.praca_id
    && dia(e.comeca_em) <= d
    && (!e.termina_em || d <= dia(e.termina_em))) || null
}

export function placarPorEtapa(etapas, stylists) {
  const lista = Array.isArray(stylists) ? stylists : []
  return [...(Array.isArray(etapas) ? etapas : [])]
    .sort((a, b) => a.ordem - b.ordem)
    .map((e) => ({ id: e.id, nome: e.nome, ordem: e.ordem, tipo: e.tipo,
      stylists: lista.filter((s) => s?.etapa_id === e.id).length }))
}
