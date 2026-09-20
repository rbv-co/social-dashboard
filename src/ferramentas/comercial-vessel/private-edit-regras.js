/* AS REGRAS DA TELA DO PRIVATE EDIT — editar, apagar, arquivar e "ver quem foi".
 *
 * ⚠️ POR QUE ISTO NÃO MORA NO `.vue`: arquivo `.vue` não roda na suíte
 * (`npm test` só pega `.js`/`.mjs`). Uma regra escrita só no template — "que
 * frase aparece para qual `situacao`", "quando o botão muda de nome" — nunca
 * seria testada, e é exatamente o tipo de regra que uma refatoração de tela
 * quebra sem ninguém perceber. Aqui, cada uma tem um teste ao lado.
 *
 * ⚠️ AS QUATRO SITUAÇÕES DE `vessel_private_edit_editar`, sem tratar a quarta
 * como as três: `ok`, `sem_permissao`, `nao_achei` e `stylist_nao_achei`. O
 * brief da tarefa listava só três — a quarta nasceu depois, do jeito que
 * `editar` deixa a stylist ser trocada, e merece a própria frase: dizer
 * "não achei o encontro" para um código de stylist errado manda quem lê
 * procurar no lugar errado.
 */

/** A frase de erro de `editar`, para cada `situacao` que a função devolve. */
export function mensagemDeEditar(situacao) {
  switch (situacao) {
    case 'ok':
      return ''
    case 'sem_permissao':
      return 'Você não tem a permissão de Atendimentos para editar encontros.'
    case 'nao_achei':
      return 'Não achei mais este encontro — a lista pode ter mudado. Recarregue e tente de novo.'
    case 'stylist_nao_achei':
      return 'Não achei esta stylist. Confira o código — ele é o STY-0000 dela.'
    default:
      return 'Não consegui salvar agora. Tente de novo em um instante.'
  }
}

/**
 * A frase de erro de `arquivar`, para cada `situacao`.
 * ⚠️ `arquivar` não tem uma quarta situação — só `ok`, `sem_permissao` e
 * `nao_achei` — mas repetir esta função em vez de reusar `mensagemDeEditar`
 * evita que as duas passem a divergir por engano se um dia `editar` ganhar
 * mais uma situação só dela.
 */
export function mensagemDeArquivar(situacao) {
  switch (situacao) {
    case 'ok':
      return ''
    case 'sem_permissao':
      return 'Você não tem a permissão de Atendimentos para arquivar encontros.'
    case 'nao_achei':
      return 'Não achei mais este encontro — a lista pode ter mudado. Recarregue e tente de novo.'
    default:
      return 'Não consegui gravar agora. Tente de novo em um instante.'
  }
}

/**
 * "Este encontro já tem N convidada(s)...", a frase que troca o botão de
 * apagar quando `vessel_private_edit_apagar` devolve `situacao: 'tem_gente'`.
 *
 * ⚠️ NÃO É UM ERRO — é a explicação de por que apagar está fora de questão, e
 * as DUAS saídas de verdade (encerrar ou arquivar). Um "erro" vermelho aqui
 * diria "tente de novo", quando tentar de novo dá exatamente a mesma recusa
 * sempre: apagar um encontro com gente pendurada nunca vai ser permitido.
 */
export function mensagemDeTemGente(quantasResponderam) {
  const n = Number(quantasResponderam) || 0
  const convidadas = n === 1 ? '1 convidada' : `${n} convidada(s)`
  const pronome = n === 1 ? 'ela' : 'elas'
  return `Este encontro já tem ${convidadas}. Apagar deixaria ${pronome} sem `
    + 'encontro e a receita somando sobre algo que não existe mais. Dá para '
    + 'encerrar (continua no histórico) ou arquivar (sai das contas e da lista).'
}

/**
 * A frase de erro de `apagar` para as situações que NÃO são `tem_gente`
 * (essa tem função própria acima, porque não é um erro).
 */
export function mensagemDeApagar(situacao) {
  switch (situacao) {
    case 'ok':
      return ''
    case 'sem_permissao':
      return 'Você não tem a permissão de Atendimentos para apagar encontros.'
    case 'nao_achei':
      return 'Não achei mais este encontro — a lista pode ter mudado. Recarregue e tente de novo.'
    default:
      return 'Não consegui apagar agora. Tente de novo em um instante.'
  }
}

/**
 * O selo do encontro: texto e classe visual.
 *
 * ⚠️ ARQUIVADA NÃO É ENCERRADA. Encerrada aconteceu e continua contando —
 * arquivada é o que não devia ter ficado ali (duplicata, engano de digitação)
 * e sai das contas e da lista por padrão. Confundir as duas no selo é dizer
 * "isto foi um evento de verdade que terminou" para uma linha que a operação
 * está tentando dizer que NUNCA devia ter existido.
 */
export function seloDoEncontro(e) {
  if (e?.arquivada) return { texto: 'Arquivada', classe: 'cv-selo-fim' }
  if (e?.ativa === false) return { texto: 'Encerrada', classe: 'cv-selo-fim' }
  return { texto: 'Aceitando', classe: 'cv-selo-viva' }
}

/** O rótulo do botão de arquivar/desarquivar — o oposto do estado atual. */
export function rotuloDeArquivar(arquivada) {
  return arquivada ? 'Desarquivar' : 'Arquivar…'
}

// ── as convidadas ───────────────────────────────────────────────────────────

/** "Sim" / "Não" / "—" — nunca deixa `rsvp` cru chegar à tela. */
export function rsvpLegivel(rsvp) {
  if (rsvp === 'sim') return 'Sim'
  if (rsvp === 'nao') return 'Não'
  return '—'
}

/**
 * "Confirmou" é um degrau da jornada, não o mesmo campo que "compareceu": uma
 * convidada pode confirmar e não vir (`no_show`), e a tabela tem coluna para
 * as duas perguntas separadas.
 */
export function confirmouLegivel(status) {
  return ['confirmado', 'realizado', 'no_show'].includes(status) ? 'Sim' : '—'
}

/** "Compareceu" distingue quem veio, quem confirmou e faltou, e quem nem isso. */
export function compareceuLegivel(status) {
  if (status === 'realizado') return 'Sim'
  if (status === 'no_show') return 'Não veio'
  return '—'
}

/** "Comprou" é sempre Sim/— — nunca um "Não" que sugira que ela foi conferida e recusada. */
export function comprouLegivel(comprou) {
  return comprou ? 'Sim' : '—'
}

/**
 * `YYYY-MM-DDTHH:mm`, o formato que o `<input type="datetime-local">` espera,
 * a partir de um timestamptz ISO — em hora LOCAL do navegador, igual ao valor
 * que o mesmo campo devolve ao ser lido (ver `criar()` na tela: manda o valor
 * do campo direto para `new Date(...)`, que o motor lê como hora local).
 *
 * ⚠️ NÃO USAR `toISOString()` AQUI: ela devolve UTC, e o campo reinterpretaria
 * esse texto como se fosse hora local — um encontro às 19h em São Paulo
 * (22h UTC) abriria o formulário de editar mostrando "22h", e salvar sem
 * mexer em mais nada empurraria o encontro 3 horas para a frente.
 */
export function paraCampoDatetimeLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
    + `T${p2(d.getHours())}:${p2(d.getMinutes())}`
}
