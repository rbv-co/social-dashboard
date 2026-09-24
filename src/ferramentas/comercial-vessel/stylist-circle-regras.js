/* AS REGRAS DA TELA DO STYLIST CIRCLE — cadastrar, corrigir e desativar
 * parceira.
 *
 * ⚠️ POR QUE ISTO NÃO MORA NO `.vue`: a mesma explicação de
 * `private-edit-regras.js` e `beauty-sessions-regras.js`, as duas telas irmãs
 * que já levaram Critical porque a regra estava só no template — arquivo
 * `.vue` não roda na suíte (`npm test` só pega `.js`/`.mjs`). QUEM PODE CLICAR
 * em qual botão e SOBRE QUE LISTA um total é somado são exatamente as duas
 * regras que escaparam de teste lá; aqui elas nascem como função pura, com
 * teste ao lado, e o `.vue` só CHAMA — nunca reimplementa.
 *
 * ⚠️ R13: esta tela usa `is_vessel_atendimentos_editar()` desde que nasceu —
 * `vessel_stylist_criar`, `_editar` e `_desativar` já checam a trava de
 * MEXER dentro de si (ver `2026-09-19-vessel-stylist-mexer.sql`). Não há aqui
 * uma versão "antiga" que usava a trava de ver, então não há uma segunda
 * migration de aperto — mas a regra de QUAL BOTÃO aparece atrás de qual trava
 * mora aqui do mesmo jeito, pelo mesmo motivo: só teste de função pura nunca
 * vê se o template esqueceu o `v-if`.
 */
import { proporcaoDoConjunto } from './estatistica.js'

/**
 * Quais ações exigem `hasPermission('atendimentos', 'editar')`.
 *
 * ⚠️ "REATIVAR" ENTRA JUNTO COM "DESATIVAR": são o mesmo botão, chamando a
 * mesma função (`vessel_stylist_desativar`) com `p_ativa` trocado — não duas
 * ações diferentes. Um `v-else` sem o MESMO gate do `v-if` foi exatamente o
 * Critical que a tela irmã do Private Edit levou com Encerrar/Reabrir.
 */
export const ACOES_QUE_EXIGEM_EDITAR = ['criar', 'editar', 'desativar', 'reativar']

export function podeExecutarAcao(acao, podeEditar) {
  if (ACOES_QUE_EXIGEM_EDITAR.includes(acao)) return !!podeEditar
  return true // leitura (copiar o link, por exemplo) não pede editar
}

/**
 * Os números do bloco "Todas as stylists juntas", a partir de UMA lista.
 *
 * ⚠️ QUEM CHAMA DECIDE A LISTA, E TEM DE SER SEMPRE A FILTRADA: esta função
 * não sabe nada sobre filtro — ela soma o que recebe. A mesma defesa das duas
 * irmãs, criada depois de um Critical em que o total somava a lista CHEIA ao
 * lado de uma contagem que já seguia o filtro.
 */
export function calcularConjunto(lista) {
  const l = Array.isArray(lista) ? lista : []
  return {
    totalStylists: l.length,
    totalAberturas: l.reduce((s, x) => s + (Number(x?.aberturas) || 0), 0),
    totalReceita: l.reduce((s, x) => s + (Number(x?.receita) || 0), 0),
    conjuntoClientes: proporcaoDoConjunto(l, 'clientes', 'aberturas'),
    // A régua da venda vem do banco e é a mesma para todas as linhas.
    janela: l[0]?.janela_de_venda_em_dias ?? null,
  }
}

/**
 * As duas situações em que a tela TEM DE VOLTAR AO BANCO com
 * `p_incluir_desativadas: true` antes de filtrar.
 *
 * ⚠️ NÃO É `precisaDoBanco` DE `filtros.js`: aquela função pergunta pela
 * situação "arquivada" (Private Edit e Beauty Session). O Stylist Circle não
 * tem arquivada — tem ativa/desativada, e a função de conta já chega SEM as
 * desativadas por padrão (`p_incluir_desativadas boolean default false`).
 * Um array que nunca as recebeu não passa a tê-las só porque o filtro de tela
 * mudou — o mesmo buraco que `precisaDoBanco` existe para evitar na irmã.
 */
export function precisaDasDesativadas(situacao) {
  return situacao === 'encerradas' || situacao === 'todas'
}

/** A frase de erro/situação de `vessel_stylist_criar`, uma por `situacao`. */
export function mensagemDeCriar(situacao) {
  switch (situacao) {
    case 'ok':
      return ''
    case 'sem_permissao':
      return 'Você não tem a permissão de Atendimentos para cadastrar parceira.'
    case 'sem_nome':
      return 'Escreva o nome da parceira.'
    case 'whatsapp_invalido':
      return 'Este WhatsApp não dá para usar. Confira o número (com DDD).'
    case 'praca_invalida':
      return 'Escolha uma praça da lista.'
    case 'loja_invalida':
      return 'Escolha uma loja da lista.'
    case 'origem_invalida':
      return 'Diga como a parceira chegou: indicação, pesquisa, evento ou veio sozinha.'
    case 'prospeccao_no_futuro':
      return 'A data da prospecção não pode ser depois de hoje.'
    case 'whatsapp_repetido':
      return 'Já existe uma parceira com este WhatsApp.'
    // ⚠️ WHATSAPP OU INSTAGRAM (24/09/2026): a parceira pode entrar só com o perfil.
    case 'sem_contato':
      return 'Escreva o WhatsApp (com DDD) ou o Instagram da parceira — um dos dois basta.'
    case 'instagram_invalido':
      return 'Sem WhatsApp, o Instagram precisa ser um perfil: @perfil ou o endereço dele.'
    case 'instagram_repetido':
      return 'Já existe uma parceira com este Instagram.'
    case 'instagram_longo':
      return 'O Instagram ficou longo demais. Use só o @ ou o endereço.'
    case 'observacoes_longas':
      return 'As observações passaram de 2.000 caracteres. Resuma um pouco.'
    case 'estagio_invalido':
      return 'Uma parceira nova entra em Prospectado ou Identificada.'
    case 'identificada_sem_prospeccao':
      return 'Identificada ainda não tem data da prospecção — deixe a data vazia.'
    case 'sem_codigo_livre':
      return 'Não sobrou código livre agora. Tente de novo em um instante.'
    case 'codigo_em_disputa':
      return 'Duas pessoas cadastraram ao mesmo tempo. Tente de novo.'
    case 'conflito_no_cadastro':
      return 'Não consegui cadastrar agora. Tente de novo em um instante.'
    default:
      return 'Não consegui cadastrar agora. Tente de novo em um instante.'
  }
}

/** A frase de erro de `vessel_stylist_editar`, uma por `situacao`. */
export function mensagemDeEditar(situacao) {
  switch (situacao) {
    case 'ok':
      return ''
    case 'sem_permissao':
      return 'Você não tem a permissão de Atendimentos para corrigir parceira.'
    case 'nao_achei':
      return 'Não achei mais esta parceira — a lista pode ter mudado. Recarregue e tente de novo.'
    case 'whatsapp_invalido':
      return 'Este WhatsApp não dá para usar. Confira o número (com DDD).'
    case 'whatsapp_repetido':
      return 'Já existe outra parceira com este WhatsApp.'
    case 'instagram_invalido':
      return 'Sem WhatsApp, o Instagram precisa ser um perfil: @perfil ou o endereço dele.'
    case 'instagram_repetido':
      return 'Já existe outra parceira com este Instagram.'
    case 'instagram_longo':
      return 'O Instagram ficou longo demais. Use só o @ ou o endereço.'
    case 'observacoes_longas':
      return 'As observações passaram de 2.000 caracteres. Resuma um pouco.'
    // ⚠️ AS DUAS DA ETAPA "IDENTIFICADA" também dizem por quê — tentar de novo
    // dá a mesma resposta.
    case 'volta_para_identificada':
      return 'Não dá para voltar para Identificada: ela perderia a data da prospecção. Use uma saída.'
    case 'identificada_sem_prospeccao':
      return 'Enquanto ela está Identificada, a data da prospecção fica vazia. Ela ganha a data quando avançar.'
    case 'praca_invalida':
      return 'Escolha uma praça da lista.'
    case 'loja_invalida':
      return 'Escolha uma loja da lista.'
    case 'origem_invalida':
      return 'Escolha a origem do contato da lista.'
    case 'prospeccao_no_futuro':
      return 'A data da prospecção não pode ser depois de hoje.'
    case 'estagio_invalido':
      return 'Escolha um estágio da lista.'
    // ⚠️ AS DUAS RECUSAS DO FUNIL NÃO SÃO "TENTE DE NOVO": tentar de novo dá a
    // mesma resposta sempre, e a frase precisa dizer por quê.
    case 'estagio_automatico':
      return 'Este estágio o sistema marca sozinho, a partir dos encontros.'
    case 'estagio_contradiz_encontro':
      return 'Ela já tem encontro marcado: não volta para um estágio de antes dele.'
    default:
      return 'Não consegui salvar agora. Tente de novo em um instante.'
  }
}

/** A frase de erro de `vessel_stylist_desativar` (desativar OU reativar). */
export function mensagemDeDesativar(situacao) {
  switch (situacao) {
    case 'ok':
      return ''
    case 'sem_permissao':
      return 'Você não tem a permissão de Atendimentos para mexer nesta parceira.'
    case 'nao_achei':
      return 'Não achei mais esta parceira — a lista pode ter mudado. Recarregue e tente de novo.'
    default:
      return 'Não consegui gravar agora. Tente de novo em um instante.'
  }
}

/** O rótulo do botão — o oposto do estado atual. */
export function rotuloDeDesativar(ativa) {
  return ativa === false ? 'Reativar' : 'Desativar…'
}

/**
 * O que está errado numa parceira nova, em frases da operação.
 *
 * ⚠️ ESPELHA SÓ AS DUAS CONFERÊNCIAS QUE `vessel_stylist_criar` FAZ ANTES DE
 * QUALQUER OUTRA COISA — nome vazio e nenhum contato (nem WhatsApp, nem
 * Instagram; desde 24/09/2026 um dos dois basta). O resto
 * (formato exato do telefone, praça, WhatsApp repetido) é do banco: ele já
 * devolve a frase certa em português, e repetir a validação aqui só criaria
 * uma segunda verdade que pode divergir da primeira. `praca` é OPCIONAL para
 * criar (`p_praca default null`) — diferente da Private Edit, onde a praça é
 * obrigatória porque vira parte do código do encontro.
 */
export function problemasDaParceira({ nome, whatsapp, instagram, origem } = {}) {
  const problemas = []
  if (!nome || !String(nome).trim()) problemas.push('Escreva o nome da parceira.')
  // ⚠️ WHATSAPP OU INSTAGRAM (24/09/2026, pedido do dono): um dos dois basta.
  // Se ela só tem o perfil, o perfil é o contato — o banco confere se é um
  // perfil de verdade (`instagram_invalido`).
  const temFone = !!whatsapp && String(whatsapp).replace(/\D/g, '').length > 0
  const temInsta = !!instagram && String(instagram).trim().length > 0
  if (!temFone && !temInsta) {
    problemas.push('Escreva o WhatsApp (com DDD) ou o Instagram da parceira — um dos dois basta.')
  }
  // ⚠️ T11: na Central a origem do contato é obrigatória — o banco recusa sem
  // ela (`origem_invalida`), e pedir aqui evita a ida e volta.
  if (origem !== undefined && !String(origem || '').trim()) {
    problemas.push('Diga como ela chegou (origem do contato).')
  }
  return problemas
}
