/* AS REGRAS DA TELA DE BEAUTY SESSIONS — filtrar, editar, apagar e arquivar.
 *
 * ⚠️ POR QUE ISTO NÃO MORA NO `.vue`: a mesma explicação de
 * `../comercial-vessel/private-edit-regras.js`, a tela irmã que já levou dois
 * Critical porque a regra estava só no template — arquivo `.vue` não roda na
 * suíte (`npm test` só pega `.js`/`.mjs`). QUEM PODE CLICAR em qual botão e
 * SOBRE QUE LISTA um total é somado são exatamente as duas regras que
 * escaparam de teste lá: aqui elas nascem como função pura, com teste ao
 * lado, e o `.vue` só CHAMA — nunca reimplementa.
 *
 * ⚠️ R13: "Encerrar" e "Reabrir" também exigem `atendimentos` → `editar`
 * agora — a migration `2026-09-19-vessel-encerrar-exige-editar.sql` apertou
 * `vessel_beauty_session_encerrar` para a MESMA trava que `editar`, `apagar` e
 * `arquivar` já usavam (`vessel_beauty_session_mexer.sql`,
 * `is_vessel_atendimentos_editar()`). A lista abaixo é a mesma da tela irmã,
 * de propósito: as duas famílias compartilham a regra, não por acaso.
 */
import { proporcao } from '../comercial-vessel/estatistica.js'

/**
 * Quais ações cada sessão permite, dado só se a pessoa TEM a permissão de
 * editar (`hasPermission('atendimentos', 'editar')`).
 *
 * "Ver quem foi"/leitura não existe nesta tela (Beauty Session não tem lista
 * de convidadas — só a contagem de leituras do QR), então esta lista cobre
 * as cinco ações que ESCREVEM na sessão.
 */
export const ACOES_QUE_EXIGEM_EDITAR = ['encerrar', 'reabrir', 'editar', 'arquivar', 'apagar']

export function podeExecutarAcao(acao, podeEditar) {
  if (ACOES_QUE_EXIGEM_EDITAR.includes(acao)) return !!podeEditar
  return true
}

/**
 * Os números do bloco "Todas as sessões juntas", a partir de UMA lista.
 *
 * ⚠️ QUEM CHAMA DECIDE A LISTA, E TEM DE SER SEMPRE A FILTRADA: esta função
 * não sabe nada sobre filtro — ela soma o que recebe. É a mesma defesa da
 * irmã `calcularConjunto` (private-edit-regras.js), criada depois de um
 * Critical em que o total somava a lista CHEIA ao lado de uma contagem que já
 * seguia o filtro. Centralizar a soma aqui, testável, é o que torna esse
 * descompasso impossível de reintroduzir em silêncio.
 *
 * ⚠️ A CONVERSÃO DO CONJUNTO SOMA NUMERADOR E DENOMINADOR, não é a média das
 * taxas de cada sessão: uma sessão de 4 leituras pesaria igual a uma de 200.
 */
export function calcularConjunto(lista) {
  const l = Array.isArray(lista) ? lista : []
  const somar = (campo) => l.reduce((s, x) => s + (Number(x?.[campo]) || 0), 0)
  const mesa = somar('leituras_mesa')
  const cartao = somar('leituras_cartao')
  return {
    totalSessoes: l.length,
    totalMesa: mesa,
    totalCartao: cartao,
    totalPessoas: somar('pessoas'),
    totalCompareceram: somar('compareceram'),
    totalReceita: somar('receita'),
    conversao: proporcao(somar('pessoas'), mesa + cartao),
  }
}

/** A frase de erro de `editar`, para cada `situacao` que a função devolve. */
export function mensagemDeEditar(situacao) {
  switch (situacao) {
    case 'ok':
      return ''
    case 'sem_permissao':
      return 'Você não tem a permissão de Atendimentos para editar sessões.'
    case 'nao_achei':
      return 'Não achei mais esta sessão — a lista pode ter mudado. Recarregue e tente de novo.'
    default:
      return 'Não consegui salvar agora. Tente de novo em um instante.'
  }
}

/** A frase de erro de `arquivar`, para cada `situacao`. */
export function mensagemDeArquivar(situacao) {
  switch (situacao) {
    case 'ok':
      return ''
    case 'sem_permissao':
      return 'Você não tem a permissão de Atendimentos para arquivar sessões.'
    case 'nao_achei':
      return 'Não achei mais esta sessão — a lista pode ter mudado. Recarregue e tente de novo.'
    default:
      return 'Não consegui gravar agora. Tente de novo em um instante.'
  }
}

/**
 * A frase de erro de `apagar` para as situações que NÃO são `tem_gente`
 * (essa tem função própria abaixo, porque não é um erro).
 */
export function mensagemDeApagar(situacao) {
  switch (situacao) {
    case 'ok':
      return ''
    case 'sem_permissao':
      return 'Você não tem a permissão de Atendimentos para apagar sessões.'
    case 'nao_achei':
      return 'Não achei mais esta sessão — a lista pode ter mudado. Recarregue e tente de novo.'
    default:
      return 'Não consegui apagar agora. Tente de novo em um instante.'
  }
}

/**
 * "Esta sessão já teve N leitura(s) do QR..." — a frase que troca o botão de
 * apagar quando `vessel_beauty_session_apagar` devolve `situacao: 'tem_gente'`.
 *
 * ⚠️ NÃO É UM ERRO — é a explicação de por que apagar está fora de questão, e
 * as DUAS saídas de verdade (encerrar ou arquivar). Um "erro" vermelho aqui
 * diria "tente de novo", quando tentar de novo dá exatamente a mesma recusa
 * sempre: apagar uma sessão com leitura pendurada nunca vai ser permitido.
 *
 * ⚠️ AQUI NÃO HÁ O GOTCHA DO ZERO DA IRMÃ (private-edit-regras.js): lá,
 * `tem_gente` olhava `vessel_atendimentos` SEM filtrar `teste` enquanto o
 * número mostrado na tela já vinha filtrado, e por isso podia recusar citando
 * zero. Aqui a recusa olha `vessel_sessao_aberturas`, que não tem coluna
 * `teste` nenhuma (ver `2026-09-18-vessel-contar-as-beauty-sessions.sql`) —
 * o número de leituras que a tela mostra (`leituras_mesa + leituras_cartao`)
 * é a MESMA fonte que a recusa consultou, então citar o número aqui nunca
 * contradiz o motivo da recusa.
 */
export function mensagemDeTemGente(leituras) {
  const n = Number(leituras) || 0
  const plural = n === 1 ? 'leitura' : 'leitura(s)'
  return `Esta sessão já teve ${n} ${plural} do QR. Apagar deixaria essas leituras `
    + 'sem sessão. Dá para encerrar (continua no histórico) ou arquivar (sai das '
    + 'contas e da lista).'
}

/**
 * O selo da sessão: texto e classe visual.
 *
 * ⚠️ ARQUIVADA NÃO É ENCERRADA — a mesma distinção da irmã Private Edit.
 * Encerrada aconteceu e continua contando; arquivada é o que não devia ter
 * ficado ali (duplicata, engano) e sai das contas e da lista por padrão.
 */
/* O `tom` é a cor da situação no cartão e no selo (`id-tom-<tom>`), a mesma
 * régua do Private Edit: aceitando é o que está valendo (verde); encerrada e
 * arquivada saem de cena (cinza) — o que as separa é a palavra do selo, e a
 * arquivada nem aparece na lista sem o filtro pedir. */
export function seloDaSessao(s) {
  if (s?.arquivada) return { texto: 'Arquivada', classe: 'bs-selo-fim', tom: 'parada' }
  if (s?.ativa === false) return { texto: 'Encerrada', classe: 'bs-selo-fim', tom: 'parada' }
  return { texto: 'Aceitando', classe: 'bs-selo-viva', tom: 'viva' }
}

/** O rótulo do botão de arquivar/desarquivar — o oposto do estado atual. */
export function rotuloDeArquivar(arquivada) {
  return arquivada ? 'Desarquivar' : 'Arquivar…'
}
