/* As gavetas da Frota: cada seção vira um bloco que abre e fecha.
 *
 * O pedido do dono: "as seções você pode minimizar em gavetas pra otimizar
 * informação e espaço". A aba Gestão tinha seis blocos empilhados, e chegar na
 * lista de veículos era rolar tudo.
 *
 * A ARMADILHA, e é ela que decide o desenho deste arquivo: pra quem tem
 * dificuldade de uso — e quem usa esta ferramenta é um policial aposentado que
 * a tem —, gaveta fechada é informação que SUMIU. Se "Problemas em aberto hoje"
 * estiver fechado com um pneu furado dentro, ninguém vê, e a gaveta deixou de
 * economizar espaço pra passar a esconder aviso.
 *
 * Daí as duas regras que este módulo existe pra garantir:
 *
 *   1. ABRE SOZINHA a gaveta que tem algo esperando a pessoa. Fica fechada a
 *      que é consulta.
 *   2. O TÍTULO FECHADO JÁ RESPONDE — "faltam 8 de 10 hoje", "2 pedidos". É a
 *      mesma ideia dos botões rápidos, que o dono aprovou: a resposta chega
 *      antes do clique.
 *
 * E o que a pessoa decidir vence: se ela abriu ou fechou uma gaveta com a mão,
 * é assim que ela volta a encontrá-la — decisão do dono, escolhida entre
 * "lembra do jeito que você deixou" e "sempre começa no padrão". */

const PREFIXO = 'frota:gavetas'

/** A memória é POR PESSOA, não por navegador — mesma razão do tutorial-visto:
 *  o jeito que uma pessoa arruma a tela não é o jeito da outra. */
function chaveDe(usuarioId) {
  return `${PREFIXO}:${usuarioId || 'anonimo'}`
}

/**
 * O que a pessoa deixou aberto ou fechado, da última vez. Devolve um objeto
 * `{ [chaveDaGaveta]: true|false }` — chave ausente significa "ela nunca mexeu
 * nesta", e aí quem manda é o padrão da gaveta.
 *
 * Nunca lança: armazém bloqueado (modo privado) ou conteúdo estragado devolvem
 * `{}`, e a tela cai toda no padrão. Uma gaveta que não abre por causa de um
 * JSON quebrado seria informação escondida por defeito técnico.
 */
export function lerPreferencias(armazem, usuarioId) {
  if (!armazem || typeof armazem.getItem !== 'function') return {}
  try {
    const cru = armazem.getItem(chaveDe(usuarioId))
    if (!cru) return {}
    const obj = JSON.parse(cru)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    // Só booleanos entram: um valor estranho gravado por uma versão futura não
    // pode virar "gaveta meio aberta".
    const limpo = {}
    for (const [k, v] of Object.entries(obj)) if (typeof v === 'boolean') limpo[k] = v
    return limpo
  } catch (e) { return {} }
}

/** Guarda a decisão da pessoa. Falhar aqui não quebra nada: ela só não é
 *  lembrada na próxima vez. */
export function gravarPreferencias(armazem, usuarioId, prefs) {
  try { armazem?.setItem(chaveDe(usuarioId), JSON.stringify(prefs || {})) } catch (e) { /* modo privado */ }
}

/**
 * A gaveta está aberta AGORA?
 *
 * Ordem de quem manda, e ela importa:
 *   1. `urgente` — tem algo esperando a pessoa. Abre, mesmo que ela tenha
 *      fechado antes. É a guarda contra a gaveta virar esconderijo: um problema
 *      que apareceu hoje não pode ficar atrás de uma decisão tomada ontem.
 *   2. O que a pessoa escolheu, se ela escolheu.
 *   3. O padrão da gaveta.
 */
export function estaAberta({ preferencia, urgente, padraoAberta }) {
  if (urgente) return true
  if (typeof preferencia === 'boolean') return preferencia
  return !!padraoAberta
}

/**
 * O estado de cada gaveta, pronto pra tela desenhar.
 *
 * `definicoes` é a lista de `{ chave, titulo, estado, urgente, padraoAberta,
 * vazia }`, montada por quem conhece os dados. Este módulo não sabe o que é um
 * checklist — ele só aplica a regra.
 *
 * Gaveta VAZIA some da lista em vez de virar um título que abre pro nada: é o
 * mesmo motivo pelo qual "Problemas em aberto hoje" não deve existir num dia
 * sem problema. Mas atenção — `vazia` é decisão de quem chama, e "não carregou"
 * NÃO é vazia: sumir com a gaveta porque a consulta falhou seria a tela dizendo
 * que está tudo bem sobre o que ela não conseguiu ler.
 */
export function gavetasVisiveis(definicoes, preferencias) {
  const prefs = preferencias || {}
  return (definicoes || [])
    .filter((d) => d && !d.vazia)
    .map((d) => ({
      ...d,
      aberta: estaAberta({
        preferencia: prefs[d.chave], urgente: d.urgente, padraoAberta: d.padraoAberta,
      }),
      // A tela desabilita o toque quando a gaveta está aberta POR URGÊNCIA:
      // deixar fechar o que está gritando devolveria o esconderijo.
      travadaAberta: !!d.urgente,
    }))
}

/** O texto que acompanha o título quando a gaveta está fechada. Nulo quando não
 *  se sabe — e aí a tela não escreve linha nenhuma, em vez de escrever "0". */
export function resumoDaGaveta(d) {
  return d && typeof d.estado === 'string' && d.estado ? d.estado : null
}
