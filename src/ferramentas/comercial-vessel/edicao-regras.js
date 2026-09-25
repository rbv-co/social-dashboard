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
 */
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

const dia = (q) => (q ? String(q).slice(0, 10) : '')

export function edicaoDoEncontro(encontro, edicoes) {
  const d = dia(encontro?.quando)
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
