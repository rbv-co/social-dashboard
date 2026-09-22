// Traduz a falha de uma busca para uma frase que o usuário entende.
// Regra do projeto: o Breno lê "sua sessão expirou", não "PGRST301".
//
// Existe porque o sb() antigo devolvia [] para tudo: "não tem nada", "falhou" e
// "você não tem permissão" ficavam idênticos na tela.

export const ERRO_DE_REDE = Object.freeze({
  tipo: 'rede',
  mensagem: 'Sem conexão com o servidor.',
  acao: 'tentar',
})

/* A CONTA FOI DESATIVADA em Administração (21/09/2026).
 *
 * Não é falha de rede nem de permissão de uma tela: é a conta inteira. A ação é
 * nula de propósito — "tentar de novo" não resolve, e "entrar de novo" mandaria
 * a pessoa bater na porta fechada outra vez. */
export const CONTA_DESATIVADA = Object.freeze({
  tipo: 'conta-desativada',
  mensagem: 'Esta conta foi desativada. Fale com quem administra a Central.',
  acao: null,
})

export function classificarErro(status, corpo) {
  const codigo = corpo?.code || ''

  if (status === 401 || codigo === 'PGRST301') {
    return { tipo: 'sessao', mensagem: 'Sua sessão expirou — entre de novo.', acao: 'entrar' }
  }
  if (status === 403 || codigo === '42501') {
    return { tipo: 'permissao', mensagem: 'Você não tem permissão para ver isso.', acao: null }
  }
  // Qualquer outra coisa (5xx, status inesperado) é problema do servidor, não do usuário.
  return { tipo: 'servidor', mensagem: 'O servidor não respondeu. Tente de novo.', acao: 'tentar' }
}
