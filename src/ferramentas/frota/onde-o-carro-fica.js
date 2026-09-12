/* Onde o carro fica, pra MOSTRAR na tela.
 *
 * O defeito que isto conserta: a lista de carros lia `local_texto` — o texto
 * digitado à mão antes da árvore existir — e nunca o `local_id` que a ficha
 * grava desde a migration 034. Medido em 12/08/2026: 9 dos 10 carros têm
 * `local_id`; em 4 deles o texto está vazio, e o dono apontava o local e a tela
 * ficava em branco. Nos outros 5 era pior de entender: mostrava o texto velho,
 * então parecia que não tinha salvado.
 *
 * A regra: a ÁRVORE VENCE o texto antigo. O texto continua guardado no banco e
 * continua sendo a pista quando não há árvore apontada — nunca é apagado. */

import { caminhoDoLocal, estadoDaEscolha } from '../../compartilhado/arvore-de-locais.js'

/**
 * Devolve `{ curto, completo, tipo }`.
 *
 * `curto` é o que entra no card, que é estreito: local, e ambiente quando há.
 * A MARCA fica de fora do curto de propósito — a empresa do carro é outro campo
 * da ficha, e repeti-la em toda linha rouba a largura do que interessa. No
 * `completo` ela vem, porque lá o caminho tem de identificar sozinho.
 *
 * `tipo` diz DE ONDE veio a resposta, pra tela poder tratar cada caso:
 *  - 'arvore'      → apontado na árvore. O caso bom.
 *  - 'texto'       → só o texto escrito à mão. Continua valendo.
 *  - 'local-sumiu' → tem `local_id` que a árvore não conhece (apagado, ou a
 *                    árvore não carregou). NUNCA vira vazio: campo que esvazia
 *                    sozinho é a mentira mais cara.
 *  - 'vazio'       → nunca foi preenchido.
 */
export function ondeOCarroFica({ arvore, veiculo } = {}) {
  const v = veiculo || {}
  const estado = estadoDaEscolha({
    arvore,
    localId: v.local_id || null,
    comodoId: v.comodo_id || null,
    textoLivre: v.local_texto || '',
  })

  if (estado.tipo === 'escolhido') {
    const { local, comodo } = estado.caminho
    return {
      tipo: 'arvore',
      curto: [local?.nome, comodo?.nome].filter(Boolean).join(' › '),
      completo: estado.caminho.rotulo,
    }
  }

  if (estado.tipo === 'local-sumiu') {
    const texto = estado.textoAntigo || null
    return { tipo: 'local-sumiu', curto: texto, completo: texto }
  }

  if (estado.tipo === 'texto-livre') {
    return { tipo: 'texto', curto: estado.texto, completo: estado.texto }
  }

  return { tipo: 'vazio', curto: null, completo: null }
}

/** Só o texto curto, ou nulo. Atalho pra quem só quer preencher uma linha. */
export function localCurto({ arvore, veiculo } = {}) {
  return ondeOCarroFica({ arvore, veiculo }).curto
}

// `caminhoDoLocal` fica importado de propósito: é a peça que `estadoDaEscolha`
// usa por dentro, e deixá-la à vista aqui evita que a próxima pessoa monte um
// segundo jeito de resolver o mesmo caminho.
export { caminhoDoLocal }
